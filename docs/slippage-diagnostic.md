# Slippage protection — read-only diagnostic

**Definition used:** Reject a market order’s fill when execution price differs from the user’s quoted price by more than a tolerance; on reject, wallet untouched and user sees an error.

**Scope:** Schema, auth-service `place_order`, NATS command, order-engine fill paths, terminal UI, sample DB row, related concepts (stop-out vs limit tolerance), integration points, verdict.

---

## Step 1 — Schema inspection

### Column search (slippage / deviation / tolerance / quote_price)

PostgreSQL `information_schema.columns` uses **`table_schema`**, not `column_schema`. The diagnostic query was run as:

```sql
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (column_name ILIKE '%slippage%'
   OR column_name ILIKE '%max_deviation%'
   OR column_name ILIKE '%price_tolerance%'
   OR column_name ILIKE '%fill_tolerance%'
   OR column_name ILIKE '%deviation%'
   OR column_name ILIKE '%quote_price%');
```

**Result:** **0 rows** — no public columns whose names match those patterns.

### Table search

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND (table_name ILIKE '%slippage%' OR table_name ILIKE '%deviation%');
```

**Result:** **0 rows**.

### Target tables (manual)

| Table | Slippage-related columns |
|-------|---------------------------|
| **`orders`** | None matching patterns. Actual columns (see Step 5): `id`, `user_id`, `symbol_id`, `side`, `type`, `size`, `price`, `stop_price`, `filled_size`, `average_price`, `leverage_used`, `margin_used`, `status`, `reference`, timestamps, `margin_from_cash`, `margin_from_bonus`. No `quote_price`, `requested_price`, `slippage_*`. |
| **`user_groups`** | No slippage columns. Risk-related: `margin_call_level`, `stop_out_level` (percent thresholds for account/risk UX — not fill slippage). |
| **`platform_general_settings`** | Columns: `singleton_id`, `site_name`, `timezone`, `currency`, `created_at`, `updated_at`. **No** global slippage default. |

---

## Step 2 — Backend `place_order` (`backend/auth-service/src/routes/orders.rs`)

### Grep: `slippage`, `deviation`, `tolerance`, `quote_price`, `requested_price`

**No matches** in `routes/orders.rs`.

### 1) `PlaceOrderRequest` — slippage / max_slippage_bps / price_tolerance?

**No.** Request fields are symbol, side, order type, size, limit price, SL/TP, TIF, client order id, idempotency key only:

```451:468:backend/auth-service/src/routes/orders.rs
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaceOrderRequest {
    pub symbol: String, // Symbol code like "BTCUSDT"
    pub side: String,   // "BUY" or "SELL"
    #[serde(rename = "order_type")]
    pub order_type: String, // "MARKET" or "LIMIT"
    pub size: String,
    #[serde(rename = "limit_price")]
    pub limit_price: Option<String>,
    pub sl: Option<String>, // Stop loss
    pub tp: Option<String>, // Take profit
    pub tif: Option<String>, // Time in force: "GTC", "IOC", "FOK"
    #[serde(rename = "client_order_id")]
    pub client_order_id: Option<String>,
    #[serde(rename = "idempotency_key")]
    pub idempotency_key: String,
}
```

### 2) `place_order` — quoted price at placement stored on the order?

**Partial / indirect only for margin math, not persisted as “quote at submit”.**

- **`compute_order_margin_details`** resolves `execution_price` from Redis (bid/ask by side) for **market** orders, or `limit_price` for limits. That value is used for **notional / margin / fee** and returned in `OrderMarginDetails`, but the **`INSERT INTO orders`** does **not** store a separate “quoted execution price” column — market orders insert `price` from `limit_price` (i.e. `NULL` for market):

```352:370:backend/auth-service/src/routes/orders.rs
    let execution_price = if order_type_upper_ref == "LIMIT" {
        limit_price.ok_or_else(|| {
            error!(user_id = %user_id, "compute_order_margin_details limit order missing limit_price");
            PlaceOrderError::Status(StatusCode::BAD_REQUEST)
        })?
    } else {
        let group_id_str = group_id.map(|u| u.to_string()).unwrap_or_default();
        let (bid, ask) = get_price_from_redis(redis, symbol_code, &group_id_str)
            .await
            .ok_or_else(|| {
                error!(user_id = %user_id, symbol = %symbol_code, group_id = %group_id_str, "compute_order_margin_details market_no_price");
                PlaceOrderError::Status(StatusCode::BAD_REQUEST)
            })?;
        if side_upper_ref == "BUY" {
            ask
        } else {
            bid
        }
    };
```

```782:806:backend/auth-service/src/routes/orders.rs
    sqlx::query(
        r#"
        INSERT INTO orders (
            id, user_id, symbol_id, side, type, size, price, stop_price,
            status, reference, created_at, updated_at,
            margin_from_cash, margin_from_bonus
        )
        VALUES ($1, $2, $3, $4::order_side, $5::order_type, $6, $7, $8, $9::order_status, $10, $11, $12, $13, $14)
        "#,
    )
    .bind(order_id)
    .bind(user_id)
    .bind(symbol_id)
    .bind(side_upper.to_lowercase())
    .bind(order_type_upper.to_lowercase())
    .bind(size)
    .bind(limit_price)
    .bind(stop_price)
```

So: **Redis read exists for margin**, but **no dedicated persisted quote** for later slippage comparison.

### 3) NATS / `PlaceOrderCommand` — slippage limit?

**No.** `crates/contracts/src/commands.rs` `PlaceOrderCommand` has no slippage / tolerance / quote fields:

```15:50:crates/contracts/src/commands.rs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaceOrderCommand {
    pub order_id: Uuid,
    pub user_id: Uuid,
    pub symbol: String,
    pub side: Side,
    pub order_type: OrderType,
    pub size: Decimal,
    pub limit_price: Option<Decimal>,
    pub sl: Option<Decimal>, // Stop Loss
    pub tp: Option<Decimal>, // Take Profit
    pub tif: TimeInForce,
    pub client_order_id: Option<String>,
    pub idempotency_key: String,
    pub ts: DateTime<Utc>,
    // ... group_id, leverage tiers, account_type, margin_from_cash/bonus — no slippage
}
```

Construction in `place_order` matches that struct (no extra fields):

```883:904:backend/auth-service/src/routes/orders.rs
    let place_order_cmd = PlaceOrderCommand {
        order_id,
        user_id,
        symbol: req.symbol.clone(),
        side,
        order_type,
        size,
        limit_price,
        sl: stop_price,
        tp: tp_decimal,
        tif,
        client_order_id: req.client_order_id.clone(),
        idempotency_key: req.idempotency_key.clone(),
        ts: now,
        group_id: effective_group_id.map(|u| u.to_string()),
        min_leverage: Some(user_min_resolved),
        max_leverage: Some(user_max_resolved),
        leverage_tiers: leverage_tiers,
        account_type: account_type.clone(),
        margin_from_cash: Some(alloc.from_cash),
        margin_from_bonus: Some(alloc.from_bonus),
    };
```

---

## Step 3 — Order engine

Repo-wide grep under `apps/order-engine/` for `slippage`, `deviation`, `tolerance`, `max_price`, `min_price`, `quote_price`: **no matches**.

### `order_handler.rs`

- **`resolve_market_fill_price`**: picks **current** ask (buy) or bid (sell) from in-memory tick cache or Redis `prices:...` JSON. **No** comparison to a stored quote or tolerance.

```98:156:apps/order-engine/src/engine/order_handler.rs
    async fn resolve_market_fill_price(
        &self,
        symbol: &str,
        group_id: Option<&str>,
        side: contracts::enums::Side,
    ) -> Option<Decimal> {
        if let Some(tick) = self
            .cache
            .get_last_tick(symbol, group_id)
            .or_else(|| self.cache.get_last_tick(symbol, None))
        {
            return Some(match side {
                contracts::enums::Side::Buy => tick.ask,
                contracts::enums::Side::Sell => tick.bid,
            });
        }
        // Fallback: use latest Redis cached quote for this symbol/group.
        // ... ask/bid extraction, no tolerance check
```

- **`market_price_hint`**: passed into internal `OrderCommand` for **validator margin hint**, not for post-hoc slippage enforcement:

```218:239:apps/order-engine/src/engine/order_handler.rs
        let market_price_hint = if cmd.order_type == contracts::enums::OrderType::Market {
            self.cache
                .get_last_tick(&cmd.symbol, cmd.group_id.as_deref())
                .or_else(|| self.cache.get_last_tick(&cmd.symbol, None))
                .map(|tick| match cmd.side {
                    contracts::enums::Side::Buy => tick.ask,
                    contracts::enums::Side::Sell => tick.bid,
                })
        } else {
            None
        };

        // Convert to internal command format
        let order_cmd = OrderCommand {
            // ...
            limit_price: cmd.limit_price,
            market_price_hint,
```

Immediate market fill path calls Lua with resolved `fill_price` — **no slippage gate** before `atomic_fill_order` (grep context around lines 362–380 in same file).

### `tick_handler.rs`

- **Market orders:** `should_fill` is **`true`** whenever the order is pending — fill always at **current** tick ask/bid. **No** reference price or tolerance.

```188:206:apps/order-engine/src/engine/tick_handler.rs
                    let should_fill = match order.order_type {
                        contracts::enums::OrderType::Market => true,
                        contracts::enums::OrderType::Limit => {
                            if let Some(limit_price) = order.limit_price {
                                match order.side {
                                    contracts::enums::Side::Buy => tick.ask <= limit_price,
                                    contracts::enums::Side::Sell => tick.bid >= limit_price,
                                }
                            } else {
                                false
                            }
                        }
                    };

                    if should_fill {
                        let fill_price = match order.side {
                            contracts::enums::Side::Buy => tick.ask,
                            contracts::enums::Side::Sell => tick.bid,
                        };
```

### `validation.rs`

- Validates symbol, size, limit price presence, SL/TP > 0, and **rough margin** using `limit_price` or `market_price_hint`. **No** slippage / deviation logic.

```108:132:apps/order-engine/src/engine/validation.rs
            let fill_price = match cmd.order_type {
                contracts::enums::OrderType::Limit => cmd.limit_price,
                contracts::enums::OrderType::Market => cmd.market_price_hint,
            };

            if let Some(price) = fill_price {
                let notional = cmd.size * price;
                let Some(eff) = crate::leverage::effective_leverage(
                    notional,
                    cmd.min_leverage,
                    cmd.max_leverage,
                    cmd.leverage_tiers.as_deref(),
                ) else {
                    return Err(anyhow::anyhow!(
                        "Leverage could not be resolved: require user min/max, symbol tiers, and a matching notional band"
                    ));
                };
                // ... required_margin vs free_margin — no slippage
```

### `lua/atomic_fill_order.lua`

- **Limit orders:** rejects fill if price is **worse** than limit (standard limit protection — not “slippage %” on market).

```38:46:apps/order-engine/lua/atomic_fill_order.lua
-- For limit orders, verify price condition
if order.order_type == "LIMIT" and order.limit_price then
    if (order.side == "BUY" or order.side == "Buy") and tonumber(fill_price) > tonumber(order.limit_price) then
        return '{"error":"limit_price_not_met"}'
    end
    if (order.side == "SELL" or order.side == "Sell") and tonumber(fill_price) < tonumber(order.limit_price) then
        return '{"error":"limit_price_not_met"}'
    end
end
```

- **Market orders:** no comparable check; proceeds to set `FILLED` at `fill_price`.

---

## Step 4 — Frontend (terminal)

Grep `src/features/terminal/` for `slippage`, `maxSlippage`, `priceTolerance`: **no matches**.

### `RightTradingPanel.tsx`

`PlaceOrderRequest` payload: symbol, side, `order_type`, size, `limit_price`, `sl`, `tp`, `tif`, `idempotency_key` — **no slippage field**.

```991:1001:src/features/terminal/components/RightTradingPanel.tsx
      const payload: PlaceOrderRequest = {
        symbol: selectedSymbol.code,
        side,
        order_type: orderType.toUpperCase() as 'MARKET' | 'LIMIT',
        size: baseSize.toString(),
        limit_price: orderType === 'limit' && limitPrice ? limitPrice : undefined,
        sl: useSlTp && stopLoss ? stopLoss : undefined,
        tp: useSlTp && takeProfit ? takeProfit : undefined,
        tif: 'GTC',
        idempotency_key: `${Date.now()}-${Math.random().toString(36).substring(7)}`,
      }
```

### `ChartTradingStrip.tsx`

Market-only payload — again **no slippage**:

```134:140:src/features/terminal/components/ChartTradingStrip.tsx
      const payload = {
        symbol: selectedSymbol.code,
        side,
        order_type: 'MARKET' as const,
        size: sizeNum.toString(),
        idempotency_key: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      }
```

---

## Step 5 — Real `orders` table (`\d orders`)

From live Postgres (`\d orders`):

| Column | Type |
|--------|------|
| `id` | uuid |
| `user_id` | uuid |
| `symbol_id` | uuid |
| `side` | order_side |
| `type` | order_type |
| `size` | numeric(20,8) |
| `price` | numeric(20,8) nullable — used for **limit** price when applicable |
| `stop_price` | numeric(20,8) nullable |
| `filled_size` | numeric(20,8) |
| `average_price` | numeric(20,8) nullable — **fill outcome**, not pre-trade quote |
| `leverage_used`, `margin_used` | … |
| `status` | order_status |
| `reference` | varchar(255) |
| `created_at`, `updated_at`, `filled_at`, `cancelled_at` | timestamptz |
| `margin_from_cash`, `margin_from_bonus` | numeric(20,8) |

**Absent (relevant to slippage):** `quote_price`, `requested_price`, `slippage_bps`, `max_slippage`, etc.

**Sample rows** (`SELECT … ORDER BY created_at DESC LIMIT 3`): recent **market** orders had `price` **NULL**; `average_price` populated after fill (when applicable). Confirms no stored “quote at placement” for markets.

---

## Step 6 — Related concepts (distinct from slippage)

### (a) Stop-out / margin call / liquidation

- **`user_groups`**: `margin_call_level`, `stop_out_level` — risk thresholds (e.g. %), **not** per-order fill tolerance.
- **`backend/auth-service/src/routes/deposits.rs`**: reads those levels for account summary / thresholds (`get_margin_call_level_for_group`, `get_stop_out_level_for_group`, fields like `margin_call_level_threshold` on cached summary) — **account-level risk**, not order slippage.
- **`apps/order-engine/src/engine/position_handler.rs`**: `handle_close_all_positions` supports `reason` defaulting to `"stop_out"` vs `"liquidated"` for **forced closes** — position lifecycle, not market-order slippage.

```513:518:apps/order-engine/src/engine/position_handler.rs
        let reason = cmd_json
            .get("reason")
            .and_then(|v| v.as_str())
            .unwrap_or("stop_out");
        let is_liquidation = reason.eq_ignore_ascii_case("liquidated");
```

- **`atomic_close_position.lua`**: optional `close_reason` `"liquidated"` → status **LIQUIDATED** vs **CLOSED**.

### (b) Limit fill tolerance

- **Tick path:** limit fills when ask ≤ limit (buy) or bid ≥ limit (sell) — **price improvement allowed**, worse-than-limit fill prevented by Lua (Step 3).
- **Not** a configurable “bps tolerance” on limits; it is **hard limit vs current touch price**.

---

## Step 7 — Natural integration points (if building slippage)

| Layer | Suggestion | Concrete hook |
|-------|------------|-----------------|
| **Storage** | `orders.requested_price` (numeric, quote at submit) + `orders.max_slippage_bps` (int) | Migration + extend `INSERT INTO orders` in `backend/auth-service/src/routes/orders.rs` inside **`place_order`** after `execution_price` is known for markets. |
| **Defaults** | `platform_general_settings.default_slippage_bps`, `user_groups.default_slippage_bps` | New columns + read in **`compute_order_margin_details`** or **`place_order`** when resolving effective tolerance. |
| **API** | Optional `slippageBps` on place order | **`PlaceOrderRequest`** + JSON handling in **`place_order`**; extend **`PlaceOrderCommand`** in `crates/contracts/src/commands.rs` and serialization block in **`place_order`**. |
| **Engine** | Compare `fill_price` vs stored `requested_price` / bps | **`OrderHandler::resolve_market_fill_price`** / immediate fill branch; **`tick_handler::execute_fill`** before **`LuaScripts::atomic_fill_order`**; optionally **inside `atomic_fill_order.lua`** if quote is replicated onto Redis order JSON. |
| **Events** | `evt.order.rejected` with `SLIPPAGE_EXCEEDED` | Where **`OrderRejectedEvent`** is emitted today (order-engine NATS publish paths — extend next to existing reject reasons). |
| **Frontend** | Slippage input / advanced section | **`RightTradingPanel.tsx`** submit payload; **`ChartTradingStrip.tsx`** if market orders from chart should inherit same defaults. |

---

## Step 8 — Verdict

**Classification: D — Not built.**

| Criterion | Present? |
|-----------|------------|
| Schema / columns for slippage or persisted quote | **No** |
| `PlaceOrderRequest` / `PlaceOrderCommand` | **No** slippage fields |
| Persisted quote on `orders` | **No** (market `price` null; `average_price` is post-fill) |
| Engine rejects fill on % deviation | **No** |
| Terminal UI | **No** |

**What *does* exist (adjacent, not slippage):**

- Auth-service **Redis bid/ask** for **margin** at placement (`execution_price` in `compute_order_margin_details`).
- Engine **`market_price_hint`** for **validation margin** only.
- **Limit** worse-than-limit rejection in **Lua**.
- **Stop-out / margin call / liquidation** as separate **position / account** concerns.

**Rough effort to full slippage (schema + API + command + engine gate + reject event + minimal UI + tests):** about **2–4 engineer-days** for a minimal vertical slice; add time for migrations across envs, admin defaults UX, partial-fill semantics, and documentation if required.

---

## Appendix — SQL note

If reproducing Step 1 from external docs, use `table_schema = 'public'`. A typo `column_schema` is not valid in PostgreSQL’s `information_schema.columns`.
