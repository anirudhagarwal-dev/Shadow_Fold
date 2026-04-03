emcc --bind -std=c++17 \
  src/main.cpp src/aes.c src/sha256.c \
  -o build/steganography.js \
  -O3 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=256MB \
  -s EXPORTED_RUNTIME_METHODS="['ccall', 'cwrap']" \
  -s MODULARIZE=0 \
  -s ENVIRONMENT='web' \
  -s USE_ZLIB=1
