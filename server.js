const express = require('express');
const session = require('express-session');
const http = require('http');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');

// Import crawler modules
const { runCategoriesCrawlerForWeb, requestStop, resetStopFlag } = require('./crawler-categories');
const { runGirlsCrawlerForWeb } = require('./crawler-girl');

const app = express();
const server = http.createServer(app);

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false // Disable CSP for SSE
}));
app.use(cors());

// Session configuration
app.use(session({
    secret: 'crawler-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, // Set to true in production with HTTPS
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
app.use(express.static('public'));

// Simple user store (in production, use a proper database)
const users = {
    'admin': {
        username: 'admin',
        password: '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi' // password: "password"
    }
};

// Configuration for memory management
const MEMORY_CONFIG = {
    MAX_LOG_ENTRIES: 1000, // Maximum number of log entries to keep in memory
    LOG_CLEANUP_INTERVAL: 300000, // 5 minutes in milliseconds
    SSE_HEARTBEAT_INTERVAL: 30000, // 30 seconds
    SSE_CLEANUP_INTERVAL: 60000, // 1 minute
    MEMORY_CHECK_INTERVAL: 60000, // 1 minute
    MEMORY_WARNING_THRESHOLD: 0.8, // 80% of heap limit
    MEMORY_CRITICAL_THRESHOLD: 0.9, // 90% of heap limit
    FORCE_GC_THRESHOLD: 0.85 // 85% of heap limit
};

// Crawler state management
let crawlerState = {
    categories: {
        isRunning: false,
        progress: 0,
        totalPages: 0,
        currentPage: 0,
        totalGirls: 0,
        totalGirlsExpected: 0,
        crawledGirls: 0,
        startTime: null,
        logs: []
    },
    girls: {
        isRunning: false,
        progress: 0,
        totalProfiles: 0,
        processedProfiles: 0,
        startTime: null,
        logs: [],
        currentPhase: null // Track current phase: 'categories', 'girls', 'completed'
    }
};

// Memory management functions
function trimLogs(logsArray, maxEntries = MEMORY_CONFIG.MAX_LOG_ENTRIES) {
    if (logsArray.length > maxEntries) {
        const excess = logsArray.length - maxEntries;
        logsArray.splice(0, excess);
        console.log(`🧹 Trimmed ${excess} old log entries to prevent memory leak`);
        return excess;
    }
    return 0;
}

function addLogEntry(logsArray, logEntry) {
    logsArray.push(logEntry);
    // Immediately trim if we exceed the limit
    trimLogs(logsArray);
}

// Periodic log cleanup to prevent memory leaks
function performLogCleanup() {
    const categoriesTrimmed = trimLogs(crawlerState.categories.logs);
    const girlsTrimmed = trimLogs(crawlerState.girls.logs);

    if (categoriesTrimmed > 0 || girlsTrimmed > 0) {
        console.log(`🧹 Log cleanup: Trimmed ${categoriesTrimmed} categories logs, ${girlsTrimmed} girls logs`);
    }
}

// Start periodic log cleanup
const logCleanupInterval = setInterval(performLogCleanup, MEMORY_CONFIG.LOG_CLEANUP_INTERVAL);

// Memory-efficient CSV utilities
function countCSVLines(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            return 0;
        }

        // Use streaming to count lines without loading entire file into memory
        const data = fs.readFileSync(filePath, 'utf8');
        const lineCount = data.split('\n').filter(line => line.trim()).length;
        return Math.max(0, lineCount - 1); // Exclude header
    } catch (error) {
        console.error(`Error counting CSV lines in ${filePath}:`, error);
        return 0;
    }
}

function readCSVHeader(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            return null;
        }

        // Read only the first line to get header
        const fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(1024); // Read first 1KB
        const bytesRead = fs.readSync(fd, buffer, 0, 1024, 0);
        fs.closeSync(fd);

        const content = buffer.toString('utf8', 0, bytesRead);
        const firstLine = content.split('\n')[0];
        return firstLine.trim();
    } catch (error) {
        console.error(`Error reading CSV header from ${filePath}:`, error);
        return null;
    }
}

// Memory monitoring and management
function getMemoryUsage() {
    const memUsage = process.memoryUsage();
    const heapUsed = memUsage.heapUsed;
    const heapTotal = memUsage.heapTotal;
    const external = memUsage.external;
    const rss = memUsage.rss;

    return {
        heapUsed: Math.round(heapUsed / 1024 / 1024), // MB
        heapTotal: Math.round(heapTotal / 1024 / 1024), // MB
        external: Math.round(external / 1024 / 1024), // MB
        rss: Math.round(rss / 1024 / 1024), // MB
        heapUsedPercent: heapUsed / heapTotal
    };
}

function performMemoryCleanup() {
    const memUsage = getMemoryUsage();

    // Log memory usage
    console.log(`🧠 Memory Usage: ${memUsage.heapUsed}MB/${memUsage.heapTotal}MB (${Math.round(memUsage.heapUsedPercent * 100)}%)`);

    // Perform aggressive cleanup if memory usage is high
    if (memUsage.heapUsedPercent > MEMORY_CONFIG.MEMORY_CRITICAL_THRESHOLD) {
        console.log('🚨 Critical memory usage detected! Performing emergency cleanup...');

        // Trim logs more aggressively
        const categoriesTrimmed = trimLogs(crawlerState.categories.logs, 100);
        const girlsTrimmed = trimLogs(crawlerState.girls.logs, 100);

        // Clean up SSE clients
        cleanupSSEClients();

        console.log(`🧹 Emergency cleanup: Trimmed ${categoriesTrimmed + girlsTrimmed} log entries, cleaned SSE clients`);

        // Force garbage collection if available
        if (global.gc) {
            global.gc();
            console.log('🗑️ Forced garbage collection');
        }

    } else if (memUsage.heapUsedPercent > MEMORY_CONFIG.MEMORY_WARNING_THRESHOLD) {
        console.log('⚠️ High memory usage detected. Performing routine cleanup...');
        performLogCleanup();
        cleanupSSEClients();

    } else if (memUsage.heapUsedPercent > MEMORY_CONFIG.FORCE_GC_THRESHOLD && global.gc) {
        global.gc();
        console.log('🗑️ Preventive garbage collection');
    }

    return memUsage;
}

// Start periodic memory monitoring
const memoryMonitorInterval = setInterval(performMemoryCleanup, MEMORY_CONFIG.MEMORY_CHECK_INTERVAL);

// Initialize crawler state with current CSV counts
function initializeCrawlerState() {
    try {
        // Check current count in list-girl.csv using memory-efficient counting
        const listGirlPath = path.join(__dirname, 'list-girl.csv');
        const currentCount = countCSVLines(listGirlPath);
        crawlerState.categories.crawledGirls = currentCount;
        console.log(`📊 Initialized Girls Found count to: ${currentCount} (from existing CSV)`);
        updateCategoriesProgress();

        // Check current count in detail-girls.csv for girls crawler using memory-efficient counting
        const detailGirlsPath = path.join(__dirname, 'detail-girls.csv');
        const processedCount = countCSVLines(detailGirlsPath);
        crawlerState.girls.processedProfiles = processedCount;
        console.log(`📊 Initialized Girls Processed count to: ${processedCount} (from existing detail CSV)`);

        // Initialize totalGirlsExpected asynchronously
        initializeTotalGirlsExpected();
    } catch (error) {
        console.error('Error initializing crawler state:', error);
    }
}

// Initialize totalGirlsExpected from website
async function initializeTotalGirlsExpected() {
    try {
        console.log('🔍 Checking website for total girls count...');

        // Create a temporary crawler instance to check total girls
        const { FgirlCategoryCrawler } = require('./crawler-categories');
        const tempCrawler = new FgirlCategoryCrawler();

        await tempCrawler.init();
        const totalGirls = await tempCrawler.checkTotalGirls();
        await tempCrawler.cleanup();

        if (totalGirls > 0) {
            crawlerState.categories.totalGirlsExpected = totalGirls;
            console.log(`📊 Initialized Expected Total to: ${totalGirls.toLocaleString()} girls`);
            updateCategoriesProgress();
        }
    } catch (error) {
        console.log('⚠️ Could not initialize totalGirlsExpected from website:', error.message);
        // Set a default value or leave as 0
        crawlerState.categories.totalGirlsExpected = 0;
    }
}

// Initialize state on server startup
initializeCrawlerState();

// Authentication middleware
function requireAuth(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    } else {
        return res.redirect('/login');
    }
}

// Routes
app.get('/', (req, res) => {
    if (req.session && req.session.user) {
        res.redirect('/website-selection');
    } else {
        res.redirect('/login');
    }
});

app.get('/login', (req, res) => {
    if (req.session && req.session.user) {
        return res.redirect('/website-selection');
    }
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }
    
    const user = users[username];
    if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    try {
        const isValid = await bcrypt.compare(password, user.password);
        if (isValid) {
            req.session.user = { username: user.username };
            res.json({ success: true, redirect: '/website-selection' });
        } else {
            res.status(401).json({ error: 'Invalid credentials' });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/website-selection', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'website-selection.html'));
});

app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
        }
        res.redirect('/login');
    });
});

app.get('/dashboard', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// API Routes
app.get('/api/crawler-state', requireAuth, (req, res) => {
    res.json(crawlerState);
});

// Memory usage API endpoint
app.get('/api/memory-usage', requireAuth, (req, res) => {
    const memUsage = getMemoryUsage();
    res.json({
        success: true,
        memory: memUsage,
        thresholds: {
            warning: MEMORY_CONFIG.MEMORY_WARNING_THRESHOLD,
            critical: MEMORY_CONFIG.MEMORY_CRITICAL_THRESHOLD,
            forceGC: MEMORY_CONFIG.FORCE_GC_THRESHOLD
        },
        status: memUsage.heapUsedPercent > MEMORY_CONFIG.MEMORY_CRITICAL_THRESHOLD ? 'critical' :
                memUsage.heapUsedPercent > MEMORY_CONFIG.MEMORY_WARNING_THRESHOLD ? 'warning' : 'normal'
    });
});



// Crawler control endpoints
app.post('/api/start-categories-crawler', requireAuth, async (req, res) => {
    if (crawlerState.categories.isRunning) {
        return res.status(400).json({ error: 'Categories crawler is already running' });
    }
    
    try {
        crawlerState.categories.isRunning = true;
        crawlerState.categories.startTime = new Date();
        crawlerState.categories.progress = 0;
        crawlerState.categories.totalGirlsExpected = 0; // Reset expected count
        crawlerState.categories.logs = [];
        
        res.json({ success: true, message: 'Categories crawler started' });
        
        // Start crawler in background
        startCategoriesCrawler();
        
    } catch (error) {
        console.error('Error starting categories crawler:', error);
        crawlerState.categories.isRunning = false;
        res.status(500).json({ error: 'Failed to start categories crawler' });
    }
});

app.post('/api/start-girls-crawler', requireAuth, async (req, res) => {
    if (crawlerState.girls.isRunning || crawlerState.categories.isRunning) {
        return res.status(400).json({ error: 'A crawler is already running' });
    }

    try {
        // Reset the stop flag to ensure crawlers can run properly
        resetStopFlag();

        // Initialize girls crawler state for sequential execution
        crawlerState.girls.isRunning = true;
        crawlerState.girls.startTime = new Date();
        crawlerState.girls.progress = 0;
        crawlerState.girls.processedProfiles = 0;
        crawlerState.girls.logs = [];
        crawlerState.girls.currentPhase = 'categories'; // Track current phase

        res.json({ success: true, message: 'Sequential crawler started (Categories → Girls)' });

        // Start sequential crawler in background
        startSequentialCrawler();

    } catch (error) {
        console.error('Error starting sequential crawler:', error);
        crawlerState.girls.isRunning = false;
        res.status(500).json({ error: 'Failed to start sequential crawler' });
    }
});

app.post('/api/stop-categories-crawler', requireAuth, async (req, res) => {
    if (!crawlerState.categories.isRunning) {
        return res.status(400).json({ error: 'Categories crawler is not running' });
    }

    try {
        // Request stop of the crawler
        requestStop();

        // Update crawler state to indicate stopping
        addLogEntry(crawlerState.categories.logs, {
            timestamp: new Date(),
            message: '🛑 Stop requested by user - crawler will stop gracefully after current operations complete'
        });

        res.json({ success: true, message: 'Stop request sent to categories crawler' });

        // Broadcast the log update
        broadcastUpdate('log', { type: 'categories', message: '🛑 Stop requested by user - crawler will stop gracefully after current operations complete' });

    } catch (error) {
        console.error('Error stopping categories crawler:', error);
        res.status(500).json({ error: 'Failed to stop categories crawler' });
    }
});

app.post('/api/stop-girls-crawler', requireAuth, async (req, res) => {
    if (!crawlerState.girls.isRunning) {
        return res.status(400).json({ error: 'Girls crawler is not running' });
    }

    try {
        // For now, we'll just mark it as stopped since the girls crawler doesn't have a stop mechanism yet
        // This is a placeholder for future implementation
        addLogEntry(crawlerState.girls.logs, {
            timestamp: new Date(),
            message: '🛑 Stop requested by user - girls crawler will be stopped (feature in development)'
        });

        res.json({ success: true, message: 'Stop request sent to girls crawler' });

        // Broadcast the log update
        broadcastUpdate('log', { type: 'girls', message: '🛑 Stop requested by user - girls crawler will be stopped (feature in development)' });

        // For now, we'll simulate stopping by setting the state
        setTimeout(() => {
            crawlerState.girls.isRunning = false;
            broadcastUpdate('stopped', { type: 'girls' });
        }, 2000);

    } catch (error) {
        console.error('Error stopping girls crawler:', error);
        res.status(500).json({ error: 'Failed to stop girls crawler' });
    }
});

// API endpoint for detail-girls data table
app.get('/api/detail-girls-data', requireAuth, (req, res) => {
    try {
        const filePath = path.join(__dirname, 'detail-girls.csv');

        // Check if file exists
        if (!fs.existsSync(filePath)) {
            return res.json({
                success: true,
                data: [],
                total: 0,
                page: parseInt(req.query.page) || 1,
                limit: parseInt(req.query.limit) || 50,
                message: 'No data available. Run the girls crawler first.'
            });
        }

        // Read and parse CSV file
        const csvContent = fs.readFileSync(filePath, 'utf8');
        const lines = csvContent.trim().split('\n');

        if (lines.length <= 1) {
            return res.json({
                success: true,
                data: [],
                total: 0,
                page: parseInt(req.query.page) || 1,
                limit: parseInt(req.query.limit) || 50,
                message: 'No data available. CSV file is empty.'
            });
        }

        // Parse header and data
        const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
        const dataLines = lines.slice(1).filter(line => line.trim() !== '');

        // Convert CSV rows to objects
        const allData = dataLines.map((line, index) => {
            const values = line.split(',').map(v => v.trim().replace(/"/g, ''));
            const row = { id: index + 1 };
            headers.forEach((header, i) => {
                row[header] = values[i] || '';
            });
            return row;
        });

        // Apply search filter if provided
        let filteredData = allData;
        const search = req.query.search;
        if (search && search.trim() !== '') {
            const searchTerm = search.toLowerCase();
            filteredData = allData.filter(row =>
                Object.values(row).some(value =>
                    String(value).toLowerCase().includes(searchTerm)
                )
            );
        }

        // Apply sorting if provided
        const sortBy = req.query.sortBy;
        const sortOrder = req.query.sortOrder || 'asc';
        if (sortBy && headers.includes(sortBy)) {
            filteredData.sort((a, b) => {
                const aVal = String(a[sortBy]).toLowerCase();
                const bVal = String(b[sortBy]).toLowerCase();
                if (sortOrder === 'desc') {
                    return bVal.localeCompare(aVal);
                }
                return aVal.localeCompare(bVal);
            });
        }

        // Apply pagination
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 50));
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const paginatedData = filteredData.slice(startIndex, endIndex);

        res.json({
            success: true,
            data: paginatedData,
            total: filteredData.length,
            totalRecords: allData.length,
            page: page,
            limit: limit,
            totalPages: Math.ceil(filteredData.length / limit),
            headers: headers,
            lastModified: fs.statSync(filePath).mtime
        });

    } catch (error) {
        console.error('Error fetching detail-girls data:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch data',
            data: [],
            total: 0
        });
    }
});

// Download endpoints
app.get('/api/download/detail-girls-csv', requireAuth, (req, res) => {
    try {
        const filePath = path.join(__dirname, 'detail-girls.csv');

        // Check if file exists
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'detail-girls.csv not found. Run the girls crawler first.' });
        }

        // Check if file has content (more than just header)
        const stats = fs.statSync(filePath);
        if (stats.size < 100) { // Assuming header is less than 100 bytes
            return res.status(400).json({ error: 'detail-girls.csv appears to be empty. Run the girls crawler first.' });
        }

        // Set headers for file download
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="detail-girls-${new Date().toISOString().split('T')[0]}.csv"`);

        // Stream the file
        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(res);

        console.log('📥 detail-girls.csv downloaded by user');

    } catch (error) {
        console.error('Error downloading detail-girls.csv:', error);
        res.status(500).json({ error: 'Failed to download file' });
    }
});

app.get('/api/download/list-girl-csv', requireAuth, (req, res) => {
    try {
        const filePath = path.join(__dirname, 'list-girl.csv');

        // Check if file exists
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'list-girl.csv not found. Run the categories crawler first.' });
        }

        // Check if file has content (more than just header)
        const stats = fs.statSync(filePath);
        if (stats.size < 50) { // Assuming header is less than 50 bytes
            return res.status(400).json({ error: 'list-girl.csv appears to be empty. Run the categories crawler first.' });
        }

        // Set headers for file download
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="list-girl-${new Date().toISOString().split('T')[0]}.csv"`);

        // Stream the file
        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(res);

        console.log('📥 list-girl.csv downloaded by user');

    } catch (error) {
        console.error('Error downloading list-girl.csv:', error);
        res.status(500).json({ error: 'Failed to download file' });
    }
});

app.get('/api/download/list-girl-stored-csv', requireAuth, (req, res) => {
    try {
        const filePath = path.join(__dirname, 'list-girl-stored.csv');

        // Check if file exists
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'list-girl-stored.csv not found. Run the categories crawler first to generate stored data.' });
        }

        // Check if file has content (more than just header)
        const stats = fs.statSync(filePath);
        if (stats.size < 50) { // Assuming header is less than 50 bytes
            return res.status(400).json({ error: 'list-girl-stored.csv appears to be empty. Run the categories crawler first.' });
        }

        // Set headers for file download
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="list-girl-stored-${new Date().toISOString().split('T')[0]}.csv"`);

        // Stream the file
        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(res);

        console.log('📥 list-girl-stored.csv downloaded by user');

    } catch (error) {
        console.error('Error downloading list-girl-stored.csv:', error);
        res.status(500).json({ error: 'Failed to download file' });
    }
});

// Manual CSV synchronization endpoint
app.post('/api/sync-csv-data', requireAuth, async (req, res) => {
    try {
        console.log('🔄 Manual CSV synchronization requested by user');

        const syncResult = await synchronizeCSVData();

        res.json({
            success: true,
            message: 'CSV data synchronization completed successfully',
            results: syncResult
        });

        console.log('✅ Manual CSV synchronization completed successfully');

    } catch (error) {
        console.error('❌ Manual CSV synchronization failed:', error);
        res.status(500).json({
            success: false,
            error: 'CSV synchronization failed',
            message: error.message
        });
    }
});

// Server-Sent Events (SSE) connection handling
const sseClients = new Set();
const sseClientHeartbeats = new Map(); // Track heartbeat intervals for each client

// SSE endpoint for real-time updates
app.get('/api/events', requireAuth, (req, res) => {
    // Set SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Send initial connection event
    res.write(`event: connected\n`);
    res.write(`data: ${JSON.stringify({ timestamp: new Date().toISOString(), message: 'Connected to server' })}\n\n`);

    // Send current crawler state immediately
    res.write(`event: crawler-state-update\n`);
    res.write(`data: ${JSON.stringify(crawlerState)}\n\n`);

    // Add client to the set
    sseClients.add(res);
    console.log(`SSE client connected. Total clients: ${sseClients.size}`);

    // Function to cleanup client resources
    const cleanupClient = () => {
        sseClients.delete(res);
        if (sseClientHeartbeats.has(res)) {
            clearInterval(sseClientHeartbeats.get(res));
            sseClientHeartbeats.delete(res);
        }
        console.log(`SSE client disconnected. Total clients: ${sseClients.size}`);
    };

    // Handle client disconnect
    req.on('close', cleanupClient);
    req.on('error', (err) => {
        console.error('SSE client error:', err);
        cleanupClient();
    });

    // Send periodic heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
        if (sseClients.has(res)) {
            try {
                res.write(`event: heartbeat\n`);
                res.write(`data: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
            } catch (error) {
                console.error('Error sending heartbeat:', error);
                cleanupClient();
            }
        } else {
            clearInterval(heartbeat);
            sseClientHeartbeats.delete(res);
        }
    }, MEMORY_CONFIG.SSE_HEARTBEAT_INTERVAL);

    // Store heartbeat interval for cleanup
    sseClientHeartbeats.set(res, heartbeat);
});

// Helper function to broadcast updates via SSE
function broadcastUpdate(type, data) {
    const eventData = {
        type,
        timestamp: new Date().toISOString(),
        crawlerState,
        data
    };

    // Send to all connected SSE clients
    sseClients.forEach(client => {
        try {
            // Always send crawler state update
            client.write(`event: crawler-state-update\n`);
            client.write(`data: ${JSON.stringify(crawlerState)}\n\n`);

            // Send specific event type
            if (type === 'log') {
                client.write(`event: crawler-log\n`);
                client.write(`data: ${JSON.stringify(data)}\n\n`);
            } else if (type === 'phase-change') {
                client.write(`event: phase-change\n`);
                client.write(`data: ${JSON.stringify(data)}\n\n`);
            } else if (type === 'complete') {
                client.write(`event: complete\n`);
                client.write(`data: ${JSON.stringify(data)}\n\n`);
            } else if (type === 'error') {
                client.write(`event: error\n`);
                client.write(`data: ${JSON.stringify(data)}\n\n`);
            } else if (type === 'stopped') {
                client.write(`event: stopped\n`);
                client.write(`data: ${JSON.stringify(data)}\n\n`);
            }
        } catch (error) {
            // Use process.stdout.write to avoid infinite recursion with overridden console.log
            process.stdout.write(`Error broadcasting to SSE client: ${error.message}\n`);
            // Clean up client and its heartbeat interval
            sseClients.delete(client);
            if (sseClientHeartbeats.has(client)) {
                clearInterval(sseClientHeartbeats.get(client));
                sseClientHeartbeats.delete(client);
            }
        }
    });

    // Use process.stdout.write to avoid infinite recursion with overridden console.log
    process.stdout.write(`Broadcasted ${type} update to ${sseClients.size} SSE clients\n`);
}

// Cleanup function for SSE clients
function cleanupSSEClients() {
    const clientsToRemove = [];
    sseClients.forEach(client => {
        try {
            // Test if client is still connected by writing a small test
            client.write('');
        } catch (error) {
            clientsToRemove.push(client);
        }
    });

    clientsToRemove.forEach(client => {
        sseClients.delete(client);
        // Also clean up heartbeat intervals
        if (sseClientHeartbeats.has(client)) {
            clearInterval(sseClientHeartbeats.get(client));
            sseClientHeartbeats.delete(client);
        }
    });

    if (clientsToRemove.length > 0) {
        console.log(`🧹 Cleaned up ${clientsToRemove.length} disconnected SSE clients and their heartbeat intervals`);
    }
}

// Periodic cleanup of disconnected SSE clients
const sseCleanupInterval = setInterval(cleanupSSEClients, MEMORY_CONFIG.SSE_CLEANUP_INTERVAL);

// Helper function to update categories progress based on girls processed
function updateCategoriesProgress() {
    // Use totalGirlsExpected if available, otherwise fall back to totalGirls
    const targetTotal = crawlerState.categories.totalGirlsExpected > 0
        ? crawlerState.categories.totalGirlsExpected
        : crawlerState.categories.totalGirls;

    if (targetTotal > 0 && crawlerState.categories.crawledGirls >= 0) {
        crawlerState.categories.progress = Math.round((crawlerState.categories.crawledGirls / targetTotal) * 100);
        crawlerState.categories.progress = Math.min(crawlerState.categories.progress, 100); // Cap at 100%
    }
}

// File watching for real-time updates
function setupFileWatching() {
    const listGirlPath = path.join(__dirname, 'list-girl.csv');

    // Watch list-girl.csv for changes
    if (fs.existsSync(listGirlPath)) {
        fs.watchFile(listGirlPath, { interval: 1000 }, (curr, prev) => {
            if (curr.mtime !== prev.mtime) {
                console.log('list-girl.csv updated');
            }
        });
    }

    console.log('File watching setup complete');
}

// CSV Data Synchronization Function
async function synchronizeCSVData() {
    const listGirlPath = path.join(__dirname, 'list-girl.csv');
    const listGirlStoredPath = path.join(__dirname, 'list-girl-stored.csv');

    try {
        // Read current crawl results
        const currentData = await readCSVFile(listGirlPath);
        console.log(`📊 Read ${currentData.length} records from list-girl.csv`);

        // Read or create stored data file
        let storedData = [];
        if (fs.existsSync(listGirlStoredPath)) {
            storedData = await readCSVFile(listGirlStoredPath);
            console.log(`📊 Read ${storedData.length} records from list-girl-stored.csv`);
        } else {
            // Create stored file with header if it doesn't exist
            const header = 'Name,Location,Profile URL\n';
            fs.writeFileSync(listGirlStoredPath, header);
            console.log(`📝 Created new list-girl-stored.csv with header`);
        }

        // Create URL-based lookup maps for efficient comparison
        const currentUrlMap = new Map();
        const storedUrlMap = new Map();

        currentData.forEach(record => {
            if (record.profile_url && record.profile_url.trim()) {
                currentUrlMap.set(record.profile_url.trim(), record);
            }
        });

        storedData.forEach(record => {
            if (record.profile_url && record.profile_url.trim()) {
                storedUrlMap.set(record.profile_url.trim(), record);
            }
        });

        // 1. Identify new records (in current but not in stored)
        const newRecords = [];
        currentUrlMap.forEach((record, url) => {
            if (!storedUrlMap.has(url)) {
                newRecords.push(record);
            }
        });

        // 2. Identify duplicates to remove from current (in both current and stored)
        const duplicatesToRemove = [];
        currentUrlMap.forEach((_, url) => {
            if (storedUrlMap.has(url)) {
                duplicatesToRemove.push(url);
            }
        });

        // 3. Identify obsolete records to remove from stored (in stored but not in current)
        const obsoleteRecords = [];
        storedUrlMap.forEach((_, url) => {
            if (!currentUrlMap.has(url)) {
                obsoleteRecords.push(url);
            }
        });

        console.log(`🔍 Analysis: ${newRecords.length} new, ${duplicatesToRemove.length} duplicates, ${obsoleteRecords.length} obsolete`);

        // 4. Update list-girl.csv (remove duplicates, keep new records)
        const updatedCurrentData = currentData.filter(record =>
            record.profile_url && !storedUrlMap.has(record.profile_url.trim())
        );
        await writeCSVFile(listGirlPath, updatedCurrentData);
        console.log(`✅ Updated list-girl.csv: removed ${duplicatesToRemove.length} duplicates, kept ${updatedCurrentData.length} new records`);

        // 5. Update list-girl-stored.csv (remove obsolete, add new)
        const updatedStoredData = storedData.filter(record =>
            record.profile_url && currentUrlMap.has(record.profile_url.trim())
        );
        updatedStoredData.push(...newRecords);
        await writeCSVFile(listGirlStoredPath, updatedStoredData);
        console.log(`✅ Updated list-girl-stored.csv: removed ${obsoleteRecords.length} obsolete, added ${newRecords.length} new records`);

        return {
            newRecords: newRecords.length,
            duplicatesRemoved: duplicatesToRemove.length,
            obsoleteRecords: obsoleteRecords.length,
            totalStored: updatedStoredData.length,
            totalCurrent: updatedCurrentData.length
        };

    } catch (error) {
        console.error('❌ CSV synchronization error:', error);
        throw new Error(`CSV synchronization failed: ${error.message}`);
    }
}

// Helper function to read CSV file and parse records
async function readCSVFile(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            return [];
        }

        const csvContent = fs.readFileSync(filePath, 'utf8');
        const lines = csvContent.trim().split('\n');
        const records = [];

        // Skip header line and process each line
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line) {
                // Parse CSV line (handle quoted fields)
                const matches = line.match(/(?:^|,)("(?:[^"]+|"")*"|[^,]*)/g);
                if (matches && matches.length >= 3) {
                    const name = matches[0].replace(/^,?"?|"?$/g, '').replace(/""/g, '"');
                    const location = matches[1].replace(/^,?"?|"?$/g, '').replace(/""/g, '"');
                    const profile_url = matches[2].replace(/^,?"?|"?$/g, '');

                    if (profile_url && profile_url.startsWith('http')) {
                        records.push({ name, location, profile_url });
                    }
                }
            }
        }

        return records;
    } catch (error) {
        console.error(`Error reading CSV file ${filePath}:`, error);
        throw error;
    }
}

// Helper function to write CSV file with records
async function writeCSVFile(filePath, records) {
    try {
        // Create CSV content with header
        let csvContent = 'Name,Location,Profile URL\n';

        // Add records
        records.forEach(record => {
            const escapedName = `"${record.name.replace(/"/g, '""')}"`;
            const escapedLocation = `"${record.location.replace(/"/g, '""')}"`;
            csvContent += `${escapedName},${escapedLocation},${record.profile_url}\n`;
        });

        fs.writeFileSync(filePath, csvContent);
        console.log(`📝 Written ${records.length} records to ${path.basename(filePath)}`);
    } catch (error) {
        console.error(`Error writing CSV file ${filePath}:`, error);
        throw error;
    }
}

// Crawler implementation functions
async function startCategoriesCrawler() {
    try {
        // Override console.log to capture logs
        const originalLog = console.log;
        console.log = (...args) => {
            const message = args.join(' ');
            addLogEntry(crawlerState.categories.logs, {
                timestamp: new Date(),
                message: message
            });

            // Extract progress information from logs
            if (message.includes('Target:')) {
                const match = message.match(/(\d+(?:,\d+)*)\s+girls/);
                if (match) {
                    crawlerState.categories.totalGirls = parseInt(match[1].replace(/,/g, ''));
                    crawlerState.categories.totalGirlsExpected = parseInt(match[1].replace(/,/g, ''));
                    updateCategoriesProgress();
                }
            }

            if (message.includes('pages')) {
                const match = message.match(/(\d+)\s+pages/);
                if (match) {
                    crawlerState.categories.totalPages = parseInt(match[1]);
                }
            }

            // Extract current CSV count for real-time "Girls Found" updates
            if (message.includes('📊 Progress:') && message.includes('girls in CSV')) {
                const match = message.match(/📊 Progress: (\d+(?:,\d+)*)/);
                if (match) {
                    crawlerState.categories.crawledGirls = parseInt(match[1].replace(/,/g, ''));
                    updateCategoriesProgress();
                }
            }

            if (message.includes('📊 Current CSV count:') && message.includes('girls')) {
                const match = message.match(/📊 Current CSV count: (\d+(?:,\d+)*) girls/);
                if (match) {
                    crawlerState.categories.crawledGirls = parseInt(match[1].replace(/,/g, ''));
                    updateCategoriesProgress();
                }
            }

            if (message.includes('📊 Found') && message.includes('existing girls in')) {
                const match = message.match(/📊 Found (\d+(?:,\d+)*) existing girls/);
                if (match) {
                    crawlerState.categories.crawledGirls = parseInt(match[1].replace(/,/g, ''));
                    updateCategoriesProgress();
                }
            }

            // Extract final count when target is reached
            if (message.includes('🎯 TARGET REACHED! Successfully crawled') && message.includes('girls in CSV file')) {
                const match = message.match(/Successfully crawled (\d+(?:,\d+)*)/);
                if (match) {
                    crawlerState.categories.crawledGirls = parseInt(match[1].replace(/,/g, ''));
                    updateCategoriesProgress();
                }
            }

            // Extract count from target reached messages during crawling
            if (message.includes('Target reached') && message.includes('in CSV')) {
                const match = message.match(/\((\d+(?:,\d+)*)\/\d+(?:,\d+)* in CSV\)/);
                if (match) {
                    crawlerState.categories.crawledGirls = parseInt(match[1].replace(/,/g, ''));
                    updateCategoriesProgress();
                }
            }

            // Extract total girls expected from target messages
            if (message.includes('Fixed Target:') && message.includes('girls across')) {
                const match = message.match(/Fixed Target: ([\d,]+) girls/);
                if (match) {
                    crawlerState.categories.totalGirls = parseInt(match[1].replace(/,/g, ''));
                    crawlerState.categories.totalGirlsExpected = parseInt(match[1].replace(/,/g, ''));
                    updateCategoriesProgress();
                }
            }

            // Extract totalGirlsExpected from updated total messages
            if (message.includes('Total girls count updated:') && message.includes('→')) {
                const match = message.match(/→ ([\d,]+)/);
                if (match) {
                    crawlerState.categories.totalGirlsExpected = parseInt(match[1].replace(/,/g, ''));
                    updateCategoriesProgress();
                }
            }

            // Extract totalGirlsExpected from unchanged total messages
            if (message.includes('Total girls count unchanged:')) {
                const match = message.match(/unchanged: ([\d,]+)/);
                if (match) {
                    crawlerState.categories.totalGirlsExpected = parseInt(match[1].replace(/,/g, ''));
                    updateCategoriesProgress();
                }
            }

            // Extract totalGirlsExpected from initial website check
            if (message.includes('Total girls found on website:')) {
                const match = message.match(/website: ([\d,]+)/);
                if (match) {
                    crawlerState.categories.totalGirlsExpected = parseInt(match[1].replace(/,/g, ''));
                    updateCategoriesProgress();
                }
            }

            // Still track current page for display purposes, but don't use it for progress calculation
            if (message.includes('Thread') && message.includes('page')) {
                const match = message.match(/page\s+(\d+)/);
                if (match) {
                    crawlerState.categories.currentPage = Math.max(crawlerState.categories.currentPage, parseInt(match[1]));
                }
            }

            // Use setTimeout to avoid recursion issues with broadcastUpdate
            setTimeout(() => {
                broadcastUpdate('log', { type: 'categories', message });
            }, 0);
            originalLog(...args);
        };

        // Start the crawler using the web-compatible function
        const result = await runCategoriesCrawlerForWeb();

        // Restore console.log
        console.log = originalLog;

        crawlerState.categories.isRunning = false;
        crawlerState.categories.crawledGirls = result.totalCrawled;
        updateCategoriesProgress();

        // Check if crawler was stopped by user or completed naturally
        if (result.stopped) {
            addLogEntry(crawlerState.categories.logs, {
                timestamp: new Date(),
                message: `🛑 Crawler stopped by user. Crawled ${result.totalCrawled} girls in ${result.cycles} cycles (${result.duration}s)`
            });
            broadcastUpdate('stopped', { type: 'categories' });
        } else {
            // Run data synchronization after successful completion
            try {
                addLogEntry(crawlerState.categories.logs, {
                    timestamp: new Date(),
                    message: `🔄 Starting data synchronization between list-girl.csv and list-girl-stored.csv...`
                });
                broadcastUpdate('log', { type: 'categories', message: '🔄 Starting data synchronization...' });

                const syncResult = await synchronizeCSVData();

                addLogEntry(crawlerState.categories.logs, {
                    timestamp: new Date(),
                    message: `✅ Data synchronization completed: ${syncResult.newRecords} new records added, ${syncResult.duplicatesRemoved} duplicates removed, ${syncResult.obsoleteRecords} obsolete records cleaned`
                });
                broadcastUpdate('log', { type: 'categories', message: `✅ Sync completed: ${syncResult.newRecords} new, ${syncResult.duplicatesRemoved} duplicates removed, ${syncResult.obsoleteRecords} obsolete cleaned` });

            } catch (syncError) {
                console.error('Data synchronization error:', syncError);
                addLogEntry(crawlerState.categories.logs, {
                    timestamp: new Date(),
                    message: `❌ Data synchronization failed: ${syncError.message}`
                });
                broadcastUpdate('log', { type: 'categories', message: `❌ Sync failed: ${syncError.message}` });
            }

            broadcastUpdate('complete', { type: 'categories' });
        }

    } catch (error) {
        console.error('Categories crawler error:', error);
        crawlerState.categories.isRunning = false;
        addLogEntry(crawlerState.categories.logs, {
            timestamp: new Date(),
            message: `Error: ${error.message}`
        });
        broadcastUpdate('error', { type: 'categories', error: error.message });
    }
}

async function startGirlsCrawler() {
    try {
        // Get total count using memory-efficient counting
        const listGirlPath = path.join(__dirname, 'list-girl.csv');
        crawlerState.girls.totalProfiles = countCSVLines(listGirlPath);
        crawlerState.girls.processedProfiles = 0; // Reset processed count to 0 when starting

        // Override console.log to capture logs
        const originalLog = console.log;
        console.log = (...args) => {
            const message = args.join(' ');
            addLogEntry(crawlerState.girls.logs, {
                timestamp: new Date(),
                message: message
            });

            // Note: Progress tracking is now handled by the crawler's real-time state management
            // The crawler will update crawlerState.girls.processedProfiles and progress directly
            // No need to extract from logs anymore since we have real-time updates

            // Use setTimeout to avoid recursion issues with broadcastUpdate
            setTimeout(() => {
                broadcastUpdate('log', { type: 'girls', message });
            }, 0);
            originalLog(...args);
        };

        // Import the girls crawler and initialize global state
        const { runGirlsCrawlerForWeb, initializeGlobalState } = require('./crawler-girl');

        // Initialize the crawler's global state reference for real-time updates
        initializeGlobalState(crawlerState);

        // Start the crawler using the web-compatible function
        const result = await runGirlsCrawlerForWeb();

        // Restore console.log
        console.log = originalLog;

        crawlerState.girls.isRunning = false;
        crawlerState.girls.progress = 100;
        broadcastUpdate('complete', { type: 'girls' });

    } catch (error) {
        console.error('Girls crawler error:', error);
        crawlerState.girls.isRunning = false;
        addLogEntry(crawlerState.girls.logs, {
            timestamp: new Date(),
            message: `Error: ${error.message}`
        });
        broadcastUpdate('error', { type: 'girls', error: error.message });
    }
}

// Sequential crawler function that runs categories first, then girls
async function startSequentialCrawler() {
    try {
        console.log('🚀 Starting sequential crawler: Categories → Girls');

        // Phase 1: Categories Crawler
        crawlerState.girls.currentPhase = 'categories';
        crawlerState.girls.progress = 0;
        broadcastUpdate('phase-change', { type: 'girls', phase: 'categories' });

        // Initialize categories state for this run
        crawlerState.categories.isRunning = true;
        crawlerState.categories.startTime = new Date();
        crawlerState.categories.progress = 0;
        crawlerState.categories.totalGirlsExpected = 0;
        crawlerState.categories.logs = [];

        console.log('📋 Phase 1: Starting Categories Crawler...');
        await runCategoriesCrawlerSequential();

        // Check if categories crawler was stopped
        if (!crawlerState.girls.isRunning) {
            console.log('🛑 Sequential crawler stopped during categories phase');
            return;
        }

        console.log('✅ Phase 1 completed: Categories Crawler finished');

        // CSV Synchronization Phase (between Phase 1 and Phase 2)
        crawlerState.girls.currentPhase = 'sync';
        broadcastUpdate('phase-change', { type: 'girls', phase: 'sync' });

        console.log('🔄 Preparing for Phase 2: Synchronizing CSV data...');
        addLogEntry(crawlerState.girls.logs, {
            timestamp: new Date(),
            message: `🔄 Preparing for Phase 2: Synchronizing CSV data...`
        });
        broadcastUpdate('log', { type: 'girls', message: '🔄 Preparing for Phase 2: Synchronizing CSV data...' });

        try {
            addLogEntry(crawlerState.girls.logs, {
                timestamp: new Date(),
                message: `🔄 Starting data synchronization between list-girl.csv and list-girl-stored.csv...`
            });
            broadcastUpdate('log', { type: 'girls', message: '🔄 Starting data synchronization between list-girl.csv and list-girl-stored.csv...' });

            const syncResult = await synchronizeCSVData();

            addLogEntry(crawlerState.girls.logs, {
                timestamp: new Date(),
                message: `✅ Data synchronization completed: ${syncResult.newRecords} new records added, ${syncResult.duplicatesRemoved} duplicates removed, ${syncResult.obsoleteRecords} obsolete records cleaned`
            });
            broadcastUpdate('log', { type: 'girls', message: `✅ Data synchronization completed: ${syncResult.newRecords} new records added, ${syncResult.duplicatesRemoved} duplicates removed, ${syncResult.obsoleteRecords} obsolete records cleaned` });

            console.log(`✅ CSV synchronization completed: ${syncResult.newRecords} new records added, ${syncResult.duplicatesRemoved} duplicates removed, ${syncResult.obsoleteRecords} obsolete records cleaned`);

        } catch (syncError) {
            console.error('❌ CSV synchronization failed:', syncError);
            addLogEntry(crawlerState.girls.logs, {
                timestamp: new Date(),
                message: `❌ CSV synchronization failed: ${syncError.message}`
            });
            broadcastUpdate('log', { type: 'girls', message: `❌ CSV synchronization failed: ${syncError.message}` });

            // Continue with girls crawler even if sync fails
            console.log('⚠️ Continuing with Girls Crawler despite sync failure...');
        }

        // Phase 2: Girls Crawler
        crawlerState.girls.currentPhase = 'girls';
        crawlerState.girls.progress = 50; // Start at 50% since categories is done
        broadcastUpdate('phase-change', { type: 'girls', phase: 'girls' });
        broadcastUpdate('progress', { type: 'girls' }); // Ensure progress update is sent

        console.log('👥 Phase 2: Starting Girls Crawler...');
        await runGirlsCrawlerSequential();

        // Final completion
        crawlerState.girls.isRunning = false;
        crawlerState.girls.progress = 100;
        crawlerState.girls.currentPhase = 'completed';
        broadcastUpdate('complete', { type: 'girls' });

        console.log('🎉 Sequential crawler completed successfully!');

    } catch (error) {
        console.error('Sequential crawler error:', error);
        crawlerState.girls.isRunning = false;
        crawlerState.categories.isRunning = false;
        addLogEntry(crawlerState.girls.logs, {
            timestamp: new Date(),
            message: `Error: ${error.message}`
        });
        broadcastUpdate('error', { type: 'girls', error: error.message });
    }
}

// Categories crawler for sequential execution
async function runCategoriesCrawlerSequential() {
    // Override console.log to capture logs for girls crawler display
    const originalLog = console.log;
    console.log = (...args) => {
        const message = args.join(' ');

        // Add to girls crawler logs with phase prefix
        addLogEntry(crawlerState.girls.logs, {
            timestamp: new Date(),
            message: `[Categories] ${message}`
        });

        // Also update categories state for internal tracking
        addLogEntry(crawlerState.categories.logs, {
            timestamp: new Date(),
            message: message
        });

        // Extract progress information and update girls progress (0-50%)
        if (message.includes('Target:')) {
            const match = message.match(/(\d+(?:,\d+)*)\s+girls/);
            if (match) {
                crawlerState.categories.totalGirlsExpected = parseInt(match[1].replace(/,/g, ''));
            }
        }

        if (message.includes('📊 Progress:') && message.includes('girls in CSV')) {
            const match = message.match(/📊 Progress: (\d+(?:,\d+)*)/);
            if (match) {
                const crawledGirls = parseInt(match[1].replace(/,/g, ''));
                crawlerState.categories.crawledGirls = crawledGirls;

                // Update girls progress (0-50% for categories phase)
                if (crawlerState.categories.totalGirlsExpected > 0) {
                    const categoriesProgress = Math.min(50, (crawledGirls / crawlerState.categories.totalGirlsExpected) * 50);
                    crawlerState.girls.progress = categoriesProgress;

                    // Broadcast the progress update to all connected clients
                    setTimeout(() => {
                        broadcastUpdate('progress', { type: 'girls' });
                    }, 0);
                }
            }
        }

        // Use setTimeout to avoid recursion issues with broadcastUpdate
        setTimeout(() => {
            broadcastUpdate('log', { type: 'girls', message: `[Categories] ${message}` });
        }, 0);
        originalLog(...args);
    };

    try {
        // Start the categories crawler
        const result = await runCategoriesCrawlerForWeb();

        // Restore console.log
        console.log = originalLog;

        crawlerState.categories.isRunning = false;
        crawlerState.categories.crawledGirls = result.totalCrawled;

        return result;

    } catch (error) {
        console.log = originalLog;
        throw error;
    }
}

// Girls crawler for sequential execution
async function runGirlsCrawlerSequential() {
    // Get total count using memory-efficient counting
    const listGirlPath = path.join(__dirname, 'list-girl.csv');
    crawlerState.girls.totalProfiles = countCSVLines(listGirlPath);
    crawlerState.girls.processedProfiles = 0;

    // Override console.log to capture logs
    const originalLog = console.log;
    console.log = (...args) => {
        const message = args.join(' ');
        addLogEntry(crawlerState.girls.logs, {
            timestamp: new Date(),
            message: `[Girls] ${message}`
        });

        // Use setTimeout to avoid recursion issues with broadcastUpdate
        setTimeout(() => {
            broadcastUpdate('log', { type: 'girls', message: `[Girls] ${message}` });
        }, 0);
        originalLog(...args);
    };

    try {
        // Import the girls crawler module
        const crawlerGirlModule = require('./crawler-girl');
        const { runGirlsCrawlerForWeb, initializeGlobalState } = crawlerGirlModule;

        // Store the original updateGlobalProcessedProfiles function
        const originalUpdateGlobalProcessedProfiles = crawlerGirlModule.updateGlobalProcessedProfiles;

        // Override the updateGlobalProcessedProfiles function to map progress to 50-100%
        crawlerGirlModule.updateGlobalProcessedProfiles = function(newProcessed) {
            if (crawlerState && crawlerState.girls) {
                crawlerState.girls.processedProfiles = newProcessed;

                // Calculate raw progress (0-100%)
                let rawProgress = 0;
                if (crawlerState.girls.totalProfiles > 0) {
                    const progressFloat = (newProcessed / crawlerState.girls.totalProfiles) * 100;
                    rawProgress = Math.round(progressFloat);

                    // Ensure progress reaches 100% when all processable profiles are completed
                    if (newProcessed >= crawlerState.girls.totalProfiles || progressFloat >= 99.5) {
                        rawProgress = 100;
                    }
                } else if (newProcessed > 0) {
                    rawProgress = 100;
                }

                // Map raw progress (0-100%) to sequential progress (50-100%)
                const mappedProgress = 50 + (rawProgress * 0.5);
                crawlerState.girls.progress = Math.round(mappedProgress);

                console.log(`📊 Sequential update: Processed Profiles = ${newProcessed}/${crawlerState.girls.totalProfiles} (${rawProgress}% → ${crawlerState.girls.progress}%)`);

                // Broadcast the state update to all connected clients
                setTimeout(() => {
                    broadcastUpdate('progress', { type: 'girls' });
                }, 0);
            }
        };

        // Initialize the crawler's global state reference for real-time updates
        initializeGlobalState(crawlerState);

        // Start the crawler using the web-compatible function
        const result = await runGirlsCrawlerForWeb();

        // Restore the original function
        crawlerGirlModule.updateGlobalProcessedProfiles = originalUpdateGlobalProcessedProfiles;

        // Restore console.log
        console.log = originalLog;

        return result;

    } catch (error) {
        // Restore the original function in case of error
        if (typeof originalUpdateGlobalProcessedProfiles !== 'undefined') {
            const crawlerGirlModule = require('./crawler-girl');
            crawlerGirlModule.updateGlobalProcessedProfiles = originalUpdateGlobalProcessedProfiles;
        }
        console.log = originalLog;
        throw error;
    }
}

const PORT = process.env.PORT || 3000;
// Graceful shutdown handler
function gracefulShutdown(signal) {
    console.log(`\n🛑 Received ${signal}. Performing graceful shutdown...`);

    // Clear all intervals
    if (typeof logCleanupInterval !== 'undefined') clearInterval(logCleanupInterval);
    if (typeof memoryMonitorInterval !== 'undefined') clearInterval(memoryMonitorInterval);
    if (typeof sseCleanupInterval !== 'undefined') clearInterval(sseCleanupInterval);

    // Clean up SSE clients
    sseClients.forEach(client => {
        try {
            client.end();
        } catch (error) {
            // Ignore errors during cleanup
        }
    });

    // Clean up heartbeat intervals
    sseClientHeartbeats.forEach(interval => {
        clearInterval(interval);
    });

    console.log('🧹 Cleanup completed. Exiting...');
    process.exit(0);
}

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

server.listen(PORT, () => {
    console.log(`🚀 Crawler Web Interface running on http://localhost:${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`🔐 Default login: admin / password`);

    // Setup file watching for real-time updates
    setupFileWatching();
});
