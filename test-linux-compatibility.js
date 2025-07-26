#!/usr/bin/env node

/**
 * Linux Compatibility Test Suite for Crawler Applications
 * 
 * This script tests the Linux compatibility of the crawler applications
 * by running basic functionality tests in a headless environment.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const os = require('os');
const path = require('path');

class LinuxCompatibilityTester {
    constructor() {
        this.platform = os.platform();
        this.testResults = [];
        this.browser = null;
    }

    async runAllTests() {
        console.log('🧪 Linux Compatibility Test Suite');
        console.log('==================================\n');

        console.log(`Platform: ${this.platform}`);
        console.log(`Node.js: ${process.version}`);
        console.log(`Architecture: ${process.arch}\n`);

        try {
            await this.testSystemInfo();
            await this.testChromePaths();
            await this.testBrowserLaunch();
            await this.testHeadlessOperation();
            await this.testNetworkConnectivity();
            await this.testFileOperations();
            await this.generateReport();
        } catch (error) {
            console.error('❌ Test suite failed:', error.message);
            process.exit(1);
        } finally {
            if (this.browser) {
                await this.browser.close();
            }
        }
    }

    async testSystemInfo() {
        console.log('📋 Testing system information...');
        
        const totalMem = os.totalmem() / (1024 * 1024 * 1024);
        const freeMem = os.freemem() / (1024 * 1024 * 1024);
        
        this.addResult('System Memory', totalMem >= 2, `Total: ${totalMem.toFixed(2)}GB, Free: ${freeMem.toFixed(2)}GB`);
        this.addResult('Platform Check', this.platform === 'linux', `Platform: ${this.platform}`);
        
        console.log('✅ System information test completed\n');
    }

    async testChromePaths() {
        console.log('🌐 Testing Chrome executable paths...');
        
        const chromePaths = [
            '/usr/bin/google-chrome-stable',
            '/usr/bin/google-chrome',
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium',
            '/snap/bin/chromium',
            '/opt/google/chrome/chrome',
            '/opt/google/chrome/google-chrome'
        ];

        let chromeFound = false;
        let foundPath = null;

        for (const chromePath of chromePaths) {
            if (fs.existsSync(chromePath)) {
                chromeFound = true;
                foundPath = chromePath;
                break;
            }
        }

        this.addResult('Chrome Installation', chromeFound, foundPath || 'Will use Puppeteer bundled Chromium');
        console.log('✅ Chrome path test completed\n');
    }

    async testBrowserLaunch() {
        console.log('🚀 Testing browser launch configurations...');
        
        const configurations = [
            {
                name: 'Linux Headless Optimized',
                config: {
                    headless: "new",
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-gpu',
                        '--disable-software-rasterizer',
                        '--memory-pressure-off',
                        '--no-zygote',
                        '--disable-features=VizDisplayCompositor',
                        '--virtual-time-budget=5000'
                    ],
                    timeout: 10000
                }
            },
            {
                name: 'Minimal Configuration',
                config: {
                    headless: "new",
                    args: ['--no-sandbox', '--disable-setuid-sandbox'],
                    timeout: 10000
                }
            }
        ];

        let launchSuccess = false;
        let successConfig = null;

        for (const { name, config } of configurations) {
            try {
                console.log(`   Testing: ${name}`);
                const browser = await puppeteer.launch(config);
                await browser.close();
                launchSuccess = true;
                successConfig = name;
                console.log(`   ✅ ${name} - Success`);
                break;
            } catch (error) {
                console.log(`   ❌ ${name} - Failed: ${error.message}`);
            }
        }

        this.addResult('Browser Launch', launchSuccess, successConfig || 'All configurations failed');
        console.log('✅ Browser launch test completed\n');
    }

    async testHeadlessOperation() {
        console.log('👻 Testing headless browser operations...');
        
        try {
            this.browser = await puppeteer.launch({
                headless: "new",
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu'
                ]
            });

            const page = await this.browser.newPage();
            
            // Test basic navigation
            await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 10000 });
            const title = await page.title();
            
            // Test page evaluation
            const userAgent = await page.evaluate(() => navigator.userAgent);
            
            // Test viewport setting
            await page.setViewport({ width: 1366, height: 768 });
            
            this.addResult('Headless Navigation', title.includes('Example'), `Title: ${title}`);
            this.addResult('JavaScript Execution', userAgent.includes('Chrome'), 'User agent detected');
            this.addResult('Viewport Setting', true, '1366x768 viewport set');
            
            await page.close();
            
        } catch (error) {
            this.addResult('Headless Operation', false, error.message);
        }
        
        console.log('✅ Headless operation test completed\n');
    }

    async testNetworkConnectivity() {
        console.log('🌐 Testing network connectivity...');
        
        if (!this.browser) {
            console.log('   Skipping network test (browser not available)');
            return;
        }

        try {
            const page = await this.browser.newPage();
            
            // Test target website connectivity
            const response = await page.goto('https://www.en.fgirl.ch/', { 
                waitUntil: 'domcontentloaded', 
                timeout: 15000 
            });
            
            const status = response.status();
            const isSuccess = status >= 200 && status < 400;
            
            this.addResult('Target Website Access', isSuccess, `HTTP ${status}`);
            
            await page.close();
            
        } catch (error) {
            this.addResult('Network Connectivity', false, error.message);
        }
        
        console.log('✅ Network connectivity test completed\n');
    }

    async testFileOperations() {
        console.log('📁 Testing file operations...');
        
        const testFile = 'test-linux-compatibility.csv';
        
        try {
            // Test CSV writing
            const csvContent = 'Name,Location,URL\nTest,Test Location,https://example.com\n';
            fs.writeFileSync(testFile, csvContent);
            
            // Test file reading
            const readContent = fs.readFileSync(testFile, 'utf8');
            const isContentCorrect = readContent === csvContent;
            
            // Test file deletion
            fs.unlinkSync(testFile);
            const fileDeleted = !fs.existsSync(testFile);
            
            this.addResult('CSV File Writing', true, 'CSV file created successfully');
            this.addResult('File Reading', isContentCorrect, 'File content verified');
            this.addResult('File Cleanup', fileDeleted, 'Test file deleted');
            
        } catch (error) {
            this.addResult('File Operations', false, error.message);
        }
        
        console.log('✅ File operations test completed\n');
    }

    addResult(testName, passed, details) {
        this.testResults.push({
            test: testName,
            passed: passed,
            details: details
        });
    }

    async generateReport() {
        console.log('📊 TEST RESULTS SUMMARY');
        console.log('=======================\n');
        
        const passedTests = this.testResults.filter(result => result.passed).length;
        const totalTests = this.testResults.length;
        const successRate = ((passedTests / totalTests) * 100).toFixed(1);
        
        console.log(`Overall Success Rate: ${successRate}% (${passedTests}/${totalTests})\n`);
        
        // Group results by status
        const passed = this.testResults.filter(r => r.passed);
        const failed = this.testResults.filter(r => !r.passed);
        
        if (passed.length > 0) {
            console.log('✅ PASSED TESTS:');
            passed.forEach(result => {
                console.log(`   ✓ ${result.test}: ${result.details}`);
            });
            console.log();
        }
        
        if (failed.length > 0) {
            console.log('❌ FAILED TESTS:');
            failed.forEach(result => {
                console.log(`   ✗ ${result.test}: ${result.details}`);
            });
            console.log();
        }
        
        // Overall assessment
        if (successRate >= 90) {
            console.log('🎉 EXCELLENT: Your system is fully ready for Linux crawler deployment!');
        } else if (successRate >= 70) {
            console.log('✅ GOOD: Your system should work well with minor adjustments.');
        } else if (successRate >= 50) {
            console.log('⚠️  WARNING: Some issues detected. Review failed tests before deployment.');
        } else {
            console.log('❌ CRITICAL: Major issues detected. System may not be ready for deployment.');
        }
        
        console.log('\n📚 For troubleshooting help, see LINUX_DEPLOYMENT.md');
        
        // Exit with appropriate code
        process.exit(failed.length > 0 ? 1 : 0);
    }
}

// Run the test suite if this script is executed directly
if (require.main === module) {
    const tester = new LinuxCompatibilityTester();
    tester.runAllTests().catch(error => {
        console.error('Fatal error in test suite:', error);
        process.exit(1);
    });
}

module.exports = LinuxCompatibilityTester;
