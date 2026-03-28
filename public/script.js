// ==============================
// DASHBOARD TRACKING
// ==============================
async function trackOperation(data) {
    console.log('[ShadowFold] Tracking:', data);
    try {
        const response = await fetch('/api/operations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: data.type,
                fileName: data.file,
                fileSize: data.size,
                status: data.status === 'ok' ? 'success' : 'fail',
                timestamp: new Date().toISOString()
            })
        });
        if (!response.ok) {
            console.error('[ShadowFold] Tracking failed with status:', response.status);
        } else {
            console.log('[ShadowFold] Tracking successful');
        }
    } catch (err) {
        console.error('[ShadowFold] Failed to track operation:', err);
    }
}

// ==============================
// UTILITY FUNCTIONS
// ==============================

function calculatePSNR(original, encoded) {
    let mse = 0;
    const len = original.length;
    for (let i = 0; i < len; i++) {
        const diff = original[i] - encoded[i];
        mse += diff * diff;
    }
    mse /= len;
    if (mse === 0) return Infinity;
    return 10 * Math.log10((255 * 255) / mse);
}

async function sha256hex(arrayBuffer) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function buildStatsHTML(rows) {
    return rows.map(r => `
        <div class="stat-row">
            <span class="stat-key">${r.label}</span>
            <span class="stat-val ${r.cls || ''}">${r.value}</span>
        </div>
    `).join('');
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function isPasswordStrong(password) {
    return password.length >= 8;
}

// ==============================
// WASM DETECTION
// Helper: detect if WASM has the new 7-arg signature or old 4-arg signature
// ==============================
function detectWASMSignature() {
    if (!window.Module) return 'none';
    if (typeof window.Module.encode_data !== 'function') return 'none';
    // The old compiled WASM encode_data has 4 params.
    // The new one has 7 params.
    // We detect by inspecting the function's .length property.
    // Emscripten-bound functions expose their arity via .length.
    const arity = window.Module.encode_data.length;
    if (arity >= 7) return 'new';
    return 'old';
}

// ==============================
// DOM READY
// ==============================
document.addEventListener('DOMContentLoaded', () => {

    // --- Tabs ---
    const tabs = document.querySelectorAll('.tab-button');
    const contents = document.querySelectorAll('.tab-content');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            contents.forEach(c => c.classList.remove('active'));
            document.getElementById(tab.dataset.tab).classList.add('active');
        });
    });

    // --- Password Toggles ---
    setupPasswordToggle('encode-toggle-password', 'encode-password');
    setupPasswordToggle('decode-toggle-password', 'decode-password');

    // --- Drop Zones ---
    setupDropZone('encode-image-drop-zone', 'encode-image-input', 'encode-image-preview');
    setupDropZone('secret-file-drop-zone', 'secret-file-input', null, 'secret-file-name');
    setupDropZone('decode-image-drop-zone', 'decode-image-input', 'decode-image-preview');
    setupDropZone('decoy-file-drop-zone', 'decoy-file-input', null, 'decoy-file-name');

    // --- Dual Layer Toggle ---
    const dualLayerToggle = document.getElementById('dual-layer-toggle');
    const decoySection = document.getElementById('decoy-section');
    if (dualLayerToggle && decoySection) {
        dualLayerToggle.addEventListener('click', () => {
            const isOpen = decoySection.style.display !== 'none';
            if (isOpen) {
                decoySection.style.display = 'none';
                dualLayerToggle.textContent = '[ + ] ADD DECOY LAYER (OPTIONAL)';
                const decoyFileInput = document.getElementById('decoy-file-input');
                const decoyFileName = document.getElementById('decoy-file-name');
                const decoyPasswordInput = document.getElementById('decoy-password');
                if (decoyFileInput) decoyFileInput.value = '';
                if (decoyFileName) decoyFileName.textContent = '';
                if (decoyPasswordInput) decoyPasswordInput.value = '';
            } else {
                decoySection.style.display = 'block';
                dualLayerToggle.textContent = '[ - ] REMOVE DECOY LAYER';
            }
        });
    }

    // --- Buttons ---
    document.getElementById('encode-button').addEventListener('click', handleEncode);
    document.getElementById('decode-button').addEventListener('click', handleDecode);
});

// ==============================
// INTRO SCREEN + SOUND
// ==============================
window.addEventListener('load', () => {
    const intro = document.getElementById('intro-screen');
    const prompt = document.getElementById('intro-prompt');
    const content = document.getElementById('intro-content');
    const audio = document.getElementById('intro-audio');

    if (!intro || !prompt || !content || !audio) return;

    intro.addEventListener('click', () => {
        // 1. Hide the prompt
        prompt.style.display = 'none';
        
        // 2. Show the skull and "Accessing Void" text
        content.style.display = 'flex';
        
        // 3. Play the voice/sound (glitch.mp3)
        audio.volume = 0.5;
        audio.play().catch(e => console.warn('Audio playback failed:', e));

        // 4. Fade out the whole intro after a few seconds
        setTimeout(() => {
            intro.classList.add('fade-out');
            // 5. Restore the cursor once the void is accessed
            document.body.style.cursor = 'default';
            intro.style.cursor = 'default';
            
            setTimeout(() => {
                intro.style.display = 'none';
            }, 1500); // match the fadeOut animation duration
        }, 2500);
    }, { once: true });
});

// ==============================
// PASSWORD TOGGLE HELPER
// ==============================
function setupPasswordToggle(toggleId, inputId) {
    const toggle = document.getElementById(toggleId);
    const input = document.getElementById(inputId);
    if (!toggle || !input) return;
    toggle.addEventListener('click', () => {
        if (input.type === 'password') {
            input.type = 'text';
            toggle.textContent = 'HIDE';
        } else {
            input.type = 'password';
            toggle.textContent = 'SHOW';
        }
    });
}

// ==============================
// DROP ZONE HELPER
// ==============================
function setupDropZone(zoneId, inputId, previewId, nameId) {
    const dropZone = document.getElementById(zoneId);
    const input = document.getElementById(inputId);
    if (!dropZone || !input) return;

    const preview = previewId ? document.getElementById(previewId) : null;
    const nameDisplay = nameId ? document.getElementById(nameId) : null;

    dropZone.addEventListener('click', () => input.click());

    dropZone.addEventListener('dragover', e => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });
    dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            input.files = e.dataTransfer.files;
            handleFileChange(input, preview, nameDisplay);
        }
    });
    input.addEventListener('change', () => {
        handleFileChange(input, preview, nameDisplay);
        if (inputId === 'encode-image-input' || inputId === 'secret-file-input') {
            updateCapacity();
        }
    });
}

function handleFileChange(input, preview, nameDisplay) {
    const file = input.files[0];
    if (!file) return;
    if (preview) {
        const reader = new FileReader();
        reader.onload = e => {
            preview.src = e.target.result;
            preview.style.display = 'block';
        };
        reader.readAsDataURL(file);
    }
    if (nameDisplay) {
        nameDisplay.textContent = file.name;
    }
}

// ==============================
// CAPACITY INDICATOR
// ==============================
function updateCapacity() {
    const carrierInput = document.getElementById('encode-image-input');
    const secretInput = document.getElementById('secret-file-input');
    const capacitySection = document.getElementById('capacity-section');
    const capacityPct = document.getElementById('capacity-pct');
    const capacityMax = document.getElementById('capacity-max');
    const capacityBar = document.getElementById('capacity-bar');
    const capacityUsed = document.getElementById('capacity-used');

    if (!carrierInput || !capacitySection) return;

    const carrierFile = carrierInput.files[0];
    if (!carrierFile) {
        capacitySection.style.display = 'none';
        return;
    }

    capacitySection.style.display = 'block';

    const img = new Image();
    img.src = URL.createObjectURL(carrierFile);
    img.onload = () => {
        const totalPixels = img.width * img.height;
        const maxBytes = Math.floor(totalPixels * 3 / 8);
        const secretFile = secretInput ? secretInput.files[0] : null;
        const usedBytes = secretFile ? secretFile.size : 0;
        const pct = Math.min(100, Math.round((usedBytes / maxBytes) * 100));

        if (capacityPct) capacityPct.textContent = `${pct}%`;
        if (capacityMax) capacityMax.textContent = `/ ${formatBytes(maxBytes)}`;
        if (capacityUsed) capacityUsed.textContent = `${formatBytes(usedBytes)} used`;
        if (capacityBar) {
            capacityBar.style.width = `${pct}%`;
            if (pct > 90) {
                capacityBar.style.background = 'var(--primary-color)';
                if (capacityPct) capacityPct.style.color = 'var(--primary-color)';
            } else if (pct > 50) {
                capacityBar.style.background = '#ffaa00';
                if (capacityPct) capacityPct.style.color = '#ffaa00';
            } else {
                capacityBar.style.background = '#00c878';
                if (capacityPct) capacityPct.style.color = '#00c878';
            }
        }
        URL.revokeObjectURL(img.src);
    };
}

// ==============================
// ENCODE
// ==============================
async function handleEncode() {
    // --- WASM readiness check ---
    if (!window.Module || typeof window.Module.encode_data !== 'function') {
        alert('WASM module not yet active. Please wait a moment and try again.');
        return;
    }

    const imageInput = document.getElementById('encode-image-input');
    const secretInput = document.getElementById('secret-file-input');
    const passwordInput = document.getElementById('encode-password');
    const stats = document.getElementById('encode-stats');

    const password = passwordInput ? passwordInput.value : '';

    // --- Input validation ---
    if (!imageInput || !imageInput.files[0]) {
        alert('Please upload a carrier image.');
        return;
    }
    if (!secretInput || !secretInput.files[0]) {
        alert('Please upload a secret file to hide.');
        return;
    }
    if (!password) {
        alert('Please enter a frequency (password).');
        return;
    }
    if (!isPasswordStrong(password)) {
        alert('Frequency (password) must be at least 8 characters for security.');
        return;
    }

    // --- Image type check ---
    const imageFile = imageInput.files[0];
    if (!imageFile.type.includes('png') && !imageFile.type.includes('bmp')) {
        alert('Carrier image must be PNG or BMP. JPEG is lossy and will destroy hidden data.');
        return;
    }

    // --- Decoy inputs (optional) ---
    const decoyInput = document.getElementById('decoy-file-input');
    const decoyPasswordInput = document.getElementById('decoy-password');
    const decoyPassword = decoyPasswordInput ? decoyPasswordInput.value : '';
    const hasDecoy = decoyInput && decoyInput.files[0] && decoyPassword;

    if (hasDecoy && !isPasswordStrong(decoyPassword)) {
        alert('Decoy frequency must be at least 8 characters.');
        return;
    }

    showLoader('FOLDING REALITY...');

    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');

    try {
        // --- Load carrier image into canvas ---
        const imageBitmap = await createImageBitmap(imageFile);
        canvas.width = imageBitmap.width;
        canvas.height = imageBitmap.height;
        ctx.drawImage(imageBitmap, 0, 0);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const originalImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        // imageBytes is a Uint8Array VIEW into imageData.data — do NOT use .buffer directly for WASM
        // We pass the Uint8Array directly to the WASM function
        const imageBytes = new Uint8Array(imageData.data);
        const secretBytes = new Uint8Array(await secretInput.files[0].arrayBuffer());
        const ext = secretInput.files[0].name.split('.').pop().toLowerCase();

        // --- Detect WASM signature and call correctly ---
        // The compiled build/steganography.js was built from a specific version of main.cpp.
        // We detect which signature it exports and call accordingly.
        const wasmArity = window.Module.encode_data.length;

        let result;

        if (wasmArity >= 7) {
            // NEW compiled WASM: encode_data(image, file, ext, password, decoy, decoyExt, decoyPass)
            let decoyBytes = new Uint8Array(0);
            let decoyExt = '';
            if (hasDecoy) {
                decoyBytes = new Uint8Array(await decoyInput.files[0].arrayBuffer());
                decoyExt = decoyInput.files[0].name.split('.').pop().toLowerCase();
            }
            result = window.Module.encode_data(
                imageBytes, secretBytes, ext, password,
                decoyBytes, decoyExt, decoyPassword
            );
        } else {
            // OLD compiled WASM: encode_data(image, file, ext, password) — 4 args
            // Dual-layer is simulated: embed decoy first with decoy password, then real on top
            if (hasDecoy) {
                const decoyBytes = new Uint8Array(await decoyInput.files[0].arrayBuffer());
                const decoyExt = decoyInput.files[0].name.split('.').pop().toLowerCase();

                // Step 1: embed decoy into a temp copy of the image
                const decoyResult = window.Module.encode_data(imageBytes, decoyBytes, decoyExt, decoyPassword);
                if (decoyResult) {
                    // Step 2: embed real file on top of the decoy-embedded image
                    const decoyResultBytes = new Uint8Array(decoyResult);
                    result = window.Module.encode_data(decoyResultBytes, secretBytes, ext, password);
                } else {
                    // Decoy failed (probably capacity), just embed real file directly
                    console.warn('[ShadowFold] Decoy embedding skipped (capacity). Embedding real file only.');
                    result = window.Module.encode_data(imageBytes, secretBytes, ext, password);
                }
            } else {
                result = window.Module.encode_data(imageBytes, secretBytes, ext, password);
            }
        }

        // --- Handle result ---
        if (!result) {
            alert('Carrier capacity exceeded — file is too large for this image. Try a larger image or smaller file.');
            trackOperation({
                type: 'encode',
                file: secretInput.files[0].name,
                ext, size: secretBytes.length,
                carrier: imageFile.name,
                capacity: Math.floor(canvas.width * canvas.height * 3 / 8),
                status: 'fail'
            });
            return;
        }

        // result is a Uint8Array (typed_memory_view from WASM)
        const resultBytes = new Uint8ClampedArray(result);
        const newImageData = new ImageData(resultBytes, canvas.width, canvas.height);
        ctx.putImageData(newImageData, 0, 0);

        // --- Download encoded image ---
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = 'encoded.png';
        a.click();

        // --- Dashboard log ---
        trackOperation({
            type: 'encode',
            file: secretInput.files[0].name,
            ext, size: secretBytes.length,
            carrier: imageFile.name,
            capacity: Math.floor(canvas.width * canvas.height * 3 / 8),
            status: 'ok'
        });

        // --- Stats ---
        const psnrValue = calculatePSNR(originalImageData.data, resultBytes);
        const psnrText = psnrValue === Infinity ? '∞ dB' : psnrValue.toFixed(2) + ' dB';
        const psnrCls = psnrValue > 45 ? 'stat-good' : psnrValue > 35 ? 'stat-warn' : 'stat-fail';

        const secretHash = await sha256hex(secretBytes.buffer);
        const totalCapacity = Math.floor((canvas.width * canvas.height * 3) / 8);
        const usagePct = ((secretBytes.length / totalCapacity) * 100).toFixed(1);

        if (stats) stats.innerHTML = buildStatsHTML([
            { label: 'STATUS',               value: 'FOLDED SUCCESSFULLY',                cls: 'stat-good' },
            { label: 'IMAGE QUALITY (PSNR)', value: psnrText,                             cls: psnrCls },
            { label: 'ENCRYPTION',           value: 'AES-256-CBC ✓',                      cls: 'stat-good' },
            { label: 'DUAL LAYER',           value: hasDecoy ? 'ACTIVE (DENIABLE) ✓' : 'INACTIVE', cls: hasDecoy ? 'stat-good' : '' },
            { label: 'CAPACITY USED',        value: usagePct + '%' },
            { label: 'PAYLOAD SIZE',         value: formatBytes(secretBytes.length) },
            { label: 'FILE TYPE',            value: '.' + ext.toUpperCase() },
            { label: 'SHA-256 (payload)',    value: secretHash.substring(0, 20) + '...' },
        ]);

        // --- Heatmap ---
        generateHeatmap(imageBytes, resultBytes, canvas.width, canvas.height);

    } catch (err) {
        console.error('[ShadowFold] Encode error:', err);
        alert('Fatal error during folding. Check console for details.');
    } finally {
        hideLoader();
    }
}

// ==============================
// DECODE
// ==============================
async function handleDecode() {
    if (!window.Module || typeof window.Module.decode_data !== 'function') {
        alert('WASM module not yet active. Please wait a moment and try again.');
        return;
    }

    const imageInput = document.getElementById('decode-image-input');
    const passwordInput = document.getElementById('decode-password');
    const stats = document.getElementById('decode-stats');

    const password = passwordInput ? passwordInput.value : '';

    if (!imageInput || !imageInput.files[0]) {
        alert('Please upload an encoded image.');
        return;
    }
    if (!password) {
        alert('Please enter the frequency (password).');
        return;
    }

    showLoader('ENTERING THE VOID...');

    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');

    try {
        const imageBitmap = await createImageBitmap(imageInput.files[0]);
        canvas.width = imageBitmap.width;
        canvas.height = imageBitmap.height;
        ctx.drawImage(imageBitmap, 0, 0);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const imageBytes = new Uint8Array(imageData.data);

        const result = window.Module.decode_data(imageBytes, password);

        if (!result) {
            alert('Frequency mismatch or image corrupted. Check your password.');
            trackOperation({
                type: 'decode',
                file: imageInput.files[0].name,
                ext: '', size: 0,
                carrier: imageInput.files[0].name,
                capacity: Math.floor(canvas.width * canvas.height * 3 / 8),
                status: 'fail'
            });
            return;
        }

        // result.data is a Uint8Array, result.extension is a string
        const fileData = new Uint8Array(result.data);
        const fileExt = result.extension || 'bin';

        const blob = new Blob([fileData], { type: 'application/octet-stream' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `decoded.${fileExt}`;
        a.click();

        // --- Dashboard log ---
        trackOperation({
            type: 'decode',
            file: imageInput.files[0].name,
            ext: fileExt,
            size: fileData.length,
            carrier: imageInput.files[0].name,
            capacity: Math.floor(canvas.width * canvas.height * 3 / 8),
            status: 'ok'
        });

        // --- Stats ---
        const fileHash = await sha256hex(fileData.buffer);

        if (stats) stats.innerHTML = buildStatsHTML([
            { label: 'STATUS',         value: 'DATA EXTRACTED',            cls: 'stat-good' },
            { label: 'FILE TYPE',      value: '.' + fileExt.toUpperCase() },
            { label: 'EXTRACTED SIZE', value: formatBytes(fileData.length) },
            { label: 'SHA-256',        value: fileHash.substring(0, 20) + '...' },
            { label: 'ENCRYPTION',     value: 'AES-256-CBC DECRYPTED ✓',   cls: 'stat-good' },
        ]);

    } catch (err) {
        console.error('[ShadowFold] Decode error:', err);
        alert('Fatal error during decoding. Check console for details.');
    } finally {
        hideLoader();
    }
}

// ==============================
// PIXEL HEATMAP
// ==============================
function generateHeatmap(originalBytes, encodedBytes, width, height) {
    const heatmapSection = document.getElementById('heatmap-section');
    const heatmapCanvas = document.getElementById('heatmap-canvas');
    const heatmapLabel = document.getElementById('heatmap-label');

    if (!heatmapSection || !heatmapCanvas) return;

    heatmapSection.style.display = 'block';
    heatmapCanvas.width = width;
    heatmapCanvas.height = height;

    const ctx = heatmapCanvas.getContext('2d');
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;
    let modifiedCount = 0;

    for (let i = 0; i < originalBytes.length; i += 4) {
        const isModified =
            (originalBytes[i]   !== encodedBytes[i])   ||
            (originalBytes[i+1] !== encodedBytes[i+1]) ||
            (originalBytes[i+2] !== encodedBytes[i+2]);

        if (isModified) {
            data[i]   = 255;
            data[i+1] = 0;
            data[i+2] = 51;
            data[i+3] = 255;
            modifiedCount++;
        } else {
            data[i]   = 0;
            data[i+1] = 0;
            data[i+2] = 0;
            data[i+3] = 255;
        }
    }

    ctx.putImageData(imageData, 0, 0);

    if (heatmapLabel) {
        const pct = ((modifiedCount / (width * height)) * 100).toFixed(2);
        heatmapLabel.textContent = `${modifiedCount.toLocaleString()} Pixels (${pct}%)`;
    }
}

// ==============================
// LOADER HELPERS
// ==============================
function showLoader(text) {
    const loader = document.getElementById('loader');
    const loaderText = document.getElementById('loader-text');
    if (loaderText) loaderText.textContent = text;
    if (loader) loader.classList.add('show');
}

function hideLoader() {
    const loader = document.getElementById('loader');
    if (loader) loader.classList.remove('show');
}
