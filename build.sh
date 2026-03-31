#!/usr/bin/env bash
set -ex

# Compile C files to object files
emcc -c src/aes.c -o aes.o
emcc -c src/sha256.c -o sha256.o

# Compile C++ files and link everything with Embind
emcc --bind -std=c++17 src/main.cpp aes.o sha256.o \
  -o build/steganography.js \
  -O2 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s EXPORTED_RUNTIME_METHODS="['ccall', 'cwrap', 'getValue', 'setValue']" \
  -s MODULARIZE=1 \
  -s EXPORT_NAME="'Module'" \
  -s ENVIRONMENT=web \
  -s USE_ZLIB=1

# Cleanup object files
rm aes.o sha256.o
