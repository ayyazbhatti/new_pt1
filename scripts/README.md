# Server Management Scripts

This directory contains scripts to manage all trading platform servers.

## Quick Start

### Start All Servers
```bash
./scripts/start-all-servers.sh
```

This script will:
1. ✅ Check prerequisites (Docker, Cargo, npm)
2. ✅ Start infrastructure services (NATS, Redis, Postgres via Docker)
3. ✅ Start all backend services with proper port configuration
4. ✅ Start the frontend development server
5. ✅ Verify services are running and ready
6. ✅ Display status and service URLs

### Stop All Servers
```bash
./scripts/stop-all-servers.sh
```

This script will:
1. ✅ Stop all backend services
2. ✅ Stop the frontend server
3. ✅ Clean up process tracking

## Service Ports

| Service | Port | URL |
|---------|------|-----|
| Auth Service | 3000 | http://localhost:3000 |
| Data Provider | 3001 | http://localhost:3001/health |
| Order Engine | 3002 | http://localhost:3002/health |
| Gateway WS | 3003 | ws://localhost:3003/ws |
| Core API | 3004 | http://localhost:3004/health |
| Frontend | 5173 | http://localhost:5173 |

## Infrastructure Services

| Service | Port | URL |
|---------|------|-----|
| NATS | 4222 | nats://localhost:4222 |
| Redis | 6379 | redis://localhost:6379 |
| Postgres | 5432 | postgresql://localhost:5432 |

## Features

- **Port Conflict Detection**: Automatically detects if ports are already in use
- **Health Check Verification**: Waits for services to be ready before proceeding
- **Process Tracking**: Tracks all started processes for easy cleanup
- **Graceful Shutdown**: Properly stops all services on Ctrl+C
- **Colored Output**: Easy-to-read status messages
- **Log Files**: Service logs are saved to `/tmp/<service-name>.log`

## Manual Service Management

If you need to start services individually:

### Infrastructure
```bash
cd infra
docker-compose up -d
```

### Backend Services
```bash
# Auth Service
cd backend/auth-service
export PORT=3000
cargo run --bin auth-service

# Data Provider
export PORT=3001
cargo run -p data-provider

# Order Engine
export PORT=3002
cargo run -p order-engine

# Gateway WS
export PORT=3003
cargo run -p gateway-ws

# Core API
export PORT=3004
cargo run -p core-api
```

### Frontend
```bash
npm run dev
```

## Troubleshooting

### Port Already in Use
If a port is already in use, the script will skip starting that service. To free up ports:
```bash
# Find process using a port
lsof -i :3000

# Kill the process
kill <PID>
```

### Services Not Starting
Check the log files in `/tmp/`:
```bash
tail -f /tmp/auth-service.log
tail -f /tmp/data-provider.log
# etc.
```

### Docker Not Running
Make sure Docker Desktop is running before starting the script.

## Environment Variables

The script uses these environment variables (with defaults):

- `DATABASE_URL` - Default: `postgresql://postgres:postgres@localhost:5432/trading`
- `REDIS_URL` - Default: `redis://localhost:6379`
- `NATS_URL` - Default: `nats://localhost:4222`
- `JWT_SECRET` - Required for auth-service (defaults to dev secret)
- `JWT_ISSUER` - Default: `newpt`

You can override these by setting them before running the script:
```bash
export DATABASE_URL="postgresql://user:pass@localhost:5432/mydb"
./scripts/start-all-servers.sh
```

