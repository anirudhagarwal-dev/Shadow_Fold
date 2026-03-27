document.addEventListener('DOMContentLoaded', () => {

    // ==============================
    // Tabs
    // ==============================
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

    // ==============================
    // Password Toggle
    // ==============================
    setupPasswordToggle('encode-toggle-password', 'encode-password');
    setupPasswordToggle('decode-toggle-password', 'decode-password');

    // ==============================
    // Drag & Drop
    // ==============================
    setupDropZone('encode-image-drop-zone', 'encode-image-input', 'encode-image-preview');
    setupDropZone('secret-file-drop-zone', 'secret-file-input', null, 'secret-file-name');
    setupDropZone('decode-image-drop-zone', 'decode-image-input', 'decode-image-preview');

    // ==============================
    // WASM Module
    // ==============================
    let steganographyModule;

    Module.onRuntimeInitialized = () => {
        steganographyModule = Module;
        console.log('Wasm module initialized');
    };

    // ==============================
    // Buttons
    // ==============================
    document.getElementById('encode-button')
        .addEventListener('click', () => handleEncode(steganographyModule));

    document.getElementById('decode-button')
        .addEventListener('click', () => handleDecode(steganographyModule));
});


// ==============================
// INTRO SCREEN + SOUND
// ==============================
window.addEventListener("load", () => {

    const audio = new Audio("assets/sounds/glitch.mp3");
    audio.volume = 0.4;

    // play sound
    setTimeout(() => {
        audio.play().catch(() => {
            console.log("Autoplay blocked");
        });
    }, 400);

    // hide intro
    setTimeout(() => {
        document.getElementById("intro-screen").style.display = "none";
    }, 3000);
});

// fallback (user interaction)
document.addEventListener("click", () => {
    const audio = new Audio("assets/sounds/glitch.mp3");
    audio.volume = 0.4;
    audio.play();
}, { once: true });


// ==============================
// Password Toggle
// ==============================
function setupPasswordToggle(toggleId, inputId) {
    const toggle = document.getElementById(toggleId);
    const input = document.getElementById(inputId);

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
// Drop Zone
// ==============================
function setupDropZone(zoneId, inputId, previewId, nameId) {
    const dropZone = document.getElementById(zoneId);
    const input = document.getElementById(inputId);
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

    input.addEventListener('change', () => handleFileChange(input, preview, nameDisplay));
}


// ==============================
// File Preview
// ==============================
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
// ENCODE
// ==============================
async function handleEncode(module) {
    if (!module) {
        alert("WASM not loaded yet");
        return;
    }

    const imageInput = document.getElementById('encode-image-input');
    const secretInput = document.getElementById('secret-file-input');
    const password = document.getElementById('encode-password').value;

    if (!imageInput.files[0] || !secretInput.files[0] || !password) {
        alert('Provide image, file, and password.');
        return;
    }

    showLoader('FOLDING REALITY...');

    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');

    const imageBitmap = await createImageBitmap(imageInput.files[0]);
    canvas.width = imageBitmap.width;
    canvas.height = imageBitmap.height;

    ctx.drawImage(imageBitmap, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const imageBytes = new Uint8Array(imageData.data.buffer);
    const secretBytes = new Uint8Array(await secretInput.files[0].arrayBuffer());

    const result = module.encode_data(
        imageBytes,
        secretBytes,
        secretInput.files[0].name.split('.').pop(),
        password
    );

    hideLoader();

    if (!result) {
        alert('Not enough space.');
        return;
    }

    const resultBytes = new Uint8ClampedArray(result);

    const newImageData = new ImageData(resultBytes, canvas.width, canvas.height);
    ctx.putImageData(newImageData, 0, 0);

    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'encoded.png';
    a.click();
}


// ==============================
// DECODE
// ==============================
async function handleDecode(module) {
    if (!module) {
        alert("WASM not loaded yet");
        return;
    }

    const imageInput = document.getElementById('decode-image-input');
    const password = document.getElementById('decode-password').value;

    if (!imageInput.files[0] || !password) {
        alert('Provide image and password.');
        return;
    }

    showLoader('ENTERING THE VOID...');

    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');

    const imageBitmap = await createImageBitmap(imageInput.files[0]);
    canvas.width = imageBitmap.width;
    canvas.height = imageBitmap.height;

    ctx.drawImage(imageBitmap, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const imageBytes = new Uint8Array(imageData.data.buffer);

    const result = module.decode_data(imageBytes, password);

    hideLoader();

    if (!result) {
        alert('Wrong password or corrupted data.');
        return;
    }

    const blob = new Blob([new Uint8Array(result.data)], {
        type: 'application/octet-stream'
    });

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `decoded.${result.extension}`;
    a.click();
}


// ==============================
// Loader
// ==============================
function showLoader(text) {
    const loader = document.getElementById('loader');
    const loaderText = document.getElementById('loader-text');

    loaderText.textContent = text;
    loader.classList.add('show');
}

function hideLoader() {
    document.getElementById('loader').classList.remove('show');
}