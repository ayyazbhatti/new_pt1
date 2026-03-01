# Why Orders Are Not Executing – Root Cause

## Cause: **Order-engine is not running**

Orders are **placed** by auth-service (or core-api), which publishes to **NATS** subject `cmd.order.place`. The service that **executes** those orders is the **order-engine**. It:

1. Subscribes to NATS `cmd.order.place` (and `cmd.order.cancel`)
2. Receives the place-order command
3. Validates, fills (market) or enqueues (limit), updates Redis, publishes events

If **order-engine is not running**, no process is subscribed to `cmd.order.place`, so:
- Place-order requests succeed (auth-service returns 200 and publishes to NATS)
- The message is never consumed
- Orders never get executed (no fill, no position update)

## Check

- **Is order-engine running?**  
  - Port **3002** (default): `lsof -i :3002` or `curl http://localhost:3002/health`
  - Process: `pgrep -fl order-engine`
- **start-all.sh** does **not** start order-engine; it only starts auth-service, data-provider, core-api, gateway-ws, Vite (and email-worker if present). So after “start all”, order-engine is still stopped.

## Fix

Start the order-engine, then place orders again:

```bash
cd /Users/mab/new_pt1
# With same .env as other services (NATS_URL, REDIS_URL)
cargo run -p order-engine
```

Or in background:

```bash
PORT=3002 cargo run -p order-engine &
```

Ensure **NATS** and **Redis** are running (order-engine connects to both). Data-provider should be running so the engine gets price ticks for market orders and SL/TP.

## Optional: Add order-engine to start-all.sh

To have “start all” also start the order-engine, add before the Vite section in `scripts/start-all.sh`:

```bash
echo "==> Starting order-engine (port 3002)..."
(PORT=3002 cargo run -p order-engine) &
ORDER_ENGINE_PID=$!
```

And include `$ORDER_ENGINE_PID` in the final `wait` and in the “To stop” message.
