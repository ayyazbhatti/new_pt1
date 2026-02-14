# How to Start All Servers

## Prerequisites

1. **Docker Desktop must be running**
   - Open Docker Desktop application
   - Wait until it shows "Docker is running"

2. **Required tools:**
   - Cargo (Rust)
   - npm (Node.js)

## Quick Start

```bash
# Start all servers
./scripts/start-all-servers.sh
```

## What Gets Started

### Infrastructure (Docker):
- **PostgreSQL** on port 5432
- **Redis** on port 6379
- **NATS** on port 4222

### Backend Services:
- **Auth Service** on port 3000
- **Data Provider** on port 3001
- **Order Engine** on port 3002
- **Gateway WS** on port 3003 (WebSocket)
- **Core API** on port 3004

### Frontend:
- **Vite Dev Server** on port 5173

## Manual Start (if script fails)

### 1. Start Infrastructure
```bash
cd infra
docker-compose up -d
cd ..
```

### 2. Start Backend Services

**Auth Service:**
```bash
cd backend/auth-service
export PORT=3000
export JWT_SECRET="dev-jwt-secret-key-change-in-production-minimum-32-characters-long"
export JWT_ISSUER="newpt"
cargo run --bin auth-service
```

**Gateway WS (for WebSocket):**
```bash
cd backend/ws-gateway
export WS_PORT=3003
export HTTP_PORT=9002
cargo run
```

**Other services** - similar pattern in their respective directories.

### 3. Start Frontend
```bash
npm run dev
```

## Check Status

```bash
# Check if services are running
lsof -i :3000 -i :3001 -i :3002 -i :3003 -i :3004 -i :5173

# Check Docker services
docker ps

# Check infrastructure
docker-compose -f infra/docker-compose.yml ps
```

## Stop All Servers

```bash
./scripts/stop-all-servers.sh
```

Or manually:
```bash
# Stop Docker services
cd infra
docker-compose down

# Kill cargo processes
pkill -f "cargo run"

# Kill frontend
pkill -f "vite"
```

## Troubleshooting

### Docker Not Running
- Open Docker Desktop
- Wait for it to fully start
- Verify: `docker ps` should work

### Port Already in Use
- Check what's using the port: `lsof -i :PORT`
- Kill the process or change the port in the script

### Services Not Starting
- Check logs in `/tmp/<service-name>.log`
- Verify Docker containers are running: `docker ps`
- Check database connection: `docker exec -it trading-postgres psql -U postgres -d newpt`

