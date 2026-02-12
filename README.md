# Trading Platform Backend

A professional, scalable backend foundation for a high-performance trading platform with zero-latency order execution, centralized Redis cache, and real-time WebSocket updates.

## Architecture

- **data-provider**: Ultra-low latency tick server publishing BID/ASK prices
- **order-engine**: Matching and execution engine (MARKET/LIMIT + SL/TP)
- **core-api**: REST API for admin/user operations, publishes commands to event bus
- **gateway-ws**: WebSocket gateway for real-time client updates (no polling)

## Tech Stack

- **Rust** (Axum) for all services
- **Postgres** (SQLx) for durable storage
- **Redis** for centralized real-time state cache
- **NATS** for event streaming between services

## Quick Start

### 1. Start Infrastructure

```bash
cd infra
docker-compose up -d
```

This starts:
- Postgres on port 5432
- Redis on port 6379
- NATS on port 4222

### 2. Run Database Migrations

```bash
# Set DATABASE_URL if needed
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/trading"

# Run migrations (using sqlx-cli or manually)
sqlx migrate run
# Or manually execute infra/migrations/001_initial_schema.sql
```

### 3. Start Services

In separate terminals:

```bash
# Terminal 1: Data Provider (publishes ticks)
cargo run -p data-provider

# Terminal 2: Order Engine (executes orders)
cargo run -p order-engine

# Terminal 3: Core API (REST endpoints)
cargo run -p core-api

# Terminal 4: Gateway WebSocket (client connections)
cargo run -p gateway-ws
```

## API Endpoints

### Core API (Port 3004)

- `GET /health` - Health check
- `POST /v1/orders` - Place order
- `POST /v1/orders/:id/cancel` - Cancel order
- `GET /v1/symbols` - List symbols
- `GET /v1/users/:id/risk` - Get user risk metrics

### Place Order Example

```bash
curl -X POST http://localhost:3004/v1/orders \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "BTCUSD",
    "side": "BUY",
    "order_type": "MARKET",
    "size": 0.1,
    "tif": "GTC",
    "idempotency_key": "unique-key-123"
  }'
```

## WebSocket Gateway (Port 3003)

Connect to `ws://localhost:3003/ws`

### Client Messages

```json
// Authenticate
{"op": "auth", "token": "jwt-token"}

// Subscribe to ticks
{"op": "sub", "topic": "ticks:BTCUSD"}

// Subscribe to orders
{"op": "sub", "topic": "orders"}

// Subscribe to positions
{"op": "sub", "topic": "positions"}

// Subscribe to balances
{"op": "sub", "topic": "balances"}
```

### Server Messages

```json
// Tick update
{"type": "tick", "payload": {"symbol": "BTCUSD", "bid": 50000.0, "ask": 50010.0, "ts": "...", "seq": 123}}

// Order update
{"type": "order", "payload": {"order_id": "...", "user_id": "...", "status": "FILLED", ...}}

// Position update
{"type": "position", "payload": {"position_id": "...", "user_id": "...", "size": 0.1, ...}}

// Balance update
{"type": "balance", "payload": {"user_id": "...", "currency": "USD", "available": 10000, ...}}
```

## Execution Flow

1. **Data Provider** publishes ticks to `ticks.<symbol>` NATS subject
2. **Order Engine** subscribes to ticks and caches latest BID/ASK
3. **Core API** receives place order request, validates, publishes `cmd.order.place`
4. **Order Engine** receives command:
   - MARKET orders: Execute immediately at ASK (BUY) or BID (SELL)
   - LIMIT orders: Store pending, trigger when price crosses
   - SL/TP: Monitor BID/ASK and trigger when conditions met
5. **Order Engine** updates Redis (orders, positions, balances)
6. **Order Engine** publishes events: `evt.order.updated`, `evt.position.updated`, `evt.balance.updated`
7. **Core API** persistence consumer writes events to Postgres
8. **Gateway WS** forwards events to subscribed clients

## Redis Data Model

- `tick:{symbol}` - Latest tick (BID/ASK)
- `user:{user_id}` - User profile
- `bal:{user_id}:{currency}` - Balance
- `pos:{user_id}` - Set of position IDs
- `pos:by_id:{position_id}` - Position details
- `ord:{user_id}:open` - Sorted set of open order IDs
- `ord:by_id:{order_id}` - Order details
- `sym:{symbol}` - Symbol configuration

## Service Ports

| Service | Port | Environment Variable | Default |
|---------|------|---------------------|---------|
| auth-service (backend) | 3000 | `PORT` | 3000 |
| data-provider (apps) | 3001 | `PORT` | 3001 |
| order-engine (apps) | 3002 | `PORT` | 3002 |
| gateway-ws (apps) | 3003 | `PORT` | 3003 |
| core-api (apps) | 3004 | `PORT` | 3004 |
| ws-gateway (backend) | 9001/9002 | `WS_PORT`/`HTTP_PORT` | 9001/9002 |
| data-provider (backend) | 9003/9004 | `WS_PORT`/`HTTP_PORT` | 9003/9004 |

All ports can be customized via environment variables.

## Environment Variables

All services support:

- `DATABASE_URL` - Postgres connection string (default: `postgresql://postgres:postgres@localhost:5432/trading`)
- `REDIS_URL` - Redis connection string (default: `redis://localhost:6379`)
- `NATS_URL` - NATS connection string (default: `nats://localhost:4222`)
- `LOG_LEVEL` - Logging level (default: `info`)
- `PORT` - HTTP port for apps services (varies by service, see table above)

## Development

### Build All Services

```bash
cargo build --workspace
```

### Run Tests

```bash
cargo test --workspace
```

### Code Structure

```
apps/
  data-provider/    # Tick publisher
  order-engine/     # Order execution
  core-api/         # REST API
  gateway-ws/       # WebSocket gateway

crates/
  common/           # Shared utilities
  contracts/        # Events, commands, DTOs
  redis-model/      # Redis key builders and models
  risk/             # Margin, liquidation, validation
```

## Notes

- All real-time state is in Redis (single source of truth)
- Postgres is for durability and reporting (async writes)
- Order execution never blocks on DB writes
- Idempotency keys prevent duplicate orders
- All events are versioned and typed

## License

MIT

