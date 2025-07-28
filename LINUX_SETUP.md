# Linux VPS Setup Guide

## System Requirements

- Debian 10+ or Ubuntu 18.04+
- 2GB RAM minimum
- 10GB free disk space
- Root or sudo access

## Step 1: Update System Packages

```bash
sudo apt update && sudo apt upgrade -y
```

## Step 2: Install Node.js

### Option A: Install Node.js via NodeSource Repository (Recommended)

```bash
# Install Node.js 18.x (LTS)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version
npm --version
```

### Option B: Install via Package Manager (Alternative)

```bash
sudo apt install -y nodejs npm
```

## Step 3: Install Chrome/Chromium

### Option A: Install Google Chrome (Recommended)

```bash
# Download and install Google Chrome
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list
sudo apt update
sudo apt install -y google-chrome-stable
```

### Option B: Install Chromium (Alternative)

```bash
sudo apt install -y chromium-browser
```

### Option C: Install via Snap (Alternative)

```bash
sudo apt install -y snapd
sudo snap install chromium
```

## Step 4: Install Additional Dependencies

```bash
# Install essential build tools and libraries
sudo apt install -y \
    build-essential \
    libgtk-3-dev \
    libnotify-dev \
    libgconf-2-4 \
    libnss3-dev \
    libxss1 \
    libasound2-dev \
    libxtst6 \
    xauth \
    xvfb \
    libgbm-dev \
    libxrandr2 \
    libasound2 \
    libpangocairo-1.0-0 \
    libatk1.0-0 \
    libcairo-gobject2 \
    libgtk-3-0 \
    libgdk-pixbuf2.0-0

# Install fonts for better rendering
sudo apt install -y fonts-liberation fonts-dejavu-core
```

## Step 5: Configure System for Headless Operation

### Create a Virtual Display (Optional, for debugging)

```bash
# Install Xvfb for virtual display
sudo apt install -y xvfb

# Create a startup script for virtual display
sudo tee /etc/systemd/system/xvfb.service > /dev/null <<EOF
[Unit]
Description=X Virtual Frame Buffer Service
After=network.target

[Service]
ExecStart=/usr/bin/Xvfb :1 -screen 0 1024x768x24
Restart=on-abort

[Install]
WantedBy=multi-user.target
EOF

# Enable and start the service
sudo systemctl enable xvfb
sudo systemctl start xvfb
```

## Step 6: Clone and Setup the Project

```bash
# Clone the project (replace with your repository URL)
git clone <your-repository-url> crawler-nodejs
cd crawler-nodejs

# Install Node.js dependencies
npm install

# Make sure the project has proper permissions
chmod +x *.js
```

## Step 7: Configure Environment Variables

```bash
# Create environment configuration
cp .env.example .env  # If you have an example file
# Or create a new .env file with your settings

# Example environment variables
cat > .env << EOF
NODE_ENV=production
PORT=3000
PROXY_URL=http://proxybird:proxybird@155.254.39.107:6065
CHROME_PATH=/usr/bin/google-chrome-stable
EOF
```

## Step 8: Test the Installation

```bash
# Test if Chrome can be launched
google-chrome-stable --version

# Test Node.js application
node --version

# Test the crawler (dry run)
node test-crawlers.js
```

## Step 9: Create Systemd Service (Optional)

```bash
# Create a systemd service file
sudo tee /etc/systemd/system/fgirl-crawler.service > /dev/null <<EOF
[Unit]
Description=Fgirl Crawler Web Application
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/path/to/crawler-nodejs
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Enable and start the service
sudo systemctl enable fgirl-crawler
sudo systemctl start fgirl-crawler
sudo systemctl status fgirl-crawler
```

## Step 10: Configure Firewall (If needed)

```bash
# Allow HTTP and HTTPS traffic
sudo ufw allow 80
sudo ufw allow 443
sudo ufw allow 3000  # If running on port 3000

# Enable firewall
sudo ufw enable
```

## Troubleshooting

### Chrome/Chromium Issues

If you encounter Chrome-related errors:

```bash
# Check Chrome installation
which google-chrome-stable
google-chrome-stable --version

# Test Chrome in headless mode
google-chrome-stable --headless --disable-gpu --no-sandbox --dump-dom https://www.google.com
```

### Memory Issues

If you encounter out-of-memory errors:

```bash
# Add swap space
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Make it permanent
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### Permission Issues

```bash
# Fix file permissions
sudo chown -R $USER:$USER /path/to/crawler-nodejs
chmod +x *.js
```

## Performance Optimization

### For VPS with Limited Resources

1. **Reduce concurrent threads** in crawler configuration
2. **Use minimal browser arguments** (already configured in the updated code)
3. **Monitor memory usage**: `htop` or `free -h`
4. **Use process managers** like PM2 for better resource management

```bash
# Install PM2
npm install -g pm2

# Start application with PM2
pm2 start server.js --name "fgirl-crawler"
pm2 startup
pm2 save
```

## Security Considerations

1. **Use a non-root user** for running the application
2. **Configure proper firewall rules**
3. **Keep system packages updated**
4. **Use environment variables** for sensitive configuration
5. **Consider using a reverse proxy** (nginx) for production

## Next Steps

After completing this setup:

1. Test all crawler functionality
2. Configure monitoring and logging
3. Set up automated backups
4. Configure SSL certificates if needed
5. Set up monitoring dashboards

For any issues, check the application logs:
```bash
# View application logs
journalctl -u fgirl-crawler -f

# Or if using PM2
pm2 logs fgirl-crawler
```
