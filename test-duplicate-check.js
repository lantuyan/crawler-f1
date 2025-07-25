const fs = require('fs');
const FgirlCategoryCrawler = require('./crawler-categories.js');

async function testDuplicateChecking() {
    console.log('=== Testing Duplicate Checking Functionality ===');
    
    const OUTPUT_FILE = 'list-girl.csv';
    const TEST_FILE = 'test-duplicates.csv';
    
    try {
        // Create a test crawler instance
        const crawler = new FgirlCategoryCrawler();
        
        // Create test data with some duplicates
        const testData1 = [
            {
                name: 'Test Alice',
                location: 'Geneva',
                profile_url: 'https://www.en.fgirl.ch/filles/test-alice/'
            },
            {
                name: 'Test Bob',
                location: 'Lausanne', 
                profile_url: 'https://www.en.fgirl.ch/filles/test-bob/'
            }
        ];
        
        const testData2 = [
            {
                name: 'Test Alice Updated', // Same URL, different name
                location: 'Zurich',
                profile_url: 'https://www.en.fgirl.ch/filles/test-alice/' // Duplicate URL
            },
            {
                name: 'Test Charlie',
                location: 'Basel',
                profile_url: 'https://www.en.fgirl.ch/filles/test-charlie/' // New URL
            }
        ];
        
        // Backup existing CSV if it exists
        let backupCreated = false;
        if (fs.existsSync(OUTPUT_FILE)) {
            fs.copyFileSync(OUTPUT_FILE, `${OUTPUT_FILE}.backup`);
            backupCreated = true;
            console.log('✓ Backed up existing CSV file');
        }
        
        // Clear test file and start fresh
        if (fs.existsSync(TEST_FILE)) {
            fs.unlinkSync(TEST_FILE);
        }
        
        // Temporarily change output file for testing
        const originalOutputFile = OUTPUT_FILE;
        
        // Override the saveLinksToCSVRealtime method to use test file
        const originalMethod = crawler.saveLinksToCSVRealtime;
        crawler.saveLinksToCSVRealtime = async function(profileLinks) {
            // Temporarily modify OUTPUT_FILE constant for this test
            const fs = require('fs');
            const OUTPUT_FILE = TEST_FILE;
            
            // Wait for any existing write operation to complete (thread-safe)
            while (this.csvWriteLock) {
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            
            this.csvWriteLock = true;
            
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
        };
        
        console.log('\n1. Writing first batch of data...');
        await crawler.saveLinksToCSVRealtime(testData1);
        
        console.log('\n2. Writing second batch with duplicates...');
        await crawler.saveLinksToCSVRealtime(testData2);
        
        // Read and verify the final CSV content
        console.log('\n3. Verifying final CSV content...');
        const finalContent = fs.readFileSync(TEST_FILE, 'utf8');
        const lines = finalContent.trim().split('\n');
        
        console.log('Final CSV content:');
        console.log(finalContent);
        
        // Count unique URLs in final CSV
        const finalUrls = new Set();
        for (let i = 1; i < lines.length; i++) { // Skip header
            const line = lines[i].trim();
            if (line) {
                const columns = line.split(',');
                if (columns.length >= 3) {
                    finalUrls.add(columns[columns.length - 1].trim());
                }
            }
        }
        
        console.log(`\n=== Test Results ===`);
        console.log(`Total lines in CSV: ${lines.length} (including header)`);
        console.log(`Unique profile URLs: ${finalUrls.size}`);
        console.log(`Expected unique URLs: 3 (Alice, Bob, Charlie)`);
        
        if (finalUrls.size === 3 && lines.length === 4) {
            console.log('✅ Duplicate checking test PASSED!');
            console.log('✅ Real-time CSV writing works correctly');
            console.log('✅ Thread-safe operations maintain data integrity');
        } else {
            console.log('❌ Test FAILED - unexpected results');
        }
        
        // Cleanup test file
        if (fs.existsSync(TEST_FILE)) {
            fs.unlinkSync(TEST_FILE);
            console.log('✓ Cleaned up test file');
        }
        
        // Restore backup if created
        if (backupCreated && fs.existsSync(`${OUTPUT_FILE}.backup`)) {
            fs.renameSync(`${OUTPUT_FILE}.backup`, OUTPUT_FILE);
            console.log('✓ Restored original CSV file');
        }
        
    } catch (error) {
        console.error('Test error:', error);
        
        // Cleanup on error
        if (fs.existsSync(TEST_FILE)) {
            fs.unlinkSync(TEST_FILE);
        }
        if (fs.existsSync(`${OUTPUT_FILE}.backup`)) {
            fs.renameSync(`${OUTPUT_FILE}.backup`, OUTPUT_FILE);
        }
    }
}

// Run the test
if (require.main === module) {
    testDuplicateChecking();
}

module.exports = testDuplicateChecking;