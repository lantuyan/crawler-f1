/**
 * Fgirl.ch Profile Crawler
 *
 * This script crawls profile pages from the URLs listed in list-girl.csv
 * and extracts detailed information about each profile, saving the results
 * to detail-girls.csv.
 *
 * Extracted fields:
 * - URL, Canton, City, Nickname, Category, Phone number
 * - Status (active/inactive), Certified or not, About, Number of visits
 * - Services provided, Location, Description, Link (if any in the ad)
 * - Number of likes, Number of followers, Number of reviews
 *
 * Note: The "Link (if any in the ad)" field will copy the URL field value
 * when links are detected in the ad content, otherwise it remains empty.
 *
 * Usage:
 * 1. Make sure list-girl.csv exists with URLs in the 3rd column
 * 2. Run: node crawler-girl.js
 * 3. Results will be saved to detail-girls.csv
 *
 * Features:
 * - Proxy support with authentication
 * - Multi-threaded crawling for speed
 * - Advanced anti-detection measures with user-agent rotation
 * - Cloudflare-aware retry logic with intelligent blocking detection
 * - Real-time CSV writing with duplicate detection
 * - Comprehensive logging and monitoring
 */

const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const fs = require('fs');

// ===== CLOUDFLARE DETECTION AND ANTI-DETECTION MODULE =====

/**
 * Cloudflare Detection and Anti-Detection Utilities
 * Handles detection of Cloudflare blocking scenarios and implements
 * anti-detection measures to improve crawler resilience
 */
class CloudflareHandler {
    constructor() {
        this.userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ];

        this.acceptLanguages = [
            'en-US,en;q=0.9',
            'en-GB,en;q=0.9',
            'fr-FR,fr;q=0.9,en;q=0.8',
            'de-DE,de;q=0.9,en;q=0.8',
            'es-ES,es;q=0.9,en;q=0.8'
        ];

        this.blockingStats = {
            totalRequests: 0,
            blockedRequests: 0,
            successfulRetries: 0,
            failedRetries: 0
        };
    }

    /**
     * Detects if a response indicates Cloudflare blocking
     * @param {Object} response - Puppeteer response object
     * @param {string} content - Page content HTML
     * @param {string} url - Request URL
     * @returns {Object} Detection result with blocking status and details
     */
    detectCloudflareBlocking(response, content, url) {
        const detection = {
            isBlocked: false,
            blockType: null,
            confidence: 0,
            indicators: [],
            statusCode: response ? response.status() : null
        };

        this.blockingStats.totalRequests++;

        // Check HTTP status codes commonly used by Cloudflare
        if (response) {
            const statusCode = response.status();
            if ([403, 503, 520, 521, 522, 523, 524, 525, 526, 527, 530].includes(statusCode)) {
                detection.isBlocked = true;
                detection.blockType = 'HTTP_STATUS';
                detection.confidence += 0.7;
                detection.indicators.push(`HTTP ${statusCode} status code`);
            }
        }

        // Check for Cloudflare-specific content patterns
        if (content) {
            const contentLower = content.toLowerCase();

            // Cloudflare challenge page indicators
            const challengePatterns = [
                'checking your browser before accessing',
                'cloudflare ray id',
                'cf-ray',
                'cloudflare',
                'ddos protection by cloudflare',
                'please wait while we check your browser',
                'browser check',
                'security check',
                'cf-browser-verification',
                'cf-challenge-form'
            ];

            challengePatterns.forEach(pattern => {
                if (contentLower.includes(pattern)) {
                    detection.isBlocked = true;
                    detection.blockType = 'CHALLENGE_PAGE';
                    detection.confidence += 0.3;
                    detection.indicators.push(`Content pattern: ${pattern}`);
                }
            });

            // Check for Cloudflare error pages
            const errorPatterns = [
                'error 1020',
                'access denied',
                'accès refusé',
                'blocked by cloudflare',
                'your ip has been blocked',
                'rate limited'
            ];

            errorPatterns.forEach(pattern => {
                if (contentLower.includes(pattern)) {
                    detection.isBlocked = true;
                    detection.blockType = 'ERROR_PAGE';
                    detection.confidence += 0.4;
                    detection.indicators.push(`Error pattern: ${pattern}`);
                }
            });

            // Check for minimal content (possible blocking)
            if (content.length < 500 && !contentLower.includes('<!doctype html>')) {
                detection.confidence += 0.2;
                detection.indicators.push('Minimal content length');
            }
        }

        // Check response headers for Cloudflare indicators
        if (response) {
            const headers = response.headers();
            if (headers['cf-ray'] || headers['cf-cache-status'] || headers['server']?.includes('cloudflare')) {
                detection.confidence += 0.1;
                detection.indicators.push('Cloudflare headers detected');
            }
        }

        // Determine final blocking status
        if (detection.confidence >= 0.5) {
            detection.isBlocked = true;
            this.blockingStats.blockedRequests++;
        }

        return detection;
    }

    /**
     * Gets a random user agent for anti-detection
     * @returns {string} Random user agent string
     */
    getRandomUserAgent() {
        return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
    }

    /**
     * Gets random headers for anti-detection
     * @returns {Object} Random headers object
     */
    getRandomHeaders() {
        return {
            'Accept-Language': this.acceptLanguages[Math.floor(Math.random() * this.acceptLanguages.length)],
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Upgrade-Insecure-Requests': '1'
        };
    }

    /**
     * Calculates retry delay with fixed 100ms wait
     * @param {number} attempt - Current attempt number (0-based)
     * @param {number} baseDelay - Base delay in milliseconds (ignored, always returns 100ms)
     * @returns {number} Delay in milliseconds (always 100ms)
     */
    calculateRetryDelay(attempt, baseDelay = 100) {
        // Fixed 100ms delay instead of exponential backoff
        return 100;
    }

    /**
     * Logs blocking incident for monitoring
     * @param {string} url - Blocked URL
     * @param {Object} detection - Detection result
     * @param {number} attempt - Current attempt number
     */
    logBlockingIncident(url, detection, attempt) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            url,
            attempt,
            blockType: detection.blockType,
            confidence: detection.confidence,
            indicators: detection.indicators,
            statusCode: detection.statusCode
        };

        console.log(`🚫 CLOUDFLARE BLOCK DETECTED [Attempt ${attempt}]:`, JSON.stringify(logEntry, null, 2));
    }

    /**
     * Gets current blocking statistics
     * @returns {Object} Statistics object
     */
    getStats() {
        const blockingRate = this.blockingStats.totalRequests > 0
            ? (this.blockingStats.blockedRequests / this.blockingStats.totalRequests * 100).toFixed(2)
            : 0;

        return {
            ...this.blockingStats,
            blockingRate: `${blockingRate}%`,
            retrySuccessRate: this.blockingStats.blockedRequests > 0
                ? `${(this.blockingStats.successfulRetries / this.blockingStats.blockedRequests * 100).toFixed(2)}%`
                : '0%'
        };
    }
}

// Global Cloudflare handler instance
const cloudflareHandler = new CloudflareHandler();

// Global state for real-time updates (compatible with web interface)
let globalCrawlerState = null;

// Shared state for multi-threaded crawling
const sharedCrawlState = {
    totalProcessed: 0,
    totalFailed: 0,
    totalValidProfiles: 0,
    lock: false
};

/**
 * Initialize global crawler state reference for real-time updates
 * This allows the crawler to update the web interface state in real-time
 * @param {Object} stateRef - Reference to the global crawler state object
 */
function initializeGlobalState(stateRef) {
    globalCrawlerState = stateRef;
    console.log('🔗 Global crawler state initialized for real-time updates');
}

/**
 * Update the global total profiles count in real-time
 * @param {number} newTotal - New total profiles count
 */
function updateGlobalTotalProfiles(newTotal) {
    if (globalCrawlerState && globalCrawlerState.girls) {
        globalCrawlerState.girls.totalProfiles = newTotal;
        console.log(`📊 Real-time update: Total Profiles = ${newTotal}`);
    }
}

/**
 * Update the global processed profiles count in real-time
 * @param {number} newProcessed - New processed profiles count
 */
function updateGlobalProcessedProfiles(newProcessed) {
    if (globalCrawlerState && globalCrawlerState.girls) {
        globalCrawlerState.girls.processedProfiles = newProcessed;
        // Update progress percentage with more robust calculation
        if (globalCrawlerState.girls.totalProfiles > 0) {
            const progressFloat = (newProcessed / globalCrawlerState.girls.totalProfiles) * 100;
            globalCrawlerState.girls.progress = Math.round(progressFloat);

            // Ensure progress reaches 100% when all processable profiles are completed
            // Use >= comparison and also check if we're very close to 100%
            if (newProcessed >= globalCrawlerState.girls.totalProfiles || progressFloat >= 99.5) {
                globalCrawlerState.girls.progress = 100;
            }
        } else if (newProcessed > 0) {
            // If totalProfiles is 0 but we have processed profiles, set to 100%
            globalCrawlerState.girls.progress = 100;
        }
        console.log(`📊 Real-time update: Processed Profiles = ${newProcessed}/${globalCrawlerState.girls.totalProfiles} (${globalCrawlerState.girls.progress}%)`);
    }
}

/**
 * Thread-safe increment of processed profiles count
 */
async function incrementProcessedProfiles() {
    // Wait for lock to be released
    while (sharedCrawlState.lock) {
        await new Promise(resolve => setTimeout(resolve, 1));
    }

    sharedCrawlState.lock = true;
    sharedCrawlState.totalProcessed++;
    updateGlobalProcessedProfiles(sharedCrawlState.totalProcessed);
    sharedCrawlState.lock = false;
}

/**
 * Thread-safe decrement of total valid profiles count
 */
async function decrementTotalValidProfiles() {
    // Wait for lock to be released
    while (sharedCrawlState.lock) {
        await new Promise(resolve => setTimeout(resolve, 1));
    }

    sharedCrawlState.lock = true;
    sharedCrawlState.totalFailed++;
    sharedCrawlState.totalValidProfiles--;
    updateGlobalTotalProfiles(sharedCrawlState.totalValidProfiles);
    sharedCrawlState.lock = false;
}

/**
 * Initialize shared state for multi-threaded crawling
 * @param {number} totalUrls - Total number of URLs to process
 */
function initializeSharedState(totalUrls) {
    sharedCrawlState.totalProcessed = 0;
    sharedCrawlState.totalFailed = 0;
    sharedCrawlState.totalValidProfiles = totalUrls;
    sharedCrawlState.lock = false;
}

/**
 * Check if crawling is complete and set progress to 100% if needed
 * @param {number} totalUrlsProcessed - Total number of URLs that have been processed (success + failed)
 * @param {number} originalTotalUrls - Original total number of URLs
 */
function checkCrawlingCompletion(totalUrlsProcessed, originalTotalUrls) {
    if (globalCrawlerState && globalCrawlerState.girls) {
        // If we've processed all URLs (either successfully or failed), set progress to 100%
        if (totalUrlsProcessed >= originalTotalUrls) {
            globalCrawlerState.girls.progress = 100;
            console.log(`🎯 Crawling completed: ${totalUrlsProcessed}/${originalTotalUrls} URLs processed - Progress set to 100%`);
        }
    }
}

// ===== CONFIGURATION =====

// Basic crawler configuration
const PROXY_URL = 'http://proxybird:proxybird@155.254.39.107:6065';
const DELAY_BETWEEN_REQUESTS = 100; // 100ms delay between requests
const MAX_CONCURRENT_THREADS = 10; // Number of concurrent browser instances
const OUTPUT_FILE = 'detail-girls.csv';

// Cloudflare-aware retry configuration
const CLOUDFLARE_CONFIG = {
    // Maximum number of retry attempts for Cloudflare-blocked requests
    maxRetries: 8,

    // Base delay for retry attempts (fixed 100ms)
    baseRetryDelay: 100, // 100ms

    // Maximum delay between retries (fixed 100ms)
    maxRetryDelay: 100, // 100ms

    // Enable/disable anti-detection measures
    enableAntiDetection: true,

    // Rotate user agent on each retry attempt
    rotateUserAgent: true,

    // Add random delays to mimic human behavior
    enableRandomDelays: true,

    // Minimum confidence level to consider a request as blocked (0.0 - 1.0)
    blockingDetectionThreshold: 0.5,

    // Enable detailed logging of blocking incidents
    enableDetailedLogging: true,

    // Wait time before considering a page fully loaded (for challenge pages)
    challengeWaitTime: 100, // 100ms

    // Enable statistics tracking
    enableStatsTracking: true
};

// CSV writer configuration
const csvWriter = createCsvWriter({
    path: OUTPUT_FILE,
    header: [
        { id: 'url', title: 'URL' },
        { id: 'canton', title: 'Canton' },
        { id: 'city', title: 'City' },
        { id: 'nickname', title: 'Nickname' },
        { id: 'category', title: 'Category' },
        { id: 'phone', title: 'Phone number' },
        { id: 'status', title: 'Status (active or inactive)' },
        { id: 'certified', title: 'Certified or not' },
        { id: 'about', title: 'About' },
        { id: 'visits', title: 'Number of visits' },
        { id: 'services', title: 'Services provided' },
        { id: 'location', title: 'Location' },
        { id: 'description', title: 'Description' },
        { id: 'link', title: 'Link (if any in the ad)' },
        { id: 'likes', title: 'Number of likes' },
        { id: 'followers', title: 'Number of followers' },
        { id: 'reviews', title: 'Number of reviews' }
    ]
});

// Function to clear the CSV file before starting
function clearDetailGirlsCsv() {
    try {
        if (fs.existsSync(OUTPUT_FILE)) {
            fs.unlinkSync(OUTPUT_FILE);
            console.log(`🗑️  Cleared existing ${OUTPUT_FILE}`);
        }
        // Create new file with header
        const headerLine = 'URL,Canton,City,Nickname,Category,Phone number,Status (active or inactive),Certified or not,About,Number of visits,Services provided,Location,Description,Link (if any in the ad),Number of likes,Number of followers,Number of reviews\n';
        fs.writeFileSync(OUTPUT_FILE, headerLine);
        console.log(`📝 Created new ${OUTPUT_FILE} with header`);
    } catch (error) {
        console.error(`❌ Error clearing ${OUTPUT_FILE}:`, error);
        throw error;
    }
}

// Global variables for real-time CSV writing
let csvWriteLock = false; // Thread-safe CSV writing lock

// Browser initialization with proxy support (based on crawler-categories.js)
async function initBrowser() {
    console.log('Initializing browser with proxy...');

    // Check for Chrome executable paths (Linux and macOS)
    const os = require('os');
    const platform = os.platform();

    let chromePaths = [];

    if (platform === 'linux') {
        chromePaths = [
            '/usr/bin/google-chrome-stable',
            '/usr/bin/google-chrome',
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium',
            '/snap/bin/chromium',
            '/usr/bin/google-chrome-unstable',
            '/usr/bin/google-chrome-beta'
        ];
    } else if (platform === 'darwin') {
        chromePaths = [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
            '/usr/bin/google-chrome',
            '/usr/bin/chromium-browser'
        ];
    } else {
        // Windows or other platforms
        chromePaths = [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            '/usr/bin/google-chrome',
            '/usr/bin/chromium-browser'
        ];
    }

    let executablePath = null;
    for (const path of chromePaths) {
        try {
            if (fs.existsSync(path)) {
                executablePath = path;
                console.log(`Found Chrome at: ${path}`);
                break;
            }
        } catch (e) {
            // Continue to next path
        }
    }

    if (!executablePath) {
        console.log('No Chrome executable found in standard locations, using Puppeteer bundled Chromium');
    }

    // Enhanced browser configurations with anti-detection measures and Linux optimization
    const isLinux = platform === 'linux';

    const configurations = [
        {
            name: 'enhanced-proxy',
            config: {
                headless: "new",
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-software-rasterizer',
                    '--disable-images',
                    '--disable-plugins',
                    '--disable-extensions',
                    '--proxy-server=155.254.39.107:6065',
                    // Anti-detection arguments
                    '--disable-blink-features=AutomationControlled',
                    '--disable-features=VizDisplayCompositor',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                    '--disable-features=TranslateUI',
                    '--disable-ipc-flooding-protection',
                    '--no-first-run',
                    '--no-default-browser-check',
                    '--disable-default-apps',
                    '--disable-popup-blocking',
                    '--disable-prompt-on-repost',
                    '--disable-hang-monitor',
                    '--disable-sync',
                    '--disable-web-security',
                    '--disable-features=site-per-process',
                    '--window-size=1366,768',
                    ...(isLinux ? [
                        '--disable-background-networking',
                        '--disable-client-side-phishing-detection',
                        '--disable-component-extensions-with-background-pages',
                        '--disable-domain-reliability'
                    ] : [])
                ],
                timeout: 20000
            }
        },
        {
            name: 'enhanced-no-proxy',
            config: {
                headless: "new",
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-images',
                    '--disable-plugins',
                    '--disable-extensions',
                    // Anti-detection arguments (same as proxy version)
                    '--disable-blink-features=AutomationControlled',
                    '--disable-features=VizDisplayCompositor',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                    '--disable-features=TranslateUI',
                    '--disable-ipc-flooding-protection',
                    '--no-first-run',
                    '--no-default-browser-check',
                    '--disable-default-apps',
                    '--disable-popup-blocking',
                    '--disable-prompt-on-repost',
                    '--disable-hang-monitor',
                    '--disable-sync',
                    '--disable-web-security',
                    '--disable-features=site-per-process',
                    '--window-size=1366,768'
                ],
                timeout: 15000
            }
        }
    ];

    let browser = null;
    let useProxy = false;

    for (const { name, config } of configurations) {
        try {
            console.log(`Trying browser configuration: ${name}`);

            // Add executable path if found
            const launchConfig = { ...config };
            if (executablePath) {
                launchConfig.executablePath = executablePath;
            }

            browser = await puppeteer.launch(launchConfig);
            useProxy = name.includes('proxy');
            console.log(`Browser launched successfully with: ${name}`);
            break;
        } catch (error) {
            console.log(`Failed to launch browser with ${name}:`, error.message);

            // Try without custom executable path if that was the issue
            if (executablePath && error.message.includes('spawn')) {
                try {
                    console.log(`Retrying ${name} without custom executable path...`);
                    browser = await puppeteer.launch(config);
                    useProxy = name.includes('proxy');
                    console.log(`Browser launched successfully with: ${name} (bundled Chromium)`);
                    break;
                } catch (retryError) {
                    console.log(`Retry also failed: ${retryError.message}`);
                }
            }

            if (browser) {
                try {
                    await browser.close();
                } catch (e) {}
                browser = null;
            }
        }
    }

    if (!browser) {
        throw new Error('Failed to launch browser with any configuration');
    }

    return { browser, useProxy };
}

// Memory-efficient function to count CSV lines
function countCSVLines(csvPath) {
    try {
        if (!fs.existsSync(csvPath)) {
            return 0;
        }

        const data = fs.readFileSync(csvPath, 'utf8');
        const lineCount = data.split('\n').filter(line => line.trim()).length;
        return Math.max(0, lineCount - 1); // Exclude header
    } catch (error) {
        console.error(`Error counting CSV lines in ${csvPath}:`, error);
        return 0;
    }
}

// Function to read URLs from CSV with memory optimization
function readUrlsFromCsv() {
    try {
        const path = require('path');
        const csvPath = path.resolve('list-girl.csv');

        // First check if file exists
        if (!fs.existsSync(csvPath)) {
            console.error('❌ list-girl.csv file not found');
            return [];
        }

        const csvContent = fs.readFileSync(csvPath, 'utf8');
        const lines = csvContent.split('\n');
        const urls = [];

        // Skip header line and process each line
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line) {
                // Parse CSV line (handle quoted fields)
                const matches = line.match(/(?:^|,)("(?:[^"]+|"")*"|[^,]*)/g);
                if (matches && matches.length >= 3) {
                    const url = matches[2].replace(/^,?"?|"?$/g, '');
                    if (url && url.startsWith('http')) {
                        urls.push(url);
                    }
                }
            }
        }

        console.log(`Found ${urls.length} URLs to crawl`);
        return urls;
    } catch (error) {
        console.error('Error reading CSV file:', error);
        return [];
    }
}

// Modal dismissal function (based on crawler-categories.js)
async function dismissModals(page) {
    try {
        // Quick check for modals
        await page.waitForTimeout(200);

        // Check if modals exist using JavaScript evaluation
        const modalInfo = await page.evaluate(() => {
            const modals = document.querySelectorAll('.modal.show');
            const backdrops = document.querySelectorAll('.modal-backdrop.show');
            return {
                modalCount: modals.length,
                backdropCount: backdrops.length,
                hasModals: modals.length > 0 || backdrops.length > 0
            };
        });

        if (modalInfo.hasModals) {
            console.log(`Found ${modalInfo.modalCount} modals and ${modalInfo.backdropCount} backdrops - dismissing...`);

            // Remove modals using JavaScript
            await page.evaluate(() => {
                // Remove modal backdrops
                const backdrops = document.querySelectorAll('.modal-backdrop');
                backdrops.forEach(backdrop => backdrop.remove());

                // Hide modals
                const modals = document.querySelectorAll('.modal.show');
                modals.forEach(modal => {
                    modal.classList.remove('show');
                    modal.style.display = 'none';
                });

                // Remove modal-open class from body
                document.body.classList.remove('modal-open');

                // Reset body styles
                document.body.style.paddingRight = '';
                document.body.style.overflow = '';
            });

            console.log('Modals dismissed successfully');
            await page.waitForTimeout(100);
        }

    } catch (error) {
        console.log('Modal dismissal completed with minor issues:', error.message);
    }
}

// Real-time CSV writing with duplicate filtering (based on crawler-categories.js)
async function saveDataToCSVRealtime(profileData) {
    // Wait for any existing write operation to complete (thread-safe)
    while (csvWriteLock) {
        await new Promise(resolve => setTimeout(resolve, 10));
    }

    csvWriteLock = true;

    try {
        // Check if CSV file exists and has content
        const fileExists = fs.existsSync(OUTPUT_FILE);
        let needsHeader = !fileExists;

        if (fileExists) {
            const stats = fs.statSync(OUTPUT_FILE);
            needsHeader = stats.size === 0;
        }

        if (needsHeader) {
            // Write header first
            const headerLine = 'URL,Canton,City,Nickname,Category,Phone number,Status (active or inactive),Certified or not,About,Number of visits,Services provided,Location,Description,Link (if any in the ad),Number of likes,Number of followers,Number of reviews\n';
            fs.writeFileSync(OUTPUT_FILE, headerLine);
            console.log(`CSV header written to ${OUTPUT_FILE}`);
        }

        // Read existing URLs to check for duplicates
        let existingUrls = new Set();
        if (fileExists) {
            try {
                const existingContent = fs.readFileSync(OUTPUT_FILE, 'utf8');
                const lines = existingContent.split('\n');

                // Skip header line and process data lines
                for (let i = 1; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (line) {
                        // Extract URL from CSV line (first column)
                        const columns = line.split(',');
                        if (columns.length >= 1) {
                            const url = columns[0].trim().replace(/^"?|"?$/g, '');
                            existingUrls.add(url);
                        }
                    }
                }
                console.log(`Found ${existingUrls.size} existing URLs in CSV for duplicate checking`);
            } catch (readError) {
                console.log('Could not read existing CSV for duplicate checking:', readError.message);
                // Continue without duplicate checking if file read fails
            }
        }

        // Check if this URL already exists
        const isDuplicate = existingUrls.has(profileData.url);
        if (isDuplicate) {
            console.log(`⚠️  Skipping duplicate URL: ${profileData.url}`);
            return false; // Return false to indicate duplicate was skipped
        }

        // Prepare CSV line with proper escaping
        const csvLine = [
            `"${profileData.url}"`,
            `"${(profileData.canton || '').replace(/"/g, '""')}"`,
            `"${(profileData.city || '').replace(/"/g, '""')}"`,
            `"${(profileData.nickname || '').replace(/"/g, '""')}"`,
            `"${(profileData.category || '').replace(/"/g, '""')}"`,
            `"${(profileData.phone || '').replace(/"/g, '""')}"`,
            `"${(profileData.status || '').replace(/"/g, '""')}"`,
            `"${(profileData.certified || '').replace(/"/g, '""')}"`,
            `"${(profileData.about || '').replace(/"/g, '""')}"`,
            `"${(profileData.visits || '').replace(/"/g, '""')}"`,
            `"${(profileData.services || '').replace(/"/g, '""')}"`,
            `"${(profileData.location || '').replace(/"/g, '""')}"`,
            `"${(profileData.description || '').replace(/"/g, '""')}"`,
            `"${(profileData.link || '').replace(/"/g, '""')}"`,
            `"${(profileData.likes || '').replace(/"/g, '""')}"`,
            `"${(profileData.followers || '').replace(/"/g, '""')}"`,
            `"${(profileData.reviews || '').replace(/"/g, '""')}"`
        ].join(',') + '\n';

        // Append the new data
        fs.appendFileSync(OUTPUT_FILE, csvLine);
        console.log(`✓ Real-time: Profile data for ${profileData.nickname} appended to ${OUTPUT_FILE}`);

        return true; // Return true to indicate successful write

    } catch (error) {
        console.error('Error in real-time CSV writing:', error);
        return false;
    } finally {
        csvWriteLock = false;
    }
}

// Function to extract phone number by making AJAX request to /call/ endpoint
async function extractPhoneFromModal(page) {
    try {
        console.log('Extracting phone number via AJAX call endpoint...');

        // Get current URL to construct call endpoint
        const currentUrl = page.url();
        const callUrl = currentUrl.replace(/\/$/, '') + '/call/';

        console.log(`Making AJAX request to: ${callUrl}`);

        // Wait a bit to ensure page is fully loaded with session
        await page.waitForTimeout(1000);

        // Make AJAX request with proper headers (like the browser does)
        const response = await page.evaluate(async (url) => {
            try {
                // Get CSRF token if available
                const csrfToken = document.querySelector('[name=csrfmiddlewaretoken]')?.value ||
                                 document.querySelector('meta[name=csrf-token]')?.content || '';

                const headers = {
                    'X-Requested-With': 'XMLHttpRequest',
                    'Accept': '*/*',
                    'Accept-Language': 'en-GB,en;q=0.9,en-US;q=0.8',
                    'Sec-Fetch-Dest': 'empty',
                    'Sec-Fetch-Mode': 'cors',
                    'Sec-Fetch-Site': 'same-origin',
                    'Referer': window.location.href
                };

                // Add CSRF token if found
                if (csrfToken) {
                    headers['X-CSRFToken'] = csrfToken;
                }

                console.log('Making fetch request to:', url);
                console.log('Headers:', JSON.stringify(headers, null, 2));

                const response = await fetch(url, {
                    method: 'GET',
                    headers: headers,
                    credentials: 'same-origin'
                });

                console.log('Response status:', response.status);
                console.log('Response headers:', [...response.headers.entries()]);

                if (response.ok) {
                    const text = await response.text();
                    console.log('Response length:', text.length);
                    return text;
                } else {
                    console.log('AJAX request failed:', response.status, response.statusText);
                    return null;
                }
            } catch (error) {
                console.log('AJAX request error:', error.message);
                return null;
            }
        }, callUrl);

        if (!response) {
            console.log('⚠️ No response from call endpoint');
            return '';
        }

        console.log('✓ Got response from call endpoint, parsing...');

        // Parse the HTML response
        const $ = cheerio.load(response);
        let phoneNumber = '';

        // Method 1: Extract from tel: links
        const telLink = $('a[href^="tel:"]').first();
        if (telLink.length > 0) {
            const href = telLink.attr('href');
            phoneNumber = href.replace('tel:', '').replace(/tel:/g, '').trim();
            console.log(`Method 1 - Tel link found: ${phoneNumber}`);
        }

        // Method 2: Extract from button text containing phone number
        if (!phoneNumber) {
            const phoneButtons = $('.btn').filter(function() {
                const text = $(this).text();
                return text.match(/\+\d+[\s\d]+/);
            });

            if (phoneButtons.length > 0) {
                const buttonText = phoneButtons.first().text().trim();
                const phoneMatch = buttonText.match(/(\+\d+[\s\d]+)/);
                if (phoneMatch) {
                    phoneNumber = phoneMatch[1].trim();
                    console.log(`Method 2 - Button text found: ${phoneNumber}`);
                }
            }
        }

        // Method 3: Extract from WhatsApp link
        if (!phoneNumber) {
            const whatsappLink = $('a[href*="wa.me/"]').first();
            if (whatsappLink.length > 0) {
                const href = whatsappLink.attr('href');
                const phoneMatch = href.match(/wa\.me\/(\d+)/);
                if (phoneMatch) {
                    const rawPhone = phoneMatch[1];
                    // Format Swiss phone number
                    if (rawPhone.startsWith('41') && rawPhone.length >= 11) {
                        phoneNumber = '+41 ' + rawPhone.substring(2, 4) + ' ' +
                                    rawPhone.substring(4, 7) + ' ' +
                                    rawPhone.substring(7, 9) + ' ' +
                                    rawPhone.substring(9);
                    } else {
                        phoneNumber = '+' + rawPhone;
                    }
                    console.log(`Method 3 - WhatsApp found: ${phoneNumber}`);
                }
            }
        }

        // Method 4: Look for phone number in mobile section plain text
        if (!phoneNumber) {
            const mobileText = $('.d-md-none p').text();
            const phoneMatch = mobileText.match(/(\+\d+[\s\d]{8,})/);
            if (phoneMatch) {
                phoneNumber = phoneMatch[1].trim();
                console.log(`Method 4 - Mobile text found: ${phoneNumber}`);
            }
        }

        // Method 5: Look for any phone number pattern in the response
        if (!phoneNumber) {
            const phoneMatch = response.match(/(\+\d+[\s\d]{8,})/);
            if (phoneMatch) {
                phoneNumber = phoneMatch[1].trim();
                console.log(`Method 5 - Pattern match found: ${phoneNumber}`);
            }
        }

        // Clean up phone number formatting
        if (phoneNumber) {
            phoneNumber = phoneNumber.replace(/\s+/g, ' ').trim();
            console.log(`✓ Phone extracted via AJAX: ${phoneNumber}`);
        } else {
            console.log('⚠️ No phone number found in AJAX response');
            // Debug: Show response preview
            const debugContent = response.substring(0, 300);
            console.log(`Response preview: ${debugContent}...`);
        }

        return phoneNumber;

    } catch (error) {
        console.error('Error extracting phone via AJAX:', error.message);
        return '';
    }
}

// Function to extract phone number by clicking phone button on profile page
async function extractPhoneNumber(page, profileUrl) {
    try {
        console.log(`Attempting to extract phone from profile page`);

        // Look for phone/call button on the current page
        const phoneButton = await page.$('a[href*="/call/"], button[data-target*="phone"], .btn-phone, .phone-btn');

        if (phoneButton) {
            console.log('Found phone button, attempting to click...');

            try {
                // Click the phone button to trigger modal
                await phoneButton.click();

                // Wait for modal to appear
                await page.waitForSelector('.modal-body, .phone-modal, [data-phone]', { timeout: 5000 });
                await page.waitForTimeout(1000);

                // Get updated page content after modal opens
                const content = await page.content();
                const $ = cheerio.load(content);

                console.log(`Modal opened, looking for phone number...`);

                // Extract phone number from modal
                let phoneNumber = '';

                // Method 1: From tel: link in modal
                const telLink = $('.modal-body a[href^="tel:"], a[href^="tel:"]').first();
                if (telLink.length > 0) {
                    const href = telLink.attr('href');
                    phoneNumber = href.replace('tel:', '').replace(/tel:/g, '').trim();
                    console.log(`Method 1 - Tel link found: ${phoneNumber}`);
                }

                // Method 2: From button text containing phone number in modal
                if (!phoneNumber) {
                    const phoneButton = $('.modal-body .btn, .btn').filter(function() {
                        return $(this).text().match(/\+\d+[\s\d]+/);
                    });
                    if (phoneButton.length > 0) {
                        const buttonText = phoneButton.text().trim();
                        const phoneMatch = buttonText.match(/(\+\d+[\s\d]+)/);
                        if (phoneMatch) {
                            phoneNumber = phoneMatch[1].trim();
                            console.log(`Method 2 - Button text found: ${phoneNumber}`);
                        }
                    }
                }

                // Method 3: From WhatsApp link in modal
                if (!phoneNumber) {
                    const whatsappLink = $('.modal-body a[href*="wa.me/"], a[href*="wa.me/"]').first();
                    if (whatsappLink.length > 0) {
                        const href = whatsappLink.attr('href');
                        const phoneMatch = href.match(/wa\.me\/(\d+)/);
                        if (phoneMatch) {
                            const rawPhone = phoneMatch[1];
                            // Format Swiss phone number
                            if (rawPhone.startsWith('41')) {
                                phoneNumber = '+41 ' + rawPhone.substring(2, 4) + ' ' +
                                            rawPhone.substring(4, 7) + ' ' +
                                            rawPhone.substring(7, 9) + ' ' +
                                            rawPhone.substring(9);
                            } else {
                                phoneNumber = '+' + rawPhone;
                            }
                            console.log(`Method 3 - WhatsApp found: ${phoneNumber}`);
                        }
                    }
                }

                // Method 4: Look for phone number in any text within modal
                if (!phoneNumber) {
                    const modalText = $('.modal-body, .modal').text();
                    const phoneMatch = modalText.match(/(\+\d+[\s\d]{8,})/);
                    if (phoneMatch) {
                        phoneNumber = phoneMatch[1].trim();
                        console.log(`Method 4 - Modal text found: ${phoneNumber}`);
                    }
                }

                if (phoneNumber) {
                    // Clean up phone number formatting
                    phoneNumber = phoneNumber.replace(/\s+/g, ' ').trim();
                    console.log(`✓ Phone extracted: ${phoneNumber}`);
                    return phoneNumber;
                }

            } catch (clickError) {
                console.log('Error clicking phone button:', clickError.message);
            }
        }

        // Fallback: Try direct call endpoint approach
        console.log('Fallback: Trying direct call endpoint...');
        const callUrl = profileUrl.replace(/\/$/, '') + '/call/';

        await page.goto(callUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 10000
        });

        await page.waitForTimeout(1000);
        const content = await page.content();
        const $ = cheerio.load(content);

        // Extract phone number from call page
        let phoneNumber = '';

        // Look for tel: links
        const telLink = $('a[href^="tel:"]').first();
        if (telLink.length > 0) {
            const href = telLink.attr('href');
            phoneNumber = href.replace('tel:', '').trim();
        }

        // Look for WhatsApp links
        if (!phoneNumber) {
            const whatsappLink = $('a[href*="wa.me/"]').first();
            if (whatsappLink.length > 0) {
                const href = whatsappLink.attr('href');
                const phoneMatch = href.match(/wa\.me\/(\d+)/);
                if (phoneMatch) {
                    const rawPhone = phoneMatch[1];
                    if (rawPhone.startsWith('41')) {
                        phoneNumber = '+41 ' + rawPhone.substring(2, 4) + ' ' +
                                    rawPhone.substring(4, 7) + ' ' +
                                    rawPhone.substring(7, 9) + ' ' +
                                    rawPhone.substring(9);
                    } else {
                        phoneNumber = '+' + rawPhone;
                    }
                }
            }
        }

        // Clean up phone number formatting
        if (phoneNumber) {
            phoneNumber = phoneNumber.replace(/\s+/g, ' ').trim();
            console.log(`✓ Phone extracted from call endpoint: ${phoneNumber}`);
        } else {
            console.log('⚠️ No phone number found in call endpoint');
        }

        return phoneNumber;

    } catch (error) {
        console.error(`Error extracting phone from ${profileUrl}:`, error.message);
        return '';
    }
}

// ===== ENHANCED CLOUDFLARE-AWARE EXTRACTION FUNCTIONS =====

/**
 * Enhanced profile data extraction with Cloudflare-aware retry logic
 * @param {Object} page - Puppeteer page object
 * @param {string} url - Profile URL to extract data from
 * @param {boolean} useProxy - Whether proxy is being used
 * @returns {Object} Extracted profile data or error data
 */
async function extractProfileDataWithRetry(page, url, useProxy) {
    let attempt = 0;
    let lastError = null;
    let lastDetection = null;

    while (attempt < CLOUDFLARE_CONFIG.maxRetries) {
        try {
            console.log(`🔄 Extracting data from: ${url} (attempt ${attempt + 1}/${CLOUDFLARE_CONFIG.maxRetries})`);

            // Apply anti-detection measures if enabled
            if (CLOUDFLARE_CONFIG.enableAntiDetection && attempt > 0) {
                await applyAntiDetectionMeasures(page, attempt);
            }

            // Attempt to extract profile data
            const result = await extractProfileDataCore(page, url, useProxy);

            // Check if the result indicates a successful extraction
            if (result && isValidProfileData(result)) {
                if (attempt > 0) {
                    cloudflareHandler.blockingStats.successfulRetries++;
                    console.log(`✅ Successfully extracted data after ${attempt + 1} attempts`);
                }
                return result;
            }

            // If we got an incomplete result, treat it as a potential block and retry
            if (result && !isValidProfileData(result)) {
                const blockType = determineBlockType(result);
                const mockDetection = {
                    isBlocked: true,
                    blockType: blockType,
                    confidence: 0.8,
                    indicators: [`Incomplete data: ${result.nickname || 'Unknown'}`],
                    statusCode: null
                };

                lastDetection = mockDetection;
                cloudflareHandler.logBlockingIncident(url, mockDetection, attempt + 1);

                if (attempt < CLOUDFLARE_CONFIG.maxRetries - 1) {
                    const delay = cloudflareHandler.calculateRetryDelay(attempt, CLOUDFLARE_CONFIG.baseRetryDelay);
                    console.log(`⏳ Waiting ${delay}ms before retry...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }

        } catch (error) {
            lastError = error;
            console.error(`❌ Attempt ${attempt + 1} failed:`, error.message);

            // Check if this might be a Cloudflare-related error
            const errorMessage = error.message.toLowerCase();
            if (errorMessage.includes('timeout') || errorMessage.includes('navigation') ||
                errorMessage.includes('net::') || errorMessage.includes('blocked')) {

                const errorDetection = {
                    isBlocked: true,
                    blockType: 'NAVIGATION_ERROR',
                    confidence: 0.6,
                    indicators: [`Navigation error: ${error.message}`],
                    statusCode: null
                };

                lastDetection = errorDetection;
                cloudflareHandler.logBlockingIncident(url, errorDetection, attempt + 1);
            }

            if (attempt < CLOUDFLARE_CONFIG.maxRetries - 1) {
                const delay = cloudflareHandler.calculateRetryDelay(attempt, CLOUDFLARE_CONFIG.baseRetryDelay);
                console.log(`⏳ Waiting ${delay}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        attempt++;
    }

    // All retries exhausted
    cloudflareHandler.blockingStats.failedRetries++;
    console.error(`💥 Failed to extract data from ${url} after ${CLOUDFLARE_CONFIG.maxRetries} attempts`);

    return {
        url: url,
        canton: '',
        city: '',
        nickname: 'RETRY_EXHAUSTED',
        category: '',
        phone: '',
        status: 'failed_after_retries',
        certified: '',
        about: '',
        visits: '',
        services: '',
        location: '',
        description: '',
        link: '',
        likes: '',
        followers: '',
        reviews: '',
        lastError: lastError?.message || 'Unknown error',
        lastDetection: lastDetection
    };
}

/**
 * Validates if the extracted profile data is complete and valid
 * @param {Object} data - Profile data object
 * @returns {boolean} True if data is valid and complete
 */
function isValidProfileData(data) {
    if (!data) return false;

    // Check for Cloudflare challenge indicators
    const cloudflareIndicators = [
        'just a moment',
        'un momento',
        'checking your browser',
        'please wait',
        'cloudflare',
        'ddos protection'
    ];

    const nickname = (data.nickname || '').toLowerCase();
    const description = (data.description || '').toLowerCase();
    const about = (data.about || '').toLowerCase();

    // Check if nickname contains Cloudflare indicators
    for (const indicator of cloudflareIndicators) {
        if (nickname.includes(indicator) || description.includes(indicator) || about.includes(indicator)) {
            return false;
        }
    }

    // Check for specific invalid nicknames
    const invalidNicknames = [
        'ACCESS_DENIED',
        'ERROR',
        'FAILED',
        'RETRY_EXHAUSTED',
        'Just a moment...',
        'Un momento…'
    ];

    if (invalidNicknames.includes(data.nickname)) {
        return false;
    }

    // Check for blocked status
    if (data.status === 'blocked' || data.status === 'error' || data.status === 'failed_after_retries') {
        return false;
    }

    // Check if we have minimal required data (nickname should be meaningful)
    if (!data.nickname || data.nickname.trim().length < 2) {
        return false;
    }

    // Check for Cloudflare URLs in links
    if (data.link && data.link.includes('cloudflare.com')) {
        return false;
    }

    return true;
}

/**
 * Determines the type of blocking based on the extracted data
 * @param {Object} data - Profile data object
 * @returns {string} Block type identifier
 */
function determineBlockType(data) {
    if (!data) return 'NO_DATA';

    const nickname = (data.nickname || '').toLowerCase();

    if (nickname.includes('just a moment') || nickname.includes('un momento')) {
        return 'CLOUDFLARE_CHALLENGE';
    }

    if (nickname.includes('access denied') || nickname.includes('accès refusé')) {
        return 'ACCESS_DENIED';
    }

    if (data.status === 'blocked') {
        return 'BLOCKED_STATUS';
    }

    if (data.link && data.link.includes('cloudflare.com')) {
        return 'CLOUDFLARE_REDIRECT';
    }

    return 'INCOMPLETE_DATA';
}

/**
 * Applies anti-detection measures to the page
 * @param {Object} page - Puppeteer page object
 * @param {number} attempt - Current attempt number
 */
async function applyAntiDetectionMeasures(page, attempt) {
    try {
        console.log(`🛡️ Applying anti-detection measures (attempt ${attempt + 1})`);

        // Rotate user agent if enabled
        if (CLOUDFLARE_CONFIG.rotateUserAgent) {
            const newUserAgent = cloudflareHandler.getRandomUserAgent();
            await page.setUserAgent(newUserAgent);
            console.log(`🔄 Rotated user agent: ${newUserAgent.substring(0, 50)}...`);
        }

        // Set randomized headers
        const randomHeaders = cloudflareHandler.getRandomHeaders();
        await page.setExtraHTTPHeaders(randomHeaders);
        console.log(`🔄 Applied randomized headers`);

        // Add random delay to mimic human behavior
        if (CLOUDFLARE_CONFIG.enableRandomDelays) {
            const randomDelay = 100; // Fixed 100ms delay
            console.log(`⏳ Adding random delay: ${randomDelay}ms`);
            await new Promise(resolve => setTimeout(resolve, randomDelay));
        }

        // Clear cookies and local storage to start fresh
        await page.deleteCookie(...(await page.cookies()));
        await page.evaluate(() => {
            localStorage.clear();
            sessionStorage.clear();
        });
        console.log(`🧹 Cleared cookies and storage`);

    } catch (error) {
        console.log(`⚠️ Error applying anti-detection measures:`, error.message);
    }
}

// Function to extract data from a single profile page (core implementation)
async function extractProfileDataCore(page, url, useProxy) {
    try {
        console.log(`Crawling: ${url}`);

        // Enhanced navigation with Cloudflare detection
        let response = null;
        try {
            response = await page.goto(url, {
                waitUntil: 'domcontentloaded',
                timeout: 5000
            });
        } catch (navigationError) {
            console.log(`Navigation error: ${navigationError.message}`);
            throw navigationError;
        }

        // Quick page stabilization
        await page.waitForTimeout(500);

        // Check if page is still accessible
        const isPageClosed = page.isClosed();
        if (isPageClosed) {
            throw new Error('Page was closed during navigation');
        }

        // Get page content for Cloudflare detection
        const content = await page.content();

        // Detect Cloudflare blocking
        const detection = cloudflareHandler.detectCloudflareBlocking(response, content, url);

        if (detection.isBlocked) {
            console.log(`🚫 Cloudflare blocking detected: ${detection.blockType} (confidence: ${detection.confidence})`);
            console.log(`Indicators: ${detection.indicators.join(', ')}`);

            // If it's a challenge page, wait a bit longer
            if (detection.blockType === 'CHALLENGE_PAGE') {
                console.log(`⏳ Waiting for challenge page to resolve...`);
                await page.waitForTimeout(CLOUDFLARE_CONFIG.challengeWaitTime);

                // Re-check after waiting
                const newContent = await page.content();
                const newDetection = cloudflareHandler.detectCloudflareBlocking(response, newContent, url);

                if (newDetection.isBlocked) {
                    throw new Error(`Cloudflare challenge not resolved: ${newDetection.blockType}`);
                }
            } else {
                throw new Error(`Cloudflare blocking detected: ${detection.blockType}`);
            }
        }

        // Close any modal dialogs that might be blocking the page
        await dismissModals(page);

        // Quick content check
        try {
            await page.waitForSelector('.profile-card, body', { timeout: 1000 });
        } catch (selectorError) {
            // Try body as fallback
            await page.waitForSelector('body', { timeout: 500 });
        }

        // Reload content after potential challenge resolution
        const finalContent = await page.content();
        const $ = cheerio.load(finalContent);

        // Debug: check if content is loaded (remove in production)
        // console.log('Page title from DOM:', $('title').text());

        // Check if access is denied
        const pageTitle = $('title').text().toLowerCase();
        if (pageTitle.includes('accès refusé') || pageTitle.includes('access denied') ||
            content.includes('Access denied') || content.includes('Accès refusé')) {
            console.log('Access denied for:', url);
            return {
                url: url,
                canton: '',
                city: '',
                nickname: 'ACCESS_DENIED',
                category: '',
                phone: '',
                status: 'blocked',
                certified: '',
                about: '',
                visits: '',
                services: '',
                location: '',
                description: '',
                link: '',
                likes: '',
                followers: '',
                reviews: ''
            };
        }

        // Extract data
        const data = {
            url: url,
            canton: '',
            city: '',
            nickname: '',
            category: '',
            phone: '',
            status: 'active', // Will be updated based on pause status
            certified: 'no',
            about: '',
            visits: '',
            services: '',
            location: '',
            description: '',
            link: '',
            likes: '',
            followers: '',
            reviews: ''
        };

        // Extract nickname from multiple possible sources
        let nickname = '';

        // Try from title first (most reliable)
        const titleText = $('title').text();
        const nameMatch = titleText.match(/^([^-]+)/);
        if (nameMatch && nameMatch[1].trim() !== 'Fgirl.ch') {
            nickname = nameMatch[1].trim();
        }

        // Try from profile card name
        if (!nickname || nickname === 'Fgirl.ch') {
            const profileNameElem = $('.name, .profile-name, h1.name').first();
            if (profileNameElem.length > 0) {
                const name = profileNameElem.text().trim();
                if (name && name !== 'Fgirl.ch') {
                    nickname = name;
                }
            }
        }

        // Try from breadcrumb last item
        if (!nickname || nickname === 'Fgirl.ch') {
            const lastBreadcrumb = $('.breadcrumb-item.active').text().trim();
            if (lastBreadcrumb && lastBreadcrumb !== 'Fgirl.ch') {
                nickname = lastBreadcrumb;
            }
        }
        data.nickname = nickname || 'Unknown';

        // Extract phone number by clicking "Call me" button to open modal
        try {
            const phoneNumber = await extractPhoneFromModal(page);
            data.phone = phoneNumber;
        } catch (phoneError) {
            console.log('Phone extraction failed:', phoneError.message);
            data.phone = '';
        }

        // Check if profile is on pause (inactive status)
        const pauseText = $('.card-text.font-italic.small.text-white').text().trim();
        if (pauseText.includes('On pause, I\'ll be back soon') || pauseText.includes('On pause')) {
            data.status = 'inactive';
        }

        // Extract location info from breadcrumb
        const breadcrumbItems = $('.breadcrumb-item');
        breadcrumbItems.each((i, elem) => {
            const text = $(elem).text().trim();
            if (text && text !== 'Girls' && !text.includes('Escort') && !text.includes('girls')) {
                if (!data.canton && i === 1) {
                    data.canton = text;
                } else if (!data.city && i === 2) {
                    data.city = text;
                }
            }
        });

        // Set category to always be "Girls"
        data.category = 'Girls';

        // Extract location from profile info
        const locationText = $('.fa-map-marker-alt').parent().text().trim();
        if (locationText) {
            data.location = locationText.replace(/.*in\s+/, '').trim();
            if (!data.city && data.location) {
                data.city = data.location;
            }
        }

        // Also try to get location from the Location section
        const locationSection = $('h2:contains("Location")').next().text().trim();
        if (locationSection && !data.location) {
            data.location = locationSection.replace(/\s+/g, ' ').trim();
        }

        // Clean up location field - remove extra whitespace and newlines
        if (data.location) {
            data.location = data.location.replace(/\s+/g, ' ').replace(/\n+/g, ' ').trim();
        }

        // Check if certified - based on specific button structure
        if ($('button.btn-success.card-badge.badge-certified').length > 0 ||
            $('.profile-certified-icon').length > 0 ||
            $('.badge-certified').length > 0) {
            data.certified = 'yes';
        }

        // Extract visits count
        const visitsElement = $('.text-muted.small.float-right');
        if (visitsElement.length > 0) {
            const visitsText = visitsElement.text();
            const visitsMatch = visitsText.match(/([\d,]+)\s*visits/);
            if (visitsMatch) {
                data.visits = visitsMatch[1].replace(/,/g, '');
            }
        }

        // Extract likes count
        const likesCounter = $('#like-counter');
        if (likesCounter.length > 0) {
            data.likes = likesCounter.text().replace(/,/g, '');
        }

        // Extract followers count
        const followersCounter = $('#follow-counter');
        if (followersCounter.length > 0) {
            data.followers = followersCounter.text().replace(/,/g, '');
        }

        // Extract reviews count
        const reviewsHeader = $('h2:contains("Reviews")');
        if (reviewsHeader.length > 0) {
            const reviewsText = reviewsHeader.text();
            const reviewsMatch = reviewsText.match(/Reviews\s*\((\d+)\)/);
            if (reviewsMatch) {
                data.reviews = reviewsMatch[1];
            }
        }

        // Extract description/about from multiple possible sources
        let description = '';

        // Try from description-text class
        const descriptionDiv = $('.description-text');
        if (descriptionDiv.length > 0) {
            description = descriptionDiv.text().trim().replace(/\s+/g, ' ');
        }

        // Try from card-text or other description containers
        if (!description) {
            const cardText = $('.card-text').first();
            if (cardText.length > 0) {
                description = cardText.text().trim().replace(/\s+/g, ' ');
            }
        }

        // Try from meta description
        if (!description) {
            const metaDesc = $('meta[name="description"]').attr('content');
            if (metaDesc) {
                description = metaDesc.trim();
            }
        }

        data.description = description;

        // Extract "About" information from the specific card structure
        let aboutInfo = [];

        // Find the About section by looking for h2 containing "About"
        const aboutCard = $('h2:contains("About")').closest('.card');
        if (aboutCard.length > 0) {
            const profileDetails = [];

            // Extract each profile detail from the row structure
            aboutCard.find('.row .col-6, .row .col-md-4').each((i, elem) => {
                const $elem = $(elem);
                let detailText = $elem.text().trim();

                // Skip empty details and visits count
                if (!detailText || detailText.includes('visits')) {
                    return;
                }

                // Clean up the detail text - remove extra whitespace
                detailText = detailText.replace(/\s+/g, ' ').trim();

                // Extract meaningful profile information
                if (detailText.length > 0 && detailText.length < 100) {
                    // Remove icon characters and clean up
                    const cleanDetail = detailText.replace(/^\s*[^\w\s]+\s*/, '').trim();
                    if (cleanDetail && cleanDetail.length > 1) {
                        profileDetails.push(cleanDetail);
                    }
                }
            });

            // Combine profile details into about field
            if (profileDetails.length > 0) {
                aboutInfo.push(profileDetails.join(' | '));
            }
        }

        // If no About section found, try to use description
        if (aboutInfo.length === 0 && description) {
            aboutInfo.push(description.substring(0, 300));
        }

        data.about = aboutInfo.join(' ').substring(0, 500); // Limit length

        // Extract services from multiple sources
        const services = [];

        // Extract from services list
        const servicesList = $('.services-list li');
        servicesList.each((i, elem) => {
            const service = $(elem).text().trim().replace(/^\s*✓\s*/, '');
            if (service) {
                services.push(service);
            }
        });

        // Also extract service-like information from profile details (About section)
        const aboutCardForServices = $('h2:contains("About")').closest('.card');
        if (aboutCardForServices.length > 0) {
            aboutCardForServices.find('.row .col-6, .row .col-md-4').each((i, elem) => {
                const $elem = $(elem);
                let detailText = $elem.text().trim();

                // Look for service-related information
                if (detailText.includes('Escort') || detailText.includes('Massage') ||
                    detailText.includes('Tantra') || detailText.includes('years old') ||
                    detailText.includes('Natural') || detailText.includes('Boobs')) {

                    // Clean up the detail text
                    const cleanDetail = detailText.replace(/\s+/g, ' ').replace(/^\s*[^\w\s]+\s*/, '').trim();
                    if (cleanDetail.length > 0 && cleanDetail.length < 50) {
                        services.push(cleanDetail);
                    }
                }
            });
        }

        data.services = services.join(', ');

        // Extract any links in the description or profile
        const links = [];
        $('a[href]').each((i, elem) => {
            const href = $(elem).attr('href');
            if (href && (href.startsWith('http') || href.startsWith('www'))) {
                links.push(href);
            }
        });

        // If any links are found in the ad, copy the URL field to the Link field
        // Otherwise, leave the Link field empty
        if (links.length > 0) {
            data.link = url; // Copy from URL field when links are found in the ad
        } else {
            data.link = ''; // No links found in the ad
        }

        console.log(`✓ Extracted data for: ${data.nickname}`);
        return data;

    } catch (error) {
        console.error(`Error extracting data from ${url}:`, error.message);
        return {
            url: url,
            canton: '',
            city: '',
            nickname: 'ERROR',
            category: '',
            phone: '',
            status: 'error',
            certified: '',
            about: '',
            visits: '',
            services: '',
            location: '',
            description: '',
            link: '',
            likes: '',
            followers: '',
            reviews: ''
        };
    }
}

// Main crawler function
async function crawlProfiles() {
    const urls = readUrlsFromCsv();
    if (urls.length === 0) {
        console.log('No URLs found to crawl');
        return;
    }

    // CONFIGURATION: Change this for different crawl modes
    // For testing: limit to first 10 URLs (comment out for full crawl)
    // const testUrls = urls.slice(0, 10);
    // console.log(`Processing first ${testUrls.length} URLs for testing`);

    // For full crawl: uncomment the line below and comment out the lines above
    const testUrls = urls;
    console.log(`Processing all ${testUrls.length} URLs`);

    // Initialize browser with proxy support
    const { browser, useProxy } = await initBrowser();

    const page = await browser.newPage();

    // Set viewport
    await page.setViewport({ width: 1366, height: 768 });

    // Set proxy authentication only if using proxy
    if (useProxy) {
        await page.authenticate({
            username: 'proxybird',
            password: 'proxybird'
        });
        console.log('Proxy authentication set');
    } else {
        console.log('Running without proxy - direct connection');
    }

    // Set user agent and headers to avoid detection
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    });

    // Set faster timeouts
    page.setDefaultTimeout(10000);
    page.setDefaultNavigationTimeout(15000);

    const results = [];
    let processed = 0;
    let successfulWrites = 0;
    let duplicatesSkipped = 0;
    let failedProfiles = 0;
    let totalValidProfiles = testUrls.length; // Track the effective total count

    console.log(`Real-time CSV writing to: ${OUTPUT_FILE}`);
    console.log('Data will be written immediately as each profile is processed');

    // Initialize global state with total profiles count
    updateGlobalTotalProfiles(totalValidProfiles);
    updateGlobalProcessedProfiles(0);

    for (const url of testUrls) {
        try {
            const data = await extractProfileDataWithRetry(page, url, useProxy);

            // Only save valid profile data to CSV
            if (data && isValidProfileData(data)) {
                results.push(data);

                // Write data to CSV immediately with duplicate checking
                const writeSuccess = await saveDataToCSVRealtime(data);
                if (writeSuccess) {
                    processed++; // Only increment when successfully saved to CSV
                    successfulWrites++;
                    console.log(`✅ Valid profile data saved: ${data.nickname}`);

                    // Update global state in real-time
                    updateGlobalProcessedProfiles(processed);
                } else {
                    duplicatesSkipped++;
                    console.log(`⚠️ Duplicate profile skipped: ${data.nickname}`);
                }
            } else {
                // Check if this is a failed profile after exhausting retries
                if (data && data.nickname === 'RETRY_EXHAUSTED' && data.status === 'failed_after_retries') {
                    failedProfiles++;
                    totalValidProfiles--; // Decrease total count for failed profiles
                    console.log(`❌ Profile failed after ${CLOUDFLARE_CONFIG.maxRetries} retry attempts: ${url}`);
                    console.log(`   Failed profiles count: ${failedProfiles}`);

                    // Update global total profiles count in real-time
                    updateGlobalTotalProfiles(totalValidProfiles);

                    // Log failed profile for debugging
                    logFailedProfile(url, data);
                } else {
                    console.log(`❌ Invalid/incomplete data for ${url} - not saved to CSV`);
                    if (data) {
                        console.log(`   Reason: ${data.nickname || 'No nickname'} - ${data.status || 'Unknown status'}`);
                    }
                }
            }

            // Show progress with accurate total count (excluding failed profiles)
            const progressPercentage = totalValidProfiles > 0 ? Math.round(processed/totalValidProfiles*100) : 0;
            console.log(`Progress: ${processed}/${totalValidProfiles} (${progressPercentage}%) | Written: ${successfulWrites} | Duplicates: ${duplicatesSkipped} | Failed: ${failedProfiles}`);

            // Add delay between requests to be respectful
            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_REQUESTS));

        } catch (error) {
            console.error(`❌ Failed to process ${url}:`, error.message);
            console.log(`❌ Failed to process ${url} after all retries - not saved to CSV`);
            failedProfiles++;
            totalValidProfiles--; // Decrease total count for failed profiles

            // Update global total profiles count in real-time
            updateGlobalTotalProfiles(totalValidProfiles);
        }
    }

    await browser.close();

    // Final completion check - ensure progress reaches 100%
    const totalUrlsProcessed = processed + failedProfiles;
    checkCrawlingCompletion(totalUrlsProcessed, testUrls.length);

    // Summary
    console.log(`\n=== Crawling Summary ===`);
    console.log(`✓ Successfully crawled ${results.length} profiles`);
    console.log(`✓ Real-time CSV writing completed`);
    console.log(`✓ Successful writes: ${successfulWrites}`);
    console.log(`✓ Duplicates skipped: ${duplicatesSkipped}`);
    console.log(`❌ Failed profiles (after ${CLOUDFLARE_CONFIG.maxRetries} retries): ${failedProfiles}`);
    console.log(`📊 Effective success rate: ${totalValidProfiles > 0 ? Math.round(processed/totalValidProfiles*100) : 0}%`);
    console.log(`📊 Total URLs processed: ${totalUrlsProcessed}/${testUrls.length}`);
    console.log(`✓ Results saved to ${OUTPUT_FILE}`);

    // Log Cloudflare statistics
    if (CLOUDFLARE_CONFIG.enableStatsTracking) {
        logCrawlingStats();
    }
}

// Multi-threaded crawler function for better performance
async function crawlProfilesMultiThreaded() {
    const urls = readUrlsFromCsv();
    if (urls.length === 0) {
        console.log('No URLs found to crawl');
        return;
    }

    // CONFIGURATION: Change this for different crawl modes
    // For full production crawl: process all URLs with phone extraction
    const testUrls = urls;
    console.log(`Processing all ${testUrls.length} URLs with AJAX phone extraction`);

    const numThreads = MAX_CONCURRENT_THREADS; // Adjust threads based on URL count
    const urlsPerThread = Math.ceil(testUrls.length / numThreads);

    console.log(`Using ${numThreads} threads, ~${urlsPerThread} URLs per thread`);
    console.log(`Real-time CSV writing to: ${OUTPUT_FILE}`);

    // Initialize shared state for multi-threaded crawling
    initializeSharedState(testUrls.length);

    // Initialize global state with total profiles count
    updateGlobalTotalProfiles(testUrls.length);
    updateGlobalProcessedProfiles(0);

    // Create thread tasks
    const threadTasks = [];
    for (let threadId = 0; threadId < numThreads; threadId++) {
        const startIndex = threadId * urlsPerThread;
        const endIndex = Math.min((threadId + 1) * urlsPerThread, testUrls.length);
        const threadUrls = testUrls.slice(startIndex, endIndex);

        if (threadUrls.length > 0) {
            console.log(`Thread ${threadId + 1}: Will process ${threadUrls.length} URLs (${startIndex + 1}-${endIndex})`);
            threadTasks.push(crawlBatch(threadUrls, threadId + 1));
        }
    }

    console.log(`Created ${threadTasks.length} thread tasks`);

    // Execute all threads concurrently
    try {
        const results = await Promise.all(threadTasks);

        // Combine all results for summary
        let totalProcessed = 0;
        let totalSuccessful = 0;
        let totalDuplicates = 0;
        let totalFailed = 0;

        results.forEach((threadResult, index) => {
            console.log(`Thread ${index + 1} completed: ${threadResult.processed} processed, ${threadResult.successful} written, ${threadResult.duplicates} duplicates, ${threadResult.failed || 0} failed`);
            totalProcessed += threadResult.processed;
            totalSuccessful += threadResult.successful;
            totalDuplicates += threadResult.duplicates;
            totalFailed += threadResult.failed || 0;
        });

        const totalValidProfiles = urls.length - totalFailed;
        const effectiveSuccessRate = totalValidProfiles > 0 ? Math.round(totalProcessed/totalValidProfiles*100) : 0;

        // Final completion check - ensure progress reaches 100%
        const totalUrlsProcessed = totalProcessed + totalFailed;
        checkCrawlingCompletion(totalUrlsProcessed, urls.length);

        console.log(`\n=== Multi-threaded Crawling Summary ===`);
        console.log(`✓ All threads completed`);
        console.log(`✓ Total profiles processed: ${totalProcessed}`);
        console.log(`✓ Successful writes: ${totalSuccessful}`);
        console.log(`✓ Duplicates skipped: ${totalDuplicates}`);
        console.log(`❌ Failed profiles (after ${CLOUDFLARE_CONFIG.maxRetries} retries): ${totalFailed}`);
        console.log(`📊 Effective success rate: ${effectiveSuccessRate}%`);
        console.log(`📊 Total URLs processed: ${totalUrlsProcessed}/${urls.length}`);
        console.log(`✓ Real-time CSV writing completed`);
        console.log(`✓ Results saved to ${OUTPUT_FILE}`);

        // Log comprehensive Cloudflare statistics
        if (CLOUDFLARE_CONFIG.enableStatsTracking) {
            logCrawlingStats();
        }

    } catch (error) {
        console.error('Error in multi-threaded crawl:', error);
        throw error;
    }
}

// Single thread batch crawler
async function crawlBatch(urls, threadId) {
    let browser = null;
    let processed = 0;
    let successful = 0;
    let duplicates = 0;
    let failed = 0;
    let totalValidProfiles = urls.length; // Track the effective total count

    try {
        // Initialize browser for this thread
        const { browser: threadBrowser, useProxy } = await initBrowser();
        browser = threadBrowser;

        const page = await browser.newPage();

        // Set viewport
        await page.setViewport({ width: 1366, height: 768 });

        // Set proxy authentication only if using proxy
        if (useProxy) {
            await page.authenticate({
                username: 'proxybird',
                password: 'proxybird'
            });
        }

        // Set user agent and headers to avoid detection
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
        });

        // Set faster timeouts
        page.setDefaultTimeout(10000);
        page.setDefaultNavigationTimeout(15000);

        console.log(`Thread ${threadId}: Initialized, processing ${urls.length} URLs`);

        for (const url of urls) {
            try {
                const data = await extractProfileDataWithRetry(page, url, useProxy);

                // Only save valid profile data to CSV
                if (data && isValidProfileData(data)) {
                    // Write data to CSV immediately with duplicate checking
                    const writeSuccess = await saveDataToCSVRealtime(data);
                    if (writeSuccess) {
                        processed++; // Only increment when successfully saved to CSV
                        successful++;
                        console.log(`✅ Thread ${threadId}: Valid profile data saved: ${data.nickname}`);

                        // Update global state in real-time (thread-safe)
                        await incrementProcessedProfiles();
                    } else {
                        duplicates++;
                        console.log(`⚠️ Thread ${threadId}: Duplicate profile skipped: ${data.nickname}`);
                    }
                } else {
                    // Check if this is a failed profile after exhausting retries
                    if (data && data.nickname === 'RETRY_EXHAUSTED' && data.status === 'failed_after_retries') {
                        failed++;
                        totalValidProfiles--; // Decrease total count for failed profiles
                        console.log(`❌ Thread ${threadId}: Profile failed after ${CLOUDFLARE_CONFIG.maxRetries} retry attempts: ${url}`);
                        console.log(`   Failed profiles count: ${failed}`);

                        // Update global state in real-time (thread-safe)
                        await decrementTotalValidProfiles();

                        // Log failed profile for debugging
                        logFailedProfile(url, data, threadId);
                    } else {
                        console.log(`❌ Thread ${threadId}: Invalid/incomplete data for ${url} - not saved to CSV`);
                        if (data) {
                            console.log(`   Reason: ${data.nickname || 'No nickname'} - ${data.status || 'Unknown status'}`);
                        }
                    }
                }

                // Show progress with accurate total count (excluding failed profiles)
                const progressPercentage = totalValidProfiles > 0 ? Math.round(processed/totalValidProfiles*100) : 0;
                console.log(`Thread ${threadId}: ${processed}/${totalValidProfiles} (${progressPercentage}%) | ${data?.nickname || 'N/A'} | Written: ${successful} | Duplicates: ${duplicates} | Failed: ${failed}`);

                // Add delay between requests
                if (processed < urls.length) {
                    await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_REQUESTS));
                }

            } catch (error) {
                console.error(`❌ Thread ${threadId}: Failed to process ${url}:`, error.message);
                console.log(`❌ Thread ${threadId}: Failed to process ${url} after all retries - not saved to CSV`);
                failed++;
                totalValidProfiles--; // Decrease total count for failed profiles

                // Update global state in real-time (thread-safe)
                await decrementTotalValidProfiles();
            }
        }

        console.log(`Thread ${threadId}: Completed batch processing`);
        return { processed, successful, duplicates, failed };

    } catch (error) {
        console.error(`Thread ${threadId}: Batch processing error:`, error.message);
        return { processed, successful, duplicates, failed };
    } finally {
        if (browser) {
            await browser.close();
            console.log(`Thread ${threadId}: Browser closed`);
        }
    }
}

// Run the crawler
if (require.main === module) {
    console.log('=== Enhanced Fgirl.ch Profile Crawler Started ===');
    console.log('=== Features: Cloudflare-aware retry logic, Advanced anti-detection, Comprehensive monitoring ===');
    console.log('=== Proxy support, Modal handling, Real-time CSV, Multi-threading ===');

    // Clear the CSV file before starting
    clearDetailGirlsCsv();

    // Display Cloudflare configuration
    console.log('\n🛡️ Cloudflare Protection Configuration:');
    console.log(`   Max Retries: ${CLOUDFLARE_CONFIG.maxRetries}`);
    console.log(`   Base Retry Delay: ${CLOUDFLARE_CONFIG.baseRetryDelay}ms`);
    console.log(`   Anti-Detection: ${CLOUDFLARE_CONFIG.enableAntiDetection ? 'Enabled' : 'Disabled'}`);
    console.log(`   User-Agent Rotation: ${CLOUDFLARE_CONFIG.rotateUserAgent ? 'Enabled' : 'Disabled'}`);
    console.log(`   Statistics Tracking: ${CLOUDFLARE_CONFIG.enableStatsTracking ? 'Enabled' : 'Disabled'}`);
    console.log('');

    // Choose between single-threaded or multi-threaded mode
    const useMultiThreaded = true; // Set to false for single-threaded mode

    if (useMultiThreaded) {
        crawlProfilesMultiThreaded().catch(console.error);
    } else {
        crawlProfiles().catch(console.error);
    }
}

// ===== ENHANCED LOGGING AND MONITORING =====

/**
 * Logs a failed profile for debugging purposes
 * @param {string} url - The URL that failed
 * @param {Object} data - The failed profile data
 * @param {string} threadId - Thread identifier (optional)
 */
function logFailedProfile(url, data, threadId = '') {
    const timestamp = new Date().toISOString();
    const prefix = threadId ? `Thread ${threadId}: ` : '';

    console.log(`\n${prefix}🚨 FAILED PROFILE DEBUG INFO - ${timestamp}`);
    console.log(`URL: ${url}`);
    console.log(`Last Error: ${data.lastError || 'Unknown error'}`);

    if (data.lastDetection) {
        console.log(`Block Type: ${data.lastDetection.blockType || 'Unknown'}`);
        console.log(`Confidence: ${data.lastDetection.confidence || 'N/A'}`);
        if (data.lastDetection.indicators && data.lastDetection.indicators.length > 0) {
            console.log(`Indicators: ${data.lastDetection.indicators.join(', ')}`);
        }
    }
    console.log(`Max Retries Attempted: ${CLOUDFLARE_CONFIG.maxRetries}`);
    console.log('─'.repeat(50));
}

/**
 * Logs comprehensive statistics about the crawling session
 */
function logCrawlingStats() {
    const stats = cloudflareHandler.getStats();
    console.log('\n' + '='.repeat(60));
    console.log('📊 CRAWLING SESSION STATISTICS');
    console.log('='.repeat(60));
    console.log(`🔢 Total Requests: ${stats.totalRequests}`);
    console.log(`🚫 Blocked Requests: ${stats.blockedRequests}`);
    console.log(`📈 Blocking Rate: ${stats.blockingRate}`);
    console.log(`✅ Successful Retries: ${stats.successfulRetries}`);
    console.log(`❌ Failed Retries: ${stats.failedRetries}`);
    console.log(`🎯 Retry Success Rate: ${stats.retrySuccessRate}`);
    console.log('='.repeat(60));

    if (CLOUDFLARE_CONFIG.enableDetailedLogging) {
        console.log('📋 Configuration Used:');
        console.log(`   Max Retries: ${CLOUDFLARE_CONFIG.maxRetries}`);
        console.log(`   Base Retry Delay: ${CLOUDFLARE_CONFIG.baseRetryDelay}ms`);
        console.log(`   Anti-Detection: ${CLOUDFLARE_CONFIG.enableAntiDetection ? 'Enabled' : 'Disabled'}`);
        console.log(`   User-Agent Rotation: ${CLOUDFLARE_CONFIG.rotateUserAgent ? 'Enabled' : 'Disabled'}`);
        console.log(`   Detection Threshold: ${CLOUDFLARE_CONFIG.blockingDetectionThreshold}`);
        console.log('='.repeat(60));
    }
}

// Web interface compatible function
async function runGirlsCrawlerForWeb() {
    console.log('=== Fgirl Girls Crawler Started (Web Interface) ===');
    console.log('=== Multi-threaded Profile Crawling ===');
    console.log('=== Processing URLs from list-girl.csv ===');

    // Clear the CSV file before starting
    clearDetailGirlsCsv();

    try {
        const path = require('path');
        const listGirlPath = path.resolve('list-girl.csv');

        // Check if list-girl.csv exists
        if (!fs.existsSync(listGirlPath)) {
            throw new Error('list-girl.csv not found. Please run the categories crawler first.');
        }

        // Count total URLs to process using memory-efficient method
        const totalUrls = countCSVLines(listGirlPath);
        console.log(`📊 Found ${totalUrls} URLs to process in list-girl.csv`);

        const startTime = Date.now();
        console.log(`\n🚀 Starting girls crawler for web interface...`);

        // Run the multi-threaded crawler
        const results = await crawlProfilesMultiThreaded();

        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(2);

        console.log(`\n✅ Girls crawler completed in ${duration} seconds`);
        console.log(`📁 Results saved to: ${OUTPUT_FILE}`);

        return {
            success: true,
            duration: duration,
            totalUrls: totalUrls,
            results: results
        };

    } catch (error) {
        console.error(`Error in web girls crawler:`, error);
        throw error;
    }
}

// Enhanced module exports with new Cloudflare-aware functions
module.exports = {
    // Main crawler functions
    crawlProfiles,
    crawlProfilesMultiThreaded,
    runGirlsCrawlerForWeb,

    // Data extraction functions
    extractProfileData: extractProfileDataWithRetry, // Use the retry-enabled version as default
    extractProfileDataCore, // Core function without retry logic
    extractProfileDataWithRetry, // Explicit retry-enabled function

    // Utility functions
    saveDataToCSVRealtime,
    logCrawlingStats,
    logFailedProfile, // Failed profile logging function
    isValidProfileData, // Data validation function
    determineBlockType, // Block type detection function
    clearDetailGirlsCsv, // CSV clearing function
    countCSVLines, // Memory-efficient CSV line counting

    // Real-time state management functions
    initializeGlobalState, // Initialize global state reference
    updateGlobalTotalProfiles, // Update total profiles count
    updateGlobalProcessedProfiles, // Update processed profiles count
    incrementProcessedProfiles, // Thread-safe increment processed
    decrementTotalValidProfiles, // Thread-safe decrement total
    initializeSharedState, // Initialize shared state for multi-threading
    checkCrawlingCompletion, // Check and set 100% completion

    // Cloudflare handling
    cloudflareHandler,
    CLOUDFLARE_CONFIG
};
