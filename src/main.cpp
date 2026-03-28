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

// Use extern "C" to ensure C-style linkage for the C-based AES library
extern "C" {
#include "aes.h"
}

using namespace emscripten;

// Helper to convert a JavaScript Uint8Array to a C++ std::vector<uint8_t>
std::vector<uint8_t> vecFromJSArray(const val& jsArray) {
    const auto l = jsArray["length"].as<unsigned>();
    std::vector<uint8_t> v;
    v.reserve(l);
    for (unsigned i = 0; i < l; ++i) {
        v.push_back(jsArray[i].as<uint8_t>());
    }
    return v;
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
val encode_data(val image_data, val file_data, const std::string& file_extension, const std::string& password) {
    std::vector<uint8_t> image_bytes = vecFromJSArray(image_data);
    std::vector<uint8_t> file_bytes = vecFromJSArray(file_data);

    std::cout << "[C++] Encoding started. Original file size: " << file_bytes.size() << " bytes, extension: ." << file_extension << std::endl;

    // 1. Generate a deterministic 128-bit key and 128-bit IV from the password
    // Note: tiny-aes is configured for AES128 (16-byte key)
    std::seed_seq seed(password.begin(), password.end());
    std::vector<uint32_t> key_material(8); // 4 for key (16B), 4 for IV (16B)
    seed.generate(key_material.begin(), key_material.end());

    uint8_t key[16];
    uint8_t iv[16];
    std::memcpy(key, key_material.data(), 16);
    std::memcpy(iv, key_material.data() + 4, 16);

    // 2. Pad the file data to be a multiple of the AES block size (16 bytes)
    uint32_t original_size = file_bytes.size();
    size_t padded_size = ((original_size + 15) / 16) * 16;
    std::vector<uint8_t> padded_file = file_bytes;
    padded_file.resize(padded_size, 0);

    // 3. Encrypt the padded data
    struct AES_ctx ctx;
    AES_init_ctx_iv(&ctx, key, iv);
    AES_CBC_encrypt_buffer(&ctx, padded_file.data(), padded_size);

    // 4. Create the metadata header
    uint32_t ext_len = file_extension.length();
    std::vector<uint8_t> header;
    header.resize(8);
    std::memcpy(&header[0], &original_size, 4);
    std::memcpy(&header[4], &ext_len, 4);
    header.insert(header.end(), file_extension.begin(), file_extension.end());

    // 5. Combine header and encrypted data
    std::vector<uint8_t> data_to_embed = header;
    data_to_embed.insert(data_to_embed.end(), padded_file.begin(), padded_file.end());

    // Check for capacity
    if ((data_to_embed.size() * 8) > image_bytes.size()) {
        std::cerr << "[C++] Error: Not enough space in the image to hide the file." << std::endl;
        return val::null();
    }

    // 6. Create a deterministic, shuffled list of pixel indices for embedding
    std::mt19937 rng(seed);
    std::vector<int> pixel_indices(image_bytes.size());
    std::iota(pixel_indices.begin(), pixel_indices.end(), 0);
    std::shuffle(pixel_indices.begin(), pixel_indices.end(), rng);

    // 7. Embed the data bits into the LSB of each pixel channel byte
    for (size_t i = 0; i < data_to_embed.size() * 8; ++i) {
        uint8_t bit = (data_to_embed[i / 8] >> (7 - (i % 8))) & 1;
        encode_bit(image_bytes[pixel_indices[i]], bit);
    }

    return val(typed_memory_view(image_bytes.size(), image_bytes.data()));
}

// --- DECODING --- //
val decode_data(val image_data, const std::string& password) {
    std::vector<uint8_t> image_bytes = vecFromJSArray(image_data);

    // 1. Re-generate the same deterministic 128-bit key, IV, and pixel order
    std::seed_seq seed(password.begin(), password.end());
    std::vector<uint32_t> key_material(8);
    seed.generate(key_material.begin(), key_material.end());

    uint8_t key[16];
    uint8_t iv[16];
    std::memcpy(key, key_material.data(), 16);
    std::memcpy(iv, key_material.data() + 4, 16);

    std::mt19937 rng(seed);
    std::vector<int> pixel_indices(image_bytes.size());
    std::iota(pixel_indices.begin(), pixel_indices.end(), 0);
    std::shuffle(pixel_indices.begin(), pixel_indices.end(), rng);

    // 2. Extract the header bits (file size + ext length = 8 bytes = 64 bits)
    std::vector<uint8_t> header_bits;
    for (int i = 0; i < 64; ++i) {
        header_bits.push_back(decode_bit(image_bytes[pixel_indices[i]]));
    }

    // 3. Reconstruct header values
    uint32_t original_size = 0;
    uint32_t ext_len = 0;
    std::vector<uint8_t> header_bytes;
    for (size_t i = 0; i < header_bits.size(); i += 8) {
        uint8_t byte = 0;
        for (int j = 0; j < 8; ++j) byte = (byte << 1) | header_bits[i + j];
        header_bytes.push_back(byte);
    }
    std::memcpy(&original_size, &header_bytes[0], 4);
    std::memcpy(&ext_len, &header_bytes[4], 4);

    // 4. Extract file extension string
    std::vector<uint8_t> ext_bits;
    for (size_t i = 64; i < 64 + (ext_len * 8); ++i) {
        ext_bits.push_back(decode_bit(image_bytes[pixel_indices[i]]));
    }
    std::string file_extension;
    for (size_t i = 0; i < ext_bits.size(); i += 8) {
        uint8_t byte = 0;
        for (int j = 0; j < 8; ++j) byte = (byte << 1) | ext_bits[i + j];
        file_extension += static_cast<char>(byte);
    }

    std::cout << "[C++] Decoding started. Decoded file size: " << original_size << " bytes, extension: ." << file_extension << std::endl;

    // 5. Determine how many bits to extract for the file data
    size_t padded_size = ((original_size + 15) / 16) * 16;
    size_t total_file_bits = padded_size * 8;

    // 6. Extract all file data bits
    std::vector<uint8_t> file_bits;
    size_t file_bit_offset = 64 + (ext_len * 8);
    for (size_t i = 0; i < total_file_bits; ++i) {
        file_bits.push_back(decode_bit(image_bytes[pixel_indices[file_bit_offset + i]]));
    }

    // 7. Reconstruct the encrypted bytes
    std::vector<uint8_t> encrypted_data;
    for (size_t i = 0; i < file_bits.size(); i += 8) {
        uint8_t byte = 0;
        for (int j = 0; j < 8; ++j) byte = (byte << 1) | file_bits[i + j];
        encrypted_data.push_back(byte);
    }

    // 8. Decrypt the data
    struct AES_ctx ctx;
    AES_init_ctx_iv(&ctx, key, iv);
    AES_CBC_decrypt_buffer(&ctx, encrypted_data.data(), encrypted_data.size());

    // 9. Trim the decrypted data back to its original size
    encrypted_data.resize(original_size);

    // 10. Return both the file data and the extension to JavaScript
    val result = val::object();
    result.set("data", val(typed_memory_view(encrypted_data.size(), encrypted_data.data())));
    result.set("extension", val(file_extension));

    return result;
}

EMSCRIPTEN_BINDINGS(my_module) {
    function("encode_data", &encode_data);
    function("decode_data", &decode_data);
}
