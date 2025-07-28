/**
 * Environment Configuration Module
 * Handles environment-specific settings and provides defaults
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Load environment variables from .env file if it exists
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
}

/**
 * Get platform-specific Chrome paths
 */
function getChromePaths() {
    const platform = os.platform();
    
    if (platform === 'linux') {
        return [
            '/usr/bin/google-chrome-stable',
            '/usr/bin/google-chrome',
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium',
            '/snap/bin/chromium',
            '/usr/bin/google-chrome-unstable',
            '/usr/bin/google-chrome-beta'
        ];
    } else if (platform === 'darwin') {
        return [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
            '/usr/bin/google-chrome',
            '/usr/bin/chromium-browser'
        ];
    } else {
        // Windows or other platforms
        return [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            '/usr/bin/google-chrome',
            '/usr/bin/chromium-browser'
        ];
    }
}

/**
 * Find available Chrome executable
 */
function findChromeExecutable() {
    // Check if explicitly set in environment
    if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
        return process.env.CHROME_PATH;
    }
    
    // Search in standard locations
    const chromePaths = getChromePaths();
    for (const chromePath of chromePaths) {
        if (fs.existsSync(chromePath)) {
            return chromePath;
        }
    }
    
    return null; // Use Puppeteer's bundled Chromium
}

/**
 * Get platform-specific browser arguments
 */
function getBrowserArgs(useProxy = false) {
    const platform = os.platform();
    const isLinux = platform === 'linux';
    
    const baseArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer'
    ];
    
    const linuxArgs = [
        '--disable-extensions',
        '--disable-plugins',
        '--disable-default-apps',
        '--disable-sync',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=TranslateUI',
        '--disable-ipc-flooding-protection'
    ];
    
    const proxyArgs = useProxy && process.env.PROXY_URL ? [
        `--proxy-server=${process.env.PROXY_URL.replace(/^https?:\/\/[^@]+@/, '')}`
    ] : [];
    
    const args = [
        ...baseArgs,
        ...(isLinux ? linuxArgs : []),
        ...proxyArgs
    ];
    
    // Add single process mode for Linux VPS if enabled
    if (isLinux && process.env.CHROME_SINGLE_PROCESS === 'true') {
        args.push('--single-process');
    }
    
    return args;
}

/**
 * Configuration object
 */
const config = {
    // Application settings
    app: {
        name: 'Fgirl Crawler',
        version: '1.0.0',
        env: process.env.NODE_ENV || 'development',
        port: parseInt(process.env.PORT) || 3000,
        sessionSecret: process.env.SESSION_SECRET || 'crawler-secret-key-change-in-production'
    },
    
    // Browser settings
    browser: {
        executablePath: findChromeExecutable(),
        headless: process.env.HEADLESS || 'new',
        args: getBrowserArgs(),
        timeout: parseInt(process.env.REQUEST_TIMEOUT) || 30000
    },
    
    // Proxy settings
    proxy: {
        url: process.env.PROXY_URL || '',
        username: process.env.PROXY_USERNAME || 'proxybird',
        password: process.env.PROXY_PASSWORD || 'proxybird',
        enabled: !!process.env.PROXY_URL
    },
    
    // Crawler settings
    crawler: {
        delayBetweenRequests: parseInt(process.env.DELAY_BETWEEN_REQUESTS) || 100,
        categoriesThreads: parseInt(process.env.CATEGORIES_THREADS) || 10,
        girlsThreads: parseInt(process.env.GIRLS_THREADS) || 10,
        maxPagesCategories: parseInt(process.env.MAX_PAGES_CATEGORIES) || 125,
        requestTimeout: parseInt(process.env.REQUEST_TIMEOUT) || 30000
    },
    
    // File paths
    files: {
        categoriesOutput: process.env.CATEGORIES_OUTPUT_FILE || 'list-girl.csv',
        girlsOutput: process.env.GIRLS_OUTPUT_FILE || 'detail-girls.csv',
        logDir: process.env.LOG_DIR || 'logs',
        tempDir: process.env.TEMP_DIR || 'tmp',
        uploadDir: process.env.UPLOAD_DIR || 'uploads',
        backupDir: process.env.BACKUP_DIR || 'backups'
    },
    
    // Security settings
    security: {
        httpsEnabled: process.env.HTTPS_ENABLED === 'true',
        sslCertPath: process.env.SSL_CERT_PATH || '',
        sslKeyPath: process.env.SSL_KEY_PATH || '',
        corsOrigin: process.env.CORS_ORIGIN || '*',
        helmetEnabled: process.env.HELMET_ENABLED !== 'false',
        rateLimitingEnabled: process.env.RATE_LIMITING_ENABLED === 'true',
        rateLimitRpm: parseInt(process.env.RATE_LIMIT_RPM) || 100
    },
    
    // Authentication
    auth: {
        adminUsername: process.env.ADMIN_USERNAME || 'admin',
        adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
        sessionTimeout: parseInt(process.env.SESSION_TIMEOUT) || 86400000 // 24 hours
    },
    
    // Monitoring & Logging
    monitoring: {
        logLevel: process.env.LOG_LEVEL || 'info',
        requestLogging: process.env.REQUEST_LOGGING !== 'false',
        performanceMonitoring: process.env.PERFORMANCE_MONITORING === 'true',
        memoryMonitoring: process.env.MEMORY_MONITORING === 'true',
        maxMemoryPerBrowser: parseInt(process.env.MAX_MEMORY_PER_BROWSER) || 2048
    },
    
    // System settings
    system: {
        platform: os.platform(),
        isLinux: os.platform() === 'linux',
        cleanupOnStart: process.env.CLEANUP_ON_START !== 'false',
        gzipEnabled: process.env.GZIP_ENABLED !== 'false',
        staticCacheEnabled: process.env.STATIC_CACHE_ENABLED !== 'false',
        staticCacheDuration: parseInt(process.env.STATIC_CACHE_DURATION) || 3600
    },
    
    // Development settings
    development: {
        debugMode: process.env.DEBUG_MODE === 'true',
        verboseLogging: process.env.VERBOSE_LOGGING === 'true',
        browserDebug: process.env.BROWSER_DEBUG === 'true',
        browserDebugPort: parseInt(process.env.BROWSER_DEBUG_PORT) || 9222
    },
    
    // Backup settings
    backup: {
        autoBackup: process.env.AUTO_BACKUP !== 'false',
        backupInterval: parseInt(process.env.BACKUP_INTERVAL) || 24,
        maxBackups: parseInt(process.env.MAX_BACKUPS) || 7,
        backupCompression: process.env.BACKUP_COMPRESSION !== 'false'
    }
};

/**
 * Get browser configuration for Puppeteer
 */
config.getBrowserConfig = function(useProxy = false) {
    const args = getBrowserArgs(useProxy);
    
    const browserConfig = {
        headless: this.browser.headless,
        args: args,
        timeout: this.browser.timeout
    };
    
    if (this.browser.executablePath) {
        browserConfig.executablePath = this.browser.executablePath;
    }
    
    if (this.development.browserDebug) {
        browserConfig.devtools = true;
        browserConfig.args.push(`--remote-debugging-port=${this.development.browserDebugPort}`);
    }
    
    return browserConfig;
};

/**
 * Validate configuration
 */
config.validate = function() {
    const errors = [];
    
    // Check required directories
    const requiredDirs = [
        this.files.logDir,
        this.files.tempDir,
        this.files.uploadDir,
        this.files.backupDir
    ];
    
    for (const dir of requiredDirs) {
        if (!fs.existsSync(dir)) {
            try {
                fs.mkdirSync(dir, { recursive: true });
            } catch (error) {
                errors.push(`Cannot create directory: ${dir}`);
            }
        }
    }
    
    // Check Chrome executable
    if (this.browser.executablePath && !fs.existsSync(this.browser.executablePath)) {
        errors.push(`Chrome executable not found: ${this.browser.executablePath}`);
    }
    
    // Validate port
    if (this.app.port < 1 || this.app.port > 65535) {
        errors.push(`Invalid port number: ${this.app.port}`);
    }
    
    return errors;
};

/**
 * Get environment-specific settings
 */
config.getEnvironmentSettings = function() {
    const env = this.app.env;
    
    const settings = {
        development: {
            logLevel: 'debug',
            verboseLogging: true,
            browserDebug: false,
            helmetEnabled: false,
            rateLimitingEnabled: false
        },
        production: {
            logLevel: 'info',
            verboseLogging: false,
            browserDebug: false,
            helmetEnabled: true,
            rateLimitingEnabled: true
        },
        staging: {
            logLevel: 'info',
            verboseLogging: false,
            browserDebug: false,
            helmetEnabled: true,
            rateLimitingEnabled: false
        }
    };
    
    return settings[env] || settings.production;
};

module.exports = config;
