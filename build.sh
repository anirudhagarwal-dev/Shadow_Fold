emcc --bind -std=c++17 \
  src/main.cpp src/aes.c src/sha256.c \
  -o build/steganography.js \
  -O2 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s EXPORTED_RUNTIME_METHODS="['ccall', 'cwrap']" \
  -s MODULARIZE=0 \
  -s ENVIRONMENT='web' \
  -s USE_ZLIB=1
