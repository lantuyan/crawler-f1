#!/bin/bash

# Fgirl Crawler - Stop Script
# This script stops the crawler application gracefully

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
}

# Function to stop PM2 process
stop_pm2() {
    log "Stopping PM2 process..."
    
    if command -v pm2 &> /dev/null; then
        if pm2 list | grep -q "fgirl-crawler"; then
            pm2 stop fgirl-crawler
            pm2 delete fgirl-crawler
            log "PM2 process stopped and deleted"
        else
            warn "No PM2 process named 'fgirl-crawler' found"
        fi
    else
        warn "PM2 is not installed"
    fi
}

# Function to stop systemd service
stop_systemd() {
    log "Stopping systemd service..."
    
    if systemctl is-active --quiet fgirl-crawler; then
        sudo systemctl stop fgirl-crawler
        log "Systemd service stopped"
    else
        warn "Systemd service is not running"
    fi
}

# Function to stop Node.js process by PID
stop_by_pid() {
    log "Stopping Node.js process by PID..."
    
    if [ -f "logs/app.pid" ]; then
        PID=$(cat logs/app.pid)
        if kill -0 "$PID" 2>/dev/null; then
            log "Stopping process with PID: $PID"
            kill -TERM "$PID"
            
            # Wait for graceful shutdown
            for i in {1..10}; do
                if ! kill -0 "$PID" 2>/dev/null; then
                    log "Process stopped gracefully"
                    rm -f logs/app.pid
                    return 0
                fi
                sleep 1
            done
            
            # Force kill if still running
            warn "Process didn't stop gracefully, forcing termination"
            kill -KILL "$PID" 2>/dev/null || true
            rm -f logs/app.pid
            log "Process terminated"
        else
            warn "Process with PID $PID is not running"
            rm -f logs/app.pid
        fi
    else
        warn "PID file not found"
    fi
}

# Function to stop all Node.js processes related to the project
stop_all_node_processes() {
    log "Stopping all related Node.js processes..."
    
    # Find processes running server.js
    PIDS=$(pgrep -f "node.*server.js" || true)
    
    if [ -n "$PIDS" ]; then
        log "Found Node.js processes: $PIDS"
        for PID in $PIDS; do
            log "Stopping process $PID"
            kill -TERM "$PID" 2>/dev/null || true
        done
        
        # Wait for graceful shutdown
        sleep 3
        
        # Check if any are still running and force kill
        REMAINING_PIDS=$(pgrep -f "node.*server.js" || true)
        if [ -n "$REMAINING_PIDS" ]; then
            warn "Some processes didn't stop gracefully, forcing termination"
            for PID in $REMAINING_PIDS; do
                kill -KILL "$PID" 2>/dev/null || true
            done
        fi
        
        log "All Node.js processes stopped"
    else
        warn "No Node.js processes found"
    fi
}

# Function to stop Chrome/Chromium processes
stop_chrome_processes() {
    log "Stopping Chrome/Chromium processes..."
    
    # Find Chrome processes that might be left running
    CHROME_PIDS=$(pgrep -f "chrome|chromium" || true)
    
    if [ -n "$CHROME_PIDS" ]; then
        log "Found Chrome/Chromium processes: $CHROME_PIDS"
        for PID in $CHROME_PIDS; do
            # Check if it's a process started by our user
            if ps -o user= -p "$PID" 2>/dev/null | grep -q "^$(whoami)$"; then
                log "Stopping Chrome process $PID"
                kill -TERM "$PID" 2>/dev/null || true
            fi
        done
        
        # Wait a moment
        sleep 2
        
        # Force kill remaining processes
        REMAINING_CHROME_PIDS=$(pgrep -f "chrome|chromium" || true)
        if [ -n "$REMAINING_CHROME_PIDS" ]; then
            for PID in $REMAINING_CHROME_PIDS; do
                if ps -o user= -p "$PID" 2>/dev/null | grep -q "^$(whoami)$"; then
                    kill -KILL "$PID" 2>/dev/null || true
                fi
            done
        fi
        
        log "Chrome/Chromium processes stopped"
    else
        log "No Chrome/Chromium processes found"
    fi
}

# Parse command line arguments
STOP_METHOD="all"
FORCE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --pm2)
            STOP_METHOD="pm2"
            shift
            ;;
        --systemd)
            STOP_METHOD="systemd"
            shift
            ;;
        --node)
            STOP_METHOD="node"
            shift
            ;;
        --force)
            FORCE=true
            shift
            ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --pm2       Stop PM2 process only"
            echo "  --systemd   Stop systemd service only"
            echo "  --node      Stop Node.js processes only"
            echo "  --force     Force stop all related processes"
            echo "  --help      Show this help message"
            echo ""
            echo "Default: Stop all methods"
            exit 0
            ;;
        *)
            error "Unknown option: $1. Use --help for usage information."
            ;;
    esac
done

log "Stopping Fgirl Crawler application..."

# Stop based on the selected method
case $STOP_METHOD in
    "pm2")
        stop_pm2
        ;;
    "systemd")
        stop_systemd
        ;;
    "node")
        stop_by_pid
        stop_all_node_processes
        ;;
    "all")
        stop_systemd
        stop_pm2
        stop_by_pid
        stop_all_node_processes
        ;;
    *)
        error "Invalid stop method: $STOP_METHOD"
        ;;
esac

# Force stop if requested
if [ "$FORCE" = true ]; then
    log "Force stopping all related processes..."
    stop_all_node_processes
    stop_chrome_processes
fi

# Clean up temporary files
log "Cleaning up temporary files..."
rm -f logs/app.pid
rm -rf tmp/*

# Check if any processes are still running
REMAINING_PROCESSES=$(pgrep -f "node.*server.js" || true)
if [ -n "$REMAINING_PROCESSES" ]; then
    warn "Some processes might still be running: $REMAINING_PROCESSES"
    warn "Use --force option to forcefully terminate all processes"
else
    log "All processes stopped successfully"
fi

log "Stop operation completed"
