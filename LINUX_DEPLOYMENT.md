# Linux VPS Deployment Guide

## Quick Setup for Debian/Ubuntu VPS

### 1. Automated Installation

```bash
# Upload project to your VPS and run:
chmod +x scripts/install-linux.sh
./scripts/install-linux.sh
```

**Note**: Can be run as root or regular user with sudo privileges.

This script will automatically:
- Install Node.js 18+
- Install Google Chrome
- Install system dependencies
- Install npm packages
- Create environment file
- Set up systemd service (optional)

### 2. Manual Configuration

Edit the environment file:
```bash
cp .env.example .env
nano .env
```

Key settings for VPS:
```env
NODE_ENV=production
PORT=3000
PROXY_URL=http://proxybird:proxybird@155.254.39.107:6065
CHROME_PATH=/usr/bin/google-chrome-stable
```

### 3. Start the Application

Choose one method:

**Option A: PM2 (Recommended for production)**
```bash
npm run start:pm2
```

**Option B: Systemd Service**
```bash
npm run start:systemd
```

**Option C: Direct Node.js**
```bash
npm start
```

### 4. Access the Application

Open in browser: `http://your-vps-ip:3000`

Default login:
- Username: `admin`
- Password: `admin123`

⚠️ **Change the password in production!**

## File Structure (Essential Files Only)

```
crawler-nodejs/
├── config/
│   └── environment.js          # Environment configuration
├── scripts/
│   ├── install-linux.sh        # Auto installation
│   ├── start-crawler.sh        # Startup script
│   └── stop-crawler.sh         # Stop script
├── public/                     # Web interface
├── crawler-categories.js       # Categories crawler
├── crawler-girl.js            # Profile crawler
├── server.js                  # Web server
├── .env.example               # Environment template
├── LINUX_SETUP.md            # Detailed setup guide
└── package.json               # Dependencies
```

## Management Commands

```bash
# Start application
npm run start:pm2              # With PM2
npm run start:systemd          # With systemd
npm run start:linux            # Direct start

# Stop application
npm run stop:linux

# View logs
pm2 logs fgirl-crawler         # PM2 logs
journalctl -u fgirl-crawler -f # Systemd logs
```

## Troubleshooting

### Chrome Issues
```bash
# Install Chrome manually if needed
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list
sudo apt update && sudo apt install google-chrome-stable
```

### Memory Issues
```bash
# Add swap if low memory
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

### Port Issues
```bash
# Check if port 3000 is in use
sudo netstat -tulpn | grep :3000
```

## Security Setup

1. **Change default password** in the web interface
2. **Configure firewall**:
   ```bash
   sudo ufw allow 3000
   sudo ufw enable
   ```
3. **Use environment variables** for sensitive data in `.env`

## What Changed for Linux

- ✅ **Chrome paths**: Auto-detects Linux Chrome/Chromium installations
- ✅ **Browser args**: Optimized for headless VPS environments
- ✅ **Memory usage**: Reduced with `--disable-dev-shm-usage`
- ✅ **Process management**: PM2 and systemd support
- ✅ **Environment config**: Centralized configuration system

The project now works seamlessly on Linux VPS without any macOS dependencies.
