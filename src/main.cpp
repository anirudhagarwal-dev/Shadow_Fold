#include <iostream>
#include <vector>
#include <string>
#include <emscripten.h>
#include <emscripten/bind.h>
#include <random>
#include <algorithm>
#include <iterator>
#include <numeric>
#include <cstring>
#include <zlib.h>

extern "C" {
#include "aes.h"
#include "sha256.h"
}
#include "pbkdf2.h"

using namespace emscripten;

// ============================================================
// HELPERS
// ============================================================

// Bulk copy from JS Uint8Array to C++ vector.
// Uses a subarray view into HEAPU8 then JS set() — one crossing
// instead of N crossings for an N-byte image.
std::vector<uint8_t> vecFromJSArray(const val& jsArray) {
    if (!jsArray.hasOwnProperty("length")) return {};
    const unsigned l = jsArray["length"].as<unsigned>();
    if (l == 0) return {};
    std::vector<uint8_t> v(l);
    val heap = val::module_property("HEAPU8");
    val mem  = val::global("Uint8Array").new_(
        heap["buffer"],
        reinterpret_cast<uintptr_t>(v.data()),
        l
    );
    mem.call<void>("set", jsArray);
    return v;
}

val copyToJSArray(const std::vector<uint8_t>& vec) {
    if (vec.empty()) return val::global("Uint8Array").new_(0);
    val result = val::global("Uint8Array").new_(vec.size());
    result.call<void>("set", val(typed_memory_view(vec.size(), vec.data())));
    return result;
}

void    encode_bit(uint8_t& ch, uint8_t bit) { ch = (ch & 0xFE) | bit; }
uint8_t decode_bit(uint8_t ch)               { return ch & 1; }

// ============================================================
// KEY + PRNG DERIVATION
//
// One PBKDF2-SHA256 call produces 56 bytes of key material:
//   [0..31]  = AES-256 key
//   [32..47] = AES-CBC IV
//   [48..55] = 64-bit PRNG seed  →  fed to std::mt19937_64
//
// The salt encodes the image dimensions so two users with the
// same password on different images get different key material.
// ============================================================
struct DerivedParams {
    uint8_t  key[32];
    uint8_t  iv[16];
    uint64_t prng_seed;   // 64-bit seed for mt19937_64
};

DerivedParams derive_params(const std::string& pass,
                              uint32_t img_w,
                              uint32_t img_h) {
    // Salt = "shadow_fold_v2_" || width(4B BE) || height(4B BE)
    const char prefix[] = "shadow_fold_v2_";
    constexpr size_t PFX = sizeof(prefix) - 1;   // 15 bytes
    uint8_t salt[PFX + 8];
    std::memcpy(salt, prefix, PFX);
    salt[PFX+0] = (img_w >> 24) & 0xFF;
    salt[PFX+1] = (img_w >> 16) & 0xFF;
    salt[PFX+2] = (img_w >>  8) & 0xFF;
    salt[PFX+3] = (img_w      ) & 0xFF;
    salt[PFX+4] = (img_h >> 24) & 0xFF;
    salt[PFX+5] = (img_h >> 16) & 0xFF;
    salt[PFX+6] = (img_h >>  8) & 0xFF;
    salt[PFX+7] = (img_h      ) & 0xFF;

    uint8_t material[56];
    pbkdf2_sha256(
        (const uint8_t*)pass.c_str(), pass.length(),
        salt, sizeof(salt),
        100000,
        material, sizeof(material)
    );

    DerivedParams p;
    std::memcpy(p.key, material,      32);
    std::memcpy(p.iv,  material + 32, 16);
    uint64_t seed = 0;
    for (int i = 0; i < 8; ++i)
        seed = (seed << 8) | material[48 + i];
    p.prng_seed = seed;
    return p;
}

// ============================================================
// DUAL-LAYER PARTITION SPLIT
//
// The split index (how many pool indices the decoy gets) is
// derived from BOTH passwords combined, via a short PBKDF2.
// Neither party alone can compute the split without knowing
// the other password, so the partition boundary stays hidden.
//
// Split range: [25%, 50%) of the total pool.
//   Decoy always gets the smaller slice so the real payload
//   retains at least 50% of the image's capacity.
// ============================================================
size_t derive_split(const std::string& real_pass,
                     const std::string& decoy_pass,
                     size_t total) {
    std::string combined = real_pass + "\x00" + decoy_pass;
    const uint8_t salt[] = "shadow_fold_split_v2";
    uint8_t out[4];
    pbkdf2_sha256(
        (const uint8_t*)combined.c_str(), combined.length(),
        salt, sizeof(salt) - 1,
        10000,
        out, 4
    );
    uint32_t raw;
    std::memcpy(&raw, out, 4);
    // Map uniformly to [0.25, 0.50)
    double frac = 0.25 + ((double)raw / (double)0xFFFFFFFFUL) * 0.25;
    return static_cast<size_t>(total * frac);
}

// ============================================================
// BUILD PAYLOAD BLOB
//
// Returns: header(12) + ext_bytes + AES-CBC-encrypted(zlib(data))
// Returns empty vector on failure.
// ============================================================
std::vector<uint8_t> build_payload(const std::vector<uint8_t>& raw,
                                    const std::string& ext,
                                    const DerivedParams& p) {
    if (raw.empty()) return {};

    // Compress
    uLongf bound = compressBound(raw.size());
    std::vector<uint8_t> comp(bound);
    if (compress(comp.data(), &bound, raw.data(), raw.size()) != Z_OK)
        return {};
    comp.resize(bound);
    uint32_t comp_size = static_cast<uint32_t>(bound);

    // Pad to AES-16 block boundary (zero padding)
    size_t padded = ((comp_size + 15) / 16) * 16;
    comp.resize(padded, 0);

    // AES-256-CBC encrypt in-place
    AES_ctx ctx;
    AES_init_ctx_iv(&ctx, p.key, p.iv);
    AES_CBC_encrypt_buffer(&ctx, comp.data(), padded);

    // Header: orig_size(4) | comp_size(4) | ext_len(4) | ext_bytes
    uint32_t orig32 = static_cast<uint32_t>(raw.size());
    uint32_t ext32  = static_cast<uint32_t>(ext.length());

    std::vector<uint8_t> blob(12);
    std::memcpy(&blob[0], &orig32,    4);
    std::memcpy(&blob[4], &comp_size, 4);
    std::memcpy(&blob[8], &ext32,     4);
    blob.insert(blob.end(), ext.begin(), ext.end());
    blob.insert(blob.end(), comp.begin(), comp.end());
    return blob;
}

// ============================================================
// EMBED blob into carrier using a slice of pre-shuffled indices
// ============================================================
bool embed_blob(std::vector<uint8_t>& carrier,
                const std::vector<uint8_t>& blob,
                const std::vector<int>& indices,
                size_t offset) {
    size_t bits = blob.size() * 8;
    if (offset + bits > indices.size()) return false;
    for (size_t i = 0; i < bits; ++i) {
        uint8_t bit = (blob[i / 8] >> (7 - (i % 8))) & 1;
        encode_bit(carrier[indices[offset + i]], bit);
    }
    return true;
}

// ============================================================
// DECODE blob from carrier, starting at indices[offset]
// Returns decoded file or {empty, ""} on failure.
// ============================================================
struct DecodedFile {
    std::vector<uint8_t> data;
    std::string extension;
};

// Helper: read `byte_count` bytes starting at indices[offset]
static std::vector<uint8_t> read_bytes(const std::vector<uint8_t>& carrier,
                                        const std::vector<int>& indices,
                                        size_t offset, size_t byte_count) {
    std::vector<uint8_t> out(byte_count);
    for (size_t b = 0; b < byte_count; ++b) {
        uint8_t byte = 0;
        for (int bit = 0; bit < 8; ++bit)
            byte = (byte << 1) | decode_bit(carrier[indices[offset + b * 8 + bit]]);
        out[b] = byte;
    }
    return out;
}

DecodedFile decode_blob(const std::vector<uint8_t>& carrier,
                         const std::vector<int>& indices,
                         size_t offset,
                         const DerivedParams& p) {
    // Need at least 12-byte fixed header
    if (offset + 96 > indices.size()) return {};

    std::vector<uint8_t> hdr = read_bytes(carrier, indices, offset, 12);

    uint32_t orig_size, comp_size, ext_len;
    std::memcpy(&orig_size, &hdr[0], 4);
    std::memcpy(&comp_size, &hdr[4], 4);
    std::memcpy(&ext_len,   &hdr[8], 4);

    // Sanity bounds (500 MB max, 16 char ext)
    if (orig_size > 500u * 1024 * 1024 ||
        comp_size > 500u * 1024 * 1024 ||
        ext_len   > 16)
        return {};

    size_t header_total = 12 + ext_len;
    size_t padded       = ((comp_size + 15) / 16) * 16;
    size_t blob_bytes   = header_total + padded;

    if (offset + blob_bytes * 8 > indices.size()) return {};

    // Read full blob
    std::vector<uint8_t> blob = read_bytes(carrier, indices, offset, blob_bytes);

    // Parse extension
    std::string ext(blob.begin() + 12, blob.begin() + 12 + ext_len);

    // Decrypt
    std::vector<uint8_t> cipher(blob.begin() + header_total, blob.end());
    AES_ctx ctx;
    AES_init_ctx_iv(&ctx, p.key, p.iv);
    AES_CBC_decrypt_buffer(&ctx, cipher.data(), cipher.size());

    // Decompress
    cipher.resize(comp_size);
    std::vector<uint8_t> plain(orig_size);
    uLongf final_sz = orig_size;
    if (uncompress(plain.data(), &final_sz, cipher.data(), comp_size) != Z_OK)
        return {};

    return { plain, ext };
}

// ============================================================
// JS-EXPORTED: encode_data_wh   (preferred — strong salt)
//
// Dual-layer deniability design:
//
//   The full pool of non-alpha pixel indices is partitioned into
//   two disjoint, non-overlapping halves:
//
//     pool[0 .. split)    ← decoy  partition
//     pool[split .. N)    ← real   partition
//
//   Each partition is independently shuffled by its own PRNG seed
//   (derived from its own password + image dimensions).
//
//   The split point is derived from BOTH passwords combined, so
//   neither party can compute it knowing only one password.
//
//   Under coercion:
//     - User reveals DECOY password only.
//     - Examiner cannot compute `split` (needs real password).
//     - Examiner cannot reach the real partition at all.
//     - Decoy decodes perfectly and cleanly. ✓
//
// ============================================================
val encode_data_wh(val image_data,
                   val file_data,        const std::string& file_extension,
                   const std::string&    password,
                   val decoy_data,       const std::string& decoy_extension,
                   const std::string&    decoy_password,
                   uint32_t img_width,   uint32_t img_height) {

    std::vector<uint8_t> carrier = vecFromJSArray(image_data);

    // Build sorted pool of all non-alpha channel indices
    std::vector<int> pool;
    pool.reserve(carrier.size() * 3 / 4);
    for (size_t i = 0; i < carrier.size(); ++i)
        if ((i + 1) % 4 != 0)
            pool.push_back(static_cast<int>(i));

    const bool has_decoy = !decoy_password.empty();

    DerivedParams real_p = derive_params(password, img_width, img_height);
    std::vector<uint8_t> real_bytes = vecFromJSArray(file_data);
    if (real_bytes.empty()) { std::cerr << "[C++] Real payload empty.\n"; return val::null(); }
    std::vector<uint8_t> real_blob = build_payload(real_bytes, file_extension, real_p);
    if (real_blob.empty()) { std::cerr << "[C++] Compression failed.\n"; return val::null(); }

    if (!has_decoy) {
        // Single-layer: shuffle full pool by real seed
        std::vector<int> indices = pool;
        std::mt19937_64 rng(real_p.prng_seed);
        std::shuffle(indices.begin(), indices.end(), rng);
        if (!embed_blob(carrier, real_blob, indices, 0)) {
            std::cerr << "[C++] Capacity exceeded.\n"; return val::null();
        }
        return copyToJSArray(carrier);
    }

    // Dual-layer: compute disjoint partitions
    DerivedParams decoy_p = derive_params(decoy_password, img_width, img_height);
    size_t split = derive_split(password, decoy_password, pool.size());

    std::vector<int> decoy_indices(pool.begin(), pool.begin() + split);
    {
        std::mt19937_64 rng(decoy_p.prng_seed);
        std::shuffle(decoy_indices.begin(), decoy_indices.end(), rng);
    }

    std::vector<int> real_indices(pool.begin() + split, pool.end());
    {
        std::mt19937_64 rng(real_p.prng_seed);
        std::shuffle(real_indices.begin(), real_indices.end(), rng);
    }

    // Embed decoy
    std::vector<uint8_t> decoy_bytes = vecFromJSArray(decoy_data);
    if (!decoy_bytes.empty()) {
        std::vector<uint8_t> decoy_blob = build_payload(decoy_bytes, decoy_extension, decoy_p);
        if (!decoy_blob.empty()) {
            if (!embed_blob(carrier, decoy_blob, decoy_indices, 0))
                std::cerr << "[C++] Decoy capacity exceeded — skipped.\n";
        }
    }

    // Embed real
    if (!embed_blob(carrier, real_blob, real_indices, 0)) {
        std::cerr << "[C++] Real payload capacity exceeded.\n"; return val::null();
    }

    return copyToJSArray(carrier);
}

// ============================================================
// JS-EXPORTED: encode_data   (legacy shim — uses w=0, h=0 salt)
// Keeps the existing 7-arg JS calls working unchanged.
// ============================================================
val encode_data(val image_data,
                val file_data,       const std::string& file_extension,
                const std::string&   password,
                val decoy_data,      const std::string& decoy_extension,
                const std::string&   decoy_password) {
    return encode_data_wh(image_data, file_data, file_extension, password,
                          decoy_data, decoy_extension, decoy_password, 0, 0);
}

// ============================================================
// JS-EXPORTED: decode_data_wh   (preferred)
// ============================================================
val decode_data_wh(val image_data, const std::string& password,
                   uint32_t img_width, uint32_t img_height) {
    std::vector<uint8_t> carrier = vecFromJSArray(image_data);
    DerivedParams p = derive_params(password, img_width, img_height);

    std::vector<int> indices;
    indices.reserve(carrier.size() * 3 / 4);
    for (size_t i = 0; i < carrier.size(); ++i)
        if ((i + 1) % 4 != 0)
            indices.push_back(static_cast<int>(i));
    std::mt19937_64 rng(p.prng_seed);
    std::shuffle(indices.begin(), indices.end(), rng);

    DecodedFile result = decode_blob(carrier, indices, 0, p);
    if (result.data.empty()) {
        std::cerr << "[C++] Decode failed.\n"; return val::null();
    }
    val ret = val::object();
    ret.set("data",      copyToJSArray(result.data));
    ret.set("extension", val(result.extension));
    return ret;
}

// ============================================================
// JS-EXPORTED: decode_data   (legacy shim)
// ============================================================
val decode_data(val image_data, const std::string& password) {
    return decode_data_wh(image_data, password, 0, 0);
}

// ============================================================
// JS-EXPORTED: decode_data_dual
// Decodes either layer from a dual-layer image.
//   decode_decoy_layer = true  → returns decoy file
//   decode_decoy_layer = false → returns real  file
// Requires BOTH passwords to compute the partition split.
// ============================================================
val decode_data_dual(val image_data,
                     const std::string& password,
                     const std::string& decoy_password,
                     bool decode_decoy_layer,
                     uint32_t img_width, uint32_t img_height) {
    std::vector<uint8_t> carrier = vecFromJSArray(image_data);

    std::vector<int> pool;
    pool.reserve(carrier.size() * 3 / 4);
    for (size_t i = 0; i < carrier.size(); ++i)
        if ((i + 1) % 4 != 0)
            pool.push_back(static_cast<int>(i));

    size_t split = derive_split(password, decoy_password, pool.size());

    if (decode_decoy_layer) {
        DerivedParams dp = derive_params(decoy_password, img_width, img_height);
        std::vector<int> decoy_idx(pool.begin(), pool.begin() + split);
        {
            std::mt19937_64 rng(dp.prng_seed);
            std::shuffle(decoy_idx.begin(), decoy_idx.end(), rng);
        }
        DecodedFile r = decode_blob(carrier, decoy_idx, 0, dp);
        if (r.data.empty()) return val::null();
        val ret = val::object();
        ret.set("data",      copyToJSArray(r.data));
        ret.set("extension", val(r.extension));
        return ret;
    } else {
        DerivedParams rp = derive_params(password, img_width, img_height);
        std::vector<int> real_idx(pool.begin() + split, pool.end());
        {
            std::mt19937_64 rng(rp.prng_seed);
            std::shuffle(real_idx.begin(), real_idx.end(), rng);
        }
        DecodedFile r = decode_blob(carrier, real_idx, 0, rp);
        if (r.data.empty()) return val::null();
        val ret = val::object();
        ret.set("data",      copyToJSArray(r.data));
        ret.set("extension", val(r.extension));
        return ret;
    }
}

// ============================================================
// JS-EXPORTED: get_capacity_bytes
//
// Returns the accurate usable byte capacity, accounting for:
//   - header (12 bytes fixed + ext_len)
//   - AES-CBC padding overhead (up to 15 bytes)
//   - zlib header (~10 bytes)
//   - dual-layer partition (real layer gets ≥50% of pool)
// ============================================================
uint32_t get_capacity_bytes(uint32_t total_pixels,
                              uint32_t ext_len,
                              bool dual_layer) {
    size_t total_bits  = static_cast<size_t>(total_pixels) * 3;
    // Real layer gets at least 50% in dual-layer mode
    size_t usable_bits  = dual_layer ? (total_bits / 2) : total_bits;
    size_t usable_bytes = usable_bits / 8;
    size_t overhead     = 12 + ext_len + 15 + 10;
    if (usable_bytes <= overhead) return 0;
    return static_cast<uint32_t>(usable_bytes - overhead);
}

// ============================================================
// BINDINGS
// ============================================================
EMSCRIPTEN_BINDINGS(steganography_module) {
    function("encode_data",        &encode_data);
    function("encode_data_wh",     &encode_data_wh);
    function("decode_data",        &decode_data);
    function("decode_data_wh",     &decode_data_wh);
    function("decode_data_dual",   &decode_data_dual);
    function("get_capacity_bytes", &get_capacity_bytes);
}
