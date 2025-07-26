#!/usr/bin/env node

/**
 * Linux System Dependencies Checker for Crawler Applications
 * 
 * This script checks if all required system dependencies are installed
 * on a Linux server for running the crawler applications in headless mode.
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');

class LinuxDependencyChecker {
    constructor() {
        this.platform = os.platform();
        this.distro = null;
        this.packageManager = null;
        this.missingDependencies = [];
        this.warnings = [];
    }

    async checkAll() {
        console.log('🔍 Linux Crawler Dependencies Checker');
        console.log('=====================================\n');

        if (this.platform !== 'linux') {
            console.log(`⚠️  Warning: This checker is designed for Linux. Current platform: ${this.platform}`);
            console.log('   The crawlers should still work, but some checks may not be accurate.\n');
        }

        await this.detectDistribution();
        await this.detectPackageManager();
        await this.checkSystemDependencies();
        await this.checkChromeDependencies();
        await this.checkNodeDependencies();
        await this.checkSystemResources();
        await this.generateReport();
    }

    async detectDistribution() {
        try {
            if (fs.existsSync('/etc/os-release')) {
                const osRelease = fs.readFileSync('/etc/os-release', 'utf8');
                const idMatch = osRelease.match(/^ID=(.+)$/m);
                this.distro = idMatch ? idMatch[1].replace(/"/g, '') : 'unknown';
                console.log(`📋 Detected Linux distribution: ${this.distro}`);
            }
        } catch (error) {
            this.distro = 'unknown';
            console.log('📋 Could not detect Linux distribution');
        }
    }

    async detectPackageManager() {
        const packageManagers = [
            { cmd: 'apt', name: 'apt' },
            { cmd: 'yum', name: 'yum' },
            { cmd: 'dnf', name: 'dnf' },
            { cmd: 'pacman', name: 'pacman' },
            { cmd: 'zypper', name: 'zypper' }
        ];

        for (const pm of packageManagers) {
            try {
                execSync(`which ${pm.cmd}`, { stdio: 'ignore' });
                this.packageManager = pm.name;
                console.log(`📦 Detected package manager: ${this.packageManager}\n`);
                return;
            } catch (error) {
                // Continue to next package manager
            }
        }
        
        console.log('⚠️  Could not detect package manager\n');
    }

    async checkSystemDependencies() {
        console.log('🔧 Checking system dependencies...');
        
        const requiredPackages = {
            'apt': [
                'ca-certificates',
                'fonts-liberation',
                'libappindicator3-1',
                'libasound2',
                'libatk-bridge2.0-0',
                'libdrm2',
                'libgtk-3-0',
                'libnspr4',
                'libnss3',
                'libxss1',
                'libxtst6',
                'xdg-utils'
            ],
            'yum': [
                'alsa-lib',
                'atk',
                'cups-libs',
                'gtk3',
                'libdrm',
                'libX11',
                'libXcomposite',
                'libXdamage',
                'libXext',
                'libXfixes',
                'libXrandr',
                'libXss',
                'libXtst',
                'nss',
                'pango'
            ]
        };

        const packages = requiredPackages[this.packageManager] || [];
        
        for (const pkg of packages) {
            if (!this.isPackageInstalled(pkg)) {
                this.missingDependencies.push(pkg);
            }
        }

        if (this.missingDependencies.length === 0) {
            console.log('✅ All system dependencies are installed');
        } else {
            console.log(`❌ Missing ${this.missingDependencies.length} system dependencies`);
        }
    }

    async checkChromeDependencies() {
        console.log('\n🌐 Checking Chrome/Chromium installation...');
        
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
        for (const path of chromePaths) {
            if (fs.existsSync(path)) {
                console.log(`✅ Found Chrome/Chromium at: ${path}`);
                chromeFound = true;
                break;
            }
        }

        if (!chromeFound) {
            console.log('❌ No Chrome/Chromium installation found');
            this.warnings.push('Chrome/Chromium not found - Puppeteer will use bundled Chromium');
        }
    }

    async checkNodeDependencies() {
        console.log('\n📦 Checking Node.js dependencies...');
        
        try {
            const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
            const requiredDeps = ['puppeteer', 'cheerio', 'csv-writer', 'axios', 'https-proxy-agent'];
            
            for (const dep of requiredDeps) {
                if (!packageJson.dependencies[dep]) {
                    this.missingDependencies.push(`npm package: ${dep}`);
                }
            }
            
            console.log('✅ Node.js dependencies check completed');
        } catch (error) {
            console.log('❌ Could not read package.json');
            this.warnings.push('Could not verify Node.js dependencies');
        }
    }

    async checkSystemResources() {
        console.log('\n💾 Checking system resources...');
        
        const totalMem = os.totalmem() / (1024 * 1024 * 1024); // GB
        const freeMem = os.freemem() / (1024 * 1024 * 1024); // GB
        
        console.log(`   Total memory: ${totalMem.toFixed(2)} GB`);
        console.log(`   Free memory: ${freeMem.toFixed(2)} GB`);
        
        if (totalMem < 2) {
            this.warnings.push('Low total memory (< 2GB) - may affect crawler performance');
        }
        
        if (freeMem < 1) {
            this.warnings.push('Low free memory (< 1GB) - may cause browser crashes');
        }
        
        console.log('✅ System resources check completed');
    }

    isPackageInstalled(packageName) {
        try {
            switch (this.packageManager) {
                case 'apt':
                    execSync(`dpkg -l | grep -q "^ii  ${packageName}"`, { stdio: 'ignore' });
                    return true;
                case 'yum':
                case 'dnf':
                    execSync(`${this.packageManager} list installed ${packageName}`, { stdio: 'ignore' });
                    return true;
                case 'pacman':
                    execSync(`pacman -Q ${packageName}`, { stdio: 'ignore' });
                    return true;
                default:
                    return false;
            }
        } catch (error) {
            return false;
        }
    }

    async generateReport() {
        console.log('\n📊 DEPENDENCY CHECK REPORT');
        console.log('==========================');
        
        if (this.missingDependencies.length === 0 && this.warnings.length === 0) {
            console.log('🎉 All dependencies are satisfied! Your system is ready for crawler deployment.');
        } else {
            if (this.missingDependencies.length > 0) {
                console.log('\n❌ MISSING DEPENDENCIES:');
                this.missingDependencies.forEach(dep => console.log(`   - ${dep}`));
                
                console.log('\n🔧 INSTALLATION COMMANDS:');
                this.generateInstallCommands();
            }
            
            if (this.warnings.length > 0) {
                console.log('\n⚠️  WARNINGS:');
                this.warnings.forEach(warning => console.log(`   - ${warning}`));
            }
        }
        
        console.log('\n📚 For more information, see the Linux deployment documentation.');
    }

    generateInstallCommands() {
        const systemDeps = this.missingDependencies.filter(dep => !dep.startsWith('npm package:'));
        const npmDeps = this.missingDependencies.filter(dep => dep.startsWith('npm package:'));
        
        if (systemDeps.length > 0) {
            switch (this.packageManager) {
                case 'apt':
                    console.log(`   sudo apt update && sudo apt install -y ${systemDeps.join(' ')}`);
                    break;
                case 'yum':
                    console.log(`   sudo yum install -y ${systemDeps.join(' ')}`);
                    break;
                case 'dnf':
                    console.log(`   sudo dnf install -y ${systemDeps.join(' ')}`);
                    break;
                default:
                    console.log(`   Install these packages using your package manager: ${systemDeps.join(', ')}`);
            }
        }
        
        if (npmDeps.length > 0) {
            const packages = npmDeps.map(dep => dep.replace('npm package: ', '')).join(' ');
            console.log(`   npm install ${packages}`);
        }
        
        // Chrome installation
        if (!fs.existsSync('/usr/bin/google-chrome-stable') && !fs.existsSync('/usr/bin/chromium-browser')) {
            console.log('\n   # Install Google Chrome (recommended):');
            console.log('   wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo apt-key add -');
            console.log('   echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list');
            console.log('   sudo apt update && sudo apt install -y google-chrome-stable');
        }
    }
}

// Run the checker if this script is executed directly
if (require.main === module) {
    const checker = new LinuxDependencyChecker();
    checker.checkAll().catch(error => {
        console.error('Error running dependency check:', error);
        process.exit(1);
    });
}

module.exports = LinuxDependencyChecker;
