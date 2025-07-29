#!/bin/bash

# Production Deployment Script for Distributed Crawling System
# This script sets up the crawler for production deployment on Linux servers

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] INFO: $1${NC}"
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARN: $1${NC}"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}"
}

info() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] INFO: $1${NC}"
}

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    warn "Running as root. Consider using a non-root user for security."
fi

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

log "Starting production deployment..."
log "Project directory: $PROJECT_DIR"

# Change to project directory
cd "$PROJECT_DIR"

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    error "package.json not found. Are you in the correct directory?"
    exit 1
fi

# Check system requirements
log "Checking system requirements..."

# Check Node.js
if ! command -v node &> /dev/null; then
    error "Node.js is not installed. Please install Node.js 16 or higher."
    exit 1
fi

NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 16 ]; then
    error "Node.js version 16 or higher is required. Current version: $(node --version)"
    exit 1
fi

log "Node.js version: $(node --version) ✓"

# Check npm
if ! command -v npm &> /dev/null; then
    error "npm is not installed."
    exit 1
fi

log "npm version: $(npm --version) ✓"

# Check available memory
AVAILABLE_MEMORY=$(free -m | awk 'NR==2{printf "%.0f", $7}')
if [ "$AVAILABLE_MEMORY" -lt 1024 ]; then
    warn "Low available memory: ${AVAILABLE_MEMORY}MB. Recommended: 2GB+"
fi

# Check available disk space
AVAILABLE_SPACE=$(df . | tail -1 | awk '{print $4}')
if [ "$AVAILABLE_SPACE" -lt 2097152 ]; then  # Less than 2GB
    warn "Low disk space available: $(df -h . | tail -1 | awk '{print $4}')"
fi

# Install dependencies
log "Installing dependencies..."
npm install --production

# Create necessary directories
log "Creating necessary directories..."
mkdir -p logs tmp uploads backups

# Set proper permissions
chmod 755 logs tmp uploads backups

# Copy production environment file
if [ ! -f ".env" ]; then
    if [ -f ".env.production" ]; then
        log "Copying production environment configuration..."
        cp .env.production .env
        warn "Please review and update .env file with your specific settings!"
    else
        warn "No .env file found. Please create one based on .env.example"
    fi
else
    log ".env file already exists"
fi

# Check Chrome/Chromium installation
log "Checking Chrome/Chromium installation..."
CHROME_PATHS=(
    "/usr/bin/google-chrome"
    "/usr/bin/google-chrome-stable"
    "/usr/bin/chromium-browser"
    "/usr/bin/chromium"
    "/snap/bin/chromium"
)

CHROME_FOUND=false
for chrome_path in "${CHROME_PATHS[@]}"; do
    if [ -f "$chrome_path" ]; then
        log "Found Chrome/Chromium at: $chrome_path"
        CHROME_FOUND=true
        break
    fi
done

if [ "$CHROME_FOUND" = false ]; then
    warn "Chrome/Chromium not found. Installing Chromium..."
    
    # Detect package manager and install Chromium
    if command -v apt-get &> /dev/null; then
        sudo apt-get update
        sudo apt-get install -y chromium-browser
    elif command -v yum &> /dev/null; then
        sudo yum install -y chromium
    elif command -v dnf &> /dev/null; then
        sudo dnf install -y chromium
    elif command -v snap &> /dev/null; then
        sudo snap install chromium
    else
        error "Could not install Chromium automatically. Please install it manually."
        exit 1
    fi
fi

# Test Chrome installation
log "Testing Chrome installation..."
if timeout 10 google-chrome --headless --disable-gpu --no-sandbox --dump-dom https://www.google.com > /dev/null 2>&1 || \
   timeout 10 chromium-browser --headless --disable-gpu --no-sandbox --dump-dom https://www.google.com > /dev/null 2>&1 || \
   timeout 10 chromium --headless --disable-gpu --no-sandbox --dump-dom https://www.google.com > /dev/null 2>&1; then
    log "Chrome test successful ✓"
else
    warn "Chrome test failed. The application might have issues with browser automation."
fi

# Test network connectivity
log "Testing network connectivity..."
if curl -s --max-time 10 https://www.google.com > /dev/null; then
    log "Network connectivity test successful ✓"
else
    warn "Network connectivity test failed. Check your internet connection."
fi

# Check firewall settings
log "Checking firewall settings..."
if command -v ufw &> /dev/null; then
    if ufw status | grep -q "Status: active"; then
        if ! ufw status | grep -q "3000"; then
            warn "Port 3000 might not be open in UFW firewall."
            info "To open port 3000, run: sudo ufw allow 3000"
        fi
    fi
elif command -v firewall-cmd &> /dev/null; then
    if firewall-cmd --state 2>/dev/null | grep -q "running"; then
        if ! firewall-cmd --list-ports | grep -q "3000"; then
            warn "Port 3000 might not be open in firewalld."
            info "To open port 3000, run: sudo firewall-cmd --permanent --add-port=3000/tcp && sudo firewall-cmd --reload"
        fi
    fi
fi

# Create systemd service file
log "Creating systemd service file..."
cat > /tmp/crawler-nodejs.service << EOF
[Unit]
Description=Crawler NodeJS Application
After=network.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=$PROJECT_DIR
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=crawler-nodejs

[Install]
WantedBy=multi-user.target
EOF

if [ -w "/etc/systemd/system" ] || sudo -n true 2>/dev/null; then
    sudo mv /tmp/crawler-nodejs.service /etc/systemd/system/
    sudo systemctl daemon-reload
    log "Systemd service created. You can now use:"
    info "  sudo systemctl start crawler-nodejs"
    info "  sudo systemctl enable crawler-nodejs"
    info "  sudo systemctl status crawler-nodejs"
else
    warn "Cannot create systemd service (no sudo access). Service file saved to /tmp/crawler-nodejs.service"
fi

# Final checks and information
log "Production deployment completed successfully!"
echo
info "=== DEPLOYMENT SUMMARY ==="
info "Project directory: $PROJECT_DIR"
info "Server will run on: http://0.0.0.0:3000"
info "External access: http://$(curl -s ifconfig.me 2>/dev/null || echo 'YOUR_SERVER_IP'):3000"
info "Dashboard: http://$(curl -s ifconfig.me 2>/dev/null || echo 'YOUR_SERVER_IP'):3000/dashboard"
info "Distributed client: http://$(curl -s ifconfig.me 2>/dev/null || echo 'YOUR_SERVER_IP'):3000/distributed-client"
echo
info "=== NEXT STEPS ==="
info "1. Review and update .env file with your settings"
info "2. Start the application:"
info "   npm start"
info "   OR"
info "   sudo systemctl start crawler-nodejs"
info "3. Open the dashboard in your browser"
info "4. For distributed crawling, share the client URL with workers"
echo
warn "=== SECURITY REMINDERS ==="
warn "1. Change default admin password in .env file"
warn "2. Update SESSION_SECRET in .env file"
warn "3. Configure firewall to allow port 3000"
warn "4. Consider using HTTPS in production"
echo
log "Deployment script completed!"
