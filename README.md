# SHADOW FOLD – The Visual Void

(sf.png)

**Shadow Fold** is a high-performance, experimental steganography engine designed for the modern web. It allows users to hide sensitive data within plain-sight carrier images (PNG/BMP) using advanced cryptographic and steganographic techniques.

## ◈ Key Features

- **Any-File Steganography**: Hide images, PDFs, audio, video, documents, or archives within a carrier image.
- **WebAssembly Powered**: Core engine written in C/C++ and compiled to WASM for near-native performance.
- **Dual Layer Mode**: Plausible deniability through a decoy layer. Embed two different payloads with separate passwords; reveal the decoy under coercion.
- **Military-Grade Security**: AES-256 encryption with PBKDF2 key derivation for maximum protection.
- **Multi-Pack Mode**: Bundle multiple files into a single encrypted `.sfpack` container.
- **Built-in Steganalysis**: Tools to analyze and detect hidden data within images.
- **Benchmark Suite**: Measure the performance of the steganographic engine on your hardware.
- **Cyberpunk Aesthetic**: A modern, immersive UI featuring CRT scanlines, glitch animations, and a "Void" inspired design.

## ◈ Technical Architecture

The "Void Pipeline" follows a secure path for data injection:
1. **Carrier Selection**: PNG/BMP image is loaded into an HTML5 Canvas.
2. **Byte Mapping**: Raw RGBA pixel data is extracted as a flat byte array.
3. **PRNG Scrambling**: Data bits are scattered across the carrier using a pseudo-random number generator.
4. **LSB Injection**: Secret data is injected into the Least Significant Bits (LSB) of the pixel channels.
5. **Output**: A visually identical steganographic PNG is generated.

## ◈ Getting Started

### Prerequisites
- Node.js (for running the local server)
- A modern web browser with WebAssembly support

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/your-repo/shadow-fold.git
   cd shadow-fold
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   npm start
   ```
4. Open your browser and navigate to `http://localhost:3000`.

## ◈ Security Notice
Shadow Fold is an experimental tool. While it uses robust encryption (AES-256), the security of steganography also depends on the choice of carrier image and the size of the payload. Use high-entropy images for best results.

---
*Created for the Visual Void.*
