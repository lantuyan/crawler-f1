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
const { runCategoriesCrawlerForWeb } = require('./crawler-categories');
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
    } catch (error) {
        console.error('Error initializing crawler state:', error);
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
        res.redirect('/dashboard');
    } else {
        res.redirect('/login');
    }
});

app.get('/login', (req, res) => {
    if (req.session && req.session.user) {
        return res.redirect('/dashboard');
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
            res.json({ success: true, redirect: '/dashboard' });
        } else {
            res.status(401).json({ error: 'Invalid credentials' });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
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
        
        crawlerState.girls.isRunning = true;
        crawlerState.girls.startTime = new Date();
        crawlerState.girls.progress = 0;
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
    if (crawlerState.categories.totalGirls > 0 && crawlerState.categories.crawledGirls >= 0) {
        crawlerState.categories.progress = Math.round((crawlerState.categories.crawledGirls / crawlerState.categories.totalGirls) * 100);
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
        broadcastUpdate('complete', { type: 'categories' });

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

        // Override console.log to capture logs
        const originalLog = console.log;
        console.log = (...args) => {
            const message = args.join(' ');
            crawlerState.girls.logs.push({
                timestamp: new Date(),
                message: message
            });

            // Extract progress information from logs
            if (message.includes('Extracted data for:') || message.includes('Profile data appended')) {
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
