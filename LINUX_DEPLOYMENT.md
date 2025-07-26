# Linux Deployment Guide for Crawler Applications

This guide provides comprehensive instructions for deploying the crawler applications (`crawler-categories.js` and `crawler-girl.js`) on Linux servers in production environments.

## Table of Contents

1. [System Requirements](#system-requirements)
2. [Quick Setup](#quick-setup)
3. [Manual Installation](#manual-installation)
4. [Configuration](#configuration)
5. [Running the Crawlers](#running-the-crawlers)
6. [Troubleshooting](#troubleshooting)
7. [Performance Optimization](#performance-optimization)
8. [Monitoring and Maintenance](#monitoring-and-maintenance)

## System Requirements

### Minimum Requirements
- **OS**: Linux (Ubuntu 18.04+, CentOS 7+, Debian 9+, or equivalent)
- **RAM**: 2GB minimum, 4GB recommended
- **CPU**: 2 cores minimum
- **Storage**: 5GB free space
- **Network**: Stable internet connection

### Supported Linux Distributions
- Ubuntu 18.04, 20.04, 22.04
- CentOS 7, 8
- RHEL 7, 8
- Debian 9, 10, 11
- Amazon Linux 2
- Other systemd-based distributions

## Quick Setup

### 1. Automated Setup (Recommended)

```bash
# Clone or upload the project to your Linux server
cd /path/to/crawler-nodejs

# Install Node.js dependencies
npm install

# Check system dependencies and setup
npm run setup-linux

# Verify installation
npm run check-deps
```

### 2. Start Crawling

```bash
# Run category crawler
npm run production-start

# Run profile detail crawler
npm run production-girl

# Check application health
npm run health-check
```

## Manual Installation

### 1. Install Node.js

```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# CentOS/RHEL
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo yum install -y nodejs
```

### 2. Install System Dependencies

#### Ubuntu/Debian:
```bash
sudo apt update
sudo apt install -y ca-certificates fonts-liberation libappindicator3-1 \
    libasound2 libatk-bridge2.0-0 libdrm2 libgtk-3-0 libnspr4 \
    libnss3 libxss1 libxtst6 xdg-utils
```

#### CentOS/RHEL:
```bash
sudo yum install -y alsa-lib atk cups-libs gtk3 libdrm libX11 \
    libXcomposite libXdamage libXext libXfixes libXrandr \
    libXss libXtst nss pango
```

### 3. Install Chrome/Chromium

#### Option A: Google Chrome (Recommended)
```bash
# Ubuntu/Debian
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list
sudo apt update
sudo apt install -y google-chrome-stable

# CentOS/RHEL
sudo yum install -y wget
wget https://dl.google.com/linux/direct/google-chrome-stable_current_x86_64.rpm
sudo yum localinstall -y google-chrome-stable_current_x86_64.rpm
```

#### Option B: Chromium
```bash
# Ubuntu/Debian
sudo apt install -y chromium-browser

# CentOS/RHEL
sudo yum install -y chromium
```

### 4. Install Project Dependencies

```bash
cd /path/to/crawler-nodejs
npm install
```

## Configuration

### Environment Variables

Create a `.env` file for production configuration:

```bash
# .env
NODE_ENV=production
CRAWLER_HEADLESS=true
CRAWLER_TIMEOUT=30000
CRAWLER_MAX_THREADS=10
CRAWLER_DELAY=100
```

### Memory Configuration

For servers with limited memory, adjust Node.js memory settings:

```bash
# Set max memory to 2GB
export NODE_OPTIONS="--max-old-space-size=2048"

# Or add to your startup script
node --max-old-space-size=2048 crawler-categories.js
```

## Running the Crawlers

### Development Mode

```bash
# Run individual crawlers
node crawler-categories.js
node crawler-girl.js
```

### Production Mode

```bash
# Using npm scripts (recommended)
npm run production-start    # Categories crawler
npm run production-girl     # Profile details crawler

# Direct execution with production settings
NODE_ENV=production node crawler-categories.js
NODE_ENV=production node crawler-girl.js
```

### Background Execution

```bash
# Using nohup
nohup npm run production-start > categories.log 2>&1 &
nohup npm run production-girl > profiles.log 2>&1 &

# Using screen
screen -S categories npm run production-start
screen -S profiles npm run production-girl

# Using systemd (see systemd service examples below)
```

### Systemd Service Setup

Create service files for automatic startup:

#### Categories Crawler Service
```bash
sudo tee /etc/systemd/system/crawler-categories.service > /dev/null <<EOF
[Unit]
Description=Fgirl Categories Crawler
After=network.target

[Service]
Type=simple
User=crawler
WorkingDirectory=/path/to/crawler-nodejs
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm run production-start
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
```

#### Enable and start services
```bash
sudo systemctl daemon-reload
sudo systemctl enable crawler-categories
sudo systemctl start crawler-categories
sudo systemctl status crawler-categories
```

## Troubleshooting

### Common Issues

#### 1. Chrome/Chromium Not Found
```bash
# Check if Chrome is installed
which google-chrome-stable
which chromium-browser

# Install if missing
npm run install-chrome-linux
```

#### 2. Permission Denied Errors
```bash
# Fix permissions
sudo chown -R $USER:$USER /path/to/crawler-nodejs
chmod +x linux-deps-check.js
```

#### 3. Memory Issues
```bash
# Check memory usage
free -h
npm run health-check

# Reduce concurrent threads in crawler configuration
# Edit crawler files and reduce MAX_CONCURRENT_THREADS
```

#### 4. Network/Proxy Issues
```bash
# Test network connectivity
curl -I https://www.en.fgirl.ch/

# Check proxy configuration in crawler files
# Verify proxy credentials and server
```

### Debug Mode

Enable debug logging:

```bash
DEBUG=puppeteer:* node crawler-categories.js
```

### Dependency Check

Run the comprehensive dependency checker:

```bash
npm run check-deps
```

## Performance Optimization

### 1. System Tuning

```bash
# Increase file descriptor limits
echo "* soft nofile 65536" | sudo tee -a /etc/security/limits.conf
echo "* hard nofile 65536" | sudo tee -a /etc/security/limits.conf

# Optimize memory settings
echo "vm.swappiness=10" | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

### 2. Application Tuning

- Adjust `MAX_CONCURRENT_THREADS` based on server capacity
- Increase `DELAY_BETWEEN_REQUESTS` if getting rate limited
- Monitor memory usage and adjust Node.js heap size

### 3. Resource Monitoring

```bash
# Monitor resource usage
htop
iotop
nethogs

# Monitor crawler logs
tail -f categories.log
tail -f profiles.log
```

## Monitoring and Maintenance

### Log Management

```bash
# Rotate logs to prevent disk space issues
sudo logrotate -f /etc/logrotate.conf

# Monitor log sizes
du -sh *.log *.csv
```

### Health Checks

```bash
# Regular health check
npm run health-check

# Check crawler status
ps aux | grep node
systemctl status crawler-categories
```

### Backup and Recovery

```bash
# Backup CSV data
tar -czf backup-$(date +%Y%m%d).tar.gz *.csv

# Backup configuration
cp package.json .env backup/
```

## Security Considerations

1. **Run as non-root user**: Create a dedicated user for the crawler
2. **Firewall**: Only open necessary ports
3. **Updates**: Keep system and dependencies updated
4. **Monitoring**: Set up log monitoring for suspicious activity

## Support

For issues specific to Linux deployment:

1. Check the troubleshooting section above
2. Run `npm run check-deps` for dependency issues
3. Review system logs: `journalctl -u crawler-categories`
4. Monitor resource usage during operation

---

**Note**: This deployment guide assumes a headless Linux server environment. The crawlers have been optimized to work without GUI components and include comprehensive error handling for production use.
