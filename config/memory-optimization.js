/**
 * Memory Optimization Configuration for Crawler
 * 
 * This module provides memory management utilities and configurations
 * to prevent heap overflow and optimize garbage collection.
 */

const os = require('os');

// Memory thresholds and limits
const MEMORY_CONFIG = {
    // Maximum heap size in MB (16GB)
    maxHeapSize: 16384,

    // Warning threshold in MB (12GB)
    warningThreshold: 12288,

    // Critical threshold in MB (14GB)
    criticalThreshold: 14336,
    
    // GC trigger interval (number of processed items)
    gcTriggerInterval: 25,
    
    // Memory monitoring interval in ms
    monitoringInterval: 30000, // 30 seconds
    
    // Browser memory limit per instance in MB
    browserMemoryLimit: 1024,
    
    // Maximum concurrent browsers based on available memory
    getMaxConcurrentBrowsers() {
        const totalMemoryGB = os.totalmem() / (1024 * 1024 * 1024);

        if (totalMemoryGB >= 32) return 10;
        if (totalMemoryGB >= 16) return 8;
        if (totalMemoryGB >= 8) return 5;
        if (totalMemoryGB >= 4) return 3;
        return 2;
    }
};

// Memory monitoring utilities
class MemoryMonitor {
    constructor() {
        this.isMonitoring = false;
        this.monitoringInterval = null;
        this.memoryHistory = [];
        this.maxHistorySize = 100;
    }

    start() {
        if (this.isMonitoring) return;
        
        this.isMonitoring = true;
        console.log('🔍 Memory monitoring started');
        
        this.monitoringInterval = setInterval(() => {
            this.checkMemoryUsage();
        }, MEMORY_CONFIG.monitoringInterval);
    }

    stop() {
        if (!this.isMonitoring) return;
        
        this.isMonitoring = false;
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
        console.log('🔍 Memory monitoring stopped');
    }

    checkMemoryUsage() {
        const usage = this.getMemoryUsage();
        this.recordMemoryUsage(usage);
        
        if (usage.heapUsedMB > MEMORY_CONFIG.criticalThreshold) {
            console.log(`🚨 CRITICAL MEMORY USAGE: ${usage.heapUsedMB} MB`);
            this.triggerEmergencyGC();
        } else if (usage.heapUsedMB > MEMORY_CONFIG.warningThreshold) {
            console.log(`⚠️ HIGH MEMORY USAGE: ${usage.heapUsedMB} MB`);
            this.triggerGC();
        }
    }

    getMemoryUsage() {
        const used = process.memoryUsage();
        return {
            rss: used.rss,
            heapUsed: used.heapUsed,
            heapTotal: used.heapTotal,
            external: used.external,
            rssMB: Math.round(used.rss / 1024 / 1024 * 100) / 100,
            heapUsedMB: Math.round(used.heapUsed / 1024 / 1024 * 100) / 100,
            heapTotalMB: Math.round(used.heapTotal / 1024 / 1024 * 100) / 100,
            externalMB: Math.round(used.external / 1024 / 1024 * 100) / 100,
            timestamp: new Date()
        };
    }

    recordMemoryUsage(usage) {
        this.memoryHistory.push(usage);
        if (this.memoryHistory.length > this.maxHistorySize) {
            this.memoryHistory.shift();
        }
    }

    logMemoryUsage(context = '') {
        const usage = this.getMemoryUsage();
        
        console.log(`📊 Memory Usage ${context}:`);
        console.log(`   RSS: ${usage.rssMB} MB`);
        console.log(`   Heap Used: ${usage.heapUsedMB} MB`);
        console.log(`   Heap Total: ${usage.heapTotalMB} MB`);
        console.log(`   External: ${usage.externalMB} MB`);
        
        return usage;
    }

    triggerGC() {
        if (global.gc) {
            global.gc();
            console.log('🧹 Garbage collection triggered');
            return true;
        } else {
            console.log('⚠️ Garbage collection not available (run with --expose-gc)');
            return false;
        }
    }

    triggerEmergencyGC() {
        console.log('🚨 Emergency garbage collection triggered');
        if (global.gc) {
            // Multiple GC cycles for emergency cleanup
            for (let i = 0; i < 3; i++) {
                global.gc();
            }
            console.log('🧹 Emergency GC completed');
        }
    }

    getMemoryTrend() {
        if (this.memoryHistory.length < 2) return 'insufficient_data';
        
        const recent = this.memoryHistory.slice(-5);
        const trend = recent[recent.length - 1].heapUsedMB - recent[0].heapUsedMB;
        
        if (trend > 100) return 'increasing_rapidly';
        if (trend > 50) return 'increasing';
        if (trend < -50) return 'decreasing';
        return 'stable';
    }

    getMemoryStats() {
        const current = this.getMemoryUsage();
        const trend = this.getMemoryTrend();
        
        return {
            current,
            trend,
            history: this.memoryHistory.slice(-10), // Last 10 readings
            systemInfo: {
                totalMemory: Math.round(os.totalmem() / 1024 / 1024),
                freeMemory: Math.round(os.freemem() / 1024 / 1024),
                platform: os.platform(),
                arch: os.arch()
            }
        };
    }
}

// Browser memory optimization
const BrowserOptimizer = {
    getOptimizedLaunchArgs() {
        return [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-features=TranslateUI',
            '--disable-ipc-flooding-protection',
            '--disable-extensions',
            '--disable-default-apps',
            '--disable-sync',
            '--disable-translate',
            '--hide-scrollbars',
            '--mute-audio',
            '--no-default-browser-check',
            '--no-pings',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
            `--memory-pressure-off`,
            `--max_old_space_size=${MEMORY_CONFIG.browserMemoryLimit}`,
            '--aggressive-cache-discard',
            '--disable-background-networking'
        ];
    },

    async optimizePage(page) {
        // Disable images and CSS to reduce memory usage
        await page.setRequestInterception(true);
        
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (resourceType === 'image' || resourceType === 'stylesheet' || resourceType === 'font') {
                req.abort();
            } else {
                req.continue();
            }
        });

        // Set aggressive timeouts
        page.setDefaultTimeout(10000);
        page.setDefaultNavigationTimeout(15000);

        // Disable JavaScript if not needed for basic scraping
        // await page.setJavaScriptEnabled(false);
    },

    async cleanupPage(page) {
        try {
            // Clear all cookies and storage
            await page.deleteCookie(...(await page.cookies()));
            await page.evaluate(() => {
                localStorage.clear();
                sessionStorage.clear();
                if (window.caches) {
                    caches.keys().then(names => {
                        names.forEach(name => caches.delete(name));
                    });
                }
            });
        } catch (error) {
            console.log('Page cleanup error:', error.message);
        }
    }
};

// Global memory monitor instance
const memoryMonitor = new MemoryMonitor();

module.exports = {
    MEMORY_CONFIG,
    MemoryMonitor,
    BrowserOptimizer,
    memoryMonitor
};
