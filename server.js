const express = require('express');
const path = require('path');

const cors = require('cors');

const app = express();
const port = 3000;

// Simple in-memory data store for operations
let operations = [
    { id: 1, type: 'encode', fileName: 'sample_secret.txt', fileSize: 1024, status: 'success', timestamp: new Date(Date.now() - 1000 * 60 * 15).toISOString() },
    { id: 2, type: 'decode', fileName: 'carrier_image.png', fileSize: 512, status: 'success', timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString() },
    { id: 3, type: 'steganalysis', fileName: 'suspicious.bmp', fileSize: 2048000, status: 'fail', timestamp: new Date(Date.now() - 1000 * 60 * 45).toISOString() }
];

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/build', express.static(path.join(__dirname, 'build')));

// API: Track an operation (encode/decode/steganalysis/benchmark)
app.post('/api/operations', (req, res) => {
    console.log('--- NEW OPERATION ---');
    console.log('Payload:', req.body);
    const { type, fileName, fileSize, status, timestamp } = req.body;
    const newOp = {
        id: Date.now(),
        type, // 'encode', 'decode', 'steganalysis', 'benchmark'
        fileName: fileName || 'N/A',
        fileSize: Number(fileSize) || 0,
        status, // 'success' or 'fail'
        timestamp: timestamp || new Date().toISOString()
    };
    operations.unshift(newOp); // Add to the beginning for "recent activity"
    console.log('Operations count:', operations.length);
    res.status(201).json(newOp);
});

// API: Get dashboard data
app.get('/api/dashboard', (req, res) => {
    try {
        const totalOps = operations.length;
        const encCount = operations.filter(op => op.type === 'encode' && op.status === 'success').length;
        const decCount = operations.filter(op => op.type === 'decode' && op.status === 'success').length;
        const stegCount = operations.filter(op => op.type === 'steganalysis' && op.status === 'success').length;
        const benchCount = operations.filter(op => op.type === 'benchmark' && op.status === 'success').length;
        const failCount = operations.filter(op => op.status === 'fail').length;
        
        const totalBytes = operations
            .filter(op => op.type === 'encode' && op.status === 'success')
            .reduce((acc, op) => acc + (Number(op.fileSize) || 0), 0);

        res.json({
            stats: {
                total: totalOps,
                encoded: encCount,
                decoded: decCount,
                steganalysis: stegCount,
                benchmark: benchCount,
                failed: failCount,
                bytes: totalBytes
            },
            recentActivity: operations.slice(0, 50) // Return last 50 actions
        });
    } catch (error) {
        console.error('Error in GET /api/dashboard:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// API: Clear operations
app.delete('/api/operations', (req, res) => {
    operations = [];
    res.status(204).send();
});

// API: Delete a single operation
app.delete('/api/operations/:id', (req, res) => {
    const { id } = req.params;
    operations = operations.filter(op => op.id !== parseInt(id));
    res.status(204).send();
});

app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});
