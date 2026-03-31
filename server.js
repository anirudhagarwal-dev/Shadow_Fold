require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs').promises;
const fsSync = require('fs');
const Joi = require('joi');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const morgan = require('morgan');

const app = express();
const port = process.env.PORT || 3000;

const DATA_FILE = path.join(__dirname, 'data', 'operations.json');

// --- Data Persistence Helpers ---
async function loadOperations() { 
  try { 
    if (fsSync.existsSync(DATA_FILE)) { 
      const raw = await fs.readFile(DATA_FILE, 'utf8'); 
      return JSON.parse(raw); 
    } 
  } catch (e) { console.error('Failed to load operations:', e.message); } 
  return []; 
} 

async function saveOperations(ops) { 
  try { 
    const dir = path.dirname(DATA_FILE); 
    if (!fsSync.existsSync(dir)) await fs.mkdir(dir, { recursive: true }); 
    await fs.writeFile(DATA_FILE, JSON.stringify(ops), 'utf8'); 
  } catch (e) { console.error('Failed to save operations:', e.message); } 
} 

// --- CORS Configuration ---
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',') 
  : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173']; // Common dev ports

app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));


const MAX_OPS = 500;
let operations = [];

// Initialize operations
loadOperations().then(data => {
    operations = data;
    console.log('Operations loaded:', operations.length);
});

// --- Security & Performance Middleware ---
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "script-src": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com"],
      "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      "font-src": ["'self'", "https://fonts.gstatic.com"],
      "img-src": ["'self'", "data:", "blob:"],
      "connect-src": ["'self'"]
    },
  },
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests from this IP, please try again later.' }
});
app.use('/api/', limiter);

app.use(compression()); // Compress all responses
app.use(morgan('combined')); // HTTP request logger

// --- Health Check ---
app.get('/health', (req, res) => {
    res.json({
        status: 'UP',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
        version: '2.0.4'
    });
});

// --- Middleware ---
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/build', express.static(path.join(__dirname, 'build')));

// Utility to wrap async routes for Express 4.x
const asyncHandler = fn => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

// API: Track an operation (encode/decode/steganalysis/benchmark)
app.post('/api/operations', asyncHandler(async (req, res) => {
    console.log(`[${new Date().toISOString()}] --- NEW OPERATION ---`);
    console.log('Payload:', req.body);
    
    // Validation schema
    const schema = Joi.object({
        type: Joi.string().valid('encode', 'decode', 'steganalysis', 'benchmark').required(),
        fileName: Joi.string().allow('', null).optional(),
        file: Joi.string().allow('', null).optional(),
        fileSize: Joi.number().min(0).optional(),
        status: Joi.string().valid('success', 'fail').required(),
        timestamp: Joi.string().isoDate().optional()
    });

    const { error, value } = schema.validate(req.body, { abortEarly: false });
    
    if (error) {
        const validationError = new Error(error.details.map(d => d.message).join(', '));
        validationError.status = 400;
        throw validationError;
    }

    const { type, file, fileName, fileSize, status, timestamp } = value;

    const newOp = {
        id: Date.now(),
        type,
        fileName: fileName || file || 'N/A',
        fileSize: Number(fileSize) || 0,
        status,
        timestamp: timestamp || new Date().toISOString()
    };
    operations.unshift(newOp); // Add to the beginning for "recent activity"
    
    // Cap the operations array
    if (operations.length > MAX_OPS) {
        operations = operations.slice(0, MAX_OPS);
    }
    
    await saveOperations(operations);
    console.log(`[${new Date().toISOString()}] Operations count: ${operations.length}`);
    res.status(201).json(newOp);
}));

// API: Get dashboard data
app.get('/api/dashboard', (req, res) => {
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
});

// API: Clear operations
app.delete('/api/operations', asyncHandler(async (req, res) => {
    operations = [];
    await saveOperations(operations);
    res.status(204).send();
}));

// API: Delete a single operation
app.delete('/api/operations/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const initialLength = operations.length;
    operations = operations.filter(op => op.id !== parseInt(id));
    
    if (operations.length === initialLength) {
        const error = new Error(`Operation with ID ${id} not found`);
        error.status = 404;
        throw error;
    }

    await saveOperations(operations);
    res.status(204).send();
}));

// API: Get all operations for client-side filtering
app.get('/api/operations', (req, res) => {
    res.json(operations);
});

// --- Centralized Error Handling Middleware ---
app.use((req, res, next) => {
    const error = new Error('Resource Not Found');
    error.status = 404;
    next(error);
});

app.use((err, req, res, next) => {
    const status = err.status || 500;
    const message = err.message || 'Internal Server Error';
    
    // Log error for debugging
    console.error(`[${new Date().toISOString()}] ERROR ${status}: ${message}`);
    if (status === 500) console.error(err.stack);

    res.status(status).json({
        error: {
            status,
            message,
            timestamp: new Date().toISOString(),
            path: req.originalUrl
        }
    });
});

app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});

// Keep process alive in some environments
setInterval(() => {}, 1 << 30);

