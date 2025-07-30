#!/bin/bash

# Quick fix script for memory issues
# This script stops the current crawler and restarts it with memory optimization

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}"
}

log "🚨 Fixing memory issue - stopping current crawler and restarting with optimization"

# Stop PM2 process if running
if command -v pm2 &> /dev/null; then
    log "Stopping PM2 fgirl-crawler process..."
    pm2 stop fgirl-crawler 2>/dev/null || true
    pm2 delete fgirl-crawler 2>/dev/null || true
    log "PM2 process stopped"
fi

# Kill any remaining node processes
log "Killing any remaining node processes..."
pkill -f "server.js" 2>/dev/null || true
pkill -f "fgirl-crawler" 2>/dev/null || true

# Wait for processes to stop
sleep 3

# Clear any temporary files that might be consuming memory
log "Cleaning up temporary files..."
rm -rf tmp/* 2>/dev/null || true
rm -rf logs/*.log 2>/dev/null || true

# Force garbage collection if possible
if command -v node &> /dev/null; then
    log "Triggering system cleanup..."
    node -e "if (global.gc) global.gc(); console.log('Cleanup completed');" 2>/dev/null || true
fi

# Check current memory usage
log "Current memory usage:"
free -h || echo "Memory info not available"

# Start with memory optimization
log "Starting crawler with memory optimization..."

# Check if we're on Linux (production) or macOS (development)
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux - use the optimized startup script
    if [ -f "scripts/start-with-memory-optimization.sh" ]; then
        log "Using memory-optimized startup script for Linux"
        exec ./scripts/start-with-memory-optimization.sh --pm2
    else
        # Fallback to regular script with memory flags
        log "Using regular startup script with memory flags"
        export NODE_OPTIONS="--max-old-space-size=16384 --max-semi-space-size=1024 --expose-gc --optimize-for-size"
        exec ./scripts/start-crawler.sh --pm2
    fi
elif [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS - use regular script with memory flags
    log "macOS detected - using regular startup with memory optimization"
    export NODE_OPTIONS="--max-old-space-size=16384 --max-semi-space-size=1024 --expose-gc --optimize-for-size"
    
    if command -v pm2 &> /dev/null; then
        log "Starting with PM2..."
        pm2 start server.js --name "fgirl-crawler" \
            --max-memory-restart 14G \
            --node-args="$NODE_OPTIONS" \
            --kill-timeout 30000 \
            --restart-delay 5000
        pm2 save
        log "Started with PM2 and memory optimization"
    else
        log "PM2 not available, starting with Node.js directly..."
        node server.js
    fi
else
    error "Unsupported operating system: $OSTYPE"
fi
