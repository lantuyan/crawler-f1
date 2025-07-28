const express = require('express');
const session = require('express-session');
const http = require('http');
const socketIo = require('socket.io');
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
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false // Disable CSP for Socket.io
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
        logs: []
    }
};

// Initialize crawler state with current CSV counts
function initializeCrawlerState() {
    try {
        // Check current count in list-girl.csv
        const listGirlPath = path.join(__dirname, 'list-girl.csv');
        if (fs.existsSync(listGirlPath)) {
            const csvContent = fs.readFileSync(listGirlPath, 'utf8');
            const lines = csvContent.trim().split('\n');
            const currentCount = Math.max(0, lines.length - 1); // Exclude header
            crawlerState.categories.crawledGirls = currentCount;
            console.log(`📊 Initialized Girls Found count to: ${currentCount} (from existing CSV)`);
            updateCategoriesProgress();
        }

        // Check current count in detail-girls.csv for girls crawler
        const detailGirlsPath = path.join(__dirname, 'detail-girls.csv');
        if (fs.existsSync(detailGirlsPath)) {
            const csvContent = fs.readFileSync(detailGirlsPath, 'utf8');
            const lines = csvContent.trim().split('\n');
            const currentCount = Math.max(0, lines.length - 1); // Exclude header
            crawlerState.girls.processedProfiles = currentCount;
            console.log(`📊 Initialized Girls Processed count to: ${currentCount} (from existing detail CSV)`);
        }

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
    if (crawlerState.girls.isRunning) {
        return res.status(400).json({ error: 'Girls crawler is already running' });
    }

    try {
        // Check if list-girl.csv exists
        const listGirlPath = path.join(__dirname, 'list-girl.csv');
        if (!fs.existsSync(listGirlPath)) {
            return res.status(400).json({ error: 'list-girl.csv not found. Run categories crawler first.' });
        }

        // Reset the stop flag from categories crawler to ensure girls crawler can run properly
        resetStopFlag();

        crawlerState.girls.isRunning = true;
        crawlerState.girls.startTime = new Date();
        crawlerState.girls.progress = 0;
        crawlerState.girls.processedProfiles = 0; // Reset processed count to 0 when starting
        crawlerState.girls.logs = [];

        res.json({ success: true, message: 'Girls crawler started' });

        // Start crawler in background
        startGirlsCrawler();

    } catch (error) {
        console.error('Error starting girls crawler:', error);
        crawlerState.girls.isRunning = false;
        res.status(500).json({ error: 'Failed to start girls crawler' });
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
        crawlerState.categories.logs.push({
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
        crawlerState.girls.logs.push({
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

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    // Send current crawler state to new client
    socket.emit('crawler-state-update', crawlerState);
    
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

// Helper function to broadcast updates
function broadcastUpdate(type, data) {
    io.emit('crawler-state-update', crawlerState);
    if (type === 'log') {
        io.emit('crawler-log', data);
    }
}

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
            crawlerState.categories.logs.push({
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

            broadcastUpdate('log', { type: 'categories', message });
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
            crawlerState.categories.logs.push({
                timestamp: new Date(),
                message: `🛑 Crawler stopped by user. Crawled ${result.totalCrawled} girls in ${result.cycles} cycles (${result.duration}s)`
            });
            broadcastUpdate('stopped', { type: 'categories' });
        } else {
            // Run data synchronization after successful completion
            try {
                crawlerState.categories.logs.push({
                    timestamp: new Date(),
                    message: `🔄 Starting data synchronization between list-girl.csv and list-girl-stored.csv...`
                });
                broadcastUpdate('log', { type: 'categories', message: '🔄 Starting data synchronization...' });

                const syncResult = await synchronizeCSVData();

                crawlerState.categories.logs.push({
                    timestamp: new Date(),
                    message: `✅ Data synchronization completed: ${syncResult.newRecords} new records added, ${syncResult.duplicatesRemoved} duplicates removed, ${syncResult.obsoleteRecords} obsolete records cleaned`
                });
                broadcastUpdate('log', { type: 'categories', message: `✅ Sync completed: ${syncResult.newRecords} new, ${syncResult.duplicatesRemoved} duplicates removed, ${syncResult.obsoleteRecords} obsolete cleaned` });

            } catch (syncError) {
                console.error('Data synchronization error:', syncError);
                crawlerState.categories.logs.push({
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
        crawlerState.categories.logs.push({
            timestamp: new Date(),
            message: `Error: ${error.message}`
        });
        broadcastUpdate('error', { type: 'categories', error: error.message });
    }
}

async function startGirlsCrawler() {
    try {
        // Read list-girl.csv to get total count
        const listGirlPath = path.join(__dirname, 'list-girl.csv');
        const csvContent = fs.readFileSync(listGirlPath, 'utf8');
        const lines = csvContent.trim().split('\n');
        crawlerState.girls.totalProfiles = Math.max(0, lines.length - 1); // Exclude header
        crawlerState.girls.processedProfiles = 0; // Reset processed count to 0 when starting

        // Override console.log to capture logs
        const originalLog = console.log;
        console.log = (...args) => {
            const message = args.join(' ');
            crawlerState.girls.logs.push({
                timestamp: new Date(),
                message: message
            });

            // Extract progress information from logs - only count successfully saved profiles
            if (message.includes('Valid profile data saved:')) {
                crawlerState.girls.processedProfiles++;
                if (crawlerState.girls.totalProfiles > 0) {
                    crawlerState.girls.progress = Math.round((crawlerState.girls.processedProfiles / crawlerState.girls.totalProfiles) * 100);
                }
            }

            broadcastUpdate('log', { type: 'girls', message });
            originalLog(...args);
        };

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
        crawlerState.girls.logs.push({
            timestamp: new Date(),
            message: `Error: ${error.message}`
        });
        broadcastUpdate('error', { type: 'girls', error: error.message });
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Crawler Web Interface running on http://localhost:${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`🔐 Default login: admin / password`);

    // Setup file watching for real-time updates
    setupFileWatching();
});
