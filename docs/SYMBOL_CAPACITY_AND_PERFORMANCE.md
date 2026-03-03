# Symbol capacity and performance – full analysis

This document summarizes how the codebase and infrastructure use symbols, where limits and bottlenecks are, and how many symbols you can use **without affecting platform optimization or speed**.

---

## 1. High-level architecture (where symbols flow)

```
[Binance] → data-provider (N WS connections, 1 per symbol)
                ↓
           Tick loop (100 ms) → get_price(), apply_markup() per (symbol × group), Redis PUBLISH price:ticks
                ↓
           [Redis] price:ticks (pub/sub)
                ↓
           ws-gateway → fan-out to subscribed connections
                ↓
           [Frontend] Terminal subscribes to symbol codes (from API symbols list), receives ticks
```

- **Auth-service** (bootstrap): Reads all symbol codes from DB, writes Redis keys `symbol:markup:{SYMBOL}:{GROUP_ID}` for each group with a price profile. No per-tick cost.
- **Data-provider**: Subscribes to Binance **per symbol** (one WebSocket per symbol), then every **100 ms** loops over all subscribed symbols, applies markup (Redis GET per symbol×group), publishes one message per symbol to Redis.
- **Ws-gateway**: Subscribes to Redis `price:ticks`; for each message, finds connections subscribed to that symbol and sends them the tick.
- **Frontend**: Fetches symbol list from API (paginated, `page_size: 100` in terminal), subscribes to gateway with those codes in batches of **50**.

---

## 2. Limits and constants (by component)

### 2.1 Data-provider (`backend/data-provider`)

| Item | Value | Location | Effect |
|------|--------|----------|--------|
| **Max symbols per WS connection** | **50** | `SymbolValidator::new(50)` in `main.rs` | A single client to the data-provider WS cannot subscribe to more than 50 symbols. |
| **Rate limiter** | 100 requests / 60 s | `RateLimiter::new(60, 100)` in `main.rs` | Subscribe actions to data-provider WS are rate-limited. |
| **Tick interval** | **100 ms** | `Duration::from_millis(100)` in main loop | Every 100 ms, one pass over all `subscribed_symbols`. |
| **Binance feed** | **1 WebSocket per symbol** | `binance_feed.rs` `subscribe_symbol()` | Each symbol gets its own WS to Binance (`/ws/{symbol}@bookTicker`). N symbols ⇒ N connections. |
| **Broadcast channel capacity** | 1000 | `broadcast::channel(1000)` in `broadcaster.rs` | Per-room tick buffer; slow consumers can be lagged/dropped after 1000 ticks. |

There is **no hard cap on total symbols** in code; the practical limit comes from Binance connections, Redis load, and the 100 ms loop.

### 2.2 Ws-gateway (`backend/ws-gateway`)

| Item | Value | Env / config | Effect |
|------|--------|----------------|--------|
| **Max symbols per client** | **100** | `MAX_SYMBOLS_PER_CLIENT` (default 100) in `config.rs` | One gateway client (e.g. terminal) can subscribe to at most 100 symbols. |
| **Max message size** | 65536 bytes | `MAX_MESSAGE_SIZE_BYTES` | Large subscribe payloads rejected. |
| **Redis channel** | `price:ticks` | Single subscriber | Gateway receives every tick the data-provider publishes; fan-out is per-connection. |
| **Broadcast channel (Redis)** | 10000 | `redis_subscriber.rs` | Buffer for incoming Redis messages. |

### 2.3 Auth-service (bootstrap / markup)

| Item | Effect |
|------|--------|
| **Bootstrap** | `get_all_symbol_codes()` → all rows from `symbols` table. Then for each group with a profile: for each symbol, one Redis `SET` for `symbol:markup:{SYMBOL}:{GROUP_ID}`. One-time at startup (and on profile sync). |
| **DB** | No LIMIT on `SELECT code FROM symbols`. Symbol code length 2–50 (admin_symbols_service). |

So auth can handle **hundreds of symbols**; cost is startup/sync time and Redis key count (symbols × groups).

### 2.4 Frontend

| Item | Value | Location | Effect |
|------|--------|----------|--------|
| **Terminal symbol list** | **page_size: 100** | `AppShellTerminal.tsx` `useSymbolsList({ page_size: 100 })` | Terminal requests up to 100 symbols from API; those are the codes used for price subscription. |
| **Subscribe batch size** | **50** | `usePriceStream.ts` `const MAX = 50` | Price subscription to gateway is sent in chunks of 50 symbols. |
| **Symbols page (admin)** | page_size default 20 | `SymbolsPage.tsx` | Admin list is paginated; no impact on runtime price flow. |

So the **terminal** is effectively limited to **100 symbols** (what it gets from the API for the session) and subscribes in batches of 50.

### 2.5 Binance (external)

| Limit | Typical value | Impact |
|-------|----------------|--------|
| **Streams per connection** | Up to 1024 | Not used today: we open 1 connection per symbol (1 stream each). |
| **Connections per IP** | 300 new connection attempts per 5 minutes | Many symbols ⇒ many connections; restarts or scaling can approach this. |
| **Incoming control messages** | 5/sec (subscribe/unsubscribe, ping/pong) | Only matters during bulk subscribe/unsubscribe. |

So the **current design** (one WS per symbol) is limited mainly by **number of connections**. Staying well under 300 connections (e.g. ≤ 100–150 symbols) avoids risk.

### 2.6 Infrastructure (current)

- **Redis**: Single instance (no cluster), no explicit memory/spec in docker-compose. Key count: `price:groups` (small) + `symbol:markup:{SYMBOL}:{GROUP_ID}` (symbols × groups). Typical key size small; hundreds of symbols × tens of groups = thousands of keys, fine for one Redis.
- **Postgres**: Single instance; symbol list and markup metadata are small.
- **NATS**: Used for ticks to order-engine; one (or more) message per symbol per tick cycle.

---

## 3. Per-tick load (data-provider, 100 ms cycle)

For **S** symbols and **G** groups with a price profile:

- **In-memory**: S × `get_price()` (HashMap lookup).
- **Redis**: S × G × `get_markup()` (one GET per symbol per group).
- **Redis**: S × `PUBLISH` (one message per symbol to `price:ticks`).
- **NATS**: S or S × G publishes (depending on branch).
- **Data-provider internal**: S × G `broadcast_price` (in-memory rooms).

Example: **50 symbols, 5 groups**  
- 50 × 5 = 250 Redis GETs  
- 50 PUBLISHes  
per 100 ms ⇒ **2,500 GETs/s + 500 PUBLISH/s**. Redis handles this easily.

**100 symbols, 10 groups**: 10,000 GETs/s + 1,000 PUBLISH/s. Still fine for a single Redis.

**200 symbols, 20 groups**: 40,000 GETs/s + 2,000 PUBLISH/s. Still within capability of a single Redis, but the data-provider loop and gateway fan-out start to add up (CPU, latency).

---

## 4. Recommendation: how many symbols “easily” without affecting optimization/speed

Considering:

- **Data-provider**: 50 max per connection (validator), 100 ms loop, 1 Binance WS per symbol.
- **Gateway**: 100 max symbols per client.
- **Frontend**: Fetches 100 symbols for terminal, subscribes in batches of 50.
- **Binance**: Connection count (1 per symbol); staying comfortably under 300 connections.
- **Redis / CPU**: Load scales with S and S×G; keeping S and G in a “moderate” range keeps latency and throughput stable.

**Recommended range for “easy” use without tuning or re-architecture:**

- **50 symbols**  
  - Fits all current limits (data-provider 50, gateway 100, frontend 100, batch 50).  
  - 50 Binance connections, low Redis and CPU load.  
  - **Best choice if you want zero impact on optimization and speed.**

- **Up to 100 symbols**  
  - Increase data-provider `SymbolValidator::new(50)` to **100** (or same as gateway).  
  - Terminal already uses `page_size: 100`; frontend does 2 batches of 50.  
  - 100 Binance connections; still within Binance and Redis comfort zone.  
  - **Still “easy” with this single code change.**

- **Above 100 (e.g. 150–200)**  
  - Increase validator and gateway `MAX_SYMBOLS_PER_CLIENT` as needed.  
  - Monitor Redis (memory, CPU) and data-provider tick loop latency.  
  - **Consider Binance combined streams** (one connection, many streams, e.g. up to 1024) so you don’t scale to 200+ connections; this requires a data-provider change to use a single (or few) WS with multiple streams.

**Concrete “safe” number for your question:**

- **Use 50 symbols** if you want no changes and no impact on platform optimization or speed.  
- **Use up to 100 symbols** with one change (data-provider validator to 100); keep gateway at 100 and frontend as-is.  
- Beyond 100, treat as “needs tuning” (and eventually Binance connection consolidation).

---

## 5. Optional: make 100 symbols “native” without changing behavior

1. **Data-provider**  
   In `backend/data-provider/src/main.rs`, change:
   - `SymbolValidator::new(50)` → `SymbolValidator::new(100)`  
   so one WS client can subscribe to up to 100 symbols (matching gateway and terminal).

2. **Frontend**  
   Terminal already uses `page_size: 100` and batches of 50; no change required.

3. **Gateway**  
   Default `MAX_SYMBOLS_PER_CLIENT` is already 100; no change required.

4. **Auth-service**  
   No symbol-count limit; bootstrap and sync scale with DB symbol list.

5. **Binance**  
   At 100 symbols you have 100 connections; still well under typical connection limits.

After (1), you can set `INITIAL_SYMBOLS` (or DB symbols) to up to 100 and run without affecting platform optimization or speed under the assumptions above (single Redis, single data-provider, single gateway, typical group count).

---

## 6. Summary table

| Component        | Limit / bottleneck              | Safe “easy” range |
|-----------------|----------------------------------|-------------------|
| Data-provider   | 50 per connection; 1 WS/symbol  | 50 (as-is), 100 (validator=100) |
| Ws-gateway      | 100 symbols per client          | 100               |
| Frontend        | 100 symbols, batches of 50       | 100               |
| Auth bootstrap  | No hard limit                   | Hundreds          |
| Binance         | ~300 connections / 5 min       | &lt; 150 symbols with 1 WS each |
| Redis           | Single instance                 | Hundreds of symbols × groups |

**Direct answer:** With the current design, the project can use **50 symbols with no changes** and **up to 100 symbols with one change (data-provider validator)** without affecting platform optimization or speed. Beyond 100, plan for Binance connection consolidation and monitoring (Redis, CPU, tick latency).
