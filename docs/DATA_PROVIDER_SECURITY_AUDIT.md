# Data Provider Security & Correctness Audit

**Scope:** `backend/data-provider/` (production), `apps/data-provider/` (legacy/dev).  
**Production:** `deploy/docker-compose.prod.yml` runs `command: ["/app/data-provider"]` built from `deploy/Dockerfile.backend` — **uses `backend/data-provider`**, not `apps/data-provider`.  
**Method:** Static read-only review.  
**Date:** 2026-05-19

**Related:** [ORDER_ENGINE_SECURITY_AUDIT.md](./ORDER_ENGINE_SECURITY_AUDIT.md), [TRADING_API_SECURITY_AUDIT.md](./TRADING_API_SECURITY_AUDIT.md)

---

# 0. Executive Summary

The production data-provider ingests **Binance** (multiplex `bookTicker`) and **MMDPS** (forex/CFD) WebSockets, applies **per-group percent markup** from Redis `symbol:markup:{symbol}:{group}`, and publishes to **Redis `price:ticks`**, **NATS `ticks.{symbol}` / `ticks.{symbol}.{group_id}`**, and an optional **direct WebSocket** on port 9003. Binance-side validation (spread, `ask > bid`, `Decimal` parsing) is reasonable; MMDPS validation is thinner. Critical gaps: **raw upstream prices are published** on the symbol-only path (no group / empty `price:groups`), **`/prices` HTTP is unauthenticated and unmarked**, markup uses **`f64` percent config** and **increases both bid and ask** (not classic spread-widening), and **stale cached prices keep publishing** while the watchdog only reconnects feeds. The service does **not** mitigate engine F12 (no signed ticks, no publish-time freshness gate); it **partially** helps F10 via Postgres catalog (`trading_enabled`) but does not filter ticks by `symbol:status` at publish time.

**Trust score: 4/10**

**Go/no-go:** **No-go** for production CFD until raw-price paths are removed for client/engine consumption and markup direction is verified with product.

**Top 3 issues:**
1. **Raw feed prices on NATS/Redis/WS when no group markup path** — engine and ws-gateway can receive unmarked ticks (Critical).
2. **Public `/prices` returns raw upstream bid/ask** — no auth, no markup (Critical for commercial terms).
3. **Stale tick cache still published at 10 Hz** — watchdog reconnects upstream but does not stop distributing last price (High / fill integrity).

---

# 1. Module Inventory

| Path | Lines | Purpose |
|------|------:|---------|
| `backend/data-provider/src/main.rs` | 718 | Orchestration: Redis/NATS, 100ms publish loop, catalog, watchdog |
| `backend/data-provider/src/feeds/binance_feed.rs` | 392 | Binance multiplex WS, spread checks |
| `backend/data-provider/src/feeds/mmdps_feed.rs` | 249 | MMDPS WS, tick parse |
| `backend/data-provider/src/feeds/feed_router.rs` | 136 | Binance vs MMDPS routing |
| `backend/data-provider/src/feeds/routing.rs` | 226 | `is_binance_spot_style`, `resolve_feed` |
| `backend/data-provider/src/pricing/markup_engine.rs` | 54 | Redis markup → adjusted bid/ask |
| `backend/data-provider/src/pricing/normalizer.rs` | 52 | Round/normalize before broadcast |
| `backend/data-provider/src/stream/broadcaster.rs` | 112 | Room-based WS fan-out |
| `backend/data-provider/src/stream/ws_server.rs` | 296 | Direct WS `:9003` subscribe API |
| `backend/data-provider/src/cache/redis_client.rs` | 124 | Markup, `price:groups`, pub/sub |
| `backend/data-provider/src/health/health_routes.rs` | 378 | `/health`, `/prices`, `/feed/history`, etc. |
| `backend/data-provider/src/catalog/symbol_catalog.rs` | 60 | Postgres MMDPS symbol merge |
| `backend/data-provider/src/validation/symbol_validation.rs` | 96 | WS symbol allowlist (dynamic enable) |
| `backend/data-provider/src/config.rs` | 183 | Env + admin Redis merge |
| `backend/data-provider/src/routing/subscription_router.rs` | 24 | **Unused** (dead) |

| `apps/data-provider/src/main.rs` | 296 | **Legacy/mock** tick generator + NATS; not in prod compose |

**Duplicate:** `apps/data-provider` reimplements markup + `price:ticks` publish for dev; production must use `backend/data-provider` only.

---

# 2. Architecture & Data Flow

```
[Binance wss://stream.binance.com:9443/ws]     [MMDPS wss://api.mmdps.uk/feed/ws?api_key=***]
         | bookTicker multiplex                              | JSON ticks
         v                                                   v
   BinanceFeed.price_states                          MmdpsFeed.price_states
         \___________________________________________/
                              FeedRouter.get_price(symbol)
                              (100ms loop, dedupe if bid/ask unchanged)
                              |
         +--------------------+--------------------+
         |                    |                    |
   MarkupEngine          Redis PUBLISH         NATS publish
   per group_id          price:ticks           ticks.{sym}[.{group}]
   symbol:markup:*        {symbol,ts,prices[]}  TickEvent (Decimal)
         |                    |                    |
         v                    v                    v
   Broadcaster WS         ws-gateway            order-engine
   group:{g}:symbol:*     (per-group array)     tick_handler
   symbol:{sym} RAW       + symbol-only RAW
```

### External endpoints

| Source | URL (default / config) |
|--------|-------------------------|
| Binance WS | `BINANCE_WS_URL` → `wss://stream.binance.com:9443/ws` (`config.rs:126-127`) |
| MMDPS WS | `MMDPS_WS_BASE` + `?api_key=` from env or Redis (`config.rs:145-153`) |
| MMDPS history | `MMDPS_HISTORY_BASE` → `https://api.mmdps.uk/feed/history` (proxied by HTTP) |

### Redis

| Key / channel | R/W | Purpose |
|---------------|-----|---------|
| `symbol:markup:{SYMBOL}:{group_id}` | Read | Markup JSON (`bid_markup`, `ask_markup` %) |
| `price:groups` | Read | SMEMBERS → groups for per-group ticks |
| `symbol:status:{symbol}` | Read helper | **Not used in publish loop** |
| `admin:integrations` / MMDPS key mirror | Read at startup | Override Binance URL, MMDPS API key |
| PUBLISH `price:ticks` | Write | JSON with `prices: [{g,bid,ask}, ...]` |
| SUBSCRIBE `markup:update` | Read | Refresh `price:groups`, clear dedup cache |

**No `tick:{symbol}` key** written in this service (engine audit may refer to other paths).

### NATS

| Subject | Payload |
|---------|---------|
| `ticks.{symbol}` | Raw `TickEvent` when **no** `price:groups` |
| `ticks.{symbol}.{group_id}` | Marked-up `TickEvent` per group |

### HTTP (port `HTTP_PORT` default 9004)

| Route | Auth |
|-------|------|
| `GET /health`, `/health/fresh` | None |
| `GET /metrics`, `/feed/status` | None |
| `GET /prices?symbols=` | **None — raw prices** |
| `GET /feed/history?symbol=&timeframe=` | **None** — server-side MMDPS proxy (key not returned) |

### Configuration sources

1. **Env:** `MMDPS_API_KEY`, `REDIS_URL`, `DATABASE_URL`, freshness/watchdog vars, `INITIAL_SYMBOLS`, etc.
2. **Redis (admin):** `DataProvidersConfig` JSON, `REDIS_KEY_DATA_PROVIDER_MMDPS_API_KEY` — merged at startup (`main.rs:49-61`)
3. **Postgres:** `symbols` table for MMDPS catalog (`symbol_catalog.rs`) — `is_enabled`, `trading_enabled`

**Priority:** Env MMDPS key first; Redis admin key **overrides** env on startup (`apply_mmdps_api_key_from_admin_redis`). Binance WS URL overridden from admin integrations JSON only.

### Symbol list

- Default ~100 crypto in `main.rs` if `INITIAL_SYMBOLS` unset
- `MMDPS_SYMBOLS` env + Postgres catalog (`fetch_mmdps_catalog_symbols`)
- Periodic refresh (`SYMBOLS_CATALOG_REFRESH_SECS`, default 300s)
- **WS clients can add symbols dynamically** (`ws_server.rs:255-268`) without DB check

---

# 3. Findings — DETAILED

---
### F1: Raw upstream prices published when no group or on symbol-only path
- **Severity:** 🔴 Critical
- **Category:** Markup Correctness | Tick Integrity
- **Location:** `backend/data-provider/src/main.rs:517-546`, `570-585`
- **Code:**

```517:546:backend/data-provider/src/main.rs
                    for group_id in &group_ids {
                        let (bid, ask) = match markup_engine_clone
                            .apply_markup(symbol, group_id, price_state.bid, price_state.ask)
                            .await
                        {
                            Some(p) => p,
                            None => (price_state.bid, price_state.ask),
                        };
                        ...
                    }
                    if prices_by_group.is_empty() {
                        prices_by_group.push(serde_json::json!({
                            "g": "",
                            "bid": price_state.bid.to_string(),
                            "ask": price_state.ask.to_string(),
                        }));
                    }
                    broadcaster_clone
                        .broadcast_price(symbol, None, price_state.bid, price_state.ask)
                        .await;
```

```570:585:backend/data-provider/src/main.rs
                        if group_ids.is_empty() {
                            let tick_event = TickEvent {
                                symbol: symbol.clone(),
                                bid: price_state.bid,
                                ask: price_state.ask,
                                ...
                            };
                            let subject = format!("ticks.{}", symbol);
                            nats_client.publish(subject.clone(), payload.into()).await
```

- **What's wrong:** Per-group NATS/Redis entries use markup when configured; **symbol-only** WS room and **empty-group** Redis/NATS paths use **raw** `price_state` from Binance/MMDPS. `apply_markup` miss / Redis error also falls back to raw (`None => (price_state.bid, price_state.ask)` at line 523).
- **Impact:** Order engine fills and charts can run on **unmarked** wholesale prices — direct P&L/markup loss.
- **Recommended fix:** Fail closed: do not publish to engine/clients without successful markup for the user's group; remove `broadcast_price(..., None, raw)` for production paths.

---
### F2: `GET /prices` exposes raw feed without authentication or markup
- **Severity:** 🔴 Critical
- **Category:** Information Disclosure | Markup Correctness
- **Location:** `backend/data-provider/src/health/health_routes.rs:215-248`
- **Code:**

```238:245:backend/data-provider/src/health/health_routes.rs
        if let Some(state) = feed.get_price(&symbol).await {
            out.push(PriceItem {
                symbol: symbol.clone(),
                bid: state.bid.to_string(),
                ask: state.ask.to_string(),
                ts: state.ts,
            });
```

- **What's wrong:** Public HTTP returns **upstream** bid/ask from `FeedRouter` with **CORS permissive** on the app (`main.rs:713`). No JWT, no admin secret ( `ADMIN_SECRET_KEY` is loaded in config but **unused** in codebase).
- **Attack scenario:** `curl http://data-provider:9004/prices?symbols=EURUSD,BTCUSDT` from any network that can reach the port yields raw prices usable to arb against marked retail quotes.
- **Recommended fix:** Require auth; return marked-up prices per `group_id` query param; or bind to internal network only and document.

---
### F3: Markup math increases both bid and ask (may invert intended spread widening)
- **Severity:** 🟠 High
- **Category:** Markup Correctness
- **Location:** `backend/data-provider/src/pricing/markup_engine.rs:36-39`
- **Code:**

```36:39:backend/data-provider/src/pricing/markup_engine.rs
        let bid_multiplier = Decimal::from(1) + decimal_from_f64(markup.bid_markup / 100.0)?;
        let ask_multiplier = Decimal::from(1) + decimal_from_f64(markup.ask_markup / 100.0)?;
        let (final_bid, final_ask) = (bid * bid_multiplier, ask * ask_multiplier);
```

- **What's wrong:** Positive `bid_markup` **raises** bid (better for client selling to broker). Typical B-book widening is **lower bid, higher ask**. Product may intend percent-of-price markup on both sides — if operators expect pip widening (`bid - spread`, `ask + spread`), fills will be wrong-sided.
- **Recommended fix:** Document contract in admin UI; implement `bid - f(bid_markup)`, `ask + f(ask_markup)` for pip/point types; unit tests with known EURUSD example.

---
### F4: Markup config uses `f64`; conversion via `Decimal::from_f64`
- **Severity:** 🟠 High
- **Category:** Numeric Precision
- **Location:** `cache/redis_client.rs:11-15`, `markup_engine.rs:51-54`
- **What's wrong:** `bid_markup` / `ask_markup` stored and applied through IEEE doubles before `Decimal::from_f64`. Extreme crypto prices and tiny markups can lose precision.
- **Recommended fix:** Store markup as string/Decimal in Redis; avoid `f64` on money path entirely.

---
### F5: Stale prices keep publishing — watchdog reconnects only
- **Severity:** 🟠 High
- **Category:** Tick Integrity | Failure handling
- **Location:** `main.rs:465-611`, `615-659`
- **What's wrong:** 100ms loop reads **last in-memory** `PriceState` even if upstream is stale. Watchdog calls `force_resync_upstreams()` after thresholds (Binance default **120s**, MMDPS **180s**) but **never blocks publish** based on tick age.
- **Cross-ref engine F12:** Engine still accepts ticks; data-provider does **not** stop stale distribution — **worsens** blind trust.
- **Recommended fix:** Per-symbol `now - price_state.ts > max_age` → skip NATS/Redis publish; expose stale flag on `/health/fresh` and metric.

---
### F6: MMDPS API key in WebSocket URL query string
- **Severity:** 🟠 High
- **Category:** Feed Authentication | Information Disclosure
- **Location:** `config.rs:145-153`, `mmdps_feed.rs:98`
- **Code:**

```145:153:backend/data-provider/src/config.rs
    pub fn mmdps_ws_connect_url(&self) -> Option<String> {
        let key = self.mmdps_api_key.as_ref()?;
        ...
            Some(format!("{}?api_key={}", base, key))
```

- **What's wrong:** Key appears in URL (proxy logs, crash dumps, `connect_async` error strings). Not logged on success path (`MMDPS: connecting…` only).
- **Recommended fix:** Header-based auth if MMDPS supports it; otherwise treat URL as secret, rotate keys, restrict egress logging.

---
### F7: `symbol:status` / disabled symbols not enforced at publish
- **Severity:** 🟡 Medium
- **Category:** Configuration Safety
- **Location:** `redis_client.rs:50-56` vs `main.rs` publish loop (no call)
- **What's wrong:** `get_symbol_status` exists, defaults **enabled** if missing. Publish loop never checks it — disabled DB symbols still tick if subscribed.
- **Cross-ref engine F10:** Partial mitigation via catalog **subscription** (`trading_enabled` in SQL), not per-tick filter.
- **Recommended fix:** Before publish, `GET symbol:status:{sym}` or in-memory set from catalog refresh.

---
### F8: Direct WebSocket allows dynamic symbol enable without catalog check
- **Severity:** 🟡 Medium
- **Category:** Feed Authentication | Resource Limit
- **Location:** `ws_server.rs:235-238`
- **Code:**

```235:238:backend/data-provider/src/stream/ws_server.rs
                if !validator.is_symbol_enabled(&symbol_upper) {
                    info!("🔓 Enabling symbol in validator: {}", symbol_upper);
                    validator.enable_symbol(symbol_upper.clone());
```

- **What's wrong:** Any WS client can subscribe to arbitrary symbol string (up to 100 per connection), triggering **upstream Binance/MMDPS subscribe** — resource / data exfil vector on open `:9003`.
- **Recommended fix:** Only allow symbols from catalog/validator bootstrap; auth on WS; bind to internal network.

---
### F9: Global subscribe rate limiter key
- **Severity:** 🟡 Medium
- **Category:** Resource Limit
- **Location:** `ws_server.rs:211`, `symbol_validation.rs:74-94`
- **What's wrong:** `check_rate_limit("subscribe")` — **one bucket for all clients** (60 req / 100 max per 60s window).
- **Recommended fix:** Rate limit per connection IP or conn id.

---
### F10: `ADMIN_SECRET_KEY` unused; config `max_connections` unused
- **Severity:** 🔵 Low
- **Category:** Configuration Safety
- **Location:** `config.rs:112-115`, `124-125`
- **What's wrong:** Dead configuration — gives false sense of protection.

---
### F11: `/feed/history` unauthenticated — MMDPS quota abuse
- **Severity:** 🟡 Medium
- **Category:** Resource Limit | Information Disclosure
- **Location:** `health_routes.rs:304-338`
- **What's wrong:** Anyone who can reach HTTP port can proxy history requests using **server's** MMDPS key (key not returned, but **cost/abuse** on vendor API).
- **Recommended fix:** Auth + rate limit; or internal-only network.

---
### F12: Binance tick validation good; MMDPS weaker
- **Severity:** 🟡 Medium (positive partial)
- **Category:** Tick Integrity
- **Location:** `binance_feed.rs:205-216`, `mmdps_feed.rs:213-216`
- **Confirmed:** Binance rejects `ask <= bid`, spread > 10%. MMDPS only checks `ask <= bid` — no wide-spread filter, no max price bounds, `parse_decimal_json` accepts `f64`.

---

## 3.1 External feed connections — confirmed

| Check | Binance | MMDPS |
|-------|---------|-------|
| URL source | Env `BINANCE_WS_URL`, admin Redis override | Env + Redis key; `MMDPS_WS_BASE` |
| TLS | `wss://` via `tokio_tungstenite::connect_async` — **default rustls/native TLS validation** (no `danger_accept_invalid` in repo) | Same |
| Retry | 5s reconnect loop | 5s reconnect |
| API key in URL | No | **Yes** (`?api_key=`) (F6) |

---

## 3.2 Feed data validation — summary

| Check | Binance | MMDPS |
|-------|---------|-------|
| Symbol whitelist at ingest | No — any subscribed symbol | No |
| ask > bid | Yes | Yes |
| Spread cap | 10% | No |
| NaN/Inf | Via `Decimal::from_str_exact` / parse errors skip | `from_f64` path |
| Timestamp | Uses event time or wall clock | Optional `timestamp` or wall clock |
| Future/past ts reject | No | No |
| Seq gaps | N/A | N/A |
| Per-symbol rate limit | No — full firehose | No |

---

## 3.3 Markup application — trace (one tick)

1. `feed_clone.get_price(symbol)` → raw `PriceState { bid, ask, ts }` from Binance or MMDPS.
2. For each `group_id` in `price:groups` (Redis SMEMBERS, refreshed every 30s + `markup:update`):
   - `redis.get("symbol:markup:{SYMBOL}:{group}")` → `MarkupConfig { bid_markup, ask_markup }` as **f64** percents.
   - `final_bid = bid * (1 + bid_markup/100)`, `final_ask = ask * (1 + ask_markup/100)`.
   - If missing markup: **raw bid/ask** used (fail open).
3. Redis `price:ticks` JSON includes marked `prices[]` per group; if no groups, **raw** in `g:""`.
4. NATS: per-group marked ticks; if no groups, **raw** `ticks.{symbol}`.
5. `broadcaster.broadcast_price(symbol, Some(group), bid, ask)` → marked via same engine.
6. `broadcast_price(symbol, None, raw_bid, raw_ask)` → **RAW** to `symbol:{sym}` WS room.

**Raw visible to clients:** Yes — symbol-only WS, `/prices`, empty groups, markup miss (F1, F2).

---

## 3.4 Tick distribution — confirmed

- **Redis:** `PUBLISH price:ticks` only (not `prices:{symbol}:{group}` keys).
- **NATS:** `ticks.{symbol}` or `ticks.{symbol}.{group_id}`.
- **Parallel:** Sequential `for group_id` in loop — groups see same raw snapshot instant; no cross-group staleness within one 100ms tick.
- **Redis down:** `publish_price_update` warns; loop continues — NATS/WS may still run.
- **NATS down:** Warn at startup; loop continues without engine ticks.

---

## 3.5 Symbol catalog — confirmed

- Postgres: `symbols` where `is_enabled`, `trading_enabled`, MMDPS routing rules (`symbol_catalog.rs:14-26`).
- Refresh adds new upstream subscriptions periodically.
- **Gap:** User can trade symbol in auth DB before catalog refresh subscribes — engine F10 window.
- Disabled symbol still ticks if already subscribed (F7).

---

## 3.6 Feed freshness — confirmed

Env defaults (`config.rs:86-105`):

- `FEED_FRESHNESS_BINANCE_MAX_STALE_SECS` = 120  
- `FEED_FRESHNESS_MMDPS_MAX_STALE_SECS` = 180  
- `FEED_WATCHDOG_INTERVAL_SECS` = 20  
- `FEED_WATCHDOG_STALE_THRESHOLD` = 3 consecutive stale checks → `force_resync_upstreams()`

**Action on stale:** Reconnect/resubscribe only — **publish continues** (F5). `/health` returns `degraded` when stale.

---

## 3.7 Failure modes — confirmed

| Failure | Behavior |
|---------|----------|
| Binance down | Last cached prices keep publishing; health degraded; watchdog reconnects |
| MMDPS down | `mmdps_stale` optional false if MMDPS not configured; same cache behavior |
| `SERVER_REGION` | Logged only — **no failover logic** in code |
| Symbol on both feeds | `resolve_feed` picks **one** — Binance if `is_binance_spot_style`, else MMDPS |

---

## 3.8 Public HTTP — confirmed

See F2, F11. **No rate limiting** on HTTP routes.

---

## 3.9 Configuration safety — confirmed

- API key: loaded from env/Redis; **not** in `/health` JSON; MMDPS history uses server key server-side only.
- Hot reload: partial — `markup:update` refreshes groups; **MMDPS key / Binance URL require restart** (startup merge only).
- Malformed admin JSON: warn and skip (`main.rs:55-56`).
- **JWT:** Data-provider does **not** use JWT (confirms auth audit concern is elsewhere).

---

## 3.10 Resource limits — confirmed

| Limit | Value | Enforced? |
|-------|-------|-----------|
| Binance streams/socket | 1020 | Yes |
| WS symbols/connection | 100 | Yes (validator) |
| Catalog MMDPS symbols | 25,000 default | Truncate |
| `max_connections` | 200,000 config | **No** |
| Publish throttle | 100ms + unchanged dedup | Yes |
| Groups × symbols NATS msgs | O(groups × symbols) / 10Hz | **No cap** — 1000 groups × 200 symbols = stress |

---

## 3.11 Numeric precision — confirmed

- Internal storage: **`Decimal`** for bid/ask in `PriceState` and NATS `TickEvent`.
- Weak points: MMDPS `as_f64()` parse path; markup percents as `f64`; `decimal_from_f64` in markup engine.
- Normalizer: round_dp(10) with micro-spread pass-through (`normalizer.rs`).

---

## 3.12 Time and timestamps — confirmed

- Publish loop uses `chrono::Utc::now().timestamp_millis()` for Redis JSON `ts`.
- NATS `TickEvent.ts` often `Utc::now()` at publish, not always `price_state.ts`.
- Binance prefers exchange `E` field when present.

---

## 3.13 Error handling — confirmed

- `expect` on MMDPS mutex only (`mmdps_feed.rs:58,69`).
- `unwrap` in ws_server JSON send paths (non-fatal).
- Malformed JSON: skip tick, continue (Binance debug, MMDPS trace).
- WS disconnect: reconnect loops — **does not clear stale price_states** on disconnect.

---

## 3.14 Logging — confirmed

- Inbound WS messages logged at **info** with full text (`ws_server.rs:93`) — noisy, possible PII.
- Binance connect logs URL **without** key (safe).
- Per-tick debug on Redis publish when enabled — high cardinality.

---

## 3.15 Cross-check with previous audits

| Ref | Data-provider role |
|-----|-------------------|
| Engine F12 (stale/unauth ticks) | **Does not mitigate** — no auth on ticks, stale still published (F5) |
| Engine F11 (`tonumber` in Lua) | Downstream; provider sends Decimal strings in JSON — helps if engine preserves strings |
| Engine F10 (symbol fail-open) | **Partial** — catalog for subscribe only (F7) |
| Trading API F10 (symbol flags) | Separate HTTP catalog |
| Auth F4 (JWT) | **N/A** — no JWT here |

---

## 3.16 Test coverage — confirmed

| Area | Tests |
|------|-------|
| `routing.rs` | Extensive unit tests |
| `binance_feed.rs` | URL normalize |
| `normalizer.rs` | Micro-spread |
| `health_routes.rs` | Timeframe mapping |
| Markup math | **None** |
| Tick validation | **None** |
| Reconnection | **None** |

---

# 4. Strengths

- **Production path clear** — `docker-compose.prod.yml` uses `backend/data-provider`.
- **Binance multiplex** — single socket, batched SUBSCRIBE, spread sanity checks, `Decimal` parsing.
- **Feed routing** — thoughtful `is_binance_spot_style` avoids forex/metal misroutes to Binance.
- **Per-group marked NATS** when `price:groups` populated — correct subject pattern for engine.
- **MMDPS history proxy** — keeps API key off browser (when network-restricted).
- **Markup refresh** on `markup:update` clears dedup cache for immediate republication.
- **Postgres catalog** respects `trading_enabled` for **new** MMDPS subscriptions.
- **sqlx/reqwest** use rustls — no obvious TLS bypass.

---

# 5. Trust Score Breakdown

| Dimension | Score |
|-----------|------:|
| Feed authentication | 5 |
| Tick integrity | 4 |
| Markup correctness | 3 |
| Failure handling | 4 |
| Resource bounds | 4 |
| Configuration safety | 5 |
| Information disclosure | 3 |
| Numeric precision | 5 |
| Test coverage | 4 |
| Error/panic safety | 6 |

**Harmonic mean ≈ 4.1 → Overall 4/10**

---

# 6. Production Go-Live Verdict

## 🟡 / 🔴 **Not ready** (treat as **No-go** for marked CFD until F1–F2 fixed)

Marked per-group NATS path is structurally sound, but **raw price escape hatches** to engine, ws-gateway, and public HTTP are incompatible with a commercial trading platform.

---

# 7. Prioritized Fix List

| # | Finding | Effort | Risk | Sprint |
|---|---------|--------|------|--------|
| 1 | F1 — Remove raw NATS/Redis/WS publish paths | M | Wrong fills | 1 |
| 2 | F2 — Secure or remove `/prices`; return marked quotes only | S | Arb / leak | 1 |
| 3 | F5 — Do not publish ticks older than threshold | M | Stale fills | 1 |
| 4 | F3 — Validate markup direction + unit tests | M | P&L | 2 |
| 5 | F4 — Decimal markup config end-to-end | S | Precision | 2 |
| 6 | F6 — MMDPS key out of query string | M | Key leak | 2 |
| 7 | F7 — Enforce symbol:status on publish | S | Disabled symbols | 2 |
| 8 | F8 — WS auth + catalog-only symbols | M | Abuse | 3 |

---

# 8. Cross-Module Notes

| Module | Implication |
|--------|-------------|
| **order-engine** | Subscribes `ticks.>` — receives **raw** ticks when no groups or wrong subject; must not fill on unmarked prices |
| **ws-gateway** | Consumes `price:ticks` — may show raw in `g:""` entry or first-group fallback |
| **auth-service** | Writes markup keys and `price:groups`; must bootstrap groups before trading |
| **frontend** | Charts via `/feed/history` — OK for history; live must use marked stream only |
| **apps/data-provider** | Do not deploy to prod; dev-only mock |

---

*End of audit. Static analysis only.*
