const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const { HttpsProxyAgent } = require('https-proxy-agent');

// Configuration
const PROXY_URL = 'http://proxybird:proxybird@155.254.39.107:6065';
const START_URL = 'https://www.en.fgirl.ch/filles/?page=1';
const OUTPUT_FILE = 'list-girl.csv';
const DELAY_BETWEEN_REQUESTS = 100; // 100ms delay for speed
let totalPagesGirl = 125; // Total number of pages to crawl (will be updated dynamically)
let totalGirlsExpected = 0; // Total number of girls expected (will be fetched dynamically)
const numThreadsForGirl = 10; // Number of concurrent threads

// Global shared state for all crawler threads
const globalCrawlState = {
    totalGirlsCrawled: 0,
    crawlLock: false
};

// CSV Writer setup
const csvWriter = createCsvWriter({
    path: OUTPUT_FILE,
    header: [
        { id: 'name', title: 'Name' },
        { id: 'location', title: 'Location' },
        { id: 'profile_url', title: 'Profile URL' }
    ]
});

class FgirlCategoryCrawler {
    constructor() {
        this.browser = null;
        this.page = null;
        this.crawledData = [];
        this.visitedPages = new Set();
        this.useProxy = true; // Track if we're using proxy
        this.csvHeaderWritten = false; // Track if CSV header is written
        this.csvWriteLock = false; // Thread-safe CSV writing lock
    }

    async init() {
        console.log('Initializing browser with proxy...');

        // Check for Chrome executable paths (Linux-first, cross-platform)
        const fs = require('fs');
        const os = require('os');
        const platform = os.platform();

        // Prioritize Linux paths for production deployment
        const chromePaths = [
            // Linux paths (prioritized for production)
            '/usr/bin/google-chrome-stable',
            '/usr/bin/google-chrome',
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium',
            '/snap/bin/chromium',
            '/opt/google/chrome/chrome',
            '/opt/google/chrome/google-chrome',
            '/usr/local/bin/google-chrome',
            '/usr/local/bin/chromium',
            '/usr/local/bin/chromium-browser',
            // macOS paths (for development)
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
            // Windows paths (for completeness)
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
        ];

        let executablePath = null;
        console.log(`Detecting Chrome on platform: ${platform}`);

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
            console.log('For Linux servers, consider installing: sudo apt-get install google-chrome-stable');
        }
        
        // Linux-optimized browser configurations for headless operation
        const configurations = [
            {
                name: 'linux-headless-proxy',
                config: {
                    headless: "new",
                    args: [
                        // Essential Linux headless arguments
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-gpu',
                        '--disable-software-rasterizer',
                        '--disable-background-timer-throttling',
                        '--disable-backgrounding-occluded-windows',
                        '--disable-renderer-backgrounding',
                        '--disable-features=TranslateUI',
                        '--disable-ipc-flooding-protection',
                        // Memory and performance optimizations for Linux servers
                        '--memory-pressure-off',
                        '--max_old_space_size=4096',
                        '--no-zygote',
                        '--single-process',
                        // Display and font handling for headless Linux
                        '--disable-extensions',
                        '--disable-plugins',
                        '--disable-images',
                        '--disable-javascript',
                        '--virtual-time-budget=5000',
                        // Proxy configuration
                        '--proxy-server=155.254.39.107:6065',
                        // Additional Linux-specific stability arguments
                        '--disable-features=VizDisplayCompositor',
                        '--disable-features=AudioServiceOutOfProcess',
                        '--disable-features=VizServiceDisplayCompositor',
                        '--disable-crash-reporter',
                        '--disable-logging',
                        '--disable-permissions-api',
                        '--disable-web-security',
                        '--allow-running-insecure-content'
                    ],
                    timeout: 10000
                }
            },
            {
                name: 'linux-headless-no-proxy',
                config: {
                    headless: "new",
                    args: [
                        // Essential Linux headless arguments
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-gpu',
                        '--disable-software-rasterizer',
                        '--disable-background-timer-throttling',
                        '--disable-backgrounding-occluded-windows',
                        '--disable-renderer-backgrounding',
                        '--disable-features=TranslateUI',
                        '--disable-ipc-flooding-protection',
                        // Memory and performance optimizations for Linux servers
                        '--memory-pressure-off',
                        '--max_old_space_size=4096',
                        '--no-zygote',
                        '--single-process',
                        // Display and font handling for headless Linux
                        '--disable-extensions',
                        '--disable-plugins',
                        '--disable-images',
                        '--disable-javascript',
                        '--virtual-time-budget=5000',
                        // Additional Linux-specific stability arguments
                        '--disable-features=VizDisplayCompositor',
                        '--disable-features=AudioServiceOutOfProcess',
                        '--disable-features=VizServiceDisplayCompositor',
                        '--disable-crash-reporter',
                        '--disable-logging',
                        '--disable-permissions-api'
                    ],
                    timeout: 10000
                }
            },
            {
                name: 'fallback-minimal',
                config: {
                    headless: "new",
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage'
                    ],
                    timeout: 5000
                }
            }
        ];

        let browserLaunched = false;

        for (const { name, config } of configurations) {
            try {
                console.log(`Trying browser configuration: ${name}`);
                
                // Add executable path if found
                const launchConfig = { ...config };
                if (executablePath) {
                    launchConfig.executablePath = executablePath;
                }
                
                this.browser = await puppeteer.launch(launchConfig);
                browserLaunched = true;
                this.useProxy = name.includes('proxy');
                console.log(`Browser launched successfully with: ${name}`);
                break;
            } catch (error) {
                console.log(`Failed to launch browser with ${name}:`, error.message);
                
                // Try without custom executable path if that was the issue
                if (executablePath && error.message.includes('spawn')) {
                    try {
                        console.log(`Retrying ${name} without custom executable path...`);
                        this.browser = await puppeteer.launch(config);
                        browserLaunched = true;
                        this.useProxy = name.includes('proxy');
                        console.log(`Browser launched successfully with: ${name} (bundled Chromium)`);
                        break;
                    } catch (retryError) {
                        console.log(`Retry also failed: ${retryError.message}`);
                    }
                }
                
                if (this.browser) {
                    try {
                        await this.browser.close();
                    } catch (e) {}
                    this.browser = null;
                }
            }
        }

        if (!browserLaunched) {
            throw new Error('Failed to launch browser with any configuration');
        }

        this.page = await this.browser.newPage();
        
        // Set viewport
        await this.page.setViewport({ width: 1366, height: 768 });
        
        // Set proxy authentication only if using proxy
        if (this.useProxy) {
            await this.page.authenticate({
                username: 'proxybird',
                password: 'proxybird'
            });
            console.log('Proxy authentication set');
        } else {
            console.log('Running without proxy - direct connection');
        }
        
        // Set user agent to avoid detection
        await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // Set faster timeouts
        this.page.setDefaultTimeout(10000);
        this.page.setDefaultNavigationTimeout(15000);
        
        console.log('Browser initialized successfully');
    }

    async checkTotalGirls() {
        try {
            console.log('Checking total number of girls from homepage...');

            // Navigate to homepage to get total girls count
            await this.page.goto('https://www.en.fgirl.ch/', {
                waitUntil: 'domcontentloaded',
                timeout: 15000
            });

            await this.page.waitForTimeout(1000);

            // Extract total girls count from the card
            const totalGirls = await this.page.evaluate(() => {
                // Look for the card with "Girls" text
                const cardBodies = document.querySelectorAll('.card-body');
                for (const cardBody of cardBodies) {
                    const cardTitle = cardBody.querySelector('.card-title');
                    if (cardTitle && cardTitle.textContent.includes('Girls')) {
                        const span = cardTitle.querySelector('span');
                        if (span) {
                            const numberText = span.textContent.trim().replace(/,/g, '');
                            const number = parseInt(numberText);
                            if (!isNaN(number)) {
                                return number;
                            }
                        }
                    }
                }
                return 0;
            });

            if (totalGirls > 0) {
                console.log(`✓ Total girls found on website: ${totalGirls.toLocaleString()}`);
                return totalGirls;
            } else {
                console.log('⚠️ Could not extract total girls count, using default');
                return 2000; // Fallback default
            }

        } catch (error) {
            console.error('Error checking total girls:', error.message);
            return 2000; // Fallback default
        }
    }

    async checkTotalPages() {
        try {
            console.log('Checking total number of pages from girls listing...');

            // Navigate to girls listing page to get total pages
            await this.page.goto('https://www.en.fgirl.ch/filles/', {
                waitUntil: 'domcontentloaded',
                timeout: 15000
            });

            await this.page.waitForTimeout(1000);

            // Extract total pages from pagination
            const totalPages = await this.page.evaluate(() => {
                // Look for pagination links
                const paginationLinks = document.querySelectorAll('.pagination a[href*="page="]');
                let maxPage = 0;

                for (const link of paginationLinks) {
                    const href = link.getAttribute('href');
                    if (href) {
                        const pageMatch = href.match(/page=(\d+)/);
                        if (pageMatch) {
                            const pageNum = parseInt(pageMatch[1]);
                            if (pageNum > maxPage) {
                                maxPage = pageNum;
                            }
                        }
                    }
                }

                // Also check for direct page number text in pagination
                const pageItems = document.querySelectorAll('.pagination .page-item');
                for (const item of pageItems) {
                    const link = item.querySelector('a');
                    if (link) {
                        const text = link.textContent.trim();
                        const pageNum = parseInt(text);
                        if (!isNaN(pageNum) && pageNum > maxPage) {
                            maxPage = pageNum;
                        }
                    }
                }

                return maxPage;
            });

            if (totalPages > 0) {
                console.log(`✓ Total pages found: ${totalPages}`);
                return totalPages;
            } else {
                console.log('⚠️ Could not extract total pages, using default');
                return 125; // Fallback default
            }

        } catch (error) {
            console.error('Error checking total pages:', error.message);
            return 125; // Fallback default
        }
    }

    async dismissModals() {
        try {
            // Quick check for modals
            await this.page.waitForTimeout(200);
            
            // Check if modals exist using JavaScript evaluation
            const modalInfo = await this.page.evaluate(() => {
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
                await this.page.evaluate(() => {
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
                await this.page.waitForTimeout(100);
            }

        } catch (error) {
            console.log('Modal dismissal completed with minor issues:', error.message);
        }
    }

    async extractProfileLinks(url) {
        let retryCount = 0;
        const maxRetries = 2; // Reduced retries for speed
        
        while (retryCount < maxRetries) {
            try {
                console.log(`Extracting profile links from: ${url} (attempt ${retryCount + 1})`);
                
                // Create a new page for each request to avoid session issues
                if (retryCount > 0) {
                    try {
                        if (!this.page.isClosed()) {
                            await this.page.close();
                        }
                    } catch (e) {
                        // Page might already be closed
                    }
                    
                    this.page = await this.browser.newPage();
                    
                    // Set viewport
                    await this.page.setViewport({ width: 1366, height: 768 });
                    
                    // Set proxy authentication only if using proxy
                    if (this.useProxy) {
                        await this.page.authenticate({
                            username: 'proxybird',
                            password: 'proxybird'
                        });
                    }
                    
                    // Set user agent
                    await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
                    
                    // Set faster timeouts
                    this.page.setDefaultTimeout(10000);
                    this.page.setDefaultNavigationTimeout(15000);
                }
                
                // Add extra headers to appear more like a regular browser
                await this.page.setExtraHTTPHeaders({
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
                });

                // Fast navigation with single strategy
                await this.page.goto(url, { 
                    waitUntil: 'domcontentloaded',
                    timeout: 15000 
                });

                // Quick page stabilization
                await this.page.waitForTimeout(500);

                // Check if page is still accessible
                const isPageClosed = this.page.isClosed();
                if (isPageClosed) {
                    throw new Error('Page was closed during navigation');
                }

                // Close any modal dialogs that might be blocking the page
                await this.dismissModals();

                // Quick content check
                try {
                    await this.page.waitForSelector('.profile-card', { timeout: 3000 });
                } catch (selectorError) {
                    // Try body as fallback
                    await this.page.waitForSelector('body', { timeout: 2000 });
                }

                const html = await this.page.content();
                const $ = cheerio.load(html);

                // Extract profile links from .profile-card elements
                const profileLinks = [];
                $('.profile-card').each((index, element) => {
                    const $card = $(element);
                    
                    // Extract name from .card-title
                    const nameElement = $card.find('.card-title');
                    const name = nameElement.text().trim() || 'N/A';
                    
                    // Extract location with multiple strategies
                    let location = 'N/A';
                    
                    // Strategy 1: Look for location in card text with common patterns
                    const cardText = $card.text();
                    const locationPatterns = [
                        /in\s+([^,\n\r]+)/i,
                        /from\s+([^,\n\r]+)/i,
                        /\b(Geneva|Zurich|Basel|Bern|Lausanne|Lucerne|St\. Gallen|Winterthur|Thun|Fribourg|Neuchâtel|Schaffhausen|Chur|Aarau|Solothurn|Zug|Bellinzona|Sion|Lugano|Baden|Wetzikon|Rapperswil|Kreuzlingen)\b/i
                    ];
                    
                    for (const pattern of locationPatterns) {
                        const match = cardText.match(pattern);
                        if (match) {
                            location = match[1] || match[0];
                            location = location.trim().replace(/[,\.]$/, ''); // Clean up trailing punctuation
                            break;
                        }
                    }
                    
                    // Strategy 2: Look in specific elements like .card-text, .text-muted, etc.
                    if (location === 'N/A') {
                        const locationElements = $card.find('.card-text, .text-muted, .small, p, span');
                        locationElements.each((i, el) => {
                            const text = $(el).text().trim();
                            for (const pattern of locationPatterns) {
                                const match = text.match(pattern);
                                if (match) {
                                    location = match[1] || match[0];
                                    location = location.trim().replace(/[,\.]$/, '');
                                    return false; // break loop
                                }
                            }
                        });
                    }
                    
                    // Extract profile URL from a.image-hover or any link within the card
                    const linkElement = $card.find('a.image-hover').first();
                    let profileUrl = 'N/A';
                    if (linkElement.length > 0) {
                        const href = linkElement.attr('href');
                        if (href) {
                            profileUrl = href.startsWith('/') ? `https://www.en.fgirl.ch${href}` : href;
                        }
                    } else {
                        // Fallback: look for any link in the card
                        const anyLink = $card.find('a[href*="/filles/"]').first();
                        if (anyLink.length > 0) {
                            const href = anyLink.attr('href');
                            if (href) {
                                profileUrl = href.startsWith('/') ? `https://www.en.fgirl.ch${href}` : href;
                            }
                        }
                    }
                    
                    if (name !== 'N/A' && profileUrl !== 'N/A') {
                        profileLinks.push({
                            name: name,
                            location: location,
                            profile_url: profileUrl
                        });
                    }
                });

                console.log(`Extracted ${profileLinks.length} profile links from current page`);

                // Check if we should stop crawling based on CSV file count
                if (totalGirlsExpected > 0) {
                    // Thread-safe update of crawled count using global state
                    while (globalCrawlState.crawlLock) {
                        await new Promise(resolve => setTimeout(resolve, 10));
                    }
                    globalCrawlState.crawlLock = true;

                    // Get current count from CSV file
                    const currentCSVCount = this.getCurrentCSVCount();
                    const newTotal = currentCSVCount + profileLinks.length;

                    if (newTotal >= totalGirlsExpected) {
                        // We've reached or exceeded the target, only take what we need
                        const remainingNeeded = totalGirlsExpected - currentCSVCount;
                        if (remainingNeeded > 0) {
                            const limitedLinks = profileLinks.slice(0, remainingNeeded);
                            globalCrawlState.crawlLock = false;

                            console.log(`🎯 Target reached! Taking only ${limitedLinks.length} girls to reach total of ${totalGirlsExpected} in CSV`);

                            // Write limited profile links to CSV
                            if (limitedLinks.length > 0) {
                                await this.saveLinksToCSVRealtime(limitedLinks);
                            }

                            return limitedLinks;
                        } else {
                            globalCrawlState.crawlLock = false;
                            console.log(`🎯 Target already reached! CSV has ${currentCSVCount} girls, skipping this page.`);
                            return [];
                        }
                    } else {
                        globalCrawlState.crawlLock = false;
                        console.log(`📊 Progress: ${currentCSVCount}/${totalGirlsExpected} girls in CSV (adding ${profileLinks.length} more)`);
                    }
                }

                // Write profile links to CSV immediately with thread-safe operation
                if (profileLinks.length > 0) {
                    await this.saveLinksToCSVRealtime(profileLinks);
                }

                return profileLinks;

            } catch (error) {
                retryCount++;
                console.error(`Error extracting profile links from ${url} (attempt ${retryCount}):`, error.message);
                
                if (retryCount >= maxRetries) {
                    console.error(`Failed to extract profile links after ${maxRetries} attempts`);
                    return [];
                }
                
                // Quick retry delay
                await new Promise(resolve => setTimeout(resolve, 500 * retryCount));
            }
        }
        
        return [];
    }

    async findNextPageUrl() {
        try {
            // Check if page is still accessible
            if (this.page.isClosed()) {
                console.error('Page is closed, cannot find next page URL');
                return null;
            }

            // Get current page number from URL
            const currentPageMatch = this.page.url().match(/page=(\d+)/);
            if (!currentPageMatch) {
                console.log('Could not determine current page number');
                return null;
            }
            
            const currentPage = parseInt(currentPageMatch[1]);
            console.log(`Current page: ${currentPage}`);
            
            // Check if we have profile cards on current page (if no cards, we've reached the end)
            const profileCardCount = await this.page.evaluate(() => {
                return document.querySelectorAll('.profile-card').length;
            });
            
            if (profileCardCount === 0) {
                console.log('No profile cards found on current page - reached end');
                return null;
            }
            
            // Look for next page link in pagination
            const nextPageUrl = await this.page.evaluate(() => {
                // Look for active pagination link that points to next page
                const paginationLinks = document.querySelectorAll('.pagination a[href*="page="]');
                const currentUrl = window.location.href;
                const currentPageMatch = currentUrl.match(/page=(\d+)/);
                
                if (!currentPageMatch) return null;
                
                const currentPage = parseInt(currentPageMatch[1]);
                const nextPage = currentPage + 1;
                
                // Find link that goes to next page
                for (const link of paginationLinks) {
                    const href = link.getAttribute('href');
                    if (href && href.includes(`page=${nextPage}`)) {
                        return href.startsWith('/') ? `https://www.en.fgirl.ch${href}` : href;
                    }
                }
                
                return null;
            });
            
            if (nextPageUrl) {
                console.log(`Found next page URL: ${nextPageUrl}`);
                return nextPageUrl;
            }
            
            // Fallback: construct next page URL if pagination link wasn't found
            const nextPage = currentPage + 1;
            if (nextPage <= 125) { // Based on categories.html showing pages up to 125
                const nextUrl = this.page.url().replace(/page=\d+/, `page=${nextPage}`);
                console.log(`Constructed next page URL: ${nextUrl}`);
                return nextUrl;
            }
            
            console.log('Reached maximum page limit or no more pages available');
            return null;
            
        } catch (error) {
            console.error('Error finding next page URL:', error.message);
            return null;
        }
    }

    async crawlPage(pageNumber) {
        try {
            // Check if we've already reached the target before processing this page
            const currentCSVCount = this.getCurrentCSVCount();
            if (totalGirlsExpected > 0 && currentCSVCount >= totalGirlsExpected) {
                console.log(`Thread ${pageNumber}: Target already reached (${currentCSVCount}/${totalGirlsExpected} in CSV), skipping page ${pageNumber}`);
                return [];
            }

            const url = `https://www.en.fgirl.ch/filles/?page=${pageNumber}`;
            console.log(`Thread ${pageNumber}: Starting crawl of page ${pageNumber}`);

            // Extract profile links from page
            const profileLinks = await this.extractProfileLinks(url);

            if (profileLinks.length > 0) {
                // Store in memory for summary purposes
                this.crawledData.push(...profileLinks);
                console.log(`Thread ${pageNumber}: Found ${profileLinks.length} profile links on page ${pageNumber} (written to CSV in real-time)`);
                return profileLinks;
            } else {
                console.log(`Thread ${pageNumber}: No profile links found on page ${pageNumber}`);
                return [];
            }

        } catch (error) {
            console.error(`Thread ${pageNumber}: Error crawling page ${pageNumber}:`, error.message);
            return [];
        }
    }

    async crawlBatch(startPage, endPage, threadId) {
        try {
            await this.init();
            console.log(`Thread ${threadId}: Initialized, crawling pages ${startPage}-${endPage}`);

            const batchResults = [];
            for (let page = startPage; page <= endPage; page++) {
                // Check if target is reached before processing each page
                const currentCSVCount = this.getCurrentCSVCount();
                if (totalGirlsExpected > 0 && currentCSVCount >= totalGirlsExpected) {
                    console.log(`Thread ${threadId}: Target reached (${currentCSVCount}/${totalGirlsExpected} in CSV), stopping batch early at page ${page}`);
                    break;
                }

                const profileLinks = await this.crawlPage(page);
                if (profileLinks.length > 0) {
                    batchResults.push(...profileLinks);
                }

                // Check again after processing the page
                const updatedCSVCount = this.getCurrentCSVCount();
                if (totalGirlsExpected > 0 && updatedCSVCount >= totalGirlsExpected) {
                    console.log(`Thread ${threadId}: Target reached after page ${page} (${updatedCSVCount}/${totalGirlsExpected} in CSV), stopping batch`);
                    break;
                }

                // Add delay between requests in the same thread
                if (page < endPage) {
                    await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_REQUESTS));
                }
            }

            console.log(`Thread ${threadId}: Completed batch ${startPage}-${endPage}, found ${batchResults.length} total links`);
            return batchResults;

        } catch (error) {
            console.error(`Thread ${threadId}: Batch crawling error:`, error.message);
            return [];
        } finally {
            await this.cleanup();
        }
    }

    async saveLinksToCSVRealtime(profileLinks) {
        // Wait for any existing write operation to complete (thread-safe)
        while (this.csvWriteLock) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        
        this.csvWriteLock = true;
        
        try {
            const fs = require('fs');
            
            // Check if CSV file exists and has content
            const fileExists = fs.existsSync(OUTPUT_FILE);
            let needsHeader = !fileExists;
            
            if (fileExists) {
                const stats = fs.statSync(OUTPUT_FILE);
                needsHeader = stats.size === 0;
            }
            
            if (needsHeader) {
                // Write header first
                const headerLine = 'Name,Location,Profile URL\n';
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
                            // Extract URL from CSV line (last column)
                            const columns = line.split(',');
                            if (columns.length >= 3) {
                                const url = columns[columns.length - 1].trim();
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
            
            // Filter out duplicate profile links
            const uniqueLinks = profileLinks.filter(link => {
                const isDuplicate = existingUrls.has(link.profile_url);
                if (isDuplicate) {
                    console.log(`⚠️  Skipping duplicate URL: ${link.profile_url}`);
                }
                return !isDuplicate;
            });
            
            if (uniqueLinks.length === 0) {
                console.log(`✓ All ${profileLinks.length} profile links were duplicates - nothing to add`);
                return;
            }
            
            // Append only unique profile links
            const csvLines = uniqueLinks.map(link => {
                return [
                    `"${link.name.replace(/"/g, '""')}"`, // Escape quotes properly
                    `"${link.location.replace(/"/g, '""')}"`,
                    link.profile_url
                ].join(',');
            }).join('\n') + '\n';
            
            fs.appendFileSync(OUTPUT_FILE, csvLines);
            
            const duplicateCount = profileLinks.length - uniqueLinks.length;
            if (duplicateCount > 0) {
                console.log(`✓ Real-time: ${uniqueLinks.length} unique profile links appended to ${OUTPUT_FILE} (${duplicateCount} duplicates skipped)`);
            } else {
                console.log(`✓ Real-time: ${uniqueLinks.length} profile links appended to ${OUTPUT_FILE}`);
            }
            
        } catch (error) {
            console.error('Error in real-time CSV writing:', error);
        } finally {
            this.csvWriteLock = false;
        }
    }
    
    async saveLinksToCSV(profileLinks) {
        try {
            if (!this.csvHeaderWritten) {
                // Write header and first batch of records
                await csvWriter.writeRecords(profileLinks);
                this.csvHeaderWritten = true;
                console.log(`CSV initialized with header and ${profileLinks.length} records saved to ${OUTPUT_FILE}`);
            } else {
                // Append records without header
                const fs = require('fs');
                const csvLines = profileLinks.map(link => {
                    return [
                        `"${link.name}"`,
                        `"${link.location}"`,
                        link.profile_url
                    ].join(',');
                }).join('\n') + '\n';
                
                fs.appendFileSync(OUTPUT_FILE, csvLines);
                console.log(`${profileLinks.length} profile links appended to ${OUTPUT_FILE}`);
            }
        } catch (error) {
            console.error('Error saving profile links to CSV:', error);
        }
    }

    async saveAllLinksToCSV(allProfileLinks) {
        try {
            // Remove duplicates based on profile_url
            const uniqueLinks = [];
            const seenUrls = new Set();
            
            for (const link of allProfileLinks) {
                if (!seenUrls.has(link.profile_url)) {
                    seenUrls.add(link.profile_url);
                    uniqueLinks.push(link);
                }
            }
            
            console.log(`Total unique profile links: ${uniqueLinks.length} (removed ${allProfileLinks.length - uniqueLinks.length} duplicates)`);
            
            if (uniqueLinks.length > 0) {
                // Clear existing file and write unique records
                const fs = require('fs');
                if (fs.existsSync(OUTPUT_FILE)) {
                    fs.unlinkSync(OUTPUT_FILE);
                    console.log(`Cleared existing ${OUTPUT_FILE}`);
                }
                await csvWriter.writeRecords(uniqueLinks);
                console.log(`All ${uniqueLinks.length} unique profile links saved to ${OUTPUT_FILE}`);
            }
        } catch (error) {
            console.error('Error saving all links to CSV:', error);
        }
    }

    // Helper function to get current count from CSV file
    getCurrentCSVCount() {
        try {
            const fs = require('fs');
            if (fs.existsSync(OUTPUT_FILE)) {
                const existingContent = fs.readFileSync(OUTPUT_FILE, 'utf8');
                const existingLines = existingContent.split('\n').filter(line => line.trim() !== '');
                return existingLines.length - 1; // Subtract header
            }
            return 0;
        } catch (error) {
            console.error('Error reading CSV count:', error);
            return 0;
        }
    }

    async multiThreadedCrawlRealtime() {
        console.log('Starting real-time multi-threaded crawl with fixed target of 1919 girls');

        // First, check the actual total pages from the website
        await this.init();

        console.log('🔍 Checking website for total pages...');
        totalPagesGirl = await this.checkTotalPages();

        // Set fixed target to 1919 girls (from the original CSV)
        totalGirlsExpected = 1919;

        // Get current count from CSV file
        const currentCSVCount = this.getCurrentCSVCount();

        console.log(`🎯 Fixed Target: ${totalGirlsExpected.toLocaleString()} girls across ${totalPagesGirl} pages`);
        console.log(`📊 Current CSV count: ${currentCSVCount} girls`);

        await this.cleanup(); // Clean up the initial browser instance

        const totalPages = totalPagesGirl;
        const numThreads = numThreadsForGirl;
        const pagesPerThread = Math.ceil(totalPages / numThreads);

        console.log(`Pages per thread: ${pagesPerThread}`);
        console.log('Real-time CSV writing: Data will be written as each page is processed');
        console.log(`🛑 Crawling will stop when ${totalGirlsExpected.toLocaleString()} girls are reached in CSV file`);

        // Check if target is already reached before starting threads
        if (currentCSVCount >= totalGirlsExpected) {
            console.log(`🎯 Target already reached! ${currentCSVCount}/${totalGirlsExpected} girls in CSV file.`);
            console.log(`✅ No crawling needed. Returning existing data.`);
            return [];
        }

        // Set global state to current CSV count
        globalCrawlState.totalGirlsCrawled = currentCSVCount;

        // Reset global state for this crawl session (unless continuing from existing data)
        if (globalCrawlState.totalGirlsCrawled === 0) {
            globalCrawlState.totalGirlsCrawled = 0;
        }
        globalCrawlState.crawlLock = false;

        // Create thread tasks
        const threadTasks = [];
        for (let threadId = 0; threadId < numThreads; threadId++) {
            const startPage = threadId * pagesPerThread + 1;
            const endPage = Math.min((threadId + 1) * pagesPerThread, totalPages);

            if (startPage <= totalPages) {
                console.log(`Thread ${threadId + 1}: Will crawl pages ${startPage}-${endPage}`);

                // Create a new crawler instance for each thread
                const threadCrawler = new FgirlCategoryCrawler();
                threadTasks.push(threadCrawler.crawlBatch(startPage, endPage, threadId + 1));
            }
        }

        console.log(`Created ${threadTasks.length} thread tasks`);

        // Execute all threads concurrently
        try {
            const results = await Promise.all(threadTasks);

            // Combine all results for summary
            const allProfileLinks = [];
            let totalCrawled = 0;
            results.forEach((threadResults, index) => {
                console.log(`Thread ${index + 1} completed with ${threadResults.length} profile links`);
                allProfileLinks.push(...threadResults);
                totalCrawled += threadResults.length;
            });

            console.log(`All threads completed. Total profile links collected: ${allProfileLinks.length}`);
            console.log(`🎯 Target status: ${globalCrawlState.totalGirlsCrawled}/${totalGirlsExpected.toLocaleString()} girls crawled`);
            console.log('✓ Real-time CSV writing completed - all data written during crawling');

            return allProfileLinks;

        } catch (error) {
            console.error('Error in real-time multi-threaded crawl:', error);
            throw error;
        }
    }
    
    async multiThreadedCrawl() {
        console.log('Starting multi-threaded crawl with 10 threads for pages 1-125');
        
        const totalPages = 125;
        const numThreads = 10; // Increased concurrency
        const pagesPerThread = Math.ceil(totalPages / numThreads);
        
        console.log(`Pages per thread: ${pagesPerThread}`);
        
        // Create thread tasks
        const threadTasks = [];
        for (let threadId = 0; threadId < numThreads; threadId++) {
            const startPage = threadId * pagesPerThread + 1;
            const endPage = Math.min((threadId + 1) * pagesPerThread, totalPages);
            
            if (startPage <= totalPages) {
                console.log(`Thread ${threadId + 1}: Will crawl pages ${startPage}-${endPage}`);
                
                // Create a new crawler instance for each thread
                const threadCrawler = new FgirlCategoryCrawler();
                threadTasks.push(threadCrawler.crawlBatch(startPage, endPage, threadId + 1));
            }
        }
        
        console.log(`Created ${threadTasks.length} thread tasks`);
        
        // Execute all threads concurrently
        try {
            const results = await Promise.all(threadTasks);
            
            // Combine all results
            const allProfileLinks = [];
            results.forEach((threadResults, index) => {
                console.log(`Thread ${index + 1} completed with ${threadResults.length} profile links`);
                allProfileLinks.push(...threadResults);
            });
            
            console.log(`All threads completed. Total profile links collected: ${allProfileLinks.length}`);
            
            // Save all results to CSV with duplicate removal
            await this.saveAllLinksToCSV(allProfileLinks);
            
            return allProfileLinks;
            
        } catch (error) {
            console.error('Error in multi-threaded crawl:', error);
            throw error;
        }
    }

    async saveToCSV() {
        try {
            if (this.crawledData.length > 0 && !this.csvHeaderWritten) {
                await csvWriter.writeRecords(this.crawledData);
                console.log(`Data saved to ${OUTPUT_FILE}`);
                console.log(`Total records: ${this.crawledData.length}`);
            } else {
                console.log(`CSV already written during crawling. Total records: ${this.crawledData.length}`);
            }
        } catch (error) {
            console.error('Error saving to CSV:', error);
        }
    }

    async cleanup() {
        if (this.browser) {
            await this.browser.close();
            console.log('Browser closed');
        }
    }
}

// Start the crawler
async function main() {
    console.log('=== Fgirl Category Crawler Started ===');
    console.log('=== Multi-threaded Mode with Real-time CSV Writing ===');
    console.log('=== Fixed Target: 1919 girls total in CSV file ===');
    console.log('=== 10 threads with intelligent stopping when target reached ===');
    console.log('=== Continuous Loop Mode - Will restart after completion ===');
    
    const crawler = new FgirlCategoryCrawler();
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\nReceived SIGINT, shutting down gracefully...');
        await crawler.cleanup();
        process.exit(0);
    });
    
    let crawlCount = 0;
    
    // Continuous crawling loop
    while (true) {
        try {
            crawlCount++;
            const startTime = new Date();
            console.log(`\n=== Starting Crawl Cycle #${crawlCount} at ${startTime.toISOString()} ===`);
            console.log(`Real-time CSV writing to: ${OUTPUT_FILE}`);

            // Check if we already have enough data from previous runs
            const fs = require('fs');
            if (fs.existsSync(OUTPUT_FILE)) {
                const existingContent = fs.readFileSync(OUTPUT_FILE, 'utf8');
                const existingLines = existingContent.split('\n').filter(line => line.trim() !== '');
                const existingCount = existingLines.length - 1; // Subtract header

                if (existingCount > 0) {
                    console.log(`📊 Found ${existingCount} existing girls in ${OUTPUT_FILE}`);

                    // Use fixed target of 1919 girls
                    const currentTarget = 1919;

                    if (existingCount >= currentTarget) {
                        console.log(`🎯 ALREADY COMPLETE! Found ${existingCount} girls, target is ${currentTarget}.`);
                        console.log(`✅ No need to crawl. Exiting.`);
                        break;
                    } else {
                        console.log(`🔄 Need to continue: ${existingCount}/${currentTarget} girls found.`);
                        globalCrawlState.totalGirlsCrawled = existingCount; // Start from existing count
                    }
                }
            }

            // Run multi-threaded crawl with real-time CSV writing
            const allProfileLinks = await crawler.multiThreadedCrawlRealtime();
            
            const endTime = new Date();
            const duration = (endTime - startTime) / 1000;
            
            console.log(`\n=== Crawl Cycle #${crawlCount} Summary ===`);
            console.log(`Start time: ${startTime.toISOString()}`);
            console.log(`End time: ${endTime.toISOString()}`);
            console.log(`Duration: ${duration} seconds`);
            console.log(`Target girls: ${totalGirlsExpected.toLocaleString()}`);
            console.log(`Girls crawled: ${globalCrawlState.totalGirlsCrawled.toLocaleString()}`);
            console.log(`Total profile links: ${allProfileLinks.length}`);
            console.log(`Pages checked: ${totalPagesGirl}`);
            console.log(`Output file: ${OUTPUT_FILE}`);
            console.log('=== Real-time CSV Writing Completed Successfully ===');

            // Check if target has been reached by checking CSV file count
            const finalCSVCount = crawler.getCurrentCSVCount();
            if (totalGirlsExpected > 0 && finalCSVCount >= totalGirlsExpected) {
                console.log(`\n🎯 TARGET REACHED! Successfully crawled ${finalCSVCount}/${totalGirlsExpected} girls in CSV file.`);
                console.log(`✅ Crawling completed successfully. Stopping crawler.`);
                console.log(`📁 Final results saved to: ${OUTPUT_FILE}`);
                break; // Exit the while loop
            }

            // Wait before starting next cycle (5 minutes)
            const waitTime = 1000; // 1 second for testing, change to 5*60*1000 for production
            console.log(`\n⏳ Target not yet reached. Waiting ${waitTime / 1000} seconds before next crawl cycle...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            
        } catch (error) {
            console.error(`Error in crawl cycle #${crawlCount}:`, error);
            await crawler.cleanup();
            
            // Wait before retrying (2 minutes on error)
            const errorWaitTime = 2 * 60 * 1000; // 2 minutes
            console.log(`⚠️  Waiting ${errorWaitTime / 1000} seconds before retry...`);
            await new Promise(resolve => setTimeout(resolve, errorWaitTime));
        }
    }

    // Final cleanup when exiting the loop
    console.log('\n🏁 Crawler finished. Performing final cleanup...');
    await crawler.cleanup();
    console.log('✅ Cleanup completed. Exiting gracefully.');
    process.exit(0);
}

// Run the crawler
if (require.main === module) {
    main();
}

module.exports = FgirlCategoryCrawler;
