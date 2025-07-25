const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const { HttpsProxyAgent } = require('https-proxy-agent');

// Configuration
const PROXY_URL = 'http://proxybird:proxybird@155.254.39.107:6065';
const START_URL = 'https://www.en.fgirl.ch/filles/jolie-3/';
const OUTPUT_FILE = 'data-gaidep.csv';
const DELAY_BETWEEN_REQUESTS = 2000; // 2 seconds delay

// CSV Writer setup
const csvWriter = createCsvWriter({
    path: OUTPUT_FILE,
    header: [
        { id: 'name', title: 'Name' },
        { id: 'age', title: 'Age' },
        { id: 'location', title: 'Location' },
        { id: 'category', title: 'Category' },
        { id: 'nationality', title: 'Nationality' },
        { id: 'hair_color', title: 'Hair Color' },
        { id: 'eye_color', title: 'Eye Color' },
        { id: 'height', title: 'Height' },
        { id: 'build', title: 'Build' },
        { id: 'boobs', title: 'Boobs' },
        { id: 'smoker', title: 'Smoker' },
        { id: 'tattoo', title: 'Tattoo' },
        { id: 'services', title: 'Services' },
        { id: 'languages', title: 'Languages' },
        { id: 'rates', title: 'Rates' },
        { id: 'description', title: 'Description' },
        { id: 'url', title: 'Profile URL' },
        { id: 'likes', title: 'Likes' },
        { id: 'followers', title: 'Followers' },
        { id: 'reviews_count', title: 'Reviews Count' }
    ]
});

class FgirlCrawler {
    constructor() {
        this.browser = null;
        this.page = null;
        this.crawledData = [];
        this.visitedUrls = new Set();
        this.useProxy = true; // Track if we're using proxy
        this.csvHeaderWritten = false; // Track if CSV header is written
    }

    async init() {
        console.log('Initializing browser with proxy...');
        
        // Check for Chrome executable paths on macOS
        const fs = require('fs');
        const chromePaths = [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
            '/usr/bin/google-chrome',
            '/usr/bin/chromium-browser'
        ];
        
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
        
        // Try different browser configurations with increasing simplicity
        const configurations = [
            {
                name: 'with-proxy-full',
                config: {
                    headless: "new",
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-accelerated-2d-canvas',
                        '--no-first-run',
                        '--no-zygote',
                        '--disable-gpu',
                        '--proxy-server=155.254.39.107:6065',
                        '--ignore-certificate-errors',
                        '--ignore-ssl-errors',
                        '--ignore-certificate-errors-spki-list',
                        '--disable-web-security',
                        '--allow-running-insecure-content',
                        '--disable-features=VizDisplayCompositor'
                    ],
                    timeout: 10000
                }
            },
            {
                name: 'with-proxy-minimal',
                config: {
                    headless: "new",
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--proxy-server=155.254.39.107:6065'
                    ],
                    timeout: 10000
                }
            },
            {
                name: 'without-proxy-standard',
                config: {
                    headless: "new",
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-gpu',
                        '--disable-features=VizDisplayCompositor'
                    ],
                    timeout: 10000
                }
            },
            {
                name: 'without-proxy-minimal',
                config: {
                    headless: "new",
                    args: ['--no-sandbox'],
                    timeout: 10000
                }
            },
            {
                name: 'old-headless-mode',
                config: {
                    headless: true,
                    args: ['--no-sandbox', '--disable-setuid-sandbox'],
                    timeout: 10000
                }
            },
            {
                name: 'non-headless-fallback',
                config: {
                    headless: false,
                    args: ['--no-sandbox'],
                    timeout: 10000
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
        
        // Set default timeout
        this.page.setDefaultTimeout(30000);
        this.page.setDefaultNavigationTimeout(30000);
        
        console.log('Browser initialized successfully');
    }

    async dismissModals() {
        try {
            // Wait a moment for any modals to fully load
            await this.page.waitForTimeout(1000);
            
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
                await this.page.waitForTimeout(500);
            }

        } catch (error) {
            console.log('Modal dismissal completed with minor issues:', error.message);
        }
    }

    async extractProfileData(url) {
        let retryCount = 0;
        const maxRetries = 3;
        
        while (retryCount < maxRetries) {
            try {
                console.log(`Extracting data from: ${url} (attempt ${retryCount + 1})`);
                
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
                    
                    // Set timeouts
                    this.page.setDefaultTimeout(30000);
                    this.page.setDefaultNavigationTimeout(30000);
                }
                
                // Add extra headers to appear more like a regular browser
                await this.page.setExtraHTTPHeaders({
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
                });

                // Try to navigate with different wait strategies
                let navigationSuccess = false;
                const waitStrategies = ['domcontentloaded', 'networkidle2', 'load'];
                
                for (const waitUntil of waitStrategies) {
                    try {
                        await this.page.goto(url, { 
                            waitUntil: waitUntil,
                            timeout: 45000 
                        });
                        navigationSuccess = true;
                        console.log(`Navigation successful with strategy: ${waitUntil}`);
                        break;
                    } catch (navError) {
                        console.log(`Navigation failed with ${waitUntil}: ${navError.message}`);
                        if (waitUntil === waitStrategies[waitStrategies.length - 1]) {
                            throw navError;
                        }
                    }
                }
                
                if (!navigationSuccess) {
                    throw new Error('All navigation strategies failed');
                }

                // Wait for page to stabilize
                await this.page.waitForTimeout(3000);

                // Check if page is still accessible
                const isPageClosed = this.page.isClosed();
                if (isPageClosed) {
                    throw new Error('Page was closed during navigation');
                }

                // Close any modal dialogs that might be blocking the page
                await this.dismissModals();

                // Try to wait for content with a more lenient approach
                try {
                    await this.page.waitForSelector('.profile-card', { timeout: 10000 });
                } catch (selectorError) {
                    // If profile-card not found, try alternative selectors
                    const alternativeSelectors = ['.profile', '.card', '.main-content', 'body'];
                    let selectorFound = false;
                    
                    for (const selector of alternativeSelectors) {
                        try {
                            await this.page.waitForSelector(selector, { timeout: 3000 });
                            console.log(`Using alternative selector: ${selector}`);
                            selectorFound = true;
                            break;
                        } catch (e) {
                            continue;
                        }
                    }
                    
                    if (!selectorFound) {
                        throw new Error('No valid content selectors found');
                    }
                }

                const html = await this.page.content();
                
                // Debug: Log HTML preview
                const htmlPreview = html.substring(0, 2000);
                console.log('Debug: HTML Preview (first 2000 chars):');
                console.log('='.repeat(80));
                console.log(htmlPreview);
                console.log('='.repeat(80));
                
                const $ = cheerio.load(html);

                // Extract profile data based on the HTML structure from example.html
                const profileData = {
                    name: this.extractText($, '.name') || 'N/A',
                    age: this.extractAge($),
                    location: this.extractLocation($),
                    category: this.extractTextFromIcon($, 'i.fa-venus-mars') || 'N/A',
                    nationality: this.extractTextFromIcon($, 'i.fa-flag') || 'N/A',
                    hair_color: this.extractTextFromIcon($, 'i.fa-palette') || 'N/A',
                    eye_color: this.extractTextFromIcon($, 'i.fa-eye') || 'N/A',
                    height: this.extractTextFromIcon($, 'i.fa-ruler-vertical') || 'N/A',
                    build: this.extractTextFromIcon($, 'i.fa-weight') || 'N/A',
                    boobs: this.extractTextFromIcon($, 'i.fa-record-vinyl') || 'N/A',
                    smoker: this.extractTextFromIcon($, 'i.fa-smoking') || 'N/A',
                    tattoo: this.extractTextFromIcon($, 'i.fa-paint-brush') || 'N/A',
                    services: this.extractServices($),
                    languages: this.extractLanguages($),
                    rates: this.extractRates($),
                    description: this.extractDescription($),
                    url: url,
                    likes: this.extractLikes($),
                    followers: this.extractFollowers($),
                    reviews_count: this.extractReviewsCount($)
                };

                console.log(`Extracted data for: ${profileData.name}`);
                
                // Save profile data immediately to CSV
                await this.saveProfileToCSV(profileData);
                
                return profileData;

            } catch (error) {
                retryCount++;
                console.error(`Error extracting data from ${url} (attempt ${retryCount}):`, error.message);
                
                if (retryCount >= maxRetries) {
                    console.error(`Failed to extract data after ${maxRetries} attempts`);
                    return null;
                }
                
                // Wait before retrying
                await new Promise(resolve => setTimeout(resolve, 2000 * retryCount));
            }
        }
        
        return null;
    }

    extractText($, selector) {
        const element = $(selector).first();
        return element.length > 0 ? element.text().trim() : null;
    }

    extractTextFromIcon($, iconSelector) {
        try {
            const iconElement = $(iconSelector);
            if (iconElement.length > 0) {
                const parentElement = iconElement.parent();
                if (parentElement.length > 0) {
                    return parentElement.text().trim();
                }
            }
            return null;
        } catch (error) {
            return null;
        }
    }

    extractAge($) {
        const ageText = this.extractTextFromIcon($, 'i.fa-birthday-cake');
        const match = ageText ? ageText.match(/(\d+)\s*years?\s*old/i) : null;
        return match ? match[1] : 'N/A';
    }

    extractLocation($) {
        const locationElement = $('i.fa-map-marker-alt').parent();
        if (locationElement.length > 0) {
            const text = locationElement.text().trim();
            const match = text.match(/in\s+(.+)$/i);
            return match ? match[1] : text;
        }
        return 'N/A';
    }

    extractServices($) {
        const services = [];
        $('.services-list li').each((index, element) => {
            const service = $(element).text().trim();
            if (service) {
                services.push(service);
            }
        });
        return services.join(', ') || 'N/A';
    }

    extractLanguages($) {
        const languages = [];
        $('.media-body').each((index, element) => {
            const text = $(element).find('div').last().text().trim();
            if (text && ['English', 'French', 'German', 'Italian', 'Spanish'].includes(text)) {
                const stars = $(element).find('.fa-star').length;
                languages.push(`${text} (${stars} stars)`);
            }
        });
        return languages.join(', ') || 'N/A';
    }

    extractRates($) {
        const ratesText = this.extractText($, '.card-text');
        if (ratesText && ratesText.includes('CHF')) {
            return ratesText;
        }
        return 'N/A';
    }

    extractDescription($) {
        const description = $('.description-text p').map((i, el) => $(el).text().trim()).get().join(' ');
        return description || 'N/A';
    }

    extractLikes($) {
        const likesText = $('#like-counter').text().trim();
        return likesText || '0';
    }

    extractFollowers($) {
        const followersText = $('#follow-counter').text().trim();
        return followersText || '0';
    }

    extractReviewsCount($) {
        const reviewsTitle = $('h2:contains("Reviews")').text();
        const match = reviewsTitle.match(/Reviews\s*\((\d+)\)/);
        return match ? match[1] : '0';
    }

    async findNextProfileUrl() {
        try {
            // Check if page is still accessible
            if (this.page.isClosed()) {
                console.error('Page is closed, cannot find next profile URL');
                return null;
            }

            // Look for the "Next profile" link in the specific div structure
            const nextProfileSelectors = [
                '.col-6.col-lg-3.order-lg-2.text-right.py-2 a[href*="/filles/"]',
                'a[href*="/filles/"]:contains("Next")',
                'a[href*="/filles/"]:contains("next")',
                '.next a[href*="/filles/"]',
                '.pagination a[href*="/filles/"]:last'
            ];
            
            for (const selector of nextProfileSelectors) {
                try {
                    const nextProfileElement = await this.page.$(selector);
                    
                    if (nextProfileElement) {
                        const href = await this.page.evaluate(el => el.href, nextProfileElement);
                        if (href && href.includes('/filles/')) {
                            console.log(`Found next profile URL: ${href}`);
                            return href;
                        }
                    }
                } catch (selectorError) {
                    // Try next selector
                    continue;
                }
            }
            
            console.log('No next profile link found');
            return null;
            
        } catch (error) {
            console.error('Error finding next profile URL:', error.message);
            return null;
        }
    }

    async crawl() {
        try {
            await this.init();
            
            let currentUrl = START_URL;
            let profileCount = 0;
            const maxProfiles = 100; // Limit for safety
            
            console.log(`Starting crawl from: ${currentUrl}`);
            
            while (currentUrl && profileCount < maxProfiles) {
                // Skip if already visited
                if (this.visitedUrls.has(currentUrl)) {
                    console.log(`Already visited: ${currentUrl}`);
                    break;
                }
                
                this.visitedUrls.add(currentUrl);
                
                // Extract profile data
                const profileData = await this.extractProfileData(currentUrl);
                
                if (profileData) {
                    this.crawledData.push(profileData);
                    profileCount++;
                    console.log(`Profile ${profileCount}: ${profileData.name} - ${profileData.location}`);
                }
                
                // Find next profile URL
                const nextUrl = await this.findNextProfileUrl();
                
                if (!nextUrl || nextUrl === currentUrl) {
                    console.log('No more profiles to crawl or reached end');
                    break;
                }
                
                currentUrl = nextUrl;
                
                // Add delay between requests
                console.log(`Waiting ${DELAY_BETWEEN_REQUESTS}ms before next request...`);
                await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_REQUESTS));
            }
            
            console.log(`Crawling completed! Total profiles: ${this.crawledData.length}`);
            
            // Save data to CSV
            if (this.crawledData.length > 0) {
                await this.saveToCSV();
            } else {
                console.log('No data to save');
            }
            
        } catch (error) {
            console.error('Crawling error:', error);
        } finally {
            await this.cleanup();
        }
    }

    async saveProfileToCSV(profileData) {
        try {
            if (!this.csvHeaderWritten) {
                // Write header and first record
                await csvWriter.writeRecords([profileData]);
                this.csvHeaderWritten = true;
                console.log(`CSV initialized with header and first record saved to ${OUTPUT_FILE}`);
            } else {
                // Append record without header
                const fs = require('fs');
                const csvLine = [
                    profileData.name,
                    profileData.age,
                    profileData.location,
                    profileData.category,
                    profileData.nationality,
                    profileData.hair_color,
                    profileData.eye_color,
                    profileData.height,
                    profileData.build,
                    profileData.boobs,
                    profileData.smoker,
                    profileData.tattoo,
                    `"${profileData.services}"`,
                    profileData.languages,
                    profileData.rates,
                    `"${profileData.description}"`,
                    profileData.url,
                    profileData.likes,
                    profileData.followers,
                    profileData.reviews_count
                ].join(',') + '\n';
                
                fs.appendFileSync(OUTPUT_FILE, csvLine);
                console.log(`Profile data appended to ${OUTPUT_FILE}`);
            }
        } catch (error) {
            console.error('Error saving profile to CSV:', error);
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
    console.log('=== Fgirl Crawler Started ===');
    
    const crawler = new FgirlCrawler();
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\nReceived SIGINT, shutting down gracefully...');
        await crawler.cleanup();
        process.exit(0);
    });
    
    try {
        await crawler.crawl();
    } catch (error) {
        console.error('Main error:', error);
        await crawler.cleanup();
        process.exit(1);
    }
}

// Run the crawler
if (require.main === module) {
    main();
}

module.exports = FgirlCrawler;