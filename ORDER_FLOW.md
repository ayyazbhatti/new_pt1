# Order Processing Flow

This document describes how orders are processed from creation to execution.

## Order Creation Flow

### 1. Frontend (User Action)
**Location:** `src/features/terminal/components/RightTradingPanel.tsx`

- User fills order form (symbol, side, size, order type, etc.)
- Clicks "Place Order" button
- Frontend calls `placeOrder()` from `src/features/terminal/api/orders.api.ts`

**API Call:**
```typescript
POST http://localhost:3004/v1/orders
Body: {
  symbol: "BTCUSDT",
  side: "BUY",
  order_type: "MARKET",
  size: "0.1",
  idempotency_key: "unique-key-123"
}
```

---

### 2. Core API (REST Endpoint)
**Location:** `apps/core-api/src/handlers.rs` → `place_order()`

**Process:**
1. Receives HTTP POST request at `/v1/orders`
2. Extracts user_id from JWT token (currently hardcoded for testing)
3. Validates order parameters:
   - Order type (MARKET/LIMIT)
   - Side (BUY/SELL)
   - Size > 0
   - Price consistency for LIMIT orders
4. **Idempotency Check:**
   - Checks Redis for existing order with same idempotency_key
   - If exists, returns existing order_id (prevents duplicates)
5. Generates new `order_id` (UUID)
6. Creates `PlaceOrderCommand` object
7. **Publishes to NATS:**
   - Subject: `cmd.order.place`
   - Message: VersionedMessage containing PlaceOrderCommand
8. Returns HTTP response immediately:
   ```json
   {
     "order_id": "uuid-here",
     "status": "PENDING"
   }
   ```

**Key Point:** API returns immediately - doesn't wait for order execution!

---

### 3. Order Engine (Command Consumer)
**Location:** `apps/order-engine/src/engine/order_handler.rs` → `handle_place_order()`

**Process:**
1. **Subscribes to NATS:** `cmd.order.place` subject
2. **Receives command** from NATS
3. **Deserializes** PlaceOrderCommand
4. **Idempotency Check (again):**
   - Checks Redis for duplicate idempotency_key
   - Prevents duplicate processing
5. **Validates Order:**
   - Checks user balance
   - Validates symbol exists
   - Validates size/price constraints
   - Risk checks (margin, leverage, etc.)
6. **If Valid:**
   - Stores order in Redis:
     - Key: `order:{order_id}` (order details)
     - Key: `orders:pending:{symbol}` (sorted set for pending orders)
   - Updates in-memory cache
   - Stores idempotency key (30 min TTL)
   - **Publishes Event:** `evt.order.accepted`
7. **If Invalid:**
   - **Publishes Event:** `evt.order.rejected` with reason
   - Increments rejection metrics

**For MARKET Orders:**
- If tick data exists, prepares for immediate execution
- Otherwise waits for next price tick

**For LIMIT Orders:**
- Added to pending orders list
- Will execute when price crosses limit price

---

### 4. Order Execution (Price Tick Handler)
**Location:** `apps/order-engine/src/engine/tick_handler.rs`

**Process:**
1. **Subscribes to price ticks:** `ticks.*` from NATS
2. **On each tick:**
   - Checks pending orders for matching symbol
   - For MARKET orders: Executes immediately at current bid/ask
   - For LIMIT orders: Checks if price crossed limit
   - For SL/TP: Checks stop loss/take profit conditions
3. **When order fills:**
   - Updates order status to FILLED
   - Calculates fill price and size
   - Updates user balance (deducts margin, adds position)
   - Creates/updates position
   - **Publishes Events:**
     - `evt.order.updated` (order filled)
     - `evt.position.opened` or `evt.position.updated` (if new position)
     - `evt.balance.updated` (balance changed)

---

### 5. Event Persistence (Database Writer)
**Location:** `apps/core-api/src/persistence.rs` → `consume_events()`

**Process:**
1. **Subscribes to:** `evt.*` (all events)
2. **On event received:**
   - `evt.order.updated` → Updates/inserts into `orders` table
   - `evt.position.updated` → Updates/inserts into `positions` table
   - `evt.balance.updated` → Updates balance in database
3. **Async writes** to PostgreSQL (doesn't block order execution)

---

### 6. Gateway WebSocket (Real-time Updates)
**Location:** `apps/gateway-ws/src/main.rs`

**Process:**
1. **Subscribes to NATS events:** `evt.*`
2. **For each event:**
   - Filters by user_id (only sends to relevant users)
   - Checks user's WebSocket subscriptions
   - **Forwards to frontend** via WebSocket:
     - `evt.order.updated` → Frontend receives order status updates
     - `evt.position.updated` → Frontend receives position updates
     - `evt.balance.updated` → Frontend receives balance updates

---

### 7. Frontend (Real-time Updates)
**Location:** `src/shared/ws/wsClient.ts` and `src/features/terminal/components/RightTradingPanel.tsx`

**Process:**
1. **WebSocket connected** and authenticated
2. **Receives events** from gateway-ws:
   - `order` events → Updates order list/status
   - `position` events → Updates position display
   - `balance` events → Updates balance display
3. **UI updates** automatically via React state

---

## Complete Flow Diagram

```
User clicks "Place Order"
    ↓
Frontend: POST /v1/orders
    ↓
Core API: Validates & publishes to NATS (cmd.order.place)
    ↓
Order Engine: Receives command, validates, stores in Redis
    ↓
Order Engine: Publishes evt.order.accepted
    ↓
[Parallel Paths]
    ↓                    ↓
Gateway-WS          Persistence
    ↓                    ↓
Frontend (WS)       Database
    ↓
[When price tick arrives]
    ↓
Tick Handler: Executes order
    ↓
Order Engine: Publishes evt.order.updated (FILLED)
    ↓
[Parallel Paths]
    ↓                    ↓
Gateway-WS          Persistence
    ↓                    ↓
Frontend (WS)       Database
    ↓
User sees order filled in UI
```

---

## Key Components

### NATS Subjects
- `cmd.order.place` - Place order command
- `cmd.order.cancel` - Cancel order command
- `evt.order.accepted` - Order accepted event
- `evt.order.rejected` - Order rejected event
- `evt.order.updated` - Order status update (filled, cancelled, etc.)
- `evt.position.opened` - New position opened
- `evt.position.updated` - Position updated
- `evt.balance.updated` - Balance changed
- `ticks.*` - Price tick updates

### Redis Keys
- `order:{order_id}` - Order details
- `orders:pending:{symbol}` - Sorted set of pending order IDs
- `idempotency:{user_id}:{key}` - Idempotency tracking
- `tick:{symbol}` - Latest price tick
- `user:{user_id}` - User profile
- `bal:{user_id}:{currency}` - User balance

### Database Tables
- `orders` - Order history (persisted from events)
- `positions` - Position history
- `balances` - Balance snapshots

---

## Important Notes

1. **Asynchronous Processing:** API returns immediately, order executes asynchronously
2. **Idempotency:** Same idempotency_key prevents duplicate orders
3. **Event-Driven:** All state changes via events (eventual consistency)
4. **Real-time Updates:** WebSocket delivers updates to frontend instantly
5. **Durability:** Events are persisted to database asynchronously
6. **Zero-Latency Execution:** Order execution never blocks on DB writes

