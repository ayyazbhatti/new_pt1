# Trading hours / market sessions — read-only diagnostic

**Date:** 2026-05-22  
**Scope:** Admin Symbols UI, Postgres schema, `auth-service` order placement, `order-engine`, tick sources.  
**Database sampled:** `postgresql://postgres:postgres@127.0.0.1:5434/newpt` (local dev).

---

## Executive verdict

**Calendar-based trading hours (sessions, weekdays, open/close times): Status D — not built.**

There are **no** DB columns or admin fields for per-symbol session schedules. The order path does **not** compare wall-clock time to any symbol session. Ticks are driven by upstream feeds / hardcoded fetch loops without “market closed” gating.

**Related (not the same feature):** The `symbols` table has **`trading_enabled`**, **`close_only`**, **`allow_new_orders`**, and **`is_enabled`**. Admin edit form exposes **`is_enabled`** (“Enabled (Streaming)”) and **`trading_enabled`** (“Trading Enabled”). **`place_order` does not read `trading_enabled` / `close_only` / `allow_new_orders` from the DB.** The order-engine validator only checks Redis **`symbol:status:{symbol}`**, which is updated from **`is_enabled`** (not `trading_enabled`) when admins publish symbol status. So “Trading Enabled” in admin is **storage + UI only** for the HTTP place-order path; partial enforcement exists only for **streaming disabled** via `is_enabled` → Redis.

---

## Step 1 — Schema inspection (SQL)

### Column search (`information_schema.columns`)

Query (as requested; `table_schema = 'public'`):

```sql
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (column_name ILIKE '%session%'
   OR column_name ILIKE '%trading_hour%'
   OR column_name ILIKE '%market_hour%'
   OR column_name ILIKE '%open_time%'
   OR column_name ILIKE '%close_time%'
   OR column_name ILIKE '%weekday%'
   OR column_name ILIKE '%session_open%'
   OR column_name ILIKE '%session_close%');
```

**Result:** `(0 rows)` — no public columns matching session / trading_hour / market_hour / open_time / close_time / weekday / session_open / session_close.

### Table search (`information_schema.tables`)

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND (table_name ILIKE '%session%' 
       OR table_name ILIKE '%trading_hour%' 
       OR table_name ILIKE '%market_hour%'
       OR table_name ILIKE '%schedule%');
```

**Result:** only `user_sessions` (auth sessions — unrelated to market hours).

### `\d+ symbols` (Postgres describe)

Relevant columns on **`public.symbols`** (abridged from live `\d+`):

| Column | Notes |
|--------|--------|
| `code` | Symbol code |
| `market` | Enum `market_type` (e.g. crypto, forex, stocks, commodities) — **asset category, not a schedule** |
| `trading_enabled` | boolean, default true |
| `close_only` | boolean, default false |
| `allow_new_orders` | boolean, default true |
| `is_enabled` | boolean, default true — used with Redis for feed/engine gating (see Step 4) |
| (plus precision, lot, pip, MMDPS metadata, etc.) | No time-of-day fields |

**No** `session_*`, `trading_hour*`, `open_time`, `close_time`, or weekday bitmask columns.

---

## Step 2 — Admin UI inspection

**Location:** `src/features/symbols/` (pages/modals), not a separate `adminSymbols` folder.

### `AddSymbolModal.tsx`

- Form schema / fields: `symbol_code`, `provider_symbol`, `asset_class`, currencies, precisions, contract/tick/lot/pip fields, `leverage_profile_id`.
- **No** trading hours, day toggles, or time pickers.

### `EditSymbolModal.tsx`

Switches at end of form (lines ~431–447):

```431:447:src/features/symbols/modals/EditSymbolModal.tsx
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Switch
              checked={watch('is_enabled')}
              onCheckedChange={(checked) => setValue('is_enabled', checked)}
              disabled={readOnly || isSubmitting}
            />
            <Label>Enabled (Streaming)</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={watch('trading_enabled')}
              onCheckedChange={(checked) => setValue('trading_enabled', checked)}
              disabled={readOnly || isSubmitting}
            />
            <Label>Trading Enabled</Label>
          </div>
        </div>
```

**Conclusion:** Admin can toggle **streaming** and **DB `trading_enabled`**, but there is **no** UI to configure **session calendars** or **market open/close times**.

---

## Step 3 — Admin API inspection

**Router:** `backend/auth-service/src/routes/admin_symbols.rs`

**DTOs:** `CreateSymbolRequest` / `UpdateSymbolRequest` include symbol metadata, precisions, lots, pips, `leverage_profile_id`; `UpdateSymbolRequest` adds `is_enabled`, `trading_enabled`. **No** session/hour fields.

**After `update_symbol`:** Redis publish uses **`is_enabled` only**:

```430:431:backend/auth-service/src/routes/admin_symbols.rs
    // Publish Redis event
    publish_symbol_status_update(&symbol.symbol_code, symbol.is_enabled).await;
```

`publish_symbol_status_update` sets `symbol:status:{code}` to `"enabled"` / `"disabled"` from that boolean (`admin_symbols.rs` ~554–578).

**Conclusion:** Admin API persists **`trading_enabled`** to Postgres but does **not** push it to the Redis key the order-engine uses for symbol gating.

---

## Step 4 — Order engine & place_order enforcement

### Grep (`session`, `trading_hour`, `weekday`, `is_open`, `market_hours`, `is_trading_time`)

- **`apps/order-engine/`:** no matches for these patterns (whole crate).
- **`apps/order-engine/lua/*.lua`:** no matches.
- **`backend/auth-service/src/routes/orders.rs`:** no matches for symbol session/time checks (`trading_access` on **users** is checked — not symbol sessions).

### `order-engine` — `Validator` (`apps/order-engine/src/engine/validation.rs`)

Only symbol-related gate is **enabled** via Redis `symbol:status:{symbol}` or legacy `symbol:{symbol}` JSON `enabled`. **No clock / session logic.**

```17:47:apps/order-engine/src/engine/validation.rs
        // Validate symbol is enabled (normalize so lookup matches regardless of case)
        let symbol = normalize_symbol(&cmd.symbol);
        let symbol_status_key = format!("symbol:status:{}", symbol);
        let symbol_status: Option<String> = {
            use redis::AsyncCommands;
            conn.get(&symbol_status_key).await?
        };
        
        // If status key exists, check if it's enabled
        if let Some(status) = symbol_status {
            if status != "enabled" {
                return Err(anyhow::anyhow!("Symbol {} is not enabled", symbol));
            }
        } else {
            // Also check legacy format: symbol:SYMBOL (for backward compatibility)
            let symbol_key = format!("symbol:{}", symbol);
            let symbol_json: Option<String> = {
                use redis::AsyncCommands;
                conn.get(&symbol_key).await?
            };
            
            if symbol_json.is_none() {
                // Default to enabled if no status found (for backward compatibility)
                // In production, you might want to reject instead
                warn!("Symbol {} status not found in Redis, defaulting to enabled", symbol);
            } else {
                let symbol_data: serde_json::Value = serde_json::from_str(&symbol_json.unwrap())?;
                if !symbol_data.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true) {
                    return Err(anyhow::anyhow!("Symbol {} is not enabled", symbol));
                }
            }
        }
```

### `order_handler.rs`

`handle_place_order` calls `validator.validate_order` — **no additional session check** (see file around validation call ~263–265).

### `tick_handler.rs`

No session / hour keywords; fills are driven by ticks and order state — **no** “market closed” branch found in the inspected header and grep.

### `atomic_fill_order.lua`

Price/limit checks only; **no** session/time checks (grep across `apps/order-engine/lua`).

### `auth-service` — `place_order` (`backend/auth-service/src/routes/orders.rs`)

User **`trading_access`** must be `"full"` (403 otherwise). **No** query of `symbols.trading_enabled`, `close_only`, or `allow_new_orders` before DB insert / NATS publish (inspected flow from ~421–535: user row + `compute_order_margin_details` for margin; symbol row fetch there is **`SELECT id FROM symbols WHERE code = $1`** in `compute_order_margin_details` — no flags).

**Conclusion:** **No enforcement of calendar trading hours.** Partial symbol gating: **Redis `symbol:status` ↔ `is_enabled`** in order-engine only. **`trading_enabled` in DB is not enforced** on the authenticated `POST` place-order path reviewed here.

---

## Step 5 — Tick stream inspection

### `apps/data-provider/src/main.rs`

Hardcoded symbol list; `fetch_real_ticks` uses `interval(Duration::from_millis(500))` and polls Binance **continuously** — **no** session or `is_enabled` check in this binary (ticks run 24/7 for listed symbols).

### `backend/data-provider` — `RedisClient::get_symbol_status`

Defined (`get_symbol_status` → `symbol:status:{symbol}`) in `backend/data-provider/src/cache/redis_client.rs` but **no references** under `backend/data-provider` besides definition (grep). So the **Rust data-provider** path does not obviously gate ticks on status in-repo (method may be unused or called from a branch not grepped).

**Conclusion:** At least the **apps/data-provider** sample publisher runs **24/7**; charts can keep updating from feed logic independent of “exchange session.” This is separate from the absence of **session config** entirely.

---

## Step 6 — Real data check (sample symbols)

```sql
SELECT 
  code, market, trading_enabled, close_only,
  is_enabled, allow_new_orders,
  created_at, updated_at
FROM symbols
WHERE code IN ('BTCUSDT', 'EURUSD', 'AAPL', 'XAUUSD')
ORDER BY code;
```

**Result (this DB):**

| code | market | trading_enabled | close_only | is_enabled | allow_new_orders |
|------|--------|-----------------|------------|------------|------------------|
| AAPL | stocks | t | f | t | t |
| BTCUSDT | crypto | t | f | t | t |
| EURUSD | forex | t | f | t | t |
| XAUUSD | commodities | t | f | t | t |

All four share the same boolean flags in this snapshot; **`market`** differs. There is **nothing** in-row that expresses “FX session” vs “stock exchange hours.”

---

## Step 7 — Classification & effort

### User’s A/B/C/D applied to **calendar trading hours**

| Status | Meaning | Applies? |
|--------|---------|----------|
| **A** | Config + storage + enforcement | **No** |
| **B** | Config + storage, engine ignores | **No** (no session config/storage) |
| **C** | Schema only | **No** |
| **D** | Not built | **Yes** |

### What exists today

- **`symbols.market`** and **`asset_class`** for categorization / fees / display — **not** a session schedule.
- **Admin + DB:** `is_enabled`, `trading_enabled` (+ `close_only`, `allow_new_orders` in DB).
- **Partial enforcement:** Order-engine rejects orders if Redis says symbol disabled, aligned with **`is_enabled`** updates from admin — **not** time-based; **`trading_enabled` not wired to `place_order` or Redis status in the reviewed code.**

### What’s missing for real “market sessions”

- Schema: session templates, holidays, timezone, per-symbol overrides, or weekday + open/close intervals.
- Admin UI + API DTOs for those fields.
- **auth-service:** reject (or queue) orders outside session; optionally respect `close_only` / `allow_new_orders`.
- **order-engine:** same checks on accept/fill if commands can bypass HTTP; Lua/scripts if fills must be blocked when closed.
- **Tick path:** optional suppression or “last close” semantics when market closed (product decision).

### Rough effort (calendar sessions, production-grade)

- **MVP** (single timezone, weekly recurring windows, no holidays, auth + engine + admin): **~5–8 engineer-days**.
- **Full** (holidays, DST, per-venue calendars, tick policy, audits): **~2–4+ engineer-weeks** depending on spec and test matrix.

---

## Appendix — Repo paths touched

| Area | Path |
|------|------|
| Admin symbols UI | `src/features/symbols/modals/EditSymbolModal.tsx`, `AddSymbolModal.tsx`, `pages/SymbolsPage.tsx` |
| Admin symbols API | `backend/auth-service/src/routes/admin_symbols.rs` |
| Symbol persistence | `backend/auth-service/src/services/admin_symbols_service.rs` |
| User place order | `backend/auth-service/src/routes/orders.rs` |
| Order validation | `apps/order-engine/src/engine/validation.rs` |
| Order placement handler | `apps/order-engine/src/engine/order_handler.rs` |
| Lua fills | `apps/order-engine/lua/atomic_fill_order.lua` |
| Sample tick publisher | `apps/data-provider/src/main.rs` |
