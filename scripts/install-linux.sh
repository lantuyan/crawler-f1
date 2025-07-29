#!/bin/bash

# Fgirl Crawler - Linux Installation Script
# This script automates the installation process on Debian/Ubuntu systems

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}"
    exit 1
}

# Check if running as root and handle accordingly
if [[ $EUID -eq 0 ]]; then
    warn "Running as root. Will install system packages directly."
    SUDO_CMD=""
else
    # Check if sudo is available
    if ! command -v sudo &> /dev/null; then
        error "sudo is required but not installed. Please install sudo first or run as root."
    fi
    SUDO_CMD="sudo"
fi

log "Starting Fgirl Crawler Linux installation..."

# Update system packages
log "Updating system packages..."
$SUDO_CMD apt update && $SUDO_CMD apt upgrade -y

# Install Node.js
log "Installing Node.js..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | $SUDO_CMD -E bash -
    $SUDO_CMD apt-get install -y nodejs
    log "Node.js installed successfully"
else
    log "Node.js is already installed: $(node --version)"
fi

# Install Google Chrome
log "Installing Google Chrome..."
if ! command -v google-chrome-stable &> /dev/null; then
    wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | $SUDO_CMD apt-key add -
    echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" | $SUDO_CMD tee /etc/apt/sources.list.d/google-chrome.list
    $SUDO_CMD apt update
    $SUDO_CMD apt install -y google-chrome-stable
    log "Google Chrome installed successfully"
else
    log "Google Chrome is already installed: $(google-chrome-stable --version)"
fi

# Install system dependencies
log "Installing system dependencies..."
$SUDO_CMD apt install -y \
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
    libgdk-pixbuf2.0-0 \
    fonts-liberation \
    fonts-dejavu-core

# Install project dependencies
log "Installing Node.js project dependencies..."
if [ -f "package.json" ]; then
    npm install
    log "Project dependencies installed successfully"
else
    warn "package.json not found. Make sure you're in the project directory."
fi

# Create environment file
log "Creating environment configuration..."
if [ ! -f ".env" ]; then
    cat > .env << EOF
NODE_ENV=production
PORT=3000
CHROME_PATH=/usr/bin/google-chrome-stable
# Proxy functionality disabled for production server environment
# PROXY_URL=
EOF
    log "Environment file created: .env"
else
    log "Environment file already exists: .env"
fi

# Set proper permissions
log "Setting file permissions..."
chmod +x *.js
chmod +x scripts/*.sh

# Test installation
log "Testing installation..."
if node --version && google-chrome-stable --version; then
    log "Installation test passed!"
else
    error "Installation test failed!"
fi

# Create systemd service
read -p "Do you want to create a systemd service? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    log "Creating systemd service..."
    
    # Get current directory
    CURRENT_DIR=$(pwd)
    
    # Create service file
    $SUDO_CMD tee /etc/systemd/system/fgirl-crawler.service > /dev/null <<EOF
[Unit]
Description=Fgirl Crawler Web Application
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$CURRENT_DIR
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

    # Reload systemd and enable service
    $SUDO_CMD systemctl daemon-reload
    $SUDO_CMD systemctl enable fgirl-crawler

    log "Systemd service created and enabled"
    log "You can start it with: $SUDO_CMD systemctl start fgirl-crawler"
    log "Check status with: $SUDO_CMD systemctl status fgirl-crawler"
fi

# Install PM2 (optional)
read -p "Do you want to install PM2 for process management? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    log "Installing PM2..."
    $SUDO_CMD npm install -g pm2
    log "PM2 installed successfully"
    log "You can start the app with: pm2 start server.js --name fgirl-crawler"
fi

log "Installation completed successfully!"
log ""
log "Next steps:"
log "1. Review and update the .env file with your configuration"
log "2. Test the application: node server.js"
log "3. Start the service: $SUDO_CMD systemctl start fgirl-crawler (if created)"
log "4. Check the application at: http://your-server-ip:3000"
log ""
log "For troubleshooting, check the logs:"
log "- Application logs: journalctl -u fgirl-crawler -f"
log "- PM2 logs: pm2 logs fgirl-crawler (if using PM2)"
