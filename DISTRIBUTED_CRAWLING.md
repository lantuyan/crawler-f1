# Distributed Crawling System

This document describes the distributed crawling system that allows multiple browser clients to work together to crawl profile data efficiently.

## Overview

The distributed crawling system consists of:

1. **Server Component**: Coordinates tasks and collects results
2. **Client Component**: Browser-based workers that process individual tasks
3. **WebSocket Communication**: Real-time coordination between server and clients

## Architecture

```
┌─────────────────┐    WebSocket    ┌─────────────────┐
│   Server        │◄──────────────►│   Client 1      │
│   (Coordinator) │                 │   (Browser)     │
└─────────────────┘                 └─────────────────┘
         ▲                                   
         │ WebSocket                         
         ▼                                   
┌─────────────────┐                 ┌─────────────────┐
│   Client 2      │                 │   Client N      │
│   (Browser)     │                 │   (Browser)     │
└─────────────────┘                 └─────────────────┘
```

## Features

### Server Features
- **Task Distribution**: Automatically distributes crawling tasks to connected clients
- **Real-time Monitoring**: Live tracking of connected clients and progress
- **Result Collection**: Aggregates results from all clients into CSV files
- **Auto-reconnection Handling**: Robust handling of client disconnections
- **Progress Tracking**: Real-time progress updates and statistics

### Client Features
- **Auto-reconnection**: Automatically reconnects every 1 second if disconnected
- **Connection State Management**: Visual indicators for connection status
- **Task Processing**: Processes individual profile crawling tasks
- **Error Handling**: Graceful handling of failed tasks
- **Real-time Feedback**: Live updates on task completion and failures

## Getting Started

### 1. Server Setup

#### Production Deployment
```bash
# Run the production deployment script
./scripts/deploy-production.sh

# Or manually:
npm install --production
cp .env.production .env
# Edit .env with your settings
npm start
```

#### Development Setup
```bash
npm install
npm start
```

### 2. Access Points

- **Dashboard**: `http://your-server:3000/dashboard`
- **Distributed Client**: `http://your-server:3000/distributed-client`

### 3. Starting Distributed Crawling

1. **Prepare Data**: Run the categories crawler first to generate `list-girl.csv`
2. **Connect Clients**: Open the distributed client URL in multiple browsers
3. **Start Crawling**: Click "Start Distributed Crawling" in the dashboard
4. **Monitor Progress**: Watch real-time progress in both dashboard and clients

## WebSocket Events

### Client → Server Events

| Event | Description | Payload |
|-------|-------------|---------|
| `register-distributed-client` | Register as a distributed client | `{userAgent, timestamp}` |
| `task-completed` | Report successful task completion | `{taskId, url, data, completedAt}` |
| `task-failed` | Report task failure | `{taskId, url, error, failedAt}` |
| `ping` | Connection health check | - |

### Server → Client Events

| Event | Description | Payload |
|-------|-------------|---------|
| `new-task` | Assign new task to client | `{id, url, type}` |
| `stop-crawling` | Request client to stop crawling | - |
| `distributed-state-update` | Update on crawling progress | `{isActive, connectedClients, totalTasks, completedCount, failedCount, currentPhase}` |
| `pong` | Response to ping | - |

## Configuration

### Environment Variables

Key production settings in `.env`:

```bash
# Server binding
HOST=0.0.0.0
PORT=3000

# WebSocket settings
SOCKET_PING_TIMEOUT=60000
SOCKET_PING_INTERVAL=25000

# Distributed crawling
MAX_DISTRIBUTED_CLIENTS=50
DISTRIBUTED_TASK_TIMEOUT=60000
DISTRIBUTED_RECONNECT_INTERVAL=1000
```

### Firewall Configuration

Ensure port 3000 is open:

```bash
# UFW (Ubuntu)
sudo ufw allow 3000

# Firewalld (CentOS/RHEL)
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --reload

# iptables
sudo iptables -A INPUT -p tcp --dport 3000 -j ACCEPT
```

## Production Deployment

### Server Requirements

- **OS**: Linux (Ubuntu 20.04+ recommended)
- **Memory**: 2GB+ RAM
- **Storage**: 5GB+ free space
- **Network**: Stable internet connection
- **Browser**: Chrome/Chromium installed

### Deployment Steps

1. **Clone Repository**:
   ```bash
   git clone <repository-url>
   cd crawler-nodejs
   ```

2. **Run Deployment Script**:
   ```bash
   ./scripts/deploy-production.sh
   ```

3. **Configure Environment**:
   ```bash
   nano .env
   # Update settings as needed
   ```

4. **Start Service**:
   ```bash
   # Using npm
   npm start
   
   # Or using systemd
   sudo systemctl start crawler-nodejs
   sudo systemctl enable crawler-nodejs
   ```

### Monitoring

Check service status:
```bash
# Service status
sudo systemctl status crawler-nodejs

# View logs
sudo journalctl -u crawler-nodejs -f

# Application logs
tail -f logs/*.log
```

## Troubleshooting

### Common Issues

#### 1. WebSocket Connection Failures

**Symptoms**: Clients cannot connect to server
**Solutions**:
- Check firewall settings (port 3000)
- Verify server is binding to `0.0.0.0` not `localhost`
- Check network connectivity
- Verify WebSocket transports are enabled

#### 2. Auto-reconnection Not Working

**Symptoms**: Clients don't reconnect after disconnection
**Solutions**:
- Check client-side JavaScript console for errors
- Verify server is handling disconnections properly
- Check network stability

#### 3. Tasks Not Being Distributed

**Symptoms**: Connected clients not receiving tasks
**Solutions**:
- Ensure `list-girl.csv` exists and has data
- Check server logs for task distribution errors
- Verify clients are properly registered

### Debug Mode

Enable debug logging:
```bash
# In .env file
DEBUG_MODE=true
VERBOSE_LOGGING=true
LOG_LEVEL=debug
```

## Performance Optimization

### Server Optimization

- **Memory**: Allocate sufficient RAM (4GB+ for large crawls)
- **CPU**: Multi-core processors improve concurrent task handling
- **Network**: Stable, high-bandwidth connection

### Client Optimization

- **Browser**: Use modern browsers with good WebSocket support
- **Network**: Stable internet connection for each client
- **Resources**: Ensure clients have sufficient CPU/memory

## Security Considerations

1. **Authentication**: Dashboard requires login
2. **CORS**: Configure appropriate CORS origins
3. **Firewall**: Restrict access to necessary ports only
4. **HTTPS**: Consider using HTTPS in production
5. **Credentials**: Change default admin credentials

## API Endpoints

### Distributed Crawling APIs

- `GET /api/distributed-state` - Get current distributed crawling state
- `POST /api/start-distributed-crawling` - Start distributed crawling
- `POST /api/stop-distributed-crawling` - Stop distributed crawling

### Client Access

- `GET /distributed-client` - Distributed client interface (no auth required)

## File Outputs

- `distributed-results.csv` - Results from distributed crawling
- `logs/` - Application logs
- `backups/` - Automatic backups of CSV files

## Support

For issues and questions:
1. Check this documentation
2. Review server logs
3. Check client browser console
4. Verify network connectivity
5. Test with minimal setup first
