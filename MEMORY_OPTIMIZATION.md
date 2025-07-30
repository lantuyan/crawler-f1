# Memory Optimization Guide for Fgirl Crawler

## Problem Analysis

The crawler was experiencing **JavaScript heap out of memory errors** causing server crashes and restarts. The error logs showed:

```
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
```

### Root Causes Identified

1. **No Node.js heap size limit** - Default Node.js heap size is too small for large-scale crawling
2. **Memory accumulation in results array** - The `results.push(data)` in crawler-girl.js was accumulating all processed data in memory
3. **Too many concurrent browser instances** - 10 concurrent browsers consuming ~1GB each
4. **No garbage collection optimization** - No forced GC between processing batches
5. **No memory monitoring** - No visibility into memory usage patterns

## Solutions Implemented

### 1. Node.js Memory Configuration

**Updated startup scripts** to include memory optimization flags:

```bash
# Memory limits based on system resources
export NODE_OPTIONS="
--max-old-space-size=16384       # 16GB heap size (new default)
--max-semi-space-size=1024       # 1GB semi-space
--optimize-for-size              # Optimize for memory usage
--expose-gc                      # Enable manual garbage collection
--gc-interval=100                # More frequent GC
"
```

### 2. Code-Level Memory Fixes

**Removed memory accumulation** in `crawler-girl.js`:
- Eliminated `results.push(data)` that was storing all processed data
- Data is now written directly to CSV without memory storage
- Added forced garbage collection every 25 profiles per thread

**Reduced concurrent threads** from 10 to 5 to lower memory pressure.

### 3. Browser Memory Optimization

**Enhanced browser cleanup**:
- Close all pages before closing browser
- Clear cookies, localStorage, and sessionStorage
- Force garbage collection after browser cleanup

### 4. Memory Monitoring

**Added comprehensive memory monitoring**:
- Real-time memory usage tracking
- Warning thresholds (6GB) and critical thresholds (7GB)
- Memory trend analysis
- Automatic garbage collection triggers

### 5. PM2 Configuration

**Optimized PM2 settings**:
```bash
pm2 start server.js --name "fgirl-crawler" \
    --max-memory-restart 14G \
    --node-args="--max-old-space-size=16384 --expose-gc" \
    --kill-timeout 30000 \
    --restart-delay 5000
```

## Quick Fix Instructions

### Immediate Fix (Current Issue)

Run the quick fix script to restart with memory optimization:

```bash
./scripts/fix-memory-issue.sh
```

This script will:
1. Stop the current crawler process
2. Clean up temporary files
3. Restart with memory optimization

### For Future Deployments

Use the memory-optimized startup script:

```bash
# For Linux production servers
./scripts/start-with-memory-optimization.sh --pm2

# For development
./scripts/start-with-memory-optimization.sh --node
```

## Memory Usage Guidelines

### System Requirements

| System Memory | Recommended Settings | Max Threads |
|---------------|---------------------|-------------|
| 32GB+         | 24GB Node heap      | 10 threads  |
| 16GB+         | 16GB Node heap      | 8 threads   |
| 8GB+          | 8GB Node heap       | 5 threads   |
| 4GB+          | 4GB Node heap       | 3 threads   |
| <4GB          | 2GB Node heap       | 2 threads   |

### Monitoring Commands

```bash
# Monitor memory usage in real-time
watch -n 5 'free -h && ps aux | grep node'

# PM2 memory monitoring
pm2 monit

# Check memory logs
tail -f logs/application.log | grep "Memory Usage"
```

## Configuration Files

### New Files Added

1. **`config/memory-optimization.js`** - Memory monitoring utilities
2. **`scripts/start-with-memory-optimization.sh`** - Optimized startup script
3. **`scripts/fix-memory-issue.sh`** - Quick fix for memory issues

### Modified Files

1. **`scripts/start-crawler.sh`** - Added memory flags
2. **`crawler-girl.js`** - Removed memory leaks, added GC triggers

## Best Practices

### Development

1. **Always use memory flags** when starting Node.js
2. **Monitor memory usage** during development
3. **Test with realistic data volumes** before production

### Production

1. **Use PM2** with memory restart limits
2. **Monitor system memory** regularly
3. **Set up alerts** for high memory usage
4. **Use the optimized startup script**

### Code Guidelines

1. **Avoid accumulating large arrays** in memory
2. **Write data to files immediately** instead of storing in memory
3. **Force garbage collection** after processing batches
4. **Close browser instances properly** with page cleanup

## Troubleshooting

### If Memory Issues Persist

1. **Check system memory**: `free -h`
2. **Reduce concurrent threads** further
3. **Increase swap space** if needed
4. **Monitor with**: `pm2 monit` or `htop`

### Emergency Recovery

```bash
# Kill all node processes
pkill -f node

# Clear temporary files
rm -rf tmp/* logs/*.log

# Restart with minimal settings
NODE_OPTIONS="--max-old-space-size=16384" node server.js
```

## Performance Impact

The memory optimizations provide:

- **Stable operation** without crashes
- **Predictable memory usage** with monitoring
- **Automatic recovery** via PM2 restart limits
- **Better resource utilization** with optimized GC

The trade-offs:
- **Slightly slower processing** due to more frequent GC
- **Reduced concurrent threads** (5 instead of 10)
- **Additional monitoring overhead** (minimal)

## Monitoring Dashboard

The web interface now includes memory monitoring:
- Real-time memory usage graphs
- Memory trend indicators
- Automatic alerts for high usage
- GC trigger logs

Access at: `http://localhost:3001/dashboard`
