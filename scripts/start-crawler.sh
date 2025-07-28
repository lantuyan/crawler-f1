#!/bin/bash

# Fgirl Crawler - Startup Script
# This script starts the crawler application with proper environment setup

set -e

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

# Check if we're in the right directory
if [ ! -f "server.js" ]; then
    error "server.js not found. Please run this script from the project root directory."
fi

# Load environment variables if .env exists
if [ -f ".env" ]; then
    log "Loading environment variables from .env"
    export $(cat .env | grep -v '^#' | xargs)
else
    warn ".env file not found. Using default environment."
fi

# Set default values if not provided
export NODE_ENV=${NODE_ENV:-production}
export PORT=${PORT:-3000}

# Check system requirements
log "Checking system requirements..."

# Check Node.js
if ! command -v node &> /dev/null; then
    error "Node.js is not installed. Please run the installation script first."
fi

# Check Chrome/Chromium
CHROME_FOUND=false
for chrome_path in "/usr/bin/google-chrome-stable" "/usr/bin/google-chrome" "/usr/bin/chromium-browser" "/usr/bin/chromium" "/snap/bin/chromium"; do
    if [ -f "$chrome_path" ]; then
        log "Found Chrome/Chromium at: $chrome_path"
        export CHROME_PATH="$chrome_path"
        CHROME_FOUND=true
        break
    fi
done

if [ "$CHROME_FOUND" = false ]; then
    error "Chrome/Chromium not found. Please install Chrome or Chromium first."
fi

# Check if port is available
if command -v netstat &> /dev/null; then
    if netstat -tuln | grep -q ":$PORT "; then
        warn "Port $PORT is already in use. The application might already be running."
    fi
fi

# Create necessary directories
log "Creating necessary directories..."
mkdir -p logs
mkdir -p tmp
mkdir -p uploads
mkdir -p backups

# Set proper permissions
chmod 755 logs tmp uploads backups

# Check disk space
AVAILABLE_SPACE=$(df . | tail -1 | awk '{print $4}')
if [ "$AVAILABLE_SPACE" -lt 1048576 ]; then  # Less than 1GB
    warn "Low disk space available: $(df -h . | tail -1 | awk '{print $4}')"
fi

# Check memory
AVAILABLE_MEMORY=$(free -m | awk 'NR==2{printf "%.0f", $7}')
if [ "$AVAILABLE_MEMORY" -lt 512 ]; then  # Less than 512MB
    warn "Low memory available: ${AVAILABLE_MEMORY}MB"
fi

# Function to start with different methods
start_with_node() {
    log "Starting application with Node.js..."
    exec node server.js
}

start_with_pm2() {
    log "Starting application with PM2..."
    
    # Check if PM2 is installed
    if ! command -v pm2 &> /dev/null; then
        error "PM2 is not installed. Install it with: npm install -g pm2"
    fi
    
    # Stop existing instance if running
    pm2 stop fgirl-crawler 2>/dev/null || true
    pm2 delete fgirl-crawler 2>/dev/null || true
    
    # Start with PM2
    pm2 start server.js --name "fgirl-crawler" --max-memory-restart 1G
    pm2 save
    
    log "Application started with PM2"
    log "Use 'pm2 logs fgirl-crawler' to view logs"
    log "Use 'pm2 stop fgirl-crawler' to stop"
}

start_with_systemd() {
    log "Starting application with systemd..."

    # Determine sudo command
    local SUDO_CMD=""
    if [[ $EUID -ne 0 ]]; then
        SUDO_CMD="sudo"
    fi

    if ! systemctl is-enabled fgirl-crawler &> /dev/null; then
        error "Systemd service is not enabled. Run the installation script first."
    fi

    $SUDO_CMD systemctl start fgirl-crawler
    $SUDO_CMD systemctl status fgirl-crawler

    log "Application started with systemd"
    log "Use '$SUDO_CMD systemctl status fgirl-crawler' to check status"
    log "Use '$SUDO_CMD systemctl stop fgirl-crawler' to stop"
}

# Parse command line arguments
START_METHOD="node"
DAEMON_MODE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --pm2)
            START_METHOD="pm2"
            shift
            ;;
        --systemd)
            START_METHOD="systemd"
            shift
            ;;
        --daemon)
            DAEMON_MODE=true
            shift
            ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --pm2       Start with PM2 process manager"
            echo "  --systemd   Start with systemd service"
            echo "  --daemon    Run in background (only with --node)"
            echo "  --help      Show this help message"
            echo ""
            echo "Default: Start with Node.js directly"
            exit 0
            ;;
        *)
            error "Unknown option: $1. Use --help for usage information."
            ;;
    esac
done

# Pre-flight checks
log "Running pre-flight checks..."

# Test Chrome
if ! timeout 10 "$CHROME_PATH" --headless --disable-gpu --no-sandbox --dump-dom https://www.google.com > /dev/null 2>&1; then
    warn "Chrome test failed. The application might have issues with browser automation."
fi

# Test network connectivity
if ! curl -s --max-time 10 https://www.google.com > /dev/null; then
    warn "Network connectivity test failed. Check your internet connection."
fi

log "Pre-flight checks completed"

# Start the application based on the selected method
case $START_METHOD in
    "pm2")
        start_with_pm2
        ;;
    "systemd")
        start_with_systemd
        ;;
    "node")
        if [ "$DAEMON_MODE" = true ]; then
            log "Starting application in daemon mode..."
            nohup node server.js > logs/application.log 2>&1 &
            echo $! > logs/app.pid
            log "Application started in background. PID: $(cat logs/app.pid)"
            log "Logs: tail -f logs/application.log"
        else
            start_with_node
        fi
        ;;
    *)
        error "Invalid start method: $START_METHOD"
        ;;
esac
