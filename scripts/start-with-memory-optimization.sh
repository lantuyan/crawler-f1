#!/bin/bash

# Fgirl Crawler - Memory Optimized Startup Script
# This script starts the crawler with comprehensive memory management

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

log "🚀 Starting Fgirl Crawler with Memory Optimization"

# Check system memory
TOTAL_MEMORY_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
TOTAL_MEMORY_GB=$((TOTAL_MEMORY_KB / 1024 / 1024))
AVAILABLE_MEMORY_KB=$(grep MemAvailable /proc/meminfo | awk '{print $2}')
AVAILABLE_MEMORY_GB=$((AVAILABLE_MEMORY_KB / 1024 / 1024))

log "System Memory: ${TOTAL_MEMORY_GB}GB total, ${AVAILABLE_MEMORY_GB}GB available"

# Set memory limits based on available memory
if [ "$TOTAL_MEMORY_GB" -ge 32 ]; then
    NODE_MEMORY="24576"  # 24GB for 32GB+ systems
    MAX_THREADS="10"
    log "Very high-memory system detected: Using 24GB Node.js heap, 10 threads"
elif [ "$TOTAL_MEMORY_GB" -ge 16 ]; then
    NODE_MEMORY="16384"  # 16GB for 16GB+ systems (new default)
    MAX_THREADS="8"
    log "High-memory system detected: Using 16GB Node.js heap, 8 threads"
elif [ "$TOTAL_MEMORY_GB" -ge 8 ]; then
    NODE_MEMORY="8192"   # 8GB for 8GB+ systems
    MAX_THREADS="5"
    log "Medium-memory system detected: Using 8GB Node.js heap, 5 threads"
elif [ "$TOTAL_MEMORY_GB" -ge 4 ]; then
    NODE_MEMORY="4096"   # 4GB for 4GB+ systems
    MAX_THREADS="3"
    log "Low-memory system detected: Using 4GB Node.js heap, 3 threads"
else
    NODE_MEMORY="2048"   # 2GB for systems with less than 4GB
    MAX_THREADS="2"
    warn "Very low memory system: Using 2GB Node.js heap, 2 threads"
fi

# Check available memory vs required
REQUIRED_MEMORY=$((NODE_MEMORY / 1024 + 2))  # Node memory + 2GB buffer
if [ "$AVAILABLE_MEMORY_GB" -lt "$REQUIRED_MEMORY" ]; then
    warn "Available memory (${AVAILABLE_MEMORY_GB}GB) is less than required (${REQUIRED_MEMORY}GB)"
    warn "Consider closing other applications or reducing memory limits"
fi

# Set comprehensive Node.js memory optimization flags
export NODE_OPTIONS="
--max-old-space-size=${NODE_MEMORY}
--max-semi-space-size=512
--optimize-for-size
--gc-interval=100
--expose-gc
--trace-gc
--trace-gc-verbose
--max-new-space-size=256
--initial-old-space-size=1024
"

log "Node.js memory configuration:"
log "  Max heap size: ${NODE_MEMORY}MB"
log "  Max threads: ${MAX_THREADS}"
log "  Garbage collection: Enabled with tracing"

# Set environment variables for the crawler
export CRAWLER_MAX_THREADS="$MAX_THREADS"
export MEMORY_MONITORING="true"
export GC_ENABLED="true"

# Create necessary directories
log "Creating necessary directories..."
mkdir -p logs tmp uploads backups

# Check for existing processes
if pgrep -f "server.js" > /dev/null; then
    warn "Existing server.js process found. Stopping it..."
    pkill -f "server.js" || true
    sleep 2
fi

# Function to start with different methods
start_with_node() {
    log "Starting application with Node.js and memory optimization..."
    log "Memory flags: $NODE_OPTIONS"
    exec node server.js
}

start_with_pm2() {
    log "Starting application with PM2 and memory optimization..."
    
    # Check if PM2 is installed
    if ! command -v pm2 &> /dev/null; then
        error "PM2 is not installed. Install it with: npm install -g pm2"
    fi
    
    # Stop existing instance if running
    pm2 stop fgirl-crawler 2>/dev/null || true
    pm2 delete fgirl-crawler 2>/dev/null || true
    
    # Start with PM2 with optimized settings
    pm2 start server.js --name "fgirl-crawler" \
        --max-memory-restart "${NODE_MEMORY}M" \
        --node-args="$NODE_OPTIONS" \
        --kill-timeout 30000 \
        --restart-delay 5000 \
        --max-restarts 5 \
        --min-uptime 10000
    
    pm2 save
    
    log "Application started with PM2 and memory optimization"
    log "Memory limit: ${NODE_MEMORY}MB with auto-restart"
    log "Use 'pm2 logs fgirl-crawler' to view logs"
    log "Use 'pm2 monit' to monitor memory usage"
    log "Use 'pm2 stop fgirl-crawler' to stop"
}

start_with_systemd() {
    log "Starting application with systemd and memory optimization..."
    
    # Create systemd service file with memory optimization
    cat > /tmp/fgirl-crawler.service << EOF
[Unit]
Description=Fgirl Crawler with Memory Optimization
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$(pwd)
Environment=NODE_OPTIONS="$NODE_OPTIONS"
Environment=CRAWLER_MAX_THREADS="$MAX_THREADS"
Environment=MEMORY_MONITORING="true"
Environment=GC_ENABLED="true"
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=fgirl-crawler
KillMode=mixed
KillSignal=SIGTERM
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
EOF

    # Install service
    sudo mv /tmp/fgirl-crawler.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable fgirl-crawler
    sudo systemctl start fgirl-crawler
    
    log "Application started with systemd and memory optimization"
    log "Use 'sudo systemctl status fgirl-crawler' to check status"
    log "Use 'sudo journalctl -u fgirl-crawler -f' to view logs"
    log "Use 'sudo systemctl stop fgirl-crawler' to stop"
}

# Parse command line arguments
START_METHOD="pm2"  # Default to PM2 for better memory management
DAEMON_MODE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --node)
            START_METHOD="node"
            shift
            ;;
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
            echo "Memory-optimized startup script for Fgirl Crawler"
            echo ""
            echo "Options:"
            echo "  --node      Start with Node.js directly"
            echo "  --pm2       Start with PM2 process manager (default)"
            echo "  --systemd   Start with systemd service"
            echo "  --daemon    Run in background (only with --node)"
            echo "  --help      Show this help message"
            echo ""
            echo "Memory optimization is automatically applied based on system resources."
            exit 0
            ;;
        *)
            error "Unknown option: $1. Use --help for usage information."
            ;;
    esac
done

# Pre-flight memory check
log "Running pre-flight memory checks..."

# Check if we have enough memory to start
if [ "$AVAILABLE_MEMORY_GB" -lt 2 ]; then
    error "Insufficient memory available (${AVAILABLE_MEMORY_GB}GB). Need at least 2GB."
fi

# Check swap space
SWAP_TOTAL_KB=$(grep SwapTotal /proc/meminfo | awk '{print $2}')
SWAP_TOTAL_GB=$((SWAP_TOTAL_KB / 1024 / 1024))
if [ "$SWAP_TOTAL_GB" -lt 2 ]; then
    warn "Low swap space (${SWAP_TOTAL_GB}GB). Consider adding more swap for stability."
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
            log "Starting application in daemon mode with memory optimization..."
            nohup node server.js > logs/application.log 2>&1 &
            echo $! > logs/app.pid
            log "Application started in background. PID: $(cat logs/app.pid)"
            log "Memory limit: ${NODE_MEMORY}MB"
            log "Logs: tail -f logs/application.log"
        else
            start_with_node
        fi
        ;;
    *)
        error "Invalid start method: $START_METHOD"
        ;;
esac

log "🎉 Fgirl Crawler started with memory optimization"
log "Monitor memory usage with: watch -n 5 'free -h && ps aux | grep node'"
