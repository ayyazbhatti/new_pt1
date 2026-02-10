# Data Provider Server

Ultra-low latency WebSocket streaming server for real-time market data.

## Features

- **Zero Polling**: 100% WebSocket streaming
- **Low Latency**: Optimized for sub-millisecond processing
- **Redis Integration**: Real-time markup from Redis
- **Binance Feed**: Direct WebSocket connection to Binance
- **Multi-Client**: Supports 100K+ concurrent connections
- **Stateless**: No database, pure streaming

## Architecture

```
Binance WS → Data Provider → Redis PubSub → Core Server + Clients
```

## Configuration

Copy `.env.example` to `.env` and configure:

- `REDIS_URL`: Redis connection string
- `WS_PORT`: WebSocket server port (default: 9001)
- `HTTP_PORT`: Health/metrics HTTP port (default: 9002)
- `SERVER_REGION`: Deployment region identifier
- `ADMIN_SECRET_KEY`: Secret for admin endpoints

## Running

### Quick Start

```bash
# Using the run script (recommended)
./run.sh

# Or directly with cargo
cargo run --release

# Or with environment variables
REDIS_URL=redis://127.0.0.1:6379 WS_PORT=9001 HTTP_PORT=9002 cargo run --release
```

### Setup

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` with your configuration

3. Ensure Redis is running:
   ```bash
   redis-server
   ```

4. Start the server:
   ```bash
   ./run.sh
   ```

## WebSocket Protocol

### Connect
```
ws://localhost:9001/ws?group=retail
```

### Subscribe
```json
{
  "action": "subscribe",
  "symbols": ["BTCUSDT", "ETHUSDT"],
  "group": "retail"
}
```

### Price Tick
```json
{
  "type": "tick",
  "symbol": "BTCUSDT",
  "bid": 50000.50,
  "ask": 50001.00,
  "ts": 17123992123
}
```

## Health Endpoints

- `GET /health` - Server health status
- `GET /metrics` - Performance metrics
- `GET /feed/status` - Feed connection status

## Redis Keys

- `symbol:markup:{symbol}:{group}` - Markup configuration
- `symbol:status:{symbol}` - Symbol enable/disable status

