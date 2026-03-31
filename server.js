const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const port = 3000;

// --- Data Persistence ---
const DATA_DIR = path.join(__dirname, 'data');
const OPS_FILE = path.join(DATA_DIR, 'operations.json');
const MAX_OPS = 500;

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Load operations from file or initialize
let operations = [];
try {
    if (fs.existsSync(OPS_FILE)) {
        const data = fs.readFileSync(OPS_FILE, 'utf8');
        operations = JSON.parse(data);
    }
} catch (err) {
    console.error("Error loading operations:", err);
    operations = []; // Start fresh on error
}

// Function to save operations to disk
function saveOperations() {
    try {
        // Cap the operations array
        if (operations.length > MAX_OPS) {
            operations = operations.slice(0, MAX_OPS);
        }
        fs.writeFileSync(OPS_FILE, JSON.stringify(operations, null, 2), 'utf8');
    } catch (err) {
        console.error("Error saving operations:", err);
    }
}


app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/build', express.static(path.join(__dirname, 'build')));

// API: Track an operation (encode/decode/steganalysis/benchmark)
app.post('/api/operations', (req, res) => {
    console.log('--- NEW OPERATION ---');
    console.log('Payload:', req.body);
    const { type, file, fileSize, status, timestamp } = req.body;
    const newOp = {
        id: Date.now(),
        type, // 'encode', 'decode', 'steganalysis', 'benchmark'
        fileName: req.body.fileName || file || 'N/A',
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
    saveOperations();
    res.status(204).send();
});

// API: Get all operations for client-side filtering
app.get('/api/operations', (req, res) => {
    res.json(operations);
});

app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});
