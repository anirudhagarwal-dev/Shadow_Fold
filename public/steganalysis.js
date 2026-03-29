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

    document.addEventListener('mousemove', (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
    });

    function animate() {
        const easing = 0.15;
        cursorX += (mouseX - cursorX) * easing;
        cursorY += (mouseY - cursorY) * easing;
        cursor.style.left = `${cursorX}px`;
        cursor.style.top = `${cursorY}px`;
        requestAnimationFrame(animate);
    }
    animate();

    setInterval(() => {
        if (Math.random() > 0.85) {
            cursor.classList.add('glitch-active');
            setTimeout(() => cursor.classList.remove('glitch-active'), 150);
        }
        if (Math.random() > 0.95) {
            cursor.classList.add('flicker-active');
            setTimeout(() => cursor.classList.remove('flicker-active'), 80);
        }
    }, 500);

    document.addEventListener('mousedown', () => cursor.classList.add('clicking'));
    document.addEventListener('mouseup', () => cursor.classList.remove('clicking'));

    const updateHoverables = () => {
        const hoverables = document.querySelectorAll('a, button, .drop-zone, .tab-button, input, .mode-btn');
        hoverables.forEach(el => {
            if (el.dataset.cursorBound) return;
            el.addEventListener('mouseenter', () => cursor.classList.add('hover'));
            el.addEventListener('mouseleave', () => cursor.classList.remove('hover'));
            el.dataset.cursorBound = "true";
        });
    };
    updateHoverables();
    const observer = new MutationObserver(updateHoverables);
    observer.observe(document.body, { childList: true, subtree: true });
}

document.addEventListener('DOMContentLoaded', () => {
    initCustomCursor();
    // --- Tracking ---
    async function trackOperation(data) {
        console.log('[ShadowFold] Analysis Tracking:', data);
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
                console.error('[ShadowFold] Analysis tracking failed with status:', response.status);
            } else {
                console.log('[ShadowFold] Analysis tracking successful');
            }
        } catch (err) {
            console.error('[ShadowFold] Failed to track operation:', err);
        }
    }

    // --- UI Elements ---
    const input = document.getElementById('analysis-input');
    const dropZone = document.getElementById('analysis-drop-zone');
    const btnAnalyze = document.getElementById('btn-analyze');
    const btnFullScan = document.getElementById('btn-full-scan');
    const infoRes = document.getElementById('info-res');
    const infoSize = document.getElementById('info-size');
    const imageInfo = document.getElementById('image-info');
    const analysisEmpty = document.getElementById('analysis-empty');
    const analysisResult = document.getElementById('analysis-result');
    const mainCanvas = document.getElementById('main-analysis-canvas');
    const fullScanResults = document.getElementById('full-scan-results');
    const resultTitle = document.getElementById('result-title');
    const planeOptions = document.querySelectorAll('.plane-option');

    // Real Stats Elements
    const chiRealEl = document.getElementById('chi-real');
    const pvalRealEl = document.getElementById('pval-real');
    const verdictRealEl = document.getElementById('verdict-real');

    let currentFile = null;
    let currentPlane = 0; // Bit 0 (LSB)

    // ==============================
    // 01. LIVE SIGNAL ANALYSIS
    // ==============================

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
            handleFileSelect(input.files[0]);
        }
    });

    input.addEventListener('change', () => {
        if (input.files.length) handleFileSelect(input.files[0]);
    });

    planeOptions.forEach(opt => {
        opt.addEventListener('click', () => {
            planeOptions.forEach(p => p.classList.remove('active'));
            opt.classList.add('active');
            currentPlane = parseInt(opt.dataset.plane);
            if (currentFile) analyzePlane(currentPlane);
        });
    });

    function handleFileSelect(file) {
        currentFile = file;
        btnAnalyze.disabled = false;
        btnFullScan.disabled = false;
        imageInfo.style.display = 'block';
        infoSize.textContent = formatBytes(file.size);

        const img = new Image();
        img.src = URL.createObjectURL(file);
        img.onload = () => {
            infoRes.textContent = `${img.width} x ${img.height}`;
            analyzePlane(currentPlane); 
            performRealProfiling(img); // Perform actual statistical analysis
            
            // Track the analysis task
            trackOperation({
                type: 'steganalysis',
                file: file.name,
                size: file.size,
                status: 'ok'
            });
        };
    }

    async function analyzePlane(bit) {
        if (!currentFile) return;

        analysisEmpty.style.display = 'none';
        analysisResult.style.display = 'block';
        fullScanResults.style.display = 'none';
        mainCanvas.style.display = 'block';
        resultTitle.textContent = `BIT ${bit} (${bit === 0 ? 'LSB' : bit === 7 ? 'MSB' : 'INTERMEDIATE'}) EXTRACTION`;

        const img = new Image();
        img.src = URL.createObjectURL(currentFile);
        await img.decode();

        mainCanvas.width = img.width;
        mainCanvas.height = img.height;

        const ctx = mainCanvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        const data = imageData.data;

        for (let i = 0; i < data.length; i += 4) {
            const rBit = (data[i] >> bit) & 1;
            const gBit = (data[i+1] >> bit) & 1;
            const bBit = (data[i+2] >> bit) & 1;
            const val = (rBit || gBit || bBit) ? 255 : 0;
            
            data[i] = val === 255 ? 255 : 0;
            data[i+1] = val === 255 ? 0 : 0;
            data[i+2] = val === 255 ? 51 : 0;
            data[i+3] = 255;
        }
        ctx.putImageData(imageData, 0, 0);
    }

    btnFullScan.addEventListener('click', async () => {
        if (!currentFile) return;

        analysisEmpty.style.display = 'none';
        analysisResult.style.display = 'block';
        mainCanvas.style.display = 'none';
        fullScanResults.style.display = 'grid';
        fullScanResults.innerHTML = '';
        resultTitle.textContent = '8-BIT FREQUENCY SCAN';

        const img = new Image();
        img.src = URL.createObjectURL(currentFile);
        await img.decode();

        for (let bit = 0; bit < 8; bit++) {
            const card = document.createElement('div');
            card.className = 'bit-plane-card';
            card.innerHTML = `<span>BIT ${bit}</span><canvas id="scan-canvas-${bit}"></canvas>`;
            fullScanResults.appendChild(card);

            const scanCanvas = card.querySelector('canvas');
            scanCanvas.width = img.width;
            scanCanvas.height = img.height;

            const ctx = scanCanvas.getContext('2d');
            ctx.drawImage(img, 0, 0);

            const imageData = ctx.getImageData(0, 0, img.width, img.height);
            const data = imageData.data;

            for (let i = 0; i < data.length; i += 4) {
                const rBit = (data[i] >> bit) & 1;
                const gBit = (data[i+1] >> bit) & 1;
                const bBit = (data[i+2] >> bit) & 1;
                const val = (rBit || gBit || bBit) ? 255 : 0;
                data[i] = data[i+1] = data[i+2] = val;
                data[i+3] = 255;
            }
            ctx.putImageData(imageData, 0, 0);
        }
    });

    // ==============================
    // 02. STATISTICAL PROFILING (REAL)
    // ==============================

    function performRealProfiling(img) {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        // Use a subset or full image for Chi-Square
        const length = Math.min(data.length, 100000); 
        const chi = calculateChiSquare(data, 0, length);
        const pval = Math.max(0.0001, Math.min(0.9999, Math.exp(-chi / 450)));

        chiRealEl.textContent = chi.toFixed(1);
        chiRealEl.style.color = chi > 150 ? 'var(--primary-color)' : '#00c878';
        pvalRealEl.textContent = pval.toFixed(4);
        pvalRealEl.style.color = pval < 0.1 ? 'var(--primary-color)' : '#00c878';

        drawHistogram('chart-real', data, 0, length, chi > 150 ? 'rgba(255,0,51,0.6)' : 'rgba(0,200,120,0.5)');

        if (chi > 200) {
            verdictRealEl.textContent = '⚠ ANOMALY DETECTED — Signal entropy is lower than natural thresholds. High probability of hidden data.';
            verdictRealEl.className = 'verdict detected';
        } else {
            verdictRealEl.textContent = '✓ SIGNAL CLEAN — Entropy levels are consistent with natural sensor noise.';
            verdictRealEl.className = 'verdict safe';
        }
    }

    // ==============================
    // 03. COMPARATIVE SIMULATION
    // ==============================

    window.runSimulation = () => {
        const SIZE = 12000;
        const PAYLOAD_BYTES = 2400;
        const PAYLOAD_BITS = PAYLOAD_BYTES * 8;

        const cleanImage = generateMockImage(SIZE, 7);
        const seqImage = embedSequential(cleanImage, PAYLOAD_BITS, 99);
        const prngImage = embedPRNG(cleanImage, PAYLOAD_BITS, 12345, 99);

        const chiSeq = calculateChiSquare(seqImage, 0, PAYLOAD_BYTES);
        const chiPrng = calculateChiSquare(prngImage, 0, SIZE);

        const pSeq = Math.max(0.0001, Math.min(0.9999, Math.exp(-chiSeq / 180)));
        const pPrng = Math.max(0.0001, Math.min(0.9999, Math.exp(-chiPrng / 900)));

        drawHistogram('chart-sequential', seqImage, 0, PAYLOAD_BYTES, 'rgba(255,0,51,0.75)');
        drawHistogram('chart-prng', prngImage, 0, SIZE, 'rgba(0,200,120,0.65)');

        document.getElementById('chi-seq').textContent = chiSeq.toFixed(1);
        document.getElementById('pval-seq').textContent = pSeq.toFixed(4);
        document.getElementById('chi-prng').textContent = chiPrng.toFixed(1);
        document.getElementById('pval-prng').textContent = pPrng.toFixed(4);

        const seqDetected = chiSeq > 80;
        document.getElementById('verdict-seq').textContent = seqDetected 
            ? '⚠ DETECTED — Anomalous LSB pair balance. Region is statistically "flat".' 
            : 'Analysis inconclusive.';
        document.getElementById('verdict-seq').className = 'verdict ' + (seqDetected ? 'detected' : 'pending');

        const prngSafe = chiPrng < 300;
        document.getElementById('verdict-prng').textContent = prngSafe 
            ? '✓ UNDETECTED — LSB distribution is statistically normal. No detectable boundary.' 
            : 'Analysis inconclusive.';
        document.getElementById('verdict-prng').className = 'verdict ' + (prngSafe ? 'safe' : 'pending');
    };

    // ==============================
    // UTILS & MATH
    // ==============================

    function calculateChiSquare(data, start, length) {
        const freq = new Array(256).fill(0);
        const end = Math.min(start + length, data.length);
        for (let i = start; i < end; i++) freq[data[i]]++;
        let chi = 0;
        for (let v = 0; v < 255; v += 2) {
            const total = freq[v] + freq[v + 1];
            if (total === 0) continue;
            const expected = total / 2;
            chi += Math.pow(freq[v] - expected, 2) / expected;
            chi += Math.pow(freq[v + 1] - expected, 2) / expected;
        }
        return chi;
    }

    function drawHistogram(canvasId, data, start, length, color) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = canvas.offsetWidth * dpr;
        canvas.height = canvas.offsetHeight * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        const W = canvas.offsetWidth;
        const H = canvas.offsetHeight;
        ctx.clearRect(0, 0, W, H);

        const freq = new Array(128).fill(0);
        const end = Math.min(start + length, data.length);
        for (let i = start; i < end; i++) freq[data[i] >> 1]++;
        const maxF = Math.max(...freq) || 1;
        const bw = W / 128;

        for (let i = 0; i < 128; i++) {
            const bh = (freq[i] / maxF) * (H - 20);
            ctx.fillStyle = color;
            ctx.fillRect(i * bw, H - bh - 10, Math.max(1, bw - 0.5), bh);
        }
        
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(0, H/2); ctx.lineTo(W, H/2);
        ctx.stroke();
    }

    function formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    // --- Simulation Helpers ---
    function lcgRandom(seed) {
        let s = seed >>> 0;
        return function() {
            s = (Math.imul(1664525, s) + 1013904223) >>> 0;
            return s / 0xFFFFFFFF;
        };
    }

    function generateMockImage(size, seed) {
        const rng = lcgRandom(seed);
        const data = new Uint8Array(size);
        for (let i = 0; i < size; i++) {
            const base = Math.floor(rng() * 200 + 28);
            data[i] = Math.min(255, Math.max(0, base + Math.floor((rng() - 0.5) * 30)));
        }
        return data;
    }

    function embedSequential(data, payloadBits, seed) {
        const out = new Uint8Array(data);
        const rng = lcgRandom(seed);
        for (let i = 0; i < payloadBits; i++) {
            out[i] = (out[i] & 0xFE) | (Math.round(rng()) & 1);
        }
        return out;
    }

    function embedPRNG(data, payloadBits, shuffleSeed, bitSeed) {
        const out = new Uint8Array(data);
        const rng = lcgRandom(shuffleSeed);
        const indices = Array.from({length: data.length}, (_, i) => i);
        for (let i = indices.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            const tmp = indices[i]; indices[i] = indices[j]; indices[j] = tmp;
        }
        const rng2 = lcgRandom(bitSeed);
        for (let i = 0; i < payloadBits; i++) {
            out[indices[i]] = (out[indices[i]] & 0xFE) | (Math.round(rng2()) & 1);
        }
        return out;
    }

    window.downloadAnalysis = () => {
        const a = document.createElement('a');
        a.href = mainCanvas.toDataURL('image/png');
        a.download = `analysis_bit_${currentPlane}.png`;
        a.click();
    };
});
