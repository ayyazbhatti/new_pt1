# Data provider extensibility (multi-feed / multi-venue)

**Document status:** Implementation in `backend/data-provider` matches this guide.

**Default behavior:** Crypto uses **Binance** (`BinanceFeed`). Non–Binance-style symbols (e.g. forex) use **MMDPS** when `MMDPS_API_KEY` is set and routing applies. Redis `price:ticks`, WebSocket tick JSON, NATS, and markup follow the same pipeline.

---

## Implementation summary

| Phase | Status | What was built |
|-------|--------|----------------|
| **1** | Done | `FeedRouter` dispatches `get_price` / `subscribe_symbol`; `main`, `ws_server`, `health` use `Arc<FeedRouter>`. |
| **2** | Done | `feeds/routing.rs` — `FeedKind` (Binance / MMDPS), `resolve_feed`, unit tests. |
| **3** | Done | `feeds/mmdps_feed.rs` — MMDPS WebSocket for forex/CFD-style symbols (`MMDPS_API_KEY`). |
| **4** | Done | Binance **multiplex** WebSocket: one connection, batched `SUBSCRIBE`, combined + raw ticker parsing, read-biased `select!`, hot path `trace!`. Cap **~1020** streams per socket (exchange limit 1024). |

---

## Environment variables (selected)

| Variable | Default | Purpose |
|----------|---------|---------|
| `MMDPS_API_KEY` | unset | Enables MMDPS live feed + history proxy when set. |
| `MMDPS_AUTO_ROUTE` | `true` with key | `*USDT`-style → Binance; other symbols → MMDPS. |
| `FEED_PROVIDER` | `binance` | **Label only** — logged at startup. |
| `BINANCE_WS_URL`, `WS_PORT`, `HTTP_PORT`, `REDIS_URL`, … | unchanged | Same semantics as before. |

Forex and other non-crypto instruments are **live MMDPS** data when configured — not synthetic.

---

## Module map (current)

| Item | Location |
|------|----------|
| Binance spot bookTicker | `feeds/binance_feed.rs` — multiplex WS; `tracked_symbol_count()`. |
| Symbol → feed kind | `feeds/routing.rs` — `FeedKind`, `resolve_feed`, unit tests. |
| MMDPS | `feeds/mmdps_feed.rs` — `MmdpsFeed`. |
| Dispatch | `feeds/feed_router.rs` — `FeedRouter`, `FeedRouterDiagnostics`. |
| HTTP | `health/health_routes.rs` — `/prices`, `/feed/status` (`router`), `/metrics`. |
| Optional catalog | `catalog/symbol_catalog.rs` — Postgres `symbols` merge when `DATABASE_URL` / `SYMBOLS_DATABASE_URL` set. |
| WS subscribe | `stream/ws_server.rs` — `Arc<FeedRouter>`. |

---

## Routing (summary)

1. If MMDPS is **inactive** (no API key) → **Binance** for all symbols (forex may get no upstream ticks).
2. If MMDPS **active** and **auto-route** → Binance-style spot tickers → **Binance**; else → **MMDPS**.
3. If MMDPS **active** and **explicit** list (`MMDPS_AUTO_ROUTE=false`) → only listed symbols → **MMDPS**.

---

## Testing

- From `backend/data-provider`: `cargo test` — `feeds::routing` + `feeds::binance_feed` URL normalization tests.
- Manual: `GET http://localhost:9004/feed/status` — `router` shows `mmdps_configured`, `mmdps_tracked_symbols`, etc.

---

## Performance

- **Binance path:** One TCP/TLS connection + `SUBSCRIBE` batches; inbound ticks parsed on a **read-first** `select!` branch.
- **Hot path:** Per-tick logging is **`trace!`** only.
- **Limit:** At most **~1020** bookTicker streams per multiplex socket (Binance hard limit 1024).

---

## Related files

- `backend/data-provider/src/main.rs`
- `backend/data-provider/src/config.rs`
- `backend/data-provider/src/feeds/{binance_feed,feed_router,mmdps_feed,routing}.rs`
- `backend/data-provider/src/health/health_routes.rs`
- `backend/data-provider/src/stream/ws_server.rs`
