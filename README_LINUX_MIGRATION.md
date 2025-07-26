# Linux Migration Summary

## Overview

The crawler applications (`crawler-categories.js` and `crawler-girl.js`) have been successfully modified to work on headless Linux servers for production deployment. This document summarizes the changes made and provides quick reference for deployment.

## Key Changes Made

### 1. ✅ Cross-Platform Chrome Detection
- **Before**: Only checked macOS Chrome paths (`/Applications/Google Chrome.app/...`)
- **After**: Prioritizes Linux paths with comprehensive fallback options
- **Files Modified**: `crawler-categories.js`, `crawler-girl.js`, `crawler.js`

**New Chrome Detection Order:**
1. Linux production paths (`/usr/bin/google-chrome-stable`, `/usr/bin/chromium-browser`, etc.)
2. macOS development paths (for local testing)
3. Puppeteer bundled Chromium (fallback)

### 2. ✅ Linux-Optimized Browser Configurations
- **Before**: Generic headless configurations
- **After**: Linux-specific optimizations for headless servers

**Key Improvements:**
- Memory optimization (`--memory-pressure-off`, `--max_old_space_size=4096`)
- Stability arguments (`--no-zygote`, `--single-process`)
- Linux-specific display handling (`--disable-software-rasterizer`)
- Enhanced error handling and fallback configurations

### 3. ✅ Removed GUI Dependencies
- **Before**: Had non-headless fallback (`headless: false`)
- **After**: All configurations are headless-only for production

### 4. ✅ System Dependency Management
- **New File**: `linux-deps-check.js` - Comprehensive dependency checker
- **Features**: 
  - Detects Linux distribution and package manager
  - Checks system dependencies (fonts, libraries, etc.)
  - Verifies Chrome/Chromium installation
  - Provides installation commands for missing dependencies

### 5. ✅ Enhanced Package.json
- **New Scripts**: 
  - `npm run check-deps` - Run dependency checker
  - `npm run setup-linux` - Automated Linux setup
  - `npm run production-start` - Production mode for categories
  - `npm run production-girl` - Production mode for profiles
  - `npm test` - Linux compatibility test suite

### 6. ✅ Comprehensive Documentation
- **New File**: `LINUX_DEPLOYMENT.md` - Complete deployment guide
- **Covers**: System requirements, installation, configuration, troubleshooting

### 7. ✅ Testing and Validation
- **New File**: `test-linux-compatibility.js` - Automated compatibility testing
- **Tests**: Browser launch, headless operation, network connectivity, file operations

## Quick Deployment Guide

### 1. Pre-Deployment Check
```bash
# Check system compatibility
npm run check-deps

# Run compatibility tests
npm test
```

### 2. Automated Setup (Ubuntu/Debian)
```bash
# Install system dependencies
npm run install-deps-ubuntu

# Setup Chrome and verify
npm run setup-linux
```

### 3. Production Deployment
```bash
# Start category crawler
npm run production-start

# Start profile crawler (in separate terminal/screen)
npm run production-girl

# Monitor health
npm run health-check
```

## System Requirements

### Minimum Requirements
- **OS**: Linux (Ubuntu 18.04+, CentOS 7+, or equivalent)
- **RAM**: 2GB minimum, 4GB recommended
- **CPU**: 2 cores minimum
- **Storage**: 5GB free space

### Required Packages (Auto-installed)
- Chrome/Chromium browser
- System fonts and libraries
- Node.js 16+ and npm

## File Changes Summary

| File | Changes | Purpose |
|------|---------|---------|
| `crawler-categories.js` | Chrome paths, browser config | Linux compatibility |
| `crawler-girl.js` | Chrome paths, browser config | Linux compatibility |
| `crawler.js` | Chrome paths, browser config | Linux compatibility |
| `package.json` | New scripts, metadata | Deployment automation |
| `linux-deps-check.js` | **NEW** | Dependency verification |
| `test-linux-compatibility.js` | **NEW** | Compatibility testing |
| `LINUX_DEPLOYMENT.md` | **NEW** | Deployment documentation |

## Verification Commands

```bash
# Check all dependencies
npm run check-deps

# Test Linux compatibility
npm test

# Verify Chrome detection
node -e "console.log(require('fs').existsSync('/usr/bin/google-chrome-stable'))"

# Test basic browser launch
node -e "require('puppeteer').launch({headless:'new',args:['--no-sandbox']}).then(b=>b.close())"
```

## Production Considerations

### 1. **Memory Management**
- Monitor memory usage: `free -h`
- Adjust concurrent threads based on available RAM
- Set Node.js memory limits: `--max-old-space-size=2048`

### 2. **Process Management**
- Use systemd services for auto-restart
- Implement log rotation
- Monitor with `htop` or similar tools

### 3. **Network Configuration**
- Verify proxy settings if using proxy
- Test target website connectivity
- Configure firewall rules if needed

### 4. **Security**
- Run as non-root user
- Keep system and dependencies updated
- Monitor logs for suspicious activity

## Troubleshooting Quick Reference

| Issue | Solution |
|-------|----------|
| Chrome not found | `npm run install-chrome-linux` |
| Permission denied | `sudo chown -R $USER:$USER .` |
| Memory errors | Reduce concurrent threads, increase swap |
| Network timeouts | Check proxy settings, increase timeouts |
| Browser crashes | Install missing system dependencies |

## Next Steps

1. **Deploy to staging environment** and run full test suite
2. **Monitor performance** and adjust configurations as needed
3. **Set up monitoring** and alerting for production
4. **Create backup procedures** for CSV data
5. **Document any environment-specific configurations**

---

**Status**: ✅ Ready for Linux production deployment

The crawlers are now fully compatible with headless Linux servers and include comprehensive tooling for deployment, monitoring, and troubleshooting.
