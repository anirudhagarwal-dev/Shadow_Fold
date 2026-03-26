document.addEventListener('DOMContentLoaded', () => {
    const tabs = document.querySelectorAll('.tab-button');
    const contents = document.querySelectorAll('.tab-content');
    const loader = document.getElementById('loader');
    const loaderText = document.getElementById('loader-text');

    // --- Tab Switching --- //
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            contents.forEach(c => c.classList.remove('active'));
            document.getElementById(tab.dataset.tab).classList.add('active');
        });
    });

    // --- Password Visibility --- //
    setupPasswordToggle('encode-toggle-password', 'encode-password');
    setupPasswordToggle('decode-toggle-password', 'decode-password');

    // --- Drag & Drop Zones --- //
    setupDropZone('encode-image-drop-zone', 'encode-image-input', 'encode-image-preview');
    setupDropZone('secret-file-drop-zone', 'secret-file-input', null, 'secret-file-name');
    setupDropZone('decode-image-drop-zone', 'decode-image-input', 'decode-image-preview');

    // --- WebAssembly Module --- //
    let steganographyModule;
    Module.onRuntimeInitialized = () => {
        steganographyModule = Module;
        console.log('Wasm module initialized');
    };

    // --- Main Actions --- //
    document.getElementById('encode-button').addEventListener('click', () => handleEncode(steganographyModule));
    document.getElementById('decode-button').addEventListener('click', () => handleDecode(steganographyModule));

});

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
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
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

async function handleEncode(module) {
    const imageInput = document.getElementById('encode-image-input');
    const secretInput = document.getElementById('secret-file-input');
    const password = document.getElementById('encode-password').value;

    if (!imageInput.files[0] || !secretInput.files[0] || !password) {
        alert('Please provide a carrier image, a secret file, and a password.');
        return;
    }

    showLoader('FOLDING REALITY...');

    const imageFile = imageInput.files[0];
    const secretFile = secretInput.files[0];
    const fileExtension = secretFile.name.split('.').pop();

    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const imageBitmap = await createImageBitmap(imageFile);
    canvas.width = imageBitmap.width;
    canvas.height = imageBitmap.height;
    ctx.drawImage(imageBitmap, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const imageBytes = new Uint8Array(imageData.data.buffer);
    const secretFileBytes = new Uint8Array(await secretFile.arrayBuffer());

    const resultVal = module.encode_data(imageBytes, secretFileBytes, fileExtension, password);
    hideLoader();

    if (resultVal === null) {
        alert('Error: Not enough space in the image to hide the file.');
        return;
    }

    const resultBytes = new Uint8ClampedArray(resultVal.length);
    for (let i = 0; i < resultVal.length; i++) {
        resultBytes[i] = resultVal[i];
    }

    const newImageData = new ImageData(resultBytes, canvas.width, canvas.height);
    ctx.putImageData(newImageData, 0, 0);

    const outputUrl = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = outputUrl;
    a.download = 'encoded_image.png';
    a.click();

    alert('Data successfully hidden in plain sight.');
}

async function handleDecode(module) {
    const imageInput = document.getElementById('decode-image-input');
    const password = document.getElementById('decode-password').value;

    if (!imageInput.files[0] || !password) {
        alert('Please provide an encoded image and a password.');
        return;
    }

    showLoader('ENTERING THE VOID...');

    const imageFile = imageInput.files[0];
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const imageBitmap = await createImageBitmap(imageFile);
    canvas.width = imageBitmap.width;
    canvas.height = imageBitmap.height;
    ctx.drawImage(imageBitmap, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const imageBytes = new Uint8Array(imageData.data.buffer);

    const result = module.decode_data(imageBytes, password);
    hideLoader();

    if (result === null) {
        alert('Signal lost. Incorrect frequency or corrupt data.');
        return;
    }

    const resultBytes = new Uint8Array(result.data.length);
    for (let i = 0; i < result.data.length; i++) {
        resultBytes[i] = result.data[i];
    }

    const blob = new Blob([resultBytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `decoded_file.${result.extension}`;
    a.click();
    URL.revokeObjectURL(url);
}

function showLoader(text) {
    const loader = document.getElementById('loader');
    const loaderText = document.getElementById('loader-text');
    loaderText.textContent = text;
    loader.classList.add('show');
}

function hideLoader() {
    document.getElementById('loader').classList.remove('show');
}
