# WebSocket Gateway Server

A high-performance, stateless WebSocket gateway server for a professional trading platform. Handles 10M-100M concurrent connections with real-time price streaming, order updates, position updates, and risk alerts.

## Architecture

```
Clients  ↔  Gateway  ↔  Redis PubSub  ↔  Data Provider / Core Trading Server
```

- **Stateless Design**: No database access, horizontal scaling ready
- **Event-Driven**: 100% WebSocket streaming, no polling
- **Multi-Region**: Designed for deployment across Asia, EU, US

## Features

- ✅ JWT Authentication
- ✅ Real-time price tick broadcasting
- ✅ Order/Position/Risk alert routing
- ✅ Connection registry with heartbeat monitoring
- ✅ Message validation and rate limiting
- ✅ Redis PubSub integration
- ✅ Health and metrics endpoints
- ✅ Auto-reconnect and failure handling

## Configuration

Set environment variables:

```bash
# Server
WS_PORT=9001
HTTP_PORT=9002
BIND_ADDRESS=0.0.0.0
MAX_CONNECTIONS=10000000
HEARTBEAT_INTERVAL_SECS=30
CONNECTION_TIMEOUT_SECS=300

# Redis
REDIS_URL=redis://127.0.0.1:6379
REDIS_POOL_SIZE=100
REDIS_RECONNECT_INTERVAL_SECS=5

# Auth
JWT_SECRET=your-secret-key
JWT_ISSUER=newpt

# Limits
MAX_SYMBOLS_PER_CLIENT=100
MAX_MESSAGE_SIZE_BYTES=65536
MAX_REQUESTS_PER_SECOND=100
RATE_LIMIT_BURST=200

# Metrics
METRICS_ENABLED=true
METRICS_PORT=9090
```

## Running

```bash
cd backend/ws-gateway
cargo run
```

## Protocol

### Client Messages

**Authenticate:**
```json
{
  "type": "auth",
  "token": "JWT_TOKEN"
}
```

**Subscribe:**
```json
{
  "type": "subscribe",
  "symbols": ["EURUSD", "BTCUSDT"],
  "channels": ["tick", "positions"]
}
```

**Unsubscribe:**
```json
{
  "type": "unsubscribe",
  "symbols": ["EURUSD"]
}
```

**Ping:**
```json
{
  "type": "ping"
}
```

### Server Messages

**Tick:**
```json
{
  "type": "tick",
  "symbol": "EURUSD",
  "bid": "1.1045",
  "ask": "1.1046",
  "ts": 123123123
}
```

**Order Update:**
```json
{
  "type": "order_update",
  "order_id": "uuid",
  "status": "filled",
  "symbol": "EURUSD",
  "side": "buy",
  "quantity": "1.0",
  "price": "1.1045",
  "ts": 123123123
}
```

**Position Update:**
```json
{
  "type": "position_update",
  "position_id": "uuid",
  "symbol": "EURUSD",
  "side": "long",
  "quantity": "1.0",
  "unrealized_pnl": "10.50",
  "ts": 123123123
}
```

**Risk Alert:**
```json
{
  "type": "risk_alert",
  "alert_type": "margin_call",
  "message": "Margin level below 100%",
  "severity": "warning",
  "ts": 123123123
}
```

## Redis Channels

The gateway subscribes to:
- `price:ticks` - Real-time price updates
- `orders:updates` - Order status changes
- `positions:updates` - Position updates
- `risk:alerts` - Risk management alerts

## Health & Metrics

- `GET /health` - Health check endpoint
- `GET /metrics` - Metrics endpoint

## Performance

- Lock-free data structures (DashMap)
- Tokio async runtime
- SIMD JSON parsing
- Pre-allocated buffers
- Batch message broadcasting

## Scaling

Deploy multiple gateway nodes behind a load balancer. No sticky sessions required - Redis PubSub ensures all nodes receive the same feed.

