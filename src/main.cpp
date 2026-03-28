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

// Use extern "C" to ensure C-style linkage for the C-based AES library
extern "C" {
#include "aes.h"
#include "sha256.h"
}
#include "pbkdf2.h"

using namespace emscripten;

// Helper to convert a JavaScript Uint8Array to a C++ std::vector<uint8_t> safely
std::vector<uint8_t> vecFromJSArray(const val& jsArray) {
    if (!jsArray.hasOwnProperty("length")) return {};
    const auto l = jsArray["length"].as<unsigned>();
    if (l == 0) return {};
    
    std::vector<uint8_t> v(l);
    // Use emscripten::val::call<void>("set", ...) or manual copy for speed
    // typed_memory_view is for C++ -> JS. For JS -> C++, we can use this:
    auto view = val(typed_memory_view(l, v.data()));
    view.call<void>("set", jsArray);
    return v;
}

// Helper to return a copy of C++ data to JS safely
val copyToJSArray(const std::vector<uint8_t>& vec) {
    if (vec.empty()) return val::global("Uint8Array").new_(0);
    val result = val::global("Uint8Array").new_(vec.size());
    result.call<void>("set", val(typed_memory_view(vec.size(), vec.data())));
    return result;
}

// Sets the least significant bit of a byte
void encode_bit(uint8_t& pixel_channel, uint8_t bit) {
    pixel_channel = (pixel_channel & 0xFE) | bit;
}

// Gets the least significant bit of a byte
uint8_t decode_bit(uint8_t pixel_channel) {
    return pixel_channel & 1;
}

// --- ENCODING --- //
val encode_data(val image_data, val file_data, const std::string& file_extension, const std::string& password, 
                val decoy_data, const std::string& decoy_extension, const std::string& decoy_password) {
    std::vector<uint8_t> image_bytes = vecFromJSArray(image_data);
    
    auto embed_payload = [&](std::vector<uint8_t>& carrier, val data, const std::string& ext, const std::string& pass) {
        std::vector<uint8_t> bytes = vecFromJSArray(data);
        if (bytes.empty()) return true;

        uint8_t key_iv[48];
        const uint8_t salt[] = "shadow_fold_salt_v1";
        pbkdf2_sha256((const uint8_t*)pass.c_str(), pass.length(), salt, sizeof(salt) - 1, 100000, key_iv, 48);

        uint8_t key[32], iv[16];
        std::memcpy(key, key_iv, 32);
        std::memcpy(iv, key_iv + 32, 16);

        uLongf compressed_size = compressBound(bytes.size());
        std::vector<uint8_t> compressed_data(compressed_size);
        if (compress(compressed_data.data(), &compressed_size, bytes.data(), bytes.size()) != Z_OK) return false;
        compressed_data.resize(compressed_size);

        size_t padded_size = ((compressed_size + 15) / 16) * 16;
        std::vector<uint8_t> padded_data = compressed_data;
        padded_data.resize(padded_size, 0);

        struct AES_ctx ctx;
        AES_init_ctx_iv(&ctx, key, iv);
        AES_CBC_encrypt_buffer(&ctx, padded_data.data(), padded_size);

        uint32_t original_size = bytes.size();
        uint32_t comp_size = static_cast<uint32_t>(compressed_size);
        uint32_t ext_len = ext.length();
        
        std::vector<uint8_t> header;
        header.resize(12);
        std::memcpy(&header[0], &original_size, 4);
        std::memcpy(&header[4], &comp_size, 4);
        std::memcpy(&header[8], &ext_len, 4);
        header.insert(header.end(), ext.begin(), ext.end());

        std::vector<uint8_t> data_to_embed = header;
        data_to_embed.insert(data_to_embed.end(), padded_data.begin(), padded_data.end());

        uint8_t prng_seed_bytes[4];
        const uint8_t prng_salt[] = "shadow_fold_prng_v1";
        pbkdf2_sha256((const uint8_t*)pass.c_str(), pass.length(), prng_salt, sizeof(prng_salt) - 1, 100000, prng_seed_bytes, 4);
        uint32_t prng_seed;
        std::memcpy(&prng_seed, prng_seed_bytes, 4);

        std::mt19937 rng(prng_seed);
        std::vector<int> pixel_indices;
        for (size_t i = 0; i < carrier.size(); ++i) {
            if ((i + 1) % 4 != 0) pixel_indices.push_back(i);
        }
        
        if ((data_to_embed.size() * 8) > pixel_indices.size()) return false;

        std::shuffle(pixel_indices.begin(), pixel_indices.end(), rng);

        for (size_t i = 0; i < data_to_embed.size() * 8; ++i) {
            uint8_t bit = (data_to_embed[i / 8] >> (7 - (i % 8))) & 1;
            encode_bit(carrier[pixel_indices[i]], bit);
        }
        return true;
    };

    // Embed decoy first (if provided)
    if (!decoy_password.empty()) {
        if (!embed_payload(image_bytes, decoy_data, decoy_extension, decoy_password)) {
            std::cerr << "[C++] Error: Decoy embedding failed (capacity or compression)." << std::endl;
        }
    }

    // Embed real data second (overwrites decoy bits if they collide)
    if (!embed_payload(image_bytes, file_data, file_extension, password)) {
        std::cerr << "[C++] Error: Real embedding failed." << std::endl;
        return val::null();
    }

    return copyToJSArray(image_bytes);
}

// --- DECODING --- //
val decode_data(val image_data, const std::string& password) {
    std::vector<uint8_t> image_bytes = vecFromJSArray(image_data);

    // 1. Re-generate the same deterministic 256-bit key, IV, and pixel order using PBKDF2-SHA256
    uint8_t key_iv[48]; // 32 bytes for AES-256 key, 16 bytes for IV
    const uint8_t salt[] = "shadow_fold_salt_v1";
    pbkdf2_sha256((const uint8_t*)password.c_str(), password.length(), salt, sizeof(salt) - 1, 100000, key_iv, 48);

    uint8_t key[32];
    uint8_t iv[16];
    std::memcpy(key, key_iv, 32);
    std::memcpy(iv, key_iv + 32, 16);

    uint8_t prng_seed_bytes[4];
    const uint8_t prng_salt[] = "shadow_fold_prng_v1";
    pbkdf2_sha256((const uint8_t*)password.c_str(), password.length(), prng_salt, sizeof(prng_salt) - 1, 100000, prng_seed_bytes, 4);
    uint32_t prng_seed;
    std::memcpy(&prng_seed, prng_seed_bytes, 4);

    std::mt19937 rng(prng_seed);
    std::vector<int> pixel_indices;
    pixel_indices.reserve(image_bytes.size() * 3 / 4);
    for (size_t i = 0; i < image_bytes.size(); ++i) {
        if ((i + 1) % 4 != 0) { // Skip Alpha
            pixel_indices.push_back(i);
        }
    }
    std::shuffle(pixel_indices.begin(), pixel_indices.end(), rng);

    // 2. Extract the header bits (original_size + compressed_size + ext_len = 12 bytes = 96 bits)
    std::vector<uint8_t> header_bits;
    for (int i = 0; i < 96; ++i) {
        header_bits.push_back(decode_bit(image_bytes[pixel_indices[i]]));
    }

    // 3. Reconstruct header values
    uint32_t original_size = 0;
    uint32_t compressed_size = 0;
    uint32_t ext_len = 0;
    std::vector<uint8_t> header_bytes;
    for (size_t i = 0; i < header_bits.size(); i += 8) {
        uint8_t byte = 0;
        for (int j = 0; j < 8; ++j) byte = (byte << 1) | header_bits[i + j];
        header_bytes.push_back(byte);
    }
    std::memcpy(&original_size, &header_bytes[0], 4);
    std::memcpy(&compressed_size, &header_bytes[4], 4);
    std::memcpy(&ext_len, &header_bytes[8], 4);

    // 4. Extract file extension string
    std::vector<uint8_t> ext_bits;
    for (size_t i = 96; i < 96 + (ext_len * 8); ++i) {
        ext_bits.push_back(decode_bit(image_bytes[pixel_indices[i]]));
    }
    std::string file_extension;
    for (size_t i = 0; i < ext_bits.size(); i += 8) {
        uint8_t byte = 0;
        for (int j = 0; j < 8; ++j) byte = (byte << 1) | ext_bits[i + j];
        file_extension += static_cast<char>(byte);
    }

    std::cout << "[C++] Decoding started. Decoded file size: " << original_size << " bytes, compressed size: " << compressed_size << ", extension: ." << file_extension << std::endl;

    // 5. Determine how many bits to extract for the encrypted data
    size_t padded_size = ((compressed_size + 15) / 16) * 16;
    size_t total_encrypted_bits = padded_size * 8;

    // 6. Extract all encrypted data bits
    std::vector<uint8_t> encrypted_bits;
    size_t file_bit_offset = 96 + (ext_len * 8);
    for (size_t i = 0; i < total_encrypted_bits; ++i) {
        encrypted_bits.push_back(decode_bit(image_bytes[pixel_indices[file_bit_offset + i]]));
    }

    // 7. Reconstruct the encrypted bytes
    std::vector<uint8_t> encrypted_data;
    for (size_t i = 0; i < encrypted_bits.size(); i += 8) {
        uint8_t byte = 0;
        for (int j = 0; j < 8; ++j) byte = (byte << 1) | encrypted_bits[i + j];
        encrypted_data.push_back(byte);
    }

    // 8. Decrypt the data
    struct AES_ctx ctx;
    AES_init_ctx_iv(&ctx, key, iv);
    AES_CBC_decrypt_buffer(&ctx, encrypted_data.data(), encrypted_data.size());

    // 9. Trim to compressed size and decompress
    encrypted_data.resize(compressed_size);
    std::vector<uint8_t> decrypted_data(original_size);
    uLongf final_size = original_size;
    if (uncompress(decrypted_data.data(), &final_size, encrypted_data.data(), compressed_size) != Z_OK) {
        std::cerr << "[C++] Error: Decompression failed." << std::endl;
        return val::null();
    }

    // 10. Return both the file data and the extension to JavaScript
    val result = val::object();
    result.set("data", copyToJSArray(decrypted_data));
    result.set("extension", val(file_extension));

    return result;
}

EMSCRIPTEN_BINDINGS(steganography_module) {
    function("encode_data", &encode_data);
    function("decode_data", &decode_data);
}
