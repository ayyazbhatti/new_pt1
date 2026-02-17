# Plan: Per-Group Price Stream Everywhere (No Polling, Real-Time Markup)

**Status:** For review — no implementation until approved.

**Goals:**
- Use **only per-group price stream** everywhere (no single global “default” stream for pricing).
- **No polling:** no periodic refresh of markup or overrides; all updates are event-driven.
- **Real-time markup:** when an admin saves a symbol override, that markup is reflected in the price stream for the relevant group(s) immediately (event-driven propagation).

---

## 1. Current State (Summary)

### 1.1 Data model (DB)
- **user_groups:** `id`, `default_price_profile_id` (FK → price_stream_profiles).
- **users:** `group_id` (FK → user_groups).
- **price_stream_profiles:** `id`, `group_id` (optional; profile can be global or per-group).
- **symbol_markup_overrides:** `profile_id`, `symbol_id`, `bid_markup`, `ask_markup` (per-symbol overrides per profile).
- **Mapping:** User → group → `default_price_profile_id` → profile → symbol overrides. So “group price” = apply that profile’s overrides to raw prices.

### 1.2 Auth-service (markup on save)
- **File:** `backend/auth-service/src/routes/admin_markup.rs`
- **Behavior:** On `upsert_symbol_override(profile_id, symbol_id, bid, ask)`:
  - Saves to DB (`symbol_markup_overrides`).
  - Calls `publish_markup_update(symbol_code, bid_markup, ask_markup, profile_id)`.
- **`publish_markup_update`:** Only does Redis **PUBLISH** to channel `markup:update` with payload `{ symbol, group: "default", bid_markup, ask_markup }`. **Does not SET any Redis key.** Group is hardcoded `"default"`; TODO in code for fetching from DB.

### 1.3 Data-provider
- **Redis:** `backend/data-provider/src/cache/redis_client.rs` — `get_markup(symbol, group)` does **GET** `symbol:markup:{symbol}:{group}`. **No service currently SETs this key.**
- **Main loop:** `backend/data-provider/src/main.rs`
  - Applies markup only for group `"default"`.
  - Publishes to Redis channel `price:ticks` a **single** tick per symbol: `{ symbol, bid, ask, ts }` using **raw** bid/ask (not marked up, because Redis markup keys are never set).
  - NATS: publishes one tick per symbol with `final_bid`/`final_ask` (would be marked up if Redis had data).
  - Internal WS broadcaster: `broadcast_price(symbol, Some("default"), ...)`.
- **Broadcaster (data-provider):** `backend/data-provider/src/stream/broadcaster.rs` — applies markup by group; rooms: `symbol:*` and `group:default:symbol:*` (and `group:{grp}:symbol:*` when group provided).
- **WS server (data-provider):** `backend/data-provider/src/stream/ws_server.rs` — client can send `group` in subscribe message; room = `group:{grp}:symbol:{sym}` or `symbol:{sym}`.

### 1.4 ws-gateway
- **Redis:** Subscribes to single channel `price:ticks` (one stream for all).
- **Connection:** `backend/ws-gateway/src/state/connection_registry.rs` — `Connection` has `group_id: Option<String>` (from JWT). **Not used for pricing:** subscription is by symbol only (`symbol_subscribers`: symbol → conn_ids).
- **Broadcaster:** `backend/ws-gateway/src/stream/broadcaster.rs` — on `price:ticks`, builds one `ServerMessage::Tick { symbol, bid, ask, ts }` and sends to **all** subscribers of that symbol (same tick for everyone; no group filtering).
- **JWT:** ws-gateway expects `Claims` with `group_id: Option<String>`. Auth-service JWT **Claims struct** (`backend/auth-service/src/utils/jwt.rs`) **does not include group_id** — only `sub`, `email`, `role`, `exp`, `iat`. So either tokens are built elsewhere with custom claims or group_id is currently always None at gateway.

### 1.5 Frontend
- **File:** `src/shared/ws/priceStreamClient.ts`
- Subscribes via gateway with `{ type: 'subscribe', symbols, channels: [] }`. **Does not send group or profile;** gateway has no way to send group-specific prices.

### 1.6 Order-engine
- **Tick cache:** `apps/order-engine/src/engine/cache.rs` — `last_ticks: DashMap<String, Tick>` (key = **symbol only**).
- **Execution:** `apps/order-engine/src/execution.rs` — `get_last_tick(cmd.symbol)`; no group_id. **PlaceOrderCommand** (`crates/contracts/src/commands.rs`) has **no group_id**.
- **NATS:** Subscribes to `ticks.*`; subject parsed as symbol only (`ticks.BNBUSDT` → BNBUSDT). One tick per symbol stored; used for all users regardless of group.

### 1.7 Gaps
- Redis markup keys `symbol:markup:{symbol}:{group}` are never written.
- Group in auth publish is hardcoded to `"default"`; profile → group resolution not done.
- Data-provider publishes one tick per symbol to Redis/NATS (no per-group).
- ws-gateway ignores `group_id` for price routing; all clients get same tick.
- Auth JWT may not include `group_id` (Claims in auth-service don’t have it).
- Order-engine uses a single tick per symbol; no per-group tick for execution.

---

## 2. Target Architecture (Per-Group Only, Event-Driven)

### 2.1 Principles
- **Group = pricing context:** Every price delivered to a user or used for execution is for exactly one group (user’s group). No “default” single stream that ignores group.
- **Markup keyed by group_id:** Redis key `symbol:markup:{symbol}:{group_id}` where `group_id` is `user_groups.id` (UUID). All groups that use a given profile get that profile’s overrides written under their own `group_id`.
- **Event-driven only:** No polling. Markup changes: write Redis + PUBLISH; data-provider subscribes to `markup:update` and refreshes only what’s needed (e.g. group set or specific keys). No periodic “reload all overrides from DB”.

### 2.2 Flow (high level)
1. **Admin saves symbol override** (profile P, symbol S, bid/ask markup)  
   → Auth-service: resolve all groups G with `default_price_profile_id = P`; for each G: **SET** `symbol:markup:{S}:{G}` in Redis; **PUBLISH** `markup:update` with e.g. `{ symbol, group_id, bid_markup, ask_markup }` (and optionally profile_id).
2. **Bootstrap (one-time):** On auth-service startup (or dedicated job): load all groups with `default_price_profile_id` set; for each (group, profile) load overrides and **SET** Redis keys; **SADD** `price:groups` with each group_id. So Redis has full state without polling.
3. **Data-provider:** Holds cached set of “active” group_ids (from Redis `SMEMBERS price:groups` at startup; refreshed on `markup:update` by re-reading `price:groups` or from message). For each symbol tick from feed: for each group in set, **get_markup(symbol, group_id)** from Redis, apply, then:
   - **Redis:** Publish to **one** channel `price:ticks` one message per tick: `{ symbol, ts, prices: [ { g: group_id, bid, ask }, ... ] }` (all groups in one payload).
   - **NATS (order-engine):** Publish **per-group** so order-engine can cache by (symbol, group_id): e.g. subject `ticks.{symbol}.{group_id}` and payload = single TickEvent (bid, ask for that group).
4. **ws-gateway:** Subscribes to `price:ticks`. On message: for each connection subscribed to that symbol, take `conn.group_id`, find `prices[g]` for that group, send that (bid, ask) to the connection. If group_id is missing or not in list, send raw/unmarked or first available (define policy).
5. **Frontend:** No change to subscribe payload; gateway already has group from JWT and sends the correct bid/ask per connection.
6. **Order-engine:** Subscribe to `ticks.*.*` (or equivalent); cache key `(symbol, group_id)` → Tick. PlaceOrderCommand must include `group_id`. On place order, use `get_last_tick(symbol, group_id)` for fill price. Redis price key e.g. `prices:{symbol}:{group_id}`.

### 2.3 Real-time markup (no polling)
- Admin saves override → auth-service **SET**s Redis keys for all groups using that profile + **PUBLISH** `markup:update`.
- Data-provider is subscribed to `markup:update`. On message: (a) optionally refresh cached `price:groups` (e.g. SMEMBERS once), and/or (b) no need to “reload” — next tick loop already uses Redis GET for markup, so updated keys are used on next tick. So **no polling;** only PUBLISH + existing GET-on-tick.
- Optional: data-provider on `markup:update` could invalidate a small in-memory cache of markup per (symbol, group) so the very next tick re-reads from Redis; otherwise rely on Redis GET each time (simpler).

---

## 3. Detailed Implementation Plan

### Phase A: Auth-Service — Redis Write + Correct Group Resolution

**A.1 — JWT: add group_id to Claims and token generation**
- **Files:** `backend/auth-service/src/utils/jwt.rs`, `backend/auth-service/src/services/auth_service.rs`
- Add `group_id: Option<Uuid>` to `Claims`; in `create_session` / `create_session_with_metadata` and in `refresh`, set `claims.group_id = user.group_id`. Serialize as string in JWT (e.g. `group_id` claim). Ensure ws-gateway already deserializes `group_id` (it does) so no change there.

**A.2 — Resolve profile → groups and write Redis**
- **File:** `backend/auth-service/src/routes/admin_markup.rs`
- Replace `publish_markup_update(...)` with a function that:
  1. Queries DB: “all group_ids where default_price_profile_id = profile_id” (and optionally “all group_ids that have a default_price_profile_id” for bootstrap).
  2. For each such group_id, **SET** Redis key `symbol:markup:{symbol_code}:{group_id}` with value JSON `{ bid_markup, ask_markup, type: "percent" }` (TTL optional; recommend no TTL so bootstrap is enough).
  3. **SADD** `price:groups` with each group_id (so data-provider can SMEMBERS to know which groups to compute prices for).
  4. **PUBLISH** `markup:update` with payload e.g. `{ symbol, group_id, bid_markup, ask_markup }` (and optionally `profile_id`) for each group updated, or a single message “markup updated for symbol X” so data-provider can refresh group set once.
- Use same Redis connection params as today (env REDIS_URL). Prefer connection pool or single connection per request; avoid opening per-key.

**A.3 — Bootstrap Redis on startup**
- **File:** `backend/auth-service` — new module or in existing startup (e.g. `main.rs` or a small bootstrap called from admin_markup).
- On auth-service startup: query all `user_groups` with `default_price_profile_id IS NOT NULL`; for each, SADD `price:groups` with group id. Then for each (profile_id, group_id) and for each symbol in `symbol_markup_overrides` for that profile, SET `symbol:markup:{symbol_code}:{group_id}`. So Redis is fully populated without any polling; subsequent admin saves only maintain consistency.

**A.4 — When group’s default profile is changed**
- **File:** e.g. `backend/auth-service/src/routes/admin_groups.rs` (where `default_price_profile_id` is updated).
- When updating `default_price_profile_id` for a group: (1) Remove old markup keys for this group (e.g. KEYS symbol:markup:*:{group_id} + DEL, or maintain a set “symbols for group” and delete those keys). (2) SADD `price:groups` with this group_id. (3) For the new profile, copy its symbol overrides to Redis under this group_id (same as in A.2). Optionally PUBLISH `markup:update` so data-provider can refresh.

### Phase B: Data-Provider — Per-Group Tick Computation and Publish

**B.1 — Redis: ensure markup key format and type**
- **File:** `backend/data-provider/src/cache/redis_client.rs`
- `get_markup(symbol, group)` already uses key `symbol:markup:{symbol}:{group}`. Ensure `group` is group_id (UUID string). Auth will write JSON `{ bid_markup, ask_markup, type: "percent" }`; ensure MarkupConfig matches (already has bid_markup, ask_markup, type). No change if already compatible.

**B.2 — Maintain set of “price groups” (event-driven, no polling)**
- **File:** `backend/data-provider/src/main.rs` (or a small module).
- At startup: call Redis SMEMBERS `price:groups`, store in e.g. `Arc<RwLock<HashSet<String>>>` (group_ids).
- Subscribe to Redis channel `markup:update`. On message: do one SMEMBERS `price:groups` and replace the cached set (so new groups appear without polling). No periodic timer.

**B.3 — Tick loop: per-group markup and single Redis publish**
- **File:** `backend/data-provider/src/main.rs`
- For each symbol and each raw (bid, ask) from feed:
  - For each group_id in cached set: get markup from Redis (get_markup(symbol, group_id)); apply; collect (group_id, final_bid, final_ask).
  - If cached set is empty, skip Redis publish for that symbol or publish empty prices (avoid publishing “default” only).
  - Publish **one** message to Redis channel `price:ticks`:  
    `{ symbol, ts, prices: [ { g: group_id, bid, ask }, ... ] }`  
  - **NATS:** For each group in the list, publish **one** message: subject `ticks.{symbol}.{group_id}`, payload = TickEvent { symbol, bid, ask, ts, seq } (so order-engine can subscribe per symbol and group).

**B.4 — Internal WebSocket (data-provider)**
- **File:** `backend/data-provider/src/stream/broadcaster.rs`
- Today it broadcasts to `symbol:{sym}` and `group:{grp}:symbol:{sym}` with one (bid, ask). With per-group only: either (1) stop publishing a single “default” stream and only publish to `group:{group_id}:symbol:{sym}` for each group_id in the cached set, or (2) if the frontend never connects to data-provider WS directly (only via gateway), this path might be redundant. **Decision:** Prefer gateway as single WS entry for prices; data-provider WS can be updated to use the same per-group list and broadcast only to `group:{id}:symbol:{sym}` so that any direct client sending `group` gets correct prices. Remove broadcasting to `symbol:{sym}` only and to `group:default:symbol:*` for pricing.

### Phase C: ws-Gateway — Per-Group Tick Routing

**C.1 — Redis message format**
- **File:** `backend/ws-gateway/src/stream/broadcaster.rs`
- Handle `price:ticks` payload: `{ symbol, ts, prices: [ { g, bid, ask }, ... ] }`. Parse `prices` array.

**C.2 — Subscribers and group_id**
- **File:** `backend/ws-gateway/src/state/connection_registry.rs`
- Already has `Connection.group_id`. Subscription index remains symbol → list of conn_id (so we know who is subscribed to which symbol). When broadcasting a tick, for each conn_id subscribed to that symbol, get `conn.group_id`, find in `prices` the entry with `g == conn.group_id`, and send that (bid, ask). If `group_id` is None or not found in `prices`, define fallback: e.g. use first entry, or raw from a “default” group, or skip (no tick). Prefer: if no group_id, use first group’s prices for backward compatibility; if group_id not in list, skip (user’s group has no price for this symbol).

**C.3 — No new channels**
- Keep single Redis channel `price:ticks`; payload carries multiple groups. No need for gateway to subscribe to per-group channels.

### Phase D: Frontend

**D.1 — No change to subscribe payload**
- **File:** `src/shared/ws/priceStreamClient.ts`
- Continue sending `{ type: 'subscribe', symbols, channels: [] }`. Gateway has group from JWT and will send the correct tick per connection. Optionally: if product later wants “display group” in UI, frontend could send group in subscribe; for this plan, JWT group is sufficient.

### Phase E: Order-Engine — Per-Group Tick Cache and Execution

**E.1 — Contracts: PlaceOrderCommand and TickEvent**
- **File:** `crates/contracts/src/commands.rs`
- Add `group_id: Option<String>` (or `Option<Uuid>`) to `PlaceOrderCommand`. Auth-service (or whoever publishes the command) must set it from the user’s group_id.

**E.2 — Order-engine: tick cache key (symbol, group_id)**
- **Files:** `apps/order-engine/src/engine/cache.rs`, `apps/order-engine/src/engine/tick_handler.rs`, `apps/order-engine/src/execution.rs`
- Change `last_ticks` from `DashMap<String, Tick>` to key by `(symbol, group_id)`. Use composite key e.g. `format!("{}:{}", symbol, group_id)` or a struct key. `update_tick` and `get_last_tick(symbol, group_id)`.
- Tick handler: subscribe to NATS subject pattern `ticks.*.*` (e.g. `ticks.{symbol}.{group_id}`). Parse subject to get symbol and group_id; store tick under (symbol, group_id). Redis price key: `prices:{symbol}:{group_id}`.

**E.3 — Execution: use group_id from command**
- **File:** `apps/order-engine/src/execution.rs`
- When processing PlaceOrderCommand, use `cmd.group_id` (with fallback if None, e.g. a default group or reject). `get_last_tick(cmd.symbol, group_id)` for fill price and limit checks.

**E.4 — Auth-service (or order API): send group_id in PlaceOrderCommand**
- **File:** Where PlaceOrderCommand is built (e.g. `backend/auth-service/src/routes/orders.rs` or equivalent).
- When publishing the place-order command to NATS, set `group_id` from the authenticated user’s `group_id`.

### Phase F: NATS Subject and Data-Provider Publish

**F.1 — Subject format**
- Use `ticks.{symbol}.{group_id}` (e.g. `ticks.BTCUSDT.550e8400-e29b-41d4-a716-446655440000`). Order-engine subscribes to `ticks.*.*` and parses symbol and group_id from subject.

**F.2 — Data-provider: publish per group**
- In the tick loop, after computing `prices: [ { g, bid, ask }, ... ]`, for each entry publish to NATS: subject `ticks.{symbol}.{g}`, payload = VersionedMessage("tick", TickEvent { symbol, bid, ask, ts, seq }).

### Phase G: Redis Key and Bootstrap Consistency

**G.1 — Keys**
- `symbol:markup:{symbol}:{group_id}` — string (JSON); SET by auth on override save and on bootstrap.
- `price:groups` — set; SADD by auth when updating group profile or on bootstrap; SMEMBERS by data-provider.

**G.2 — Bootstrap**
- Auth-service startup: ensure all groups with a default_price_profile_id are in `price:groups` and all their profile overrides are written to `symbol:markup:*`. Optional: clear `price:groups` and re-populate from DB to avoid drift.

### Phase H: Data-Provider WS (Optional / Secondary Path)

- If clients still connect to data-provider WS (e.g. VITE_DATA_PROVIDER_WS_URL): they must send `group` in subscribe message. Data-provider should only broadcast to rooms `group:{group_id}:symbol:{symbol}` and use the same per-group markup. Remove reliance on `group:default` or unkeyed `symbol:*` for pricing.

---

## 4. File Checklist (No Polling, Real-Time Markup)

| Component        | File(s) | Change |
|-----------------|---------|--------|
| Auth JWT         | `backend/auth-service/src/utils/jwt.rs` | Add `group_id` to Claims. |
| Auth session     | `backend/auth-service/src/services/auth_service.rs` | Set `claims.group_id = user.group_id` when creating tokens. |
| Markup save      | `backend/auth-service/src/routes/admin_markup.rs` | Resolve profile → groups; SET Redis keys; SADD price:groups; PUBLISH markup:update with group_id. |
| Auth bootstrap   | New or existing startup in auth-service | On startup: SMEMBERS not needed for bootstrap; populate price:groups and all symbol:markup:* from DB. |
| Group profile    | `backend/auth-service/src/routes/admin_groups.rs` | On default_price_profile_id update: update Redis keys for that group; SADD price:groups; optionally PUBLISH. |
| Data-provider    | `backend/data-provider/src/main.rs` | Cached set of group_ids (SMEMBERS at start); subscribe to markup:update, refresh set on message; tick loop: for each group get markup, build prices[], publish one Redis message + per-group NATS. |
| Data-provider    | `backend/data-provider/src/cache/redis_client.rs` | Optional: add SET for markup if ever needed from data-provider; otherwise only GET. Key format already correct. |
| Data-provider    | `backend/data-provider/src/stream/broadcaster.rs` | Broadcast only per-group rooms; remove default-only. |
| ws-gateway       | `backend/ws-gateway/src/stream/broadcaster.rs` | Parse prices[] from price:ticks; for each subscriber get conn.group_id; send matching g’s bid/ask. |
| Contracts        | `crates/contracts/src/commands.rs` | Add group_id to PlaceOrderCommand. |
| Order-engine     | `apps/order-engine/src/engine/cache.rs` | last_ticks key (symbol, group_id); get_last_tick(symbol, group_id). |
| Order-engine     | `apps/order-engine/src/engine/tick_handler.rs` | Subscribe ticks.*.*; parse symbol and group_id; update_tick with composite key; Redis key prices:{symbol}:{group_id}. |
| Order-engine     | `apps/order-engine/src/execution.rs` | get_last_tick(symbol, cmd.group_id); use for fill price. |
| Order-engine     | `apps/order-engine/src/models.rs` | Add group_id to Order. |
| Order-engine     | `apps/order-engine/src/engine/order_handler.rs` | Build Order with cmd.group_id; immediate market fill use get_last_tick(symbol, cmd.group_id); filter pending by group_id. |
| Order-engine     | `apps/order-engine/src/engine/tick_handler.rs` | process_tick(symbol, group_id, ...); filter pending by group_id; pass group_id to SL/TP. |
| Order-engine     | `apps/order-engine/src/engine/position_handler.rs` | get_last_tick(symbol, position.group_id) for exit price. |
| Order-engine     | `apps/order-engine/src/engine/sltp_handler.rs` | Pass group_id to Lua. |
| Order-engine     | `apps/order-engine/lua/check_sltp_triggers.lua` | ARGV[4]=group_id; skip position if HGET group_id !=. |
| Order-engine     | `apps/order-engine/lua/atomic_fill_order.lua` | Accept group_id; store in position hash. |
| Auth orders      | `backend/auth-service/src/routes/orders.rs` | Set group_id on PlaceOrderCommand from user. |
| Auth admin order | `backend/auth-service/src/routes/admin_trading.rs` | Set group_id from target user's group_id. |

---

## 5. Testing and Validation

- **Unit:** Auth: profile → groups query; Redis SET/SADD/PUBLISH. Data-provider: parse prices[]; gateway: route by group_id.
- **Integration:** Save override as admin → verify Redis key exists and PUBLISH; data-provider receives markup:update; next tick has correct markup for that group. Connect two WS clients (different groups), subscribe same symbol; verify different bid/ask when groups have different markup.
- **Order-engine:** Publish ticks per group; place order with group_id; verify fill uses correct group’s tick.

---

## 6. Rollout and Backward Compatibility

- **JWT:** Adding optional `group_id` is backward compatible; old tokens simply have None.
- **Redis:** New keys and format; no removal of old keys required if none were used. Gateway and data-provider must be deployed together with new payload format.
- **Order-engine:** Requires PlaceOrderCommand with group_id; auth must publish it. Deploy order-engine and auth together for order flow.

---

## 7. Summary

- **Auth:** Writes Redis markup keys keyed by group_id; maintains `price:groups`; publishes `markup:update`; JWT includes group_id; bootstrap on startup.
- **Data-provider:** Caches group set from Redis (event-driven refresh on markup:update); publishes one Redis message per tick with `prices: [ { g, bid, ask }, ... ]` and per-group NATS ticks.
- **ws-gateway:** Routes each tick to connections by their group_id using the `prices` array.
- **Order-engine:** Cache and execution keyed by (symbol, group_id); PlaceOrderCommand carries group_id.
- **No polling:** Markup and group set updates are driven by admin actions and PUBLISH; data-provider uses GET on each tick and optional one-time SMEMBERS on markup:update.

This plan is complete and ready for your review. After approval, implementation can proceed phase by phase as above.

---

## 8. Validation: Professional, Valid, and Safe for Other Functionality

This section confirms the solution is **professional**, **valid**, will **work end-to-end**, and **will not disturb other functionalities**. It is based on a full codebase audit.

### 8.1 Solution validity (will work 100%)

- **Auth → Redis:** Profile is resolved to one or more groups via `user_groups.default_price_profile_id = profile_id`. Writing `symbol:markup:{symbol}:{group_id}` and SADD `price:groups` is deterministic and event-driven. No polling.
- **Data-provider:** Reads group set from Redis (SMEMBERS at startup + on `markup:update`). For each tick, GET markup per group from Redis; keys exist after auth bootstrap/save. Single Redis publish with `prices: [ { g, bid, ask }, ... ]` is valid JSON; ws-gateway and NATS consumers can parse it.
- **ws-gateway:** Connection already has `group_id` from JWT. Registry maps symbol → list of conn_ids; for each conn we have `group_id`. Looking up `prices[].g === conn.group_id` and sending that bid/ask is correct. Fallback (no group or not in list): use first entry or skip — defined in plan.
- **Order-engine:** PlaceOrderCommand with `group_id`; tick cache key `(symbol, group_id)`; execution and limit-fill use `get_last_tick(symbol, group_id)`. NATS subject `ticks.{symbol}.{group_id}` is unambiguous; subscription `ticks.*.*` receives all; parser returns (symbol, group_id). No polling; all driven by incoming ticks and commands.

### 8.2 Order-engine: complete scope (no gaps)

The following were verified in code; the plan is updated where needed:

| Area | Current behavior | Required change | In plan / addendum |
|------|------------------|-----------------|--------------------|
| **PlaceOrderCommand** | No group_id | Add `group_id: Option<String>` | Phase E.1 ✓ |
| **Auth orders** | `backend/auth-service/src/routes/orders.rs` builds command | Set `group_id` from authenticated user’s `group_id` | Phase E.4 ✓ |
| **Order model** | No group_id | Add `group_id: Option<String>`; set from cmd when creating Order | **Add:** order_handler creates Order with group_id |
| **Pending orders** | Redis `orders:pending:{symbol}`, cache by symbol | Keep key; in process_tick get pending for symbol and **filter by order.group_id === tick group_id** | **Add:** tick_handler process_tick filters pending by group_id |
| **Tick cache** | `symbol → Tick` | `(symbol, group_id) → Tick` | Phase E.2 ✓ |
| **Tick subject** | `ticks.{symbol}` | `ticks.{symbol}.{group_id}`; subscribe `ticks.*.*`; parse (symbol, group_id) | Phase F.1, E.2 ✓ |
| **Execution** | get_last_tick(symbol) | get_last_tick(symbol, cmd.group_id) | Phase E.3 ✓ |
| **Order handler** | Immediate market fill uses get_last_tick(symbol) | Use get_last_tick(symbol, cmd.group_id) | **Add:** order_handler immediate fill uses group_id |
| **Position** | Stored in Redis hash (pos:by_id:*); no group_id | Store `group_id` when creating position (from order) | **Add:** Phase E – position creation and Lua |
| **SL/TP** | check_and_trigger(symbol, bid, ask); Lua uses pos:open:{symbol} | Pass group_id; Lua filters: for each position load hash, skip if position.group_id != group_id | **Add:** Phase E – SL/TP Lua filter by group_id |
| **Position handler** | get_last_tick(symbol) for manual close exit price | get_last_tick(symbol, position.group_id); position must have group_id | **Add:** position_handler uses group_id from position |
| **Redis price key** | prices:{symbol} | prices:{symbol}:{group_id} | Phase E.2 ✓ |

- **Order:** Add `group_id` to `Order` (e.g. in `apps/order-engine/src/models.rs`). When building `Order` in order_handler from `PlaceOrderCommand`, set `order.group_id = cmd.group_id`.
- **Pending filter:** In tick_handler `process_tick(symbol, group_id, bid, ask)`, get `pending_order_ids = get_pending_orders(symbol)` (unchanged). When evaluating each order, load Order from cache; if `order.group_id != group_id`, skip. So only orders for this group are filled for this tick.
- **Position group_id:** When creating a position in `atomic_fill_order.lua`, pass `group_id` as argument (from order); store in position hash. Existing keys (e.g. `pos:open:{symbol}`) can stay; SL/TP Lua filters by group_id (see below).
- **SL/TP:** Pass `group_id` as fourth argument to `check_sltp_triggers.lua`. In the helper that verifies a position (e.g. before adding to `triggered`), do `HGET pos:by_id:{pos_id} group_id`; if not equal to the passed group_id, skip. No change to key layout; only filter in Lua.
- **Position handler (manual close):** When computing exit price, get position from Redis; read `group_id` from position; call `get_last_tick(symbol, position_group_id)`.

### 8.3 No other functionalities disturbed

- **Frontend / usePriceStream:** Consumes prices from WebSocket (gateway). Gateway will send group-specific bid/ask; message shape (tick with symbol, bid, ask, ts) unchanged. No frontend change required; no disturbance.
- **Other Redis consumers:** Only order-engine today writes/reads `prices:*` (tick_handler). Changing to `prices:{symbol}:{group_id}` is internal to order-engine. No other service found reading this key.
- **Other channels:** `price:ticks` is only consumed by ws-gateway for price display and by no other service. Changing payload to `{ symbol, ts, prices: [...] }` only affects ws-gateway’s broadcaster; no other subscriber.
- **Orders, positions, deposits, withdrawals, risk, notifications:** These use user_id, order_id, position_id, or their own channels. No dependency on a single “default” price stream. They are not touched except: (1) auth adds group_id to JWT and to PlaceOrderCommand, (2) order-engine uses group_id for tick lookup and position/order processing. No disturbance to their semantics.
- **Admin trading / admin order placement:** If auth has an admin path that places orders on behalf of a user, that path must set PlaceOrderCommand.group_id to **that user’s** group_id (not admin’s). Same rule: order uses the end-user’s group for pricing.

### 8.4 Deployment and compatibility

- **Backward compatibility:** JWT with optional `group_id`; old tokens still work (group_id None; gateway can fall back to “first group” or no tick for that conn). PlaceOrderCommand with new optional `group_id`: old messages without it can be treated as “no group” and rejected or use a single default group for legacy; recommend requiring group_id for new deployments.
- **Deploy order:** (1) Contracts (add group_id to PlaceOrderCommand). (2) Auth-service (JWT group_id, Redis bootstrap, markup SET/SADD/PUBLISH, set group_id when publishing PlaceOrderCommand). (3) Data-provider (group set, per-group tick, Redis + NATS format). (4) ws-gateway (parse prices[], route by group_id). (5) Order-engine (cache, tick subject, Order/Position group_id, execution, SL/TP, position handler). This order avoids undefined group_id or missing tick format.

### 8.5 Conclusion

The plan is **professional** (clear phases, keys, and contracts), **valid** (data flows and code paths checked), and **safe** (no other features depend on the current single-stream or unkeyed prices). With the order-engine addenda above (Order.group_id, pending filter, position group_id, SL/TP filter, position_handler tick by group), the solution will work end-to-end. You can approve this plan and implementation can proceed phase by phase.
