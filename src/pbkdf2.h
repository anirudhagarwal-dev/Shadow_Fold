#ifndef PBKDF2_H
#define PBKDF2_H

#include <stdint.h>
#include <string.h>
#include "sha256.h"

// HMAC-SHA256 implementation
void hmac_sha256(const uint8_t *key, size_t key_len, const uint8_t *data, size_t data_len, uint8_t *out) {
    uint8_t k_ipad[64];
    uint8_t k_opad[64];
    uint8_t tk[32];
    int i;

    if (key_len > 64) {
        SHA256_CTX ctx;
        sha256_init(&ctx);
        sha256_update(&ctx, key, key_len);
        sha256_final(&ctx, tk);
        key = tk;
        key_len = 32;
    }

    memset(k_ipad, 0, sizeof(k_ipad));
    memset(k_opad, 0, sizeof(k_opad));
    memcpy(k_ipad, key, key_len);
    memcpy(k_opad, key, key_len);

    for (i = 0; i < 64; i++) {
        k_ipad[i] ^= 0x36;
        k_opad[i] ^= 0x5c;
    }

    SHA256_CTX ctx;
    sha256_init(&ctx);
    sha256_update(&ctx, k_ipad, 64);
    sha256_update(&ctx, data, data_len);
    sha256_final(&ctx, out);

    sha256_init(&ctx);
    sha256_update(&ctx, k_opad, 64);
    sha256_update(&ctx, out, 32);
    sha256_final(&ctx, out);
}

// PBKDF2-SHA256 implementation
void pbkdf2_sha256(const uint8_t *password, size_t password_len, const uint8_t *salt, size_t salt_len, uint32_t iterations, uint8_t *out, size_t out_len) {
    uint8_t digest[32];
    uint8_t u[32];
    uint8_t salt_plus_i[salt_len + 4];
    uint32_t i, j, k;
    size_t offset = 0;
    uint32_t block_num = 1;

    while (out_len > 0) {
        size_t chunk_len = (out_len > 32) ? 32 : out_len;

        memcpy(salt_plus_i, salt, salt_len);
        salt_plus_i[salt_len] = (block_num >> 24) & 0xff;
        salt_plus_i[salt_len + 1] = (block_num >> 16) & 0xff;
        salt_plus_i[salt_len + 2] = (block_num >> 8) & 0xff;
        salt_plus_i[salt_len + 3] = block_num & 0xff;

        hmac_sha256(password, password_len, salt_plus_i, salt_len + 4, digest);
        memcpy(u, digest, 32);

        for (i = 1; i < iterations; i++) {
            hmac_sha256(password, password_len, digest, 32, digest);
            for (j = 0; j < 32; j++) {
                u[j] ^= digest[j];
            }
        }

        memcpy(out + offset, u, chunk_len);
        offset += chunk_len;
        out_len -= chunk_len;
        block_num++;
    }
}

#endif // PBKDF2_H
