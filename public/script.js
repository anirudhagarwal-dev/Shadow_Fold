const tabs = document.querySelectorAll('.tab-button');
const contents = document.querySelectorAll('.tab-content');

tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        contents.forEach(content => {
            content.classList.remove('active');
        });
        document.getElementById(tab.dataset.tab).classList.add('active');
    });
});

const encodeImageInput = document.getElementById('encode-image');
const secretFileInput = document.getElementById('secret-file');
const encodePasswordInput = document.getElementById('encode-password');
const encodeButton = document.getElementById('encode-button');

const decodeImageInput = document.getElementById('decode-image');
const decodePasswordInput = document.getElementById('decode-password');
const decodeButton = document.getElementById('decode-button');

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

let steganographyModule;

Module.onRuntimeInitialized = () => {
    steganographyModule = Module;
    console.log('Wasm module initialized');
};

encodeButton.addEventListener('click', async () => {
    const imageFile = encodeImageInput.files[0];
    const secretFile = secretFileInput.files[0];
    const password = encodePasswordInput.value;

    if (!imageFile || !secretFile || !password) {
        alert('Please provide an image, a secret file, and a password.');
        return;
    }

    const fileExtension = secretFile.name.split('.').pop();

    const imageBitmap = await createImageBitmap(imageFile);
    canvas.width = imageBitmap.width;
    canvas.height = imageBitmap.height;
    ctx.drawImage(imageBitmap, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const imageBytes = new Uint8Array(imageData.data.buffer);

    const secretFileBytes = new Uint8Array(await secretFile.arrayBuffer());

    const resultVal = steganographyModule.encode_data(imageBytes, secretFileBytes, fileExtension, password);
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
});

decodeButton.addEventListener('click', async () => {
    const imageFile = decodeImageInput.files[0];
    const password = decodePasswordInput.value;

    if (!imageFile || !password) {
        alert('Please provide an encoded image and a password.');
        return;
    }

    const imageBitmap = await createImageBitmap(imageFile);
    canvas.width = imageBitmap.width;
    canvas.height = imageBitmap.height;
    ctx.drawImage(imageBitmap, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const imageBytes = new Uint8Array(imageData.data.buffer);

    const result = steganographyModule.decode_data(imageBytes, password);
    if (result === null) {
        alert('Error: Failed to decode file. The password may be incorrect or the image may be corrupt.');
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
});
