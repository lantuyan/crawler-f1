#!/usr/bin/env node

/**
 * Test script for distributed crawling functionality
 * This script tests the WebSocket connections and API endpoints
 */

const io = require('socket.io-client');
const axios = require('axios');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const TEST_TIMEOUT = 30000; // 30 seconds

console.log('🧪 Testing Distributed Crawling System');
console.log(`📡 Server URL: ${SERVER_URL}`);
console.log('=' .repeat(50));

let testResults = {
    passed: 0,
    failed: 0,
    tests: []
};

function logTest(name, passed, message = '') {
    const status = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} ${name}${message ? ': ' + message : ''}`);
    
    testResults.tests.push({ name, passed, message });
    if (passed) {
        testResults.passed++;
    } else {
        testResults.failed++;
    }
}

async function testServerConnection() {
    try {
        const response = await axios.get(`${SERVER_URL}/distributed-client`, {
            timeout: 5000
        });
        
        if (response.status === 200) {
            logTest('Server Connection', true, 'Distributed client page accessible');
            return true;
        } else {
            logTest('Server Connection', false, `HTTP ${response.status}`);
            return false;
        }
    } catch (error) {
        logTest('Server Connection', false, error.message);
        return false;
    }
}

async function testWebSocketConnection() {
    return new Promise((resolve) => {
        const socket = io(SERVER_URL, {
            transports: ['websocket', 'polling'],
            timeout: 5000
        });

        let connected = false;
        let registered = false;

        const timeout = setTimeout(() => {
            if (!connected) {
                logTest('WebSocket Connection', false, 'Connection timeout');
                socket.disconnect();
                resolve(false);
            }
        }, 10000);

        socket.on('connect', () => {
            connected = true;
            logTest('WebSocket Connection', true, 'Connected successfully');
            
            // Test client registration
            socket.emit('register-distributed-client', {
                userAgent: 'Test Client',
                timestamp: new Date().toISOString()
            });
        });

        socket.on('distributed-state-update', (state) => {
            if (!registered) {
                registered = true;
                logTest('Client Registration', true, `Connected clients: ${state.connectedClients}`);
                
                clearTimeout(timeout);
                socket.disconnect();
                resolve(true);
            }
        });

        socket.on('connect_error', (error) => {
            logTest('WebSocket Connection', false, error.message);
            clearTimeout(timeout);
            resolve(false);
        });

        socket.on('disconnect', () => {
            if (connected && registered) {
                logTest('WebSocket Disconnection', true, 'Clean disconnection');
            }
        });
    });
}

async function testDistributedAPI() {
    try {
        // Test getting distributed state (this endpoint requires auth, so we expect 401/403)
        const response = await axios.get(`${SERVER_URL}/api/distributed-state`, {
            timeout: 5000,
            validateStatus: () => true // Don't throw on non-2xx status
        });
        
        if (response.status === 401 || response.status === 403) {
            logTest('Distributed API', true, 'API endpoint exists (auth required)');
            return true;
        } else if (response.status === 200) {
            logTest('Distributed API', true, 'API endpoint accessible');
            return true;
        } else {
            logTest('Distributed API', false, `Unexpected status: ${response.status}`);
            return false;
        }
    } catch (error) {
        if (error.response && (error.response.status === 401 || error.response.status === 403)) {
            logTest('Distributed API', true, 'API endpoint exists (auth required)');
            return true;
        } else {
            logTest('Distributed API', false, error.message);
            return false;
        }
    }
}

async function testSocketIOEndpoint() {
    try {
        const response = await axios.get(`${SERVER_URL}/socket.io/socket.io.js`, {
            timeout: 5000
        });
        
        if (response.status === 200 && response.data.includes('socket.io')) {
            logTest('Socket.IO Endpoint', true, 'Socket.IO client library accessible');
            return true;
        } else {
            logTest('Socket.IO Endpoint', false, 'Invalid Socket.IO response');
            return false;
        }
    } catch (error) {
        logTest('Socket.IO Endpoint', false, error.message);
        return false;
    }
}

async function runTests() {
    console.log('🚀 Starting tests...\n');

    // Test 1: Server Connection
    console.log('1️⃣ Testing server connection...');
    const serverOk = await testServerConnection();
    
    if (!serverOk) {
        console.log('\n❌ Server is not accessible. Skipping remaining tests.');
        printResults();
        process.exit(1);
    }

    // Test 2: Socket.IO Endpoint
    console.log('\n2️⃣ Testing Socket.IO endpoint...');
    await testSocketIOEndpoint();

    // Test 3: WebSocket Connection
    console.log('\n3️⃣ Testing WebSocket connection...');
    await testWebSocketConnection();

    // Test 4: Distributed API
    console.log('\n4️⃣ Testing distributed API...');
    await testDistributedAPI();

    console.log('\n🏁 Tests completed!');
    printResults();
}

function printResults() {
    console.log('\n' + '=' .repeat(50));
    console.log('📊 TEST RESULTS');
    console.log('=' .repeat(50));
    
    testResults.tests.forEach(test => {
        const status = test.passed ? '✅' : '❌';
        console.log(`${status} ${test.name}${test.message ? ': ' + test.message : ''}`);
    });
    
    console.log('\n📈 SUMMARY');
    console.log(`✅ Passed: ${testResults.passed}`);
    console.log(`❌ Failed: ${testResults.failed}`);
    console.log(`📊 Total: ${testResults.passed + testResults.failed}`);
    
    if (testResults.failed === 0) {
        console.log('\n🎉 All tests passed! Distributed crawling system is ready.');
        process.exit(0);
    } else {
        console.log('\n⚠️ Some tests failed. Please check the server configuration.');
        process.exit(1);
    }
}

// Handle process termination
process.on('SIGINT', () => {
    console.log('\n\n⏹️ Tests interrupted by user');
    printResults();
});

process.on('SIGTERM', () => {
    console.log('\n\n⏹️ Tests terminated');
    printResults();
});

// Set overall timeout
setTimeout(() => {
    console.log('\n\n⏰ Tests timed out');
    printResults();
}, TEST_TIMEOUT);

// Run the tests
runTests().catch(error => {
    console.error('\n💥 Test runner error:', error.message);
    process.exit(1);
});
