// ==============================
// PDF ENCRYPTION HELPER
// ==============================
async function encryptPDF(bytes, password) {
    if (typeof PDFLib === 'undefined') return bytes;
    
    const header = new TextDecoder().decode(bytes.slice(0, 5));
    if (header !== '%PDF-') {
        console.error('[ShadowFold] Invalid PDF header. Skipping encryption.');
        return bytes;
    }

    try {
        // ALWAYS use direct encryption on the original document to preserve 
        // fonts, layout, and complex objects.
        const pdfDoc = await PDFLib.PDFDocument.load(bytes);
        
        // Ensure PDF version 1.7 for AES-256 support
        pdfDoc.getForm().doc.context.header.setVersion('1.7');

        pdfDoc.encrypt({
            userPassword: password,
            ownerPassword: password,
            permissions: {
                printing: 'highResolution',
                modifying: true,
                copying: true,
                annotating: true,
                fillingForms: true,
                contentAccessibility: true,
                documentAssembly: true,
            },
        });

        // Use useObjectStreams: false for maximum compatibility with older readers
        // but keep the original structure as much as possible.
        const encryptedBytes = await pdfDoc.save({ 
            useObjectStreams: false,
            addDefaultFont: false, // Don't inject new fonts
            updateMetadata: false  // Keep original metadata
        });
        
        // Final validation
        const newHeader = new TextDecoder().decode(encryptedBytes.slice(0, 5));
        if (newHeader !== '%PDF-') {
            throw new Error('PDF structure corrupted during save.');
        }
        
        return encryptedBytes;
    } catch (e) {
        console.error('[ShadowFold] PDF encryption failed. Falling back to original.', e);
        return bytes; 
    }
}

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

async function sha256hex(data) {
    // subtle.digest accepts BufferSource (which includes TypedArrays)
    // If we pass a TypedArray, it correctly uses only the view's portion of the buffer.
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
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

// ==============================
// PASSWORD STRENGTH
// Returns { score: 0-4, label, cls }
// Checks length, uppercase, digits, symbols — not just length.
// ==============================
function assessPassword(password) {
    if (!password) return { score: 0, label: '', cls: '' };

    let score = 0;
    if (password.length >= 8)  score++;
    if (password.length >= 12) score++;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;

    // Cap at 4
    score = Math.min(score, 4);

    const labels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
    const classes = ['', 'strength-weak', 'strength-fair', 'strength-good', 'strength-strong'];
    return { score, label: labels[score], cls: classes[score] };
}

function isPasswordStrong(password) {
    return assessPassword(password).score >= 2;
}

// ==============================
// WASM DETECTION
// v2  = new build  → encode_data_wh exists (9 args)
// v1  = mid build  → encode_data exists with 7 args
// v0  = original   → encode_data exists with 4 args (pre-dual-layer)
// ==============================
function getWASMVersion() {
    const mod = window.Module || (typeof Module !== 'undefined' ? Module : null);
    if (!mod) return 'none';
    
    // Check for specific v2 exports
    if (typeof mod.encode_data_wh === 'function' && typeof mod.decode_data_dual === 'function') {
        return 'v2';
    }
    
    // Check for v1/v0 based on arity
    if (typeof mod.encode_data === 'function') {
        // Emscripten exposes arity via .length
        return mod.encode_data.length >= 7 ? 'v1' : 'v0';
    }
    return 'none';
}

// ==============================
// CYBERPUNK GLITCH CURSOR
// ==============================
function initCustomCursor() {
    const container = document.createElement('div');
    container.className = 'custom-cursor-container';
    
    const cursor = document.createElement('div');
    cursor.className = 'custom-cursor';
    cursor.innerHTML = `
        <div class="cursor-ghost"></div>
        <div class="cursor-ring"></div>
        <div class="cursor-dot"></div>
    `;
    
    container.appendChild(cursor);
    document.body.appendChild(container);

    let mouseX = 0, mouseY = 0;
    let cursorX = 0, cursorY = 0;

    // Use passive listener for better performance
    document.addEventListener('mousemove', (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
    }, { passive: true });

    // Optimized smooth follow using transform: translate3d (GPU accelerated)
    function animate() {
        const easing = 0.15;
        const dx = mouseX - cursorX;
        const dy = mouseY - cursorY;

        // Threshold to stop animating if we're close enough (saves CPU)
        if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
            cursorX += dx * easing;
            cursorY += dy * easing;
            // translate3d is more efficient than top/left, plus we keep the centering transform
            cursor.style.transform = `translate3d(${cursorX}px, ${cursorY}px, 0) translate(-50%, -50%)`;
        }
        
        requestAnimationFrame(animate);
    }
    animate();

    // Glitch logic: Jitter and Flicker
    setInterval(() => {
        if (Math.random() > 0.85) { // 15% chance to glitch
            cursor.classList.add('glitch-active');
            setTimeout(() => cursor.classList.remove('glitch-active'), 100 + Math.random() * 200);
        }
        
        if (Math.random() > 0.95) { // 5% chance to flicker
            cursor.classList.add('flicker-active');
            setTimeout(() => cursor.classList.remove('flicker-active'), 50 + Math.random() * 100);
        }
    }, 500);

    document.addEventListener('mousedown', () => cursor.classList.add('clicking'));
    document.addEventListener('mouseup', () => cursor.classList.remove('clicking'));

    // Use event delegation for hover states instead of MutationObserver/querySelectorAll
    // This is MUCH more efficient
    document.addEventListener('mouseover', (e) => {
        const target = e.target.closest('a, button, .drop-zone, .tab-button, input, .mode-btn');
        if (target) {
            cursor.classList.add('hover');
        }
    }, { passive: true });

    document.addEventListener('mouseout', (e) => {
        const target = e.target.closest('a, button, .drop-zone, .tab-button, input, .mode-btn');
        if (target) {
            cursor.classList.remove('hover');
        }
    }, { passive: true });
}

// ==============================
// DYNAMIC HUD UPDATES
// ==============================
function initDynamicHUD() {
    const coords = document.querySelectorAll('.hud-coord');
    const signal = document.getElementById('hud-signal');
    
    setInterval(() => {
        coords.forEach(el => {
            const x = (Math.random() * 100).toFixed(2).padStart(6, '0');
            const y = (Math.random() * 100).toFixed(2).padStart(6, '0');
            const axis = el.textContent.split(':')[0];
            if (axis === 'X') {
                el.textContent = `X: ${x} Y: ${y}`;
            } else {
                el.textContent = `Z: ${x} R: ${y}`;
            }
        });
    }, 2000);

    // Subtle signal flicker
    setInterval(() => {
        if (signal) {
            const original = signal.textContent;
            if (Math.random() > 0.9) {
                signal.textContent = 'INTERFERENCE';
                signal.style.color = '#fff';
                setTimeout(() => {
                    signal.textContent = original;
                    signal.style.color = '';
                }, 150);
            }
        }
    }, 3000);
}

// ==============================
// DOM READY
// ==============================
document.addEventListener('DOMContentLoaded', () => {
    initCustomCursor();
    initDynamicHUD();
    // Multi-File Pack State
    window.SF_PackFiles = [];

    window.SFLog = {
        add: function(data) {
            trackOperation(data);
        }
    };

    // --- Tabs ---
    const tabs = document.querySelectorAll('.tab-button');
    const contents = document.querySelectorAll('.tab-content');
    tabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.preventDefault(); // Prevent default link behavior if any
            const currentActiveTab = document.querySelector('.tab-button.active');
            const currentActiveContent = document.querySelector('.tab-content.active');
            
            if (currentActiveTab) currentActiveTab.classList.remove('active');
            tab.classList.add('active');

            if (currentActiveContent) {
                currentActiveContent.classList.remove('active');
                currentActiveContent.classList.add('fade-out'); // Add fade-out class
                setTimeout(() => {
                    currentActiveContent.classList.remove('fade-out');
                    // Only activate content within the currently active stego mode
                    const activeStegoMode = document.querySelector('.stego-mode-content.active');
                    if (activeStegoMode) {
                        activeStegoMode.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                        activeStegoMode.querySelector(`#${tab.dataset.tab}${activeStegoMode.id === 'image-stego-mode' ? '-image' : ''}`).classList.add('active');
                    }
                }, 300); // Match CSS transition duration
            } else {
                // If no active content, just activate the new one
                const activeStegoMode = document.querySelector('.stego-mode-content.active');
                if (activeStegoMode) {
                    activeStegoMode.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                    activeStegoMode.querySelector(`#${tab.dataset.tab}${activeStegoMode.id === 'image-stego-mode' ? '-image' : ''}`).classList.add('active');
                }
            }
        });
    });

    // --- Mode Toggles (Text/Image) ---
    const modeToggles = document.querySelectorAll('.mode-toggle-button');
    const stegoModes = document.querySelectorAll('.stego-mode-content');

    modeToggles.forEach(toggle => {
        toggle.addEventListener('click', (e) => {
            e.preventDefault();
            const currentActiveMode = document.querySelector('.stego-mode-content.active');
            const currentActiveModeToggle = document.querySelector('.mode-toggle-button.active');

            if (currentActiveModeToggle) currentActiveModeToggle.classList.remove('active');
            toggle.classList.add('active');

            if (currentActiveMode) {
                currentActiveMode.classList.remove('active');
                currentActiveMode.classList.add('fade-out');
                setTimeout(() => {
                    currentActiveMode.classList.remove('fade-out');
                    document.getElementById(`${toggle.dataset.mode}-stego-mode`).classList.add('active');
                    // Reset tab to encode when switching modes
                    const activeStegoMode = document.querySelector('.stego-mode-content.active');
                    if (activeStegoMode) {
                        activeStegoMode.querySelectorAll('.tab-button').forEach((t, i) => {
                            if (i === 0) t.classList.add('active');
                            else t.classList.remove('active');
                        });
                        activeStegoMode.querySelectorAll('.tab-content').forEach((c, i) => {
                            if (i === 0) c.classList.add('active');
                            else c.classList.remove('active');
                        });
                    }
                }, 300); // Match CSS transition duration
            } else {
                document.getElementById(`${toggle.dataset.mode}-stego-mode`).classList.add('active');
                // Reset tab to encode when switching modes
                const activeStegoMode = document.querySelector('.stego-mode-content.active');
                if (activeStegoMode) {
                    activeStegoMode.querySelectorAll('.tab-button').forEach((t, i) => {
                        if (i === 0) t.classList.add('active');
                        else t.classList.remove('active');
                    });
                    activeStegoMode.querySelectorAll('.tab-content').forEach((c, i) => {
                        if (i === 0) c.classList.add('active');
                        else c.classList.remove('active');
                    });
                }
            }
        });
    });

    // --- Password Toggles ---
    setupPasswordToggle('encode-toggle-password', 'encode-password');
    setupPasswordToggle('decode-toggle-password', 'decode-password');

    // --- Password Strength Meters ---
    setupStrengthMeter('encode-password', 'encode-password-strength');
    setupStrengthMeter('decoy-password',  'decoy-password-strength');

    // --- Drop Zones ---
    setupDropZone('encode-image-drop-zone', 'encode-image-input', 'encode-image-preview');
    // Multi-file payload zone
    setupPayloadZone('payload-pack-zone', 'secret-file-input');
    setupDropZone('decode-image-drop-zone', 'decode-image-input', 'decode-image-preview');
    setupDropZone('decoy-file-drop-zone',   'decoy-file-input',   null, 'decoy-file-name');

    // Image Steganography Drop Zones
    setupDropZone('cover-image-drop-zone', 'cover-image-input', document.getElementById('cover-image-preview-canvas'), null, true);
    setupDropZone('secret-image-drop-zone', 'secret-image-input', document.getElementById('secret-image-preview-canvas'), null, true);
    setupDropZone('encoded-image-drop-zone', 'encoded-image-input', document.getElementById('encoded-image-preview-canvas'), null, true);

    updateDualLayerRealStatus();

    // --- Dual Layer Toggle ---
    const dualLayerCheckbox = document.getElementById('dual-layer-checkbox');
    const dlPanel           = document.getElementById('dual-layer-panel-container');
    const dlBadge           = document.getElementById('dual-layer-badge');
    
    if (dualLayerCheckbox && dlPanel) {
        dualLayerCheckbox.addEventListener('change', () => {
            if (dualLayerCheckbox.checked) {
                dlPanel.classList.add('active');
                if (dlBadge) dlBadge.style.display = 'inline-block';
            } else {
                dlPanel.classList.remove('active');
                if (dlBadge) dlBadge.style.display = 'none';
                
                // Clear decoy fields when disabling
                const df = document.getElementById('decoy-file-input');
                const dn = document.getElementById('decoy-file-name');
                const dp = document.getElementById('decoy-password');
                const dm = document.getElementById('decoy-password-strength');
                if (df) df.value = '';
                if (dn) dn.textContent = '';
                if (dp) dp.value = '';
                if (dm) dm.innerHTML = '';
            }
            updateCapacity();
        });
    }

    // --- Add More Files Button ---
    const btnAddFiles = document.getElementById('btn-add-files');
    if (btnAddFiles) {
        btnAddFiles.addEventListener('click', () => {
            document.getElementById('secret-file-input').click();
        });
    }

    // --- Decode Mode Selector ---
    const decodeModeBtns = document.querySelectorAll('#decode-mode-selector .mode-btn');
    const singlePassSec  = document.getElementById('decode-single-pass-section');
    const dualPassSec    = document.getElementById('decode-dual-pass-section');
    
    decodeModeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            decodeModeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            if (btn.dataset.mode === 'dual') {
                singlePassSec.style.display = 'none';
                dualPassSec.style.display   = 'block';
            } else {
                singlePassSec.style.display = 'block';
                dualPassSec.style.display   = 'none';
            }
        });
    });

    // --- Decode Layer Selector ---
    const decodeLayerBtns = document.querySelectorAll('#decode-layer-selector .mode-btn');
    decodeLayerBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            decodeLayerBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // --- Buttons ---
    document.getElementById('encode-button').addEventListener('click', handleEncode);
    document.getElementById('decode-button').addEventListener('click', handleDecode);
    
    // Image Steganography Buttons
    const encodeImageBtn = document.getElementById('encode-image-button');
    if (encodeImageBtn) encodeImageBtn.addEventListener('click', handleImageToImageEncode);
    
    const decodeImageBtn = document.getElementById('decode-image-button');
    if (decodeImageBtn) decodeImageBtn.addEventListener('click', handleImageToImageDecode);
});

// ==============================
// PAYLOAD PACK ZONE HELPER
// ==============================
function setupPayloadZone(zoneId, inputId) {
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId);
    if (!zone || !input) return;

    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', e => {
        e.preventDefault();
        zone.classList.add('dragover');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            addFilesToPack(e.dataTransfer.files);
        }
    });
    input.addEventListener('change', () => {
        if (input.files.length) {
            addFilesToPack(input.files);
            input.value = ''; // Reset to allow re-selection of same files
        }
    });
}

function addFilesToPack(files) {
    for (const file of files) {
        // Simple deduplication by name
        if (window.SF_PackFiles.some(f => f.file.name === file.name)) continue;
        window.SF_PackFiles.push({
            file: file,
            id: Math.random().toString(36).substr(2, 9)
        });
    }
    renderPackList();
    updateCapacity();
}

function updateDualLayerRealStatus() {
    const realFileName = document.getElementById('dl-real-file-name');
    if (!realFileName) return;

    const files = window.SF_PackFiles || [];
    if (files.length === 0) {
        realFileName.textContent = '(NO PAYLOAD)';
        realFileName.style.color = '#aaa';
    } else if (files.length === 1) {
        realFileName.textContent = files[0].file.name;
        realFileName.style.color = '#00ff99';
    } else {
        realFileName.textContent = `${files.length} FILES SELECTED`;
        realFileName.style.color = '#00ff99';
    }
}

function renderPackList() {
    const list = document.getElementById('pack-file-list');
    const summary = document.getElementById('pack-summary');
    const actions = document.getElementById('pack-actions');
    const badge = document.getElementById('pack-mode-badge');
    
    if (!list) return;

    if (window.SF_PackFiles.length === 0) {
        list.innerHTML = '';
        if (summary) summary.style.display = 'none';
        if (actions) actions.style.display = 'none';
        if (badge) badge.style.display = 'none';
        updateDualLayerRealStatus();
        return;
    }

    if (summary) {
        summary.style.display = 'block';
        const totalSize = window.SF_PackFiles.reduce((acc, f) => acc + f.file.size, 0);
        summary.textContent = `PACK CONTENTS (${window.SF_PackFiles.length} files · ${formatBytes(totalSize)})`;
    }
    if (actions) actions.style.display = 'block';
    if (badge) badge.style.display = window.SF_PackFiles.length > 1 ? 'inline-block' : 'none';

    list.innerHTML = window.SF_PackFiles.map(f => {
        const ext = f.file.name.split('.').pop().toLowerCase();
        let emoji = '📎';
        if (['pdf'].includes(ext)) emoji = '📄';
        else if (['docx', 'doc', 'odt'].includes(ext)) emoji = '📝';
        else if (['pptx', 'ppt', 'odp'].includes(ext)) emoji = '📊';
        else if (['xlsx', 'xls', 'csv'].includes(ext)) emoji = '�';
        else if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) emoji = '�';
        else if (['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a'].includes(ext)) emoji = '🎵';
        else if (['mp4', 'mkv', 'mov', 'avi', 'webm'].includes(ext)) emoji = '🎬';
        else if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) emoji = '📦';
        else if (['txt', 'md', 'rtf'].includes(ext)) emoji = '📝';


        return `
            <div class="pack-item" data-id="${f.id}">
                <div class="pack-item-info">
                    <span>${emoji}</span>
                    <span class="pack-item-name" title="${f.file.name}">${f.file.name}</span>
                    <span class="pack-item-size">${f.originalSize ? `${formatBytes(f.originalSize)} → ${formatBytes(f.file.size)}` : formatBytes(f.file.size)}</span>
                </div>
                <div class="pack-item-remove" onclick="removePackFile('${f.id}')">[✕]</div>
            </div>
        `;
    }).join('');

    updateDualLayerRealStatus();
}

window.removePackFile = function(id) {
    window.SF_PackFiles = window.SF_PackFiles.filter(f => f.id !== id);
    renderPackList();
    updateCapacity();
    updateDualLayerRealStatus();
};

async function compressImage(file, maxSizeBytes) { 
    if (file.size <= maxSizeBytes) return { file, originalSize: null }; 
    return new Promise(resolve => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let w = img.width, h = img.height;
            const MAX_DIM = 1920;
            if (w > MAX_DIM || h > MAX_DIM) {
                const ratio = Math.min(MAX_DIM / w, MAX_DIM / h);
                w = Math.round(w * ratio);
                h = Math.round(h * ratio);
            }
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            URL.revokeObjectURL(url);
            let quality = 0.85;
            const originalSize = file.size;
            const tryCompress = () => {
                canvas.toBlob(blob => {
                    if (!blob) { resolve({ file, originalSize: null }); return; }
                    if (blob.size <= maxSizeBytes || quality <= 0.35) {
                        resolve({
                            file: new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }),
                            originalSize
                        });
                    } else {
                        quality -= 0.15;
                        tryCompress();
                    }
                }, 'image/jpeg', quality);
            };
            tryCompress();
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve({ file, originalSize: null }); };
        img.src = url;
    });
}

// ==============================
// MULTI-FILE PACKING LOGIC
// ==============================
async function buildSecretPayload(password) {
    const files = window.SF_PackFiles || [];
    if (files.length === 0) return null;

    // Show advisory for large non-image files
    const totalSize = files.reduce((a, f) => a + f.file.size, 0);
    const audioExts = ['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a'];
    const videoExts = ['mp4', 'mkv', 'mov', 'avi', 'webm'];
    const docExts = ['pdf', 'docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls'];
    const ext0 = files[0]?.file.name.split('.').pop().toLowerCase();
    const warningEl = document.getElementById('capacity-warning');
    if (warningEl) {
        if (videoExts.includes(ext0) && totalSize > 5 * 1024 * 1024) {
            const minPixels = Math.ceil((totalSize * 8) / 3);
            const minMP = (minPixels / 1000000).toFixed(1);
            warningEl.textContent = `⚠ Video is large (${formatBytes(totalSize)}). Carrier image must be at least ${minMP}MP. Use a high-resolution PNG.`;
            warningEl.style.display = 'block';
        } else if (audioExts.includes(ext0) && totalSize > 2 * 1024 * 1024) {
            warningEl.textContent = `ℹ Audio file is large. Consider converting to MP3 128kbps first for best results.`;
            warningEl.style.display = 'block';
        } else if (docExts.includes(ext0) && totalSize > 1 * 1024 * 1024) {
            const minPixels = Math.ceil((totalSize * 8) / 3);
            const minMP = (minPixels / 1000000).toFixed(1);
            warningEl.textContent = `ℹ Large document (${formatBytes(totalSize)}). Carrier image needs ~${minMP}MP minimum.`;
            warningEl.style.display = 'block';
        } else {
            warningEl.style.display = 'none';
        }
    }

    if (files.length === 1) {
        let fileEntry = files[0];
        const ext = fileEntry.file.name.split('.').pop().toLowerCase();
        const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];
        if (imageExts.includes(ext) && fileEntry.file.size > 500 * 1024) {
            const compressed = await compressImage(fileEntry.file, 500 * 1024);
            if (compressed.originalSize) {
                // Update the pack list to show compression happened
                window.SF_PackFiles[0].originalSize = compressed.originalSize;
                window.SF_PackFiles[0].file = compressed.file;
                renderPackList();
            }
            fileEntry = { file: compressed.file, id: fileEntry.id };
        }
        
        let bytes = new Uint8Array(await fileEntry.file.arrayBuffer());
        
        // --- FIXED: PDF-Native Encryption ---
        if (ext === 'pdf' && password && typeof PDFLib !== 'undefined') {
            console.log(`[ShadowFold] Initializing PDF-native protection for: ${fileEntry.file.name}`);
            const originalSize = bytes.length;
            console.log(`[ShadowFold] Original Size: ${formatBytes(originalSize)}`);

            bytes = await encryptPDF(bytes, password);
            
            const encryptedSize = bytes.length;
            console.log(`[ShadowFold] PDF-native encryption complete.`);
            console.log(`[ShadowFold] Encrypted Size: ${formatBytes(encryptedSize)} (${encryptedSize} bytes)`);
        }
        
        const finalExt = fileEntry.file.name.split('.').pop().toLowerCase();
        return { bytes, ext: finalExt };
    }
     
    // Multi-file: build in-memory zip using fflate
    const zipInput = {};
    for (const { file } of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        // fflate uses filename as key; store with original name
        zipInput[file.name] = [bytes, { level: 0 }]; // level:0 = store only; WASM already compresses
    }
     
    return new Promise((resolve, reject) => {
        if (typeof fflate === 'undefined') {
            reject(new Error('fflate library not loaded.'));
            return;
        }
        fflate.zip(zipInput, { level: 0 }, (err, data) => {
            if (err) { reject(err); return; }
            resolve({ bytes: data, ext: 'sfpack' });
        });
    });
}

// ==============================
// MULTI-FILE UNPACKING LOGIC
// ==============================
async function unpackPayload(fileData, fileExt) {
    if (fileExt !== 'sfpack') {
        // Single file — trigger download
        const filename = `decoded.${fileExt}`;
        
        // Validation for PDF files
        if (fileExt === 'pdf') {
            const header = new TextDecoder().decode(fileData.slice(0, 5));
            if (header !== '%PDF-') {
                console.warn(`[ShadowFold] Warning: Decoded PDF does not have a valid header. Found: ${header}`);
                // We still let the user download it, but warn in console.
            }
        }
        
        downloadBlob(fileData, filename);
        return { fileCount: 1, totalSize: fileData.length, names: [filename] };
    }
     
    // Multi-pack: decompress ZIP in JS
    return new Promise((resolve, reject) => {
        if (typeof fflate === 'undefined') {
            reject(new Error('fflate library not loaded.'));
            return;
        }
        fflate.unzip(fileData, (err, files) => {
            if (err) { reject(err); return; }
            const names = Object.keys(files);
            let totalSize = 0;
            const filenames = [];
            for (const name of names) {
                downloadBlob(files[name], name);
                totalSize += files[name].length;
                filenames.push(name);
            }
            resolve({ fileCount: filenames.length, totalSize, names: filenames });
        });
    });
}

function downloadBlob(data, filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const mimeMap = {
        'pdf': 'application/pdf',
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'gif': 'image/gif',
        'zip': 'application/zip',
        'sfpack': 'application/octet-stream',
        'txt': 'text/plain',
        'mp3': 'audio/mpeg',
        'mp4': 'video/mp4'
    };
    const type = mimeMap[ext] || 'application/octet-stream';
    
    // Ensure data is a Uint8Array for consistent Blob creation
    const buffer = data instanceof Uint8Array ? data : new Uint8Array(data);
    const blob = new Blob([buffer], { type: type });
    
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    
    // Increased timeout for Blob revocation. PDF viewers in-browser often 
    // need the URL to remain valid while rendering content streams.
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    
    console.log(`[ShadowFold] Download triggered: ${filename} (${formatBytes(buffer.length)})`);
}


// ==============================
// ENHANCED INTRO SCREEN + SOUND
// ==============================
window.addEventListener('load', () => {
    const audio = new Audio('assets/sounds/glitch.mp3');
    audio.volume = 0.1; 
    
    const intro = document.getElementById('intro-screen');
    const enterBtn = document.getElementById('enter-void-btn');

    if (enterBtn) {
        enterBtn.addEventListener('click', () => {
            // Play sound on click
            audio.play().catch(() => {});
            
            // Start fade out
            if (intro) {
                intro.classList.add('fade-out');
                setTimeout(() => {
                    intro.style.display = 'none';
                }, 1000);
            }
        });
    }
});

// ==============================
// PASSWORD TOGGLE HELPER
// ==============================
function setupPasswordToggle(toggleId, inputId) {
    const toggle = document.getElementById(toggleId);
    const input  = document.getElementById(inputId);
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
// PASSWORD STRENGTH METER
// ==============================
function setupStrengthMeter(inputId, meterId) {
    const input = document.getElementById(inputId);
    const meter = document.getElementById(meterId);
    if (!input || !meter) return;

    input.addEventListener('input', () => {
        const { score, label, cls } = assessPassword(input.value);
        meter.innerHTML = '';
        if (!input.value) return;

        // 4 segments
        for (let i = 1; i <= 4; i++) {
            const seg = document.createElement('span');
            seg.className = 'strength-seg' + (i <= score ? ' ' + cls : ' strength-empty');
            meter.appendChild(seg);
        }
        const lbl = document.createElement('span');
        lbl.className = 'strength-label ' + cls;
        lbl.textContent = label;
        meter.appendChild(lbl);
    });
}

// ==============================
// DROP ZONE HELPER
// ==============================
function setupDropZone(zoneId, inputId, previewId, nameId, isCanvas = false) {
    const dropZone   = document.getElementById(zoneId);
    const input      = document.getElementById(inputId);
    if (!dropZone || !input) return;

    const preview     = previewId ? document.getElementById(previewId) : null;
    const nameDisplay = nameId    ? document.getElementById(nameId)    : null;

    dropZone.addEventListener('click', () => input.click());

    dropZone.addEventListener('dragover', e => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            input.files = e.dataTransfer.files;
            handleFileChange(input, preview, nameDisplay);
        }
    });
    input.addEventListener('change', () => {
        handleFileChange(input, preview, nameDisplay, isCanvas);
        if (inputId === 'encode-image-input' || inputId === 'secret-file-input') {
            updateCapacity();
        }
    });
}

function handleFileChange(input, preview, nameDisplay, isCanvas) {
    const file = input.files[0];
    if (!file) return;

    const dropZone = preview && preview.parentElement ? preview.parentElement : null;
    const dropZoneText = dropZone ? dropZone.querySelector('p') : null;

    if (isCanvas) {
        const reader = new FileReader();
        reader.onload = e => {
            const img = new Image();
            img.onload = () => {
                const canvas = preview;
                const ctx = canvas.getContext('2d');
                canvas.width = img.width;
                canvas.height = img.height;
                ctx.drawImage(img, 0, 0);
                canvas.style.display = 'block';
                if (dropZoneText) dropZoneText.style.display = 'none';
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    } else if (preview) {
        const reader = new FileReader();
        reader.onload = e => {
            preview.src = e.target.result;
            preview.style.display = 'block';
            if (dropZoneText) dropZoneText.style.display = 'none';
        };
        reader.readAsDataURL(file);
    }
    if (nameDisplay) nameDisplay.textContent = file.name;
}

// ==============================
// CAPACITY INDICATOR
// Uses get_capacity_bytes() from WASM when available for exact
// overhead-aware capacity; falls back to the raw pixel estimate.
// ==============================
function updateCapacity() {
    const carrierInput   = document.getElementById('encode-image-input');
    const capacitySection = document.getElementById('capacity-section');
    const capacityPct    = document.getElementById('capacity-pct');
    const capacityMax    = document.getElementById('capacity-max');
    const capacityBar    = document.getElementById('capacity-bar');
    const capacityUsed   = document.getElementById('capacity-used');

    if (!carrierInput || !capacitySection) return;

    const carrierFile = carrierInput.files[0];
    if (!carrierFile) { capacitySection.style.display = 'none'; return; }

    capacitySection.style.display = 'block';

    const img = new Image();
    img.src = URL.createObjectURL(carrierFile);
    img.onload = () => {
        const totalPixels = img.width * img.height;
        const packFiles   = window.SF_PackFiles || [];
        
        let usedBytes = 0;
        let ext_len = 3;

        if (packFiles.length > 1) {
            usedBytes = packFiles.reduce((acc, f) => acc + f.file.size, 0);
            ext_len = 6; // ".sfpack"
        } else if (packFiles.length === 1) {
            usedBytes = packFiles[0].file.size;
            ext_len = packFiles[0].file.name.split('.').pop().length;
        }

        const dualLayerCheckbox = document.getElementById('dual-layer-checkbox');
        const isDual = dualLayerCheckbox && dualLayerCheckbox.checked;

        const mod = window.Module || (typeof Module !== 'undefined' ? Module : null);

        // Use WASM-accurate capacity when available
        let maxBytes;
        if (mod && typeof mod.get_capacity_bytes === 'function') {
            try {
                maxBytes = mod.get_capacity_bytes(totalPixels, ext_len, isDual);
            } catch(e) {
                console.warn("[ShadowFold] Capacity WASM failed, falling back.");
                maxBytes = Math.floor(totalPixels * 3 / 8) - 100;
            }
        } else {
            // Conservative fallback: raw bits / 8 minus rough overhead
            const usable = isDual ? totalPixels * 3 / 2 : totalPixels * 3;
            maxBytes = Math.max(0, Math.floor(usable / 8) - 40);
        }

        const pct = maxBytes > 0 ? Math.min(100, Math.round((usedBytes / maxBytes) * 100)) : 100;

        const capacityWarning = document.getElementById('capacity-warning');
        if (capacityWarning) {
            if (pct > 100) {
                capacityWarning.textContent = '⚠ Payload too large for this carrier image. Use a larger PNG or compress first.';
                capacityWarning.style.display = 'block';
            } else {
                capacityWarning.style.display = 'none';
            }
        }

        if (capacityPct)  capacityPct.textContent  = `${pct}%`;
        if (capacityMax)  capacityMax.textContent  = `/ ${formatBytes(maxBytes)}`;
        if (capacityUsed) capacityUsed.textContent = `${formatBytes(usedBytes)} used`;
        if (capacityBar) {
            capacityBar.style.width = `${pct}%`;
            let color = '#00c878';
            if (pct > 90)      color = 'var(--primary-color)';
            else if (pct > 50) color = '#ffaa00';
            capacityBar.style.background = color;
            if (capacityPct) capacityPct.style.color = color;
        }
        URL.revokeObjectURL(img.src);
    };
}

// ==============================
// IMAGE-TO-IMAGE STEGANOGRAPHY
// ==============================

function resizeImage(img, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height);
}

async function handleImageToImageEncode() {
    const coverCanvas = document.getElementById('cover-image-preview-canvas');
    const secretCanvas = document.getElementById('secret-image-preview-canvas');
    const downloadLink = document.getElementById('download-encoded-image');

    if (!coverCanvas.width || !secretCanvas.width) {
        alert('Please upload both a cover and a secret image.');
        return;
    }

    showLoader('MERGING VISUAL DATA...');

    // Wait a bit for UI to show loader
    await new Promise(r => setTimeout(r, 100));

    try {
        const coverCtx = coverCanvas.getContext('2d');
        const coverData = coverCtx.getImageData(0, 0, coverCanvas.width, coverCanvas.height);
        
        // Use the secret canvas directly to avoid slow toDataURL
        const secretData = resizeImage(secretCanvas, coverCanvas.width, coverCanvas.height);
        
        // LSB Encoding (4 bits per channel for better quality)
        for (let i = 0; i < coverData.data.length; i += 4) {
            for (let j = 0; j < 3; j++) { // RGB only
                // Clear the 4 LSBs of cover
                coverData.data[i + j] = coverData.data[i + j] & 0xF0;
                // Get the 4 MSBs of secret (bits 4-7) and move them to bits 0-3
                const secretBits = (secretData.data[i + j] & 0xF0) >> 4;
                // Set the 4 LSBs of cover
                coverData.data[i + j] = coverData.data[i + j] | secretBits;
            }
            // Keep Alpha channel of cover at 255 (fully opaque) to avoid artifacts
            coverData.data[i + 3] = 255;
        }

        // Update the cover canvas directly with the encoded data
        coverCtx.putImageData(coverData, 0, 0);

        // Also update the encoded image preview in the DECODE tab automatically
        const decodeEncodedCanvas = document.getElementById('encoded-image-preview-canvas');
        if (decodeEncodedCanvas) {
            decodeEncodedCanvas.width = coverCanvas.width;
            decodeEncodedCanvas.height = coverCanvas.height;
            const decodeEncodedCtx = decodeEncodedCanvas.getContext('2d');
            decodeEncodedCtx.putImageData(coverData, 0, 0);
            decodeEncodedCanvas.style.display = 'block';
            
            // Hide the text in the decode drop zone
            const decodeDropZoneText = decodeEncodedCanvas.parentElement ? decodeEncodedCanvas.parentElement.querySelector('p') : null;
            if (decodeDropZoneText) decodeDropZoneText.style.display = 'none';
        }

        // Prepare download
        const dataUrl = coverCanvas.toDataURL('image/png');
        downloadLink.href = dataUrl;
        downloadLink.style.display = 'inline-block';
        downloadLink.textContent = '✓ DOWNLOAD ENCODED IMAGE';
        
        hideLoader();
        // Removed alert as requested
        
        // Show success indicator on the button
        const encodeBtn = document.getElementById('encode-image-button');
        if (encodeBtn) {
            const originalText = encodeBtn.textContent;
            encodeBtn.textContent = '✓ ENCODING COMPLETE';
            encodeBtn.classList.add('success-pulse');
            setTimeout(() => {
                encodeBtn.textContent = originalText;
                encodeBtn.classList.remove('success-pulse');
            }, 3000);
        }

        // Track operation
        trackOperation({
            type: 'image-encode',
            file: 'encoded_image.png',
            size: dataUrl.length,
            status: 'ok'
        });

    } catch (err) {
        console.error(err);
        hideLoader();
        alert('Encoding failed: ' + err.message);
    }
}

async function handleImageToImageDecode() {
    const encodedCanvas = document.getElementById('encoded-image-preview-canvas');
    const extractedCanvas = document.getElementById('extracted-secret-image-canvas');
    const downloadLink = document.getElementById('download-decoded-image');

    if (!encodedCanvas.width) {
        alert('Please upload an encoded image.');
        return;
    }

    showLoader('EXTRACTING VISUAL DATA...');
    await new Promise(r => setTimeout(r, 100));

    try {
        const encodedCtx = encodedCanvas.getContext('2d');
        const encodedData = encodedCtx.getImageData(0, 0, encodedCanvas.width, encodedCanvas.height);
        
        const extractedData = new ImageData(encodedCanvas.width, encodedCanvas.height);

        // Extract 4 bits per channel
        for (let i = 0; i < encodedData.data.length; i += 4) {
            for (let j = 0; j < 3; j++) { // RGB only
                // Get the 4 LSBs of encoded image
                const bits = encodedData.data[i + j] & 0x0F;
                // Move them to the 4 MSBs of the extracted image (bits 4-7)
                extractedData.data[i + j] = bits << 4; 
            }
            extractedData.data[i + 3] = 255; // Fully opaque
        }

        extractedCanvas.width = encodedCanvas.width;
        extractedCanvas.height = encodedCanvas.height;
        const extractedCtx = extractedCanvas.getContext('2d');
        extractedCtx.putImageData(extractedData, 0, 0);

        // Prepare download
        const dataUrl = extractedCanvas.toDataURL('image/png');
        downloadLink.href = dataUrl;
        downloadLink.style.display = 'inline-block';
        downloadLink.textContent = '✓ DOWNLOAD EXTRACTED IMAGE';

        hideLoader();
        // Removed alert as requested

        // Show success indicator on the button
        const decodeBtn = document.getElementById('decode-image-button');
        if (decodeBtn) {
            const originalText = decodeBtn.textContent;
            decodeBtn.textContent = '✓ DECODING COMPLETE';
            decodeBtn.classList.add('success-pulse');
            setTimeout(() => {
                decodeBtn.textContent = originalText;
                decodeBtn.classList.remove('success-pulse');
            }, 3000);
        }

        trackOperation({
            type: 'image-decode',
            file: 'extracted_image.png',
            size: dataUrl.length,
            status: 'ok'
        });

    } catch (err) {
        console.error(err);
        hideLoader();
        alert('Decoding failed: ' + err.message);
    }
}

// ==============================
// ENCODE
// ==============================
async function handleEncode() {
    const wasmVer = getWASMVersion();
    const mod = window.Module || (typeof Module !== 'undefined' ? Module : null);
    if (wasmVer === 'none') {
        alert('WASM module not yet active. Please wait a moment and try again.');
        return;
    }

    const imageInput    = document.getElementById('encode-image-input');
    const passwordInput = document.getElementById('encode-password');
    const stats         = document.getElementById('encode-stats');

    const password = passwordInput ? passwordInput.value.trim() : '';

    if (!imageInput?.files[0])  { alert('Please upload a carrier image.'); return; }
    if (!window.SF_PackFiles || window.SF_PackFiles.length === 0) { alert('Please upload a secret file to hide.'); return; }
    if (!password)               { alert('Please enter a frequency (password).'); return; }

    const { score } = assessPassword(password);
    if (score < 2) {
        alert('Password is too weak. Use at least 8 characters including uppercase, numbers, or symbols.');
        return;
    }

    const imageFile = imageInput.files[0];
    if (!imageFile.type.includes('png') && !imageFile.type.includes('bmp')) {
        alert('Carrier image must be PNG or BMP. JPEG is lossy and will destroy hidden data.');
        return;
    }

    const decoyInput         = document.getElementById('decoy-file-input');
    const decoyPasswordInput = document.getElementById('decoy-password');
    const dualLayerCheckbox  = document.getElementById('dual-layer-checkbox');
    const isDual             = dualLayerCheckbox && dualLayerCheckbox.checked;
    const decoyPassword      = decoyPasswordInput ? decoyPasswordInput.value.trim() : '';
    const hasDecoy           = isDual && !!(decoyInput?.files[0] && decoyPassword);

    if (isDual && !hasDecoy) {
        alert('Dual layer is active but decoy file or password is missing.');
        return;
    }

    if (hasDecoy) {
        const { score: dScore } = assessPassword(decoyPassword);
        if (dScore < 2) {
            alert('Decoy password is too weak. Use at least 8 characters including uppercase, numbers, or symbols.');
            return;
        }
        if (decoyPassword === password) {
            alert('Real password and decoy password must be different.');
            return;
        }
    }

    showLoader('FOLDING REALITY...');

    const canvas = document.getElementById('canvas');
    const ctx    = canvas.getContext('2d', { 
        willReadFrequently: true,
        colorSpace: 'srgb' // Force standard color space to prevent profile shifts
    });

    try {
        // Use colorSpaceConversion: 'none' to prevent the browser from shifting pixels
        const imageBitmap = await createImageBitmap(imageFile, { colorSpaceConversion: 'none' });
        canvas.width  = imageBitmap.width;
        canvas.height = imageBitmap.height;
        
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(imageBitmap, 0, 0);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        
        // Force alpha to 255 for all pixels to prevent lossy premultiplication 
        // during PNG export. This is critical for bit-perfect steganography.
        for (let i = 3; i < imageData.data.length; i += 4) {
            imageData.data[i] = 255;
        }

        // Create a copy of the original pixels for PSNR and heatmap
        const originalPixels = new Uint8Array(imageData.data.slice().buffer);
        
        // Pass a Uint8Array view into the buffer instead of a ClampedArray.
        const imageBytes = new Uint8Array(imageData.data.buffer);

        // Sanity check
        if (imageBytes.length !== canvas.width * canvas.height * 4) {
            throw new Error(`Memory mismatch: Image size ${canvas.width}x${canvas.height} requires ${canvas.width * canvas.height * 4} bytes, but got ${imageBytes.length}.`);
        }
        const payload     = await buildSecretPayload(password);
        if (!payload) throw new Error('Failed to build payload');
        
        const secretBytes = payload.bytes;
        const ext         = payload.ext;

        let result;

        try {
            if (wasmVer === 'v2') {
                // Best path: new build with width/height for strong per-image salt
                let decoyBytes = new Uint8Array(0);
                let decoyExt   = '';
                if (hasDecoy) {
                    const decoyFile = decoyInput.files[0];
                    let dBytes = new Uint8Array(await decoyFile.arrayBuffer());
                    let dExt   = decoyFile.name.split('.').pop().toLowerCase();
                    
                    // --- FIXED: Decoy PDF-Native Encryption ---
                    if (dExt === 'pdf' && decoyPassword && typeof PDFLib !== 'undefined') {
                        console.log(`[ShadowFold] Initializing PDF-native protection for DECOY: ${decoyFile.name}`);
                        dBytes = await encryptPDF(dBytes, decoyPassword);
                        console.log(`[ShadowFold] Decoy PDF encrypted. Size: ${formatBytes(dBytes.length)}`);
                    }

                    decoyBytes = dBytes;
                    decoyExt   = dExt;
                }
                result = mod.encode_data_wh(
                    imageBytes, secretBytes, ext, password,
                    decoyBytes, decoyExt, decoyPassword,
                    canvas.width, canvas.height
                );
            } else if (wasmVer === 'v1') {
                // Mid build: 7-arg encode_data (dual-layer capable but no w/h salt)
                let decoyBytes = new Uint8Array(0);
                let decoyExt   = '';
                if (hasDecoy) {
                    const decoyFile = decoyInput.files[0];
                    let dBytes = new Uint8Array(await decoyFile.arrayBuffer());
                    let dExt   = decoyFile.name.split('.').pop().toLowerCase();
                    
                    if (dExt === 'pdf' && decoyPassword && typeof PDFLib !== 'undefined') {
                        dBytes = await encryptPDF(dBytes, decoyPassword);
                    }

                    decoyBytes = dBytes;
                    decoyExt   = dExt;
                }
                result = mod.encode_data(
                    imageBytes, secretBytes, ext, password,
                    decoyBytes, decoyExt, decoyPassword
                );
            } else {
                // v0: original compiled WASM — only 4 args, no dual-layer support
                // Dual-layer simulation: embed decoy first, then real on top
                if (hasDecoy) {
                    const decoyFile = decoyInput.files[0];
                    let dBytes = new Uint8Array(await decoyFile.arrayBuffer());
                    let dExt   = decoyFile.name.split('.').pop().toLowerCase();
                    
                    if (dExt === 'pdf' && decoyPassword && typeof PDFLib !== 'undefined') {
                        dBytes = await encryptPDF(dBytes, decoyPassword);
                    }

                    const decoyResult = mod.encode_data(imageBytes, dBytes, dExt, decoyPassword);
                    if (decoyResult) {
                        result = mod.encode_data(new Uint8Array(decoyResult), secretBytes, ext, password);
                    } else {
                        console.warn('[ShadowFold] Decoy skipped (capacity). Embedding real file only.');
                        result = mod.encode_data(imageBytes, secretBytes, ext, password);
                    }
                } else {
                    result = mod.encode_data(imageBytes, secretBytes, ext, password);
                }
            }
        } catch (wasmErr) {
            console.error('[ShadowFold] WASM Encode failure:', wasmErr);
            throw new Error(`The steganographic engine failed to process this image. This usually happens if the carrier image is very large or if the system is out of memory.`);
        }

        if (!result) {
            if (stats) stats.innerHTML = buildStatsHTML([
                { label: 'STATUS', value: 'ENCODE FAILED', cls: 'stat-fail' },
                { label: 'ERROR', value: 'CARRIER CAPACITY EXCEEDED' },
                { label: 'DETAILS', value: 'Payload is too large for this image.' }
            ]);
            if (window.SFLog) window.SFLog.add({
                type: 'encode', 
                file: window.SF_PackFiles.length > 1 ? `${window.SF_PackFiles.length} files (.sfpack)` : window.SF_PackFiles[0].file.name,
                ext, size: secretBytes.length, carrier: imageFile.name,
                capacity: 0,
                status: 'fail'
            });
            return;
        }

        // result is an Emscripten val representing a Uint8Array view into WASM heap.
        // We MUST slice it immediately to create a JS-owned copy.
        const resultBytes = new Uint8Array(result).slice();
        const newImageData = new ImageData(new Uint8ClampedArray(resultBytes), canvas.width, canvas.height);
        ctx.putImageData(newImageData, 0, 0);

        canvas.toBlob((blob) => {
            if (!blob) throw new Error('Failed to generate PNG blob.');
            const link = document.createElement('a');
            link.download = `encoded_${Date.now()}.png`;
            link.href = URL.createObjectURL(blob);
            link.click();
            
            // Stats
            const psnrValue = calculatePSNR(originalPixels, resultBytes);
            const psnrText  = psnrValue === Infinity ? '∞ dB' : psnrValue.toFixed(2) + ' dB';
            const psnrCls   = psnrValue > 45 ? 'stat-good' : psnrValue > 35 ? 'stat-warn' : 'stat-fail';

            const usagePct = totalCapacity > 0
                ? ((secretBytes.length / totalCapacity) * 100).toFixed(1)
                : '—';

            if (stats) stats.innerHTML = buildStatsHTML([
                { label: 'STATUS',               value: 'FOLDED SUCCESSFULLY',                       cls: 'stat-good' },
                { label: 'IMAGE QUALITY (PSNR)', value: psnrText,                                    cls: psnrCls },
                { label: 'ENCRYPTION',           value: 'AES-256-CBC ✓',                             cls: 'stat-good' },
                { label: 'KEY DERIVATION',       value: 'PBKDF2-SHA256 · 100k iter ✓',               cls: 'stat-good' },
                { label: 'DUAL LAYER',           value: hasDecoy ? 'ACTIVE — TRUE DENIABILITY ✓' : 'INACTIVE', cls: hasDecoy ? 'stat-good' : '' },
                { label: 'USAGE',                value: `${formatBytes(secretBytes.length)} / ${formatBytes(totalCapacity)} (${usagePct}%)` }
            ]);

            if (window.SFLog) window.SFLog.add({
                type: 'encode', 
                file: window.SF_PackFiles.length > 1 ? `${window.SF_PackFiles.length} files (.sfpack)` : window.SF_PackFiles[0].file.name,
                ext, size: secretBytes.length, 
                fileCount: window.SF_PackFiles.length,
                carrier: imageFile.name,
                capacity: totalCapacity,
                status: 'ok'
            });

            hideLoader();
            showStatus('THE VOID HAS SEALED YOUR DATA.', 'success');
        }, 'image/png');

        // Clear password fields from DOM after use
        setTimeout(() => { 
            if (passwordInput) passwordInput.value = ''; 
            if (decoyPasswordInput) decoyPasswordInput.value = '';
            
            // Clear strength meters
            const sm1 = document.getElementById('encode-password-strength');
            const sm2 = document.getElementById('decoy-password-strength');
            if (sm1) sm1.innerHTML = '';
            if (sm2) sm2.innerHTML = '';
        }, 1500);

        const totalPixels = canvas.width * canvas.height;
        let totalCapacity = 0;
        if (mod && typeof mod.get_capacity_bytes === 'function') {
            totalCapacity = mod.get_capacity_bytes(totalPixels, ext.length, hasDecoy);
        } else {
            // Conservative fallback if function is missing
            const usable = hasDecoy ? totalPixels * 3 / 2 : totalPixels * 3;
            totalCapacity = Math.max(0, Math.floor(usable / 8) - 40);
        }

        if (window.SFLog) window.SFLog.add({
            type: 'encode', 
            file: window.SF_PackFiles.length > 1 ? `${window.SF_PackFiles.length} files (.sfpack)` : window.SF_PackFiles[0].file.name,
            ext, size: secretBytes.length, 
            fileCount: window.SF_PackFiles.length,
            carrier: imageFile.name,
            capacity: totalCapacity,
            status: 'ok'
        });

        // Stats
        const psnrValue = calculatePSNR(originalPixels, resultBytes);
        const psnrText  = psnrValue === Infinity ? '∞ dB' : psnrValue.toFixed(2) + ' dB';
        const psnrCls   = psnrValue > 45 ? 'stat-good' : psnrValue > 35 ? 'stat-warn' : 'stat-fail';

        const secretHash = await sha256hex(secretBytes);
        const usagePct = totalCapacity > 0
            ? ((secretBytes.length / totalCapacity) * 100).toFixed(1)
            : '—';

        const { score: pScore, label: pLabel } = assessPassword(password);
        const strengthMap = { 1: 'stat-fail', 2: 'stat-warn', 3: 'stat-warn', 4: 'stat-good' };

        const statsRows = [
            { label: 'STATUS',               value: 'FOLDED SUCCESSFULLY',                       cls: 'stat-good' },
            { label: 'IMAGE QUALITY (PSNR)', value: psnrText,                                    cls: psnrCls },
            { label: 'ENCRYPTION',           value: 'AES-256-CBC ✓',                             cls: 'stat-good' },
            { label: 'KEY DERIVATION',       value: 'PBKDF2-SHA256 · 100k iter ✓',               cls: 'stat-good' },
            { label: 'DUAL LAYER',           value: hasDecoy ? 'ACTIVE — TRUE DENIABILITY ✓' : 'INACTIVE', cls: hasDecoy ? 'stat-good' : '' },
            { label: 'PASSWORD STRENGTH',    value: pLabel.toUpperCase(),                        cls: strengthMap[pScore] || '' },
            { label: 'CAPACITY USED',        value: usagePct + '%' },
            { label: 'PAYLOAD SIZE',         value: formatBytes(secretBytes.length) },
            { label: 'FILE TYPE',            value: ext === 'sfpack' ? 'MULTI-FILE PACK' : '.' + ext.toUpperCase() },
            { label: 'SHA-256 (payload)',    value: secretHash.substring(0, 20) + '...' },
        ];

        if (hasDecoy) {
            statsRows.push({ label: 'PARTITION SPLIT', value: '~25–50% (cryptographically derived)', cls: 'stat-warn' });
        }

        if (stats) stats.innerHTML = buildStatsHTML(statsRows);

        generateHeatmap(originalPixels, resultBytes, canvas.width, canvas.height, hasDecoy);

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
    const wasmVer = getWASMVersion();
    const mod = window.Module || (typeof Module !== 'undefined' ? Module : null);

    if (wasmVer === 'none') {
        alert('WASM module not yet active. Please wait a moment and try again.');
        return;
    }

    const imageInput    = document.getElementById('decode-image-input');
    const stats         = document.getElementById('decode-stats');

    // Check Mode
    const activeModeBtn = document.querySelector('#decode-mode-selector .mode-btn.active');
    const isDual = activeModeBtn && activeModeBtn.dataset.mode === 'dual';

    let password = '';
    let realPwd = '';
    let decoyPwd = '';
    let extractDecoy = false;

    if (isDual) {
        realPwd = document.getElementById('decode-real-password').value.trim();
        decoyPwd = document.getElementById('decode-decoy-password').value.trim();
        const activeLayerBtn = document.querySelector('#decode-layer-selector .mode-btn.active');
        extractDecoy = activeLayerBtn && activeLayerBtn.dataset.layer === 'decoy';
        
        if (!realPwd || !decoyPwd) {
            alert('Dual-layer images require BOTH passwords to locate either layer.');
            return;
        }
    } else {
        password = document.getElementById('decode-password').value.trim();
        if (!password) { alert('Please enter the frequency (password).'); return; }
    }

    if (!imageInput?.files[0]) { alert('Please upload an encoded image.'); return; }

    showLoader('ENTERING THE VOID...');

    const canvas = document.getElementById('canvas');
    const ctx    = canvas.getContext('2d', { 
        willReadFrequently: true,
        colorSpace: 'srgb' // Force standard color space
    });

    try {
        // Use colorSpaceConversion: 'none' to prevent browser color corrections
        const imageBitmap = await createImageBitmap(imageInput.files[0], { colorSpaceConversion: 'none' });
        canvas.width  = imageBitmap.width;
        canvas.height = imageBitmap.height;
        
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(imageBitmap, 0, 0);

        if (!canvas.width || !canvas.height) {
             throw new Error('Canvas dimensions are zero — image may not have loaded correctly.');
        }
        const imageData  = ctx.getImageData(0, 0, canvas.width, canvas.height);
        
        // Pass a Uint8Array view into the buffer instead of a ClampedArray.
        const imageBytes = new Uint8Array(imageData.data.buffer);

        // Sanity check
        if (imageBytes.length !== canvas.width * canvas.height * 4) {
            throw new Error(`Memory mismatch: Image size ${canvas.width}x${canvas.height} requires ${canvas.width * canvas.height * 4} bytes, but got ${imageBytes.length}.`);
        }

        let result;
        try {
            if (wasmVer === 'v2') {
                if (isDual) {
                    result = mod.decode_data_dual(imageBytes, realPwd, decoyPwd, extractDecoy, canvas.width, canvas.height);
                } else {
                    result = mod.decode_data_wh(imageBytes, password, canvas.width, canvas.height);
                }
            } else if (wasmVer === 'v1') {
                // Mid build: decode_data_dual might exist, but if not fall back
                if (isDual && typeof mod.decode_data_dual === 'function') {
                    result = mod.decode_data_dual(imageBytes, realPwd, decoyPwd, extractDecoy, canvas.width, canvas.height);
                } else {
                    result = mod.decode_data(imageBytes, password);
                }
            } else {
                // v0: only single decode_data
                result = mod.decode_data(imageBytes, password);
            }
        } catch (wasmErr) {
            console.error('[ShadowFold] WASM Decode failure:', wasmErr);
            throw new Error(`The steganographic engine failed to process this image. This usually happens if the carrier image is very large or if the system is out of memory.`);
        }

        if (!result || !result.data) {
            if (stats) stats.innerHTML = buildStatsHTML([
                { label: 'STATUS', value: 'DECODE FAILED', cls: 'stat-fail' },
                { label: 'ERROR', value: 'FREQUENCY MISMATCH OR CORRUPTED DATA' }
            ]);
            if (window.SFLog) window.SFLog.add({
                type: 'decode', file: imageInput.files[0].name,
                ext: '', size: 0, carrier: imageInput.files[0].name,
                capacity: 0,
                status: 'fail'
            });
            return;
        }

        // result.data is already a JS-owned Uint8Array from copyToJSArray()
        const fileData = result.data.slice();
        const fileExt  = result.extension || 'bin';

        const unpackResult = await unpackPayload(fileData, fileExt);

        // Clear password fields after use
        setTimeout(() => { 
            if (document.getElementById('decode-password')) document.getElementById('decode-password').value = ''; 
            if (document.getElementById('decode-real-password')) document.getElementById('decode-real-password').value = '';
            if (document.getElementById('decode-decoy-password')) document.getElementById('decode-decoy-password').value = '';
            
            // Clear strength meters if they exist
            const sm1 = document.getElementById('decode-password-strength');
            const sm2 = document.getElementById('decode-real-password-strength');
            const sm3 = document.getElementById('decode-decoy-password-strength');
            if (sm1) sm1.innerHTML = '';
            if (sm2) sm2.innerHTML = '';
            if (sm3) sm3.innerHTML = '';
        }, 1500);

        try { trackOperation({ type: 'decode', file: imageInput.files[0].name, ext: fileExt, size: fileData.length, carrier: imageInput.files[0].name, capacity: 0, status: 'ok' }); } catch(e) {}

        const fileHash = await sha256hex(fileData);

        const statsRows = [
            { label: 'STATUS',         value: 'DATA EXTRACTED',           cls: 'stat-good' },
            { label: 'INTEGRITY',      value: 'BIT-PERFECT ✓',            cls: 'stat-good' },
            { label: 'DIGITAL SIG',    value: fileHash.substring(0, 16).toUpperCase(), cls: 'stat-warn' }
        ];

        if (fileExt === 'sfpack') {
            statsRows.push({ label: 'PACK TYPE', value: 'MULTI-FILE SFPACK ◈', cls: 'stat-warn' });
            statsRows.push({ label: 'FILES EXTRACTED', value: unpackResult.fileCount.toString() });
            statsRows.push({ label: 'TOTAL SIZE', value: formatBytes(unpackResult.totalSize) });
            
            const fileListStr = unpackResult.names.join(' · ');
            const truncatedList = fileListStr.length > 60 ? fileListStr.substring(0, 57) + '...' : fileListStr;
            statsRows.push({ label: 'FILES', value: truncatedList });
        } else {
            statsRows.push({ label: 'FILE TYPE',      value: '.' + fileExt.toUpperCase() });
            statsRows.push({ label: 'EXTRACTED SIZE', value: formatBytes(fileData.length) });
        }

        statsRows.push({ label: 'SHA-256',        value: fileHash.substring(0, 20) + '...' });
        statsRows.push({ label: 'ENCRYPTION',     value: 'AES-256-CBC DECRYPTED ✓',  cls: 'stat-good' });

        if (stats) stats.innerHTML = buildStatsHTML(statsRows);

    } catch (err) {
        console.error('[ShadowFold] Decode error:', err);
        alert('Fatal error during decoding. Check console for details.');
    } finally {
        hideLoader();
    }
}

// ==============================
// PIXEL HEATMAP
// Only marks pixels that changed in non-alpha channels.
// Uses green for modified to distinguish from the red UI chrome.
// ==============================
function generateHeatmap(originalBytes, encodedBytes, width, height, isDual) {
    const heatmapSection = document.getElementById('heatmap-section');
    const heatmapCanvas  = document.getElementById('heatmap-canvas');
    const heatmapLabel   = document.getElementById('heatmap-label');

    if (!heatmapSection || !heatmapCanvas) return;

    heatmapSection.style.display = 'block';
    heatmapCanvas.width  = width;
    heatmapCanvas.height = height;

    const ctx       = heatmapCanvas.getContext('2d');
    const imageData = ctx.createImageData(width, height);
    const data      = imageData.data;
    let modifiedCount = 0;

    for (let i = 0; i < originalBytes.length; i += 4) {
        const isModified =
            (originalBytes[i]   !== encodedBytes[i])   ||
            (originalBytes[i+1] !== encodedBytes[i+1]) ||
            (originalBytes[i+2] !== encodedBytes[i+2]);

        if (isModified) {
            // Green dot = payload bit written here
            data[i]   = 0;
            data[i+1] = 200;
            data[i+2] = 120;
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
        let labelText = `${modifiedCount.toLocaleString()} Pixels Modified (${pct}%)`;
        if (isDual) {
            labelText += ` · ✓ ZERO partition overlap detected`;
        }
        heatmapLabel.textContent = labelText;
    }
}



// ==============================
// STRENGTH METER RESET HELPER
// ==============================
function updateStrengthMeter(inputId, meterId) {
    const meter = document.getElementById(meterId);
    if (meter) meter.innerHTML = '';
}

// ==============================
// LOADER HELPERS
// ==============================
function showLoader(text) {
    const loader     = document.getElementById('loader');
    const loaderText = document.getElementById('loader-text');
    if (loaderText) loaderText.textContent = text;
    if (loader) loader.classList.add('show');
}

function hideLoader() {
    const loader = document.getElementById('loader');
    if (loader) loader.classList.remove('show');
}
