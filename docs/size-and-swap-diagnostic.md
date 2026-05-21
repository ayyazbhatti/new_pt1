# Size semantics & swap system — read-only diagnostic

This report answers: (1) what **`size`** means end-to-end, and (2) whether **overnight swap** is functional. No code or database was modified.

**Environment note (Part 1.5 / 2.5):** Read-only SQL was executed against the local dev database `postgresql://postgres:postgres@127.0.0.1:5434/newpt` (see `.env.example`). Your database may differ.

---

# Part 1 — What is `size`?

## Step 1.1 — Schema inspection (verbatim SQL from repo migrations / schema)

### `orders.size`, `positions.size` — `database/schema.sql`

The canonical schema file defines numeric `size` with **no SQL `COMMENT`**:

```244:263:database/schema.sql
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol_id UUID NOT NULL REFERENCES symbols(id),
    side order_side NOT NULL,
    type order_type NOT NULL,
    size NUMERIC(20, 8) NOT NULL,
    price NUMERIC(20, 8),
    stop_price NUMERIC(20, 8),
    filled_size NUMERIC(20, 8) NOT NULL DEFAULT 0,
    average_price NUMERIC(20, 8),
    leverage_used INTEGER,
    margin_used NUMERIC(20, 8),
    status order_status NOT NULL DEFAULT 'pending',
    reference VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    filled_at TIMESTAMP WITH TIME ZONE,
    cancelled_at TIMESTAMP WITH TIME ZONE
);
```

```265:282:database/schema.sql
CREATE TABLE positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol_id UUID NOT NULL REFERENCES symbols(id),
    side position_side NOT NULL,
    size NUMERIC(20, 8) NOT NULL,
    entry_price NUMERIC(20, 8) NOT NULL,
    mark_price NUMERIC(20, 8) NOT NULL,
    leverage INTEGER NOT NULL,
    margin_used NUMERIC(20, 8) NOT NULL,
    liquidation_price NUMERIC(20, 8) NOT NULL,
    pnl NUMERIC(20, 8) NOT NULL DEFAULT 0,
    pnl_percent NUMERIC(10, 4) NOT NULL DEFAULT 0,
    status position_status NOT NULL DEFAULT 'open',
    opened_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

**Note:** Later migrations add columns (e.g. `margin_from_cash` on orders/positions); the **`size`** column type remains **`NUMERIC(20,8)`** (confirmed live via `\d orders`).

### `symbols.contract_size`, `base_currency`, `quote_currency`, lot bounds — `database/schema.sql`

```159:182:database/schema.sql
CREATE TABLE symbols (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255),
    market market_type NOT NULL,
    base_currency VARCHAR(10) NOT NULL,
    quote_currency VARCHAR(10) NOT NULL,
    digits INTEGER NOT NULL DEFAULT 2,
    tick_size NUMERIC(20, 8) NOT NULL DEFAULT 0.01,
    contract_size NUMERIC(20, 8) NOT NULL DEFAULT 1,
    price_precision INTEGER NOT NULL DEFAULT 2,
    lot_min NUMERIC(20, 8) NOT NULL DEFAULT 0.01,
    lot_max NUMERIC(20, 8),
    leverage_profile_id UUID REFERENCES leverage_profiles(id),
    trading_enabled BOOLEAN NOT NULL DEFAULT true,
    close_only BOOLEAN NOT NULL DEFAULT false,
    allow_new_orders BOOLEAN NOT NULL DEFAULT true,
    max_leverage_cap INTEGER,
    max_order_size NUMERIC(20, 2),
    max_position_size NUMERIC(20, 2),
    data_provider VARCHAR(100) DEFAULT 'Binance',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

### `symbols` creation branch in migration `database/migrations/0005_symbols_schema.sql` (includes `volume_precision`, `asset_class`, etc.)

```84:99:database/migrations/0005_symbols_schema.sql
        CREATE TABLE symbols (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            code VARCHAR(50) NOT NULL UNIQUE,
            provider_symbol VARCHAR(50) NOT NULL,
            asset_class asset_class NOT NULL,
            base_currency VARCHAR(10) NOT NULL,
            quote_currency VARCHAR(10) NOT NULL,
            price_precision INTEGER NOT NULL DEFAULT 2,
            volume_precision INTEGER NOT NULL DEFAULT 2,
            contract_size NUMERIC(20, 8) NOT NULL DEFAULT 1,
            is_enabled BOOLEAN NOT NULL DEFAULT true,
            trading_enabled BOOLEAN NOT NULL DEFAULT true,
            leverage_profile_id UUID NULL REFERENCES leverage_profiles(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
```

**Schema takeaway:** DDL does **not** state whether `orders.size` is “lots” or “units”; it is a generic **`NUMERIC(20,8)`** field. **`contract_size`** lives on **`symbols`** for instrument specification.

---

## Step 1.2 — Frontend submission

### `RightTradingPanel.tsx` — user input and conversion

- **Units mode:** User types a number interpreted as **base units** of the symbol (or quote amount converted to base when the unit selector is quote currency):

```1001:1018:src/features/terminal/components/RightTradingPanel.tsx
    // Get base size in units based on current mode (when only Units is shown, always use units)
    const effectiveSizeMode = SHOW_ONLY_UNITS_SIZE_MODE ? 'units' : sizeMode
    let baseSize = 0
    let displaySize = ''

    if (effectiveSizeMode === 'units') {
      const sizeNum = parseFloat(size)
      if (!sizeNum || sizeNum <= 0) {
        toast.error('Please enter a valid size')
        return
      }
      baseSize = sizeNum
      if (currency === selectedSymbol.quoteCurrency && selectedSymbol.numericPrice > 0) {
        baseSize = sizeNum / selectedSymbol.numericPrice
      }
      displaySize = currency === selectedSymbol.quoteCurrency 
        ? `${size} ${selectedSymbol.quoteCurrency} (${baseSize.toFixed(8)} ${selectedSymbol.baseCurrency})`
        : `${size} ${selectedSymbol.baseCurrency}`
```

- **Lots / pip modes:** `baseSize` is derived via **`calculateUnitsFromLots`** (see `positionCalculations.ts` below).

- **POST body:** `size` is **`baseSize.toString()`** (always **base units** sent to API):

```1076:1086:src/features/terminal/components/RightTradingPanel.tsx
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

### `positionCalculations.ts` — explicit **`units = lots × contract_size`**

```86:99:src/features/terminal/utils/positionCalculations.ts
/**
 * Convert lot size to units using cTrader formula
 * Formula: Units = Lot Size × Contract Size
 * 
 * @param lots - Lot size (e.g., 0.5, 1.0, 2.5)
 * @param symbol - Symbol with contract_size
 * @returns Units in base currency
 */
export function calculateUnitsFromLots(lots: number, symbol: AdminSymbol): number {
  if (lots <= 0) return 0
  
  const contractSize = parseFloat(symbol.contractSize) || (symbol.assetClass === 'FX' ? 100000 : 1)
  return lots * contractSize
}
```

### `orders.api.ts` — request shape

```119:141:src/features/terminal/api/orders.api.ts
export interface PlaceOrderRequest {
  symbol: string
  side: 'BUY' | 'SELL'
  order_type: 'MARKET' | 'LIMIT'
  size: string
  limit_price?: string
  sl?: string
  tp?: string
  tif?: 'GTC' | 'IOC' | 'FOK'
  client_order_id?: string
  idempotency_key: string
}

export async function placeOrder(payload: PlaceOrderRequest): Promise<PlaceOrderResponse> {
  return http<PlaceOrderResponse>('/v1/orders', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
```

**Frontend takeaway:** The user may type **units**, **lots**, or **$/pip**, but the value sent as **`size`** is **`baseSize`**: **base-currency units**, with **lots × `contract_size`** applied **in the browser** before submit.

---

## Step 1.3 — Backend handler (`POST /api/orders` and `/v1/orders` — same router)

### `PlaceOrderRequest` — `size` is a string, parsed to `Decimal`

```340:357:backend/auth-service/src/routes/orders.rs
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

### `place_order` — parse `size`, **no** `contract_size` multiplication

```399:407:backend/auth-service/src/routes/orders.rs
    // Parse size
    let size = Decimal::from_str(&req.size).map_err(|_| {
        error!(order_id = %order_id, user_id = %user_id, "place_order FAILED stage=parse_size reason=invalid size");
        PlaceOrderError::Status(StatusCode::BAD_REQUEST)
    })?;

    if size <= Decimal::ZERO {
        error!(order_id = %order_id, user_id = %user_id, "place_order FAILED stage=validate_size reason=size <= 0");
        return Err(PlaceOrderError::Status(StatusCode::BAD_REQUEST));
    }
```

### `compute_order_margin_details` — **`notional = size * execution_price`**

```295:321:backend/auth-service/src/routes/orders.rs
    let notional = size * execution_price;
    let eff_lev = effective_leverage(
        notional,
        Some(user_min_resolved),
        Some(user_max_resolved),
        leverage_tiers.as_deref(),
    )
    .ok_or_else(|| {
        error!(
            user_id = %user_id,
            symbol = %symbol_code,
            notional = %notional,
            "compute_order_margin_details resolve_effective_leverage failed"
        );
        PlaceOrderError::LeverageConfigurationInvalid {
            message: format!(
                "Order notional {} does not match any configured leverage band for this symbol. In Admin → Leverage profiles, ensure tiers cover all exposure levels (contiguous bands, e.g. last band open-ended) with no gaps.",
                notional
            ),
        }
    })?;
    if eff_lev <= Decimal::ZERO {
        return Err(PlaceOrderError::LeverageConfigurationInvalid {
            message: "Resolved effective leverage is not valid.".to_string(),
        });
    }
    let required_margin = notional / eff_lev;
```

### `INSERT INTO orders` — **`$6` = `size`** (parsed body)

```570:593:backend/auth-service/src/routes/orders.rs
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
    .bind("pending")
    .bind(req.client_order_id.as_deref())
    .bind(now)
    .bind(now)
    .bind(alloc.from_cash)
    .bind(alloc.from_bonus)
```

**Backend takeaway:** Stored **`orders.size`** is exactly the **request `size` in base units** (after any client-side conversion). **No** server-side `* contract_size`.

---

## Step 1.4 — Order engine

### `order_handler.rs` — notional / margin use **order size × price**, no `contract_size`

```371:381:apps/order-engine/src/engine/order_handler.rs
                        let notional = fill_price * order.size;
                        ...
                        match self.lua.atomic_fill_order(&mut conn, &order_id, fill_price, order.size, eff).await {
```

```481:487:apps/order-engine/src/engine/order_handler.rs
                                            let margin_used = (order.size * fill_price) / eff;
                                            ...
                                                size: order.size,
```

### `atomic_fill_order.lua` — position **`size`** = fill size; margin **`fill_size * fill_price / leverage`**

```456:470:apps/order-engine/lua/atomic_fill_order.lua
    -- Store position as Hash (matches backend format)
    local pos_key = 'pos:by_id:' .. position_id
    -- Calculate margin: (size * entry_price) / leverage (effective leverage from tiers + user limits)
    local leverage = effective_leverage
    local margin = (tonumber(fill_size) * tonumber(fill_price)) / leverage
    
    redis.call('HSET', pos_key, 'user_id', user_id)
    redis.call('HSET', pos_key, 'symbol', symbol)
    redis.call('HSET', pos_key, 'group_id', order.group_id or '')
    redis.call('HSET', pos_key, 'side', (order_side == "BUY") and "LONG" or "SHORT")
    redis.call('HSET', pos_key, 'size', fill_size)
    redis.call('HSET', pos_key, 'entry_price', fill_price)
    redis.call('HSET', pos_key, 'avg_price', fill_price)
    redis.call('HSET', pos_key, 'leverage', tostring(leverage))
    redis.call('HSET', pos_key, 'margin', tostring(margin))
```

**Engine takeaway:** **`positions.size` in Redis** tracks the same **base-unit `size`** as the order fill. **No** Lua multiplication by `contract_size`.

---

## Step 1.5 — Inspect existing data (dev DB)

**Note:** The audit template used `o.executed_price`; this database uses **`average_price`** for filled orders.

### Filled orders — notional with vs without `contract_size` (BTCUSDT, `contract_size = 1`)

```text
                  id                  | symbol  | contract_size | order_size | average_price  | notional_using_raw_size |  notional_with_contract_size   |          created_at           
--------------------------------------+---------+---------------+------------+----------------+-------------------------+--------------------------------+-------------------------------
 a852860b-3006-4d3b-b280-dd88e17cf5ee | BTCUSDT |    1.00000000 | 0.14218500 | 77293.57000000 |  10989.9862504500000000 | 10989.986250450000000000000000 | 2026-05-21 17:10:13.46483+00
 ... (18 more BTCUSDT rows; raw vs contract_size identical because contract_size = 1)
```

### `contract_size` distribution (all symbols)

```text
  contract_size  | count 
-----------------+-------
      1.00000000 |   453
    100.00000000 |     7
 100000.00000000 |   126
```

### Filled orders where **`contract_size > 1`** (EURUSD, USDCOP, USDIDR)

```text
  code  |  contract_size  |   order_size    | average_price  |      notional_raw       |         notional_x_contract          
--------+-----------------+-----------------+----------------+-------------------------+--------------------------------------
 EURUSD | 100000.00000000 |   1000.00000000 |     1.16754000 |   1167.5400000000000000 |   116754000.000000000000000000000000
 EURUSD | 100000.00000000 |    428.25000000 |     1.16749000 |    499.9775925000000000 |    49997759.250000000000000000000000
 EURUSD | 100000.00000000 |    170.81899166 |     1.17087000 |    200.0068327649442000 |    20000683.276494420000000000000000
 ...
 EURUSD | 100000.00000000 |      0.00295508 |     1.16987000 |      0.0034570594396000 |         345.705943960000000000000000
 EURUSD | 100000.00000000 | 563070.42229441 |     1.16987000 | 658719.1949295614267000 | 65871919492.956142670000000000000000
 USDCOP | 100000.00000000 |      0.00345700 |  3634.03000000 |     12.5628417100000000 |     1256284.171000000000000000000000
 ...
```

**Observation:** For **`contract_size = 100000`**, **`notional_raw = order_size × average_price`** matches economically sensible notionals when **`order_size` is already in base units** (e.g. **428.25 EUR** × **1.16749** ≈ **500 USD** notional). **`notional_x_contract`** (multiplying **`order_size` by `contract_size` again**) explodes to absurd values — confirming **`orders.size` is NOT “lots”** at rest in the DB.

---

## Step 1.6 — VERDICT (Part 1)

| Question | Answer |
|----------|--------|
| **What `size` means in `orders` / `positions`** | **Raw base-currency units** (e.g. **0.1 BTC**, **428.25 EUR**, **1000 EUR** as stored — whatever the user path produced). |
| **Is it “lots” in the DB?** | **No.** Lots are converted to units **in the frontend** via **`lots × contract_size`** before `POST`. |
| **Does the backend multiply `contract_size`?** | **No** (`compute_order_margin_details`, `INSERT`, order-engine Lua). |
| **Margin / notional formula in code** | **`(size × price) ÷ leverage`** — correct **if and only if** `size` is already **base units** (current design). It is **not** `(size × contract_size × price) ÷ leverage` at the server. |
| **Forex example: user types `1` lot, EURUSD, `contract_size = 100000`** | Frontend sends **`size = "100000"`** (base EUR). Current code computes **`notional = 100000 × 1.1675…` ≈ 116,750** (quote currency units of price — USD per EUR for EURUSD), **not** `1 × 100000 × price` again on the server. |

**Evidence chain:** `positionCalculations.ts:94–98` → `RightTradingPanel.tsx:1080` → `orders.rs:295` & `585` → `atomic_fill_order.lua:458–466`.

---

# Part 2 — Does swap work?

## Step 2.1 — Schema

### `swap_rules` table — migration `backend/auth-service/migrations/20260219100000_create_swap_rules.sql` (verbatim)

```1:28:backend/auth-service/migrations/20260219100000_create_swap_rules.sql
-- Swap rules (rollover/overnight fees) per group and symbol
DROP TABLE IF EXISTS swap_rules CASCADE;

CREATE TABLE swap_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
    symbol VARCHAR(64) NOT NULL,
    market VARCHAR(32) NOT NULL CHECK (market IN ('crypto', 'forex', 'commodities', 'indices', 'stocks')),
    calc_mode VARCHAR(32) NOT NULL CHECK (calc_mode IN ('daily', 'hourly', 'funding_8h')),
    unit VARCHAR(16) NOT NULL CHECK (unit IN ('percent', 'fixed')),
    long_rate NUMERIC(20, 8) NOT NULL,
    short_rate NUMERIC(20, 8) NOT NULL,
    rollover_time_utc VARCHAR(8) NOT NULL,
    triple_day VARCHAR(4) CHECK (triple_day IN ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')),
    weekend_rule VARCHAR(32) NOT NULL CHECK (weekend_rule IN ('none', 'triple_day', 'fri_triple', 'custom')),
    min_charge NUMERIC(20, 8),
    max_charge NUMERIC(20, 8),
    status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_by VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_swap_rules_group_id ON swap_rules(group_id);
CREATE INDEX IF NOT EXISTS idx_swap_rules_symbol ON swap_rules(symbol);
CREATE INDEX IF NOT EXISTS idx_swap_rules_status ON swap_rules(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_swap_rules_group_symbol ON swap_rules(group_id, symbol);
```

**Live DB:** `\d swap_rules` shows an extra nullable column **`created_by_user_id`** (added outside the snippet above).

### `symbols` / `positions` — swap-specific columns

- **`information_schema`** on dev DB: **no** `symbols` or `positions` columns matching `%swap%` / `%overnight%`.

### `transactions.type` enum (dev DB)

```text
 transaction_type | deposit / withdrawal / adjustment / fee / rebate / bonus_* / pnl_credit / pnl_debit
```

**No** value named `swap`, `overnight`, `rollover`, or `financing`.

---

## Step 2.2 — Computation code

| Area | Finding |
|------|---------|
| **Rust services** | `backend/auth-service/src/services/admin_swap_service.rs` — **CRUD** for `swap_rules` (list/get/insert/update/delete, tags). **No** charge calculation. |
| **Routes** | `backend/auth-service/src/routes/admin_swap.rs` — **Admin HTTP API** under `/api/admin/swap` (`lib.rs:314`). |
| **Order engine** | **`rg` swap / rollover / overnight / financing** under `apps/order-engine/src`: **no matches**. |
| **Scheduled swap job** | **No** `tokio::interval` or NATS consumer in this repo was found that reads `swap_rules` and posts charges. Background intervals in `lib.rs` include **price group sync (60s)**, **FX hourly**, **tick-driven account summary**, etc. — **none** reference swap. |

---

## Step 2.3 — Application to balance / PnL

| Question | Answer |
|----------|--------|
| **`compute_account_summary_inner` includes swap?** | **No** — balance uses **deposits − withdrawals + closed PnL** (`deposits.rs:2043–2120` per prior audit); **no** swap ledger term. |
| **Deduct `wallets.available_balance` for swap?** | **No code path found** that applies swap to wallets. |
| **`transactions` rows for swap?** | **No** matching types in enum; query on `ILIKE '%swap%'` etc. returned **0 rows**. |
| **Fold into `positions.pnl`?** | **No** swap-specific writer located; **no** swap columns on `positions`. |
| **Dead code?** | **Config + admin UI exist; charging pipeline absent.** |

---

## Step 2.4 — Admin / user visibility

| Surface | Exists? |
|---------|---------|
| **Admin swap configuration** | ✅ `src/features/swap/pages/SwapRulesPage.tsx` — title **"Swap / Overnight Fees"** (`~90–91`). |
| **Copy claims application** | ⚠️ The page states swap is **"applied at rollover time"** — **not backed by engine code found in this repo**: ```159:162:src/features/swap/pages/SwapRulesPage.tsx``` |
| **User transaction history / position detail for swap** | ❌ No swap-specific transaction type; no position swap column. |

---

## Step 2.5 — Inspect existing data (dev DB)

### Swap-like `transactions`

```text
 type | count | sum | min | max 
------+-------+-----+-----+-----
(0 rows)
```

### `positions` columns (`%swap%|%overnight%|%charge%|%fee%`)

```text
 column_name | data_type 
-------------+-----------
(0 rows)
```

### `symbols` columns (`%swap%|%overnight%`)

```text
 column_name | data_type 
-------------+-----------
(0 rows)
```

### `swap_rules` row count

```text
 swap_rules_rows 
-----------------
               6
```

---

## Step 2.6 — VERDICT (Part 2)

| Question | Verdict |
|----------|---------|
| **Swap config exists?** | ✅ **`swap_rules` table** + **admin CRUD** (`admin_swap_service.rs`, `admin_swap.rs`) + **6 rows** in dev DB. |
| **Swap computation runs?** | ❌ **No** engine/service job found that computes rollover from open positions + rules. |
| **Swap applied to user balance?** | ❌ **No** ledger path (`transactions`), **no** wallet mutation, **no** `positions` swap field updates. |
| **User can see swap charges?** | ⚠️ **Admin** can edit rules; **end-user** has **no** real swap charge line item in data model reviewed. |

**Classification:** **4 — “Not implemented”** (for **charging**). More precisely: **“Config + admin only; runtime swap application missing.”** Close to **stub / dead** from a **trader balance** perspective.

---

# Part 3 — Related findings (brief)

## Commission / fee code (non-swap)

- **`transaction_type`** includes **`fee`** (schema) but dev DB has **`SELECT COUNT(*) FROM transactions WHERE type = 'fee'` → `0`**.
- **Per-trade commission** in `orders.rs` / order-engine: **no** `commission` / `fee_rate` / `charge_fee` logic found in **`orders.rs`** or **`apps/order-engine`** (grep).
- **Affiliate:** `backend/auth-service/src/routes/admin_affiliate.rs` and **`affiliate_commission_layers`** — **referral / layer config**, not the same as per-fill trading commission unless wired elsewhere (not traced here).

## Scheduled-job patterns (how a future fee/swap could plug in)

- **`tokio::time::interval`** in `backend/auth-service/src/lib.rs`: **60s** markup/price-group sync (`156–166`), **3600s** FX refresh (`626–646`).
- **NATS subscribers:** account summary refresh, position events, order events, etc. — **none** for swap.

---

# Alarming / high-signal notes

1. **Admin UI copy** implies swap is **applied at rollover** (`SwapRulesPage.tsx:159–162`) while **no charging implementation** was found in **order-engine** or **auth-service** beyond **CRUD** — **risk of misleading operators**.
2. **`atomic_fill_order.lua`** still contains a **placeholder** balance block comment: *"Update balance (simplified - would need proper margin calculation)"* (`513–527`) — separate from swap, but shows **legacy / incomplete** balance mirroring in Lua.

---

# Chat-sized verdicts (see instructions)

1. **File:** `docs/size-and-swap-diagnostic.md`
2. **Part 1:** `size` means **raw base units in DB/API**; **lots are converted to base units on the frontend** using **`contract_size`**; the server uses **`(size × price) / leverage`** without multiplying **`contract_size`** again.
3. **Part 2:** Swap is **not implemented** as a **runtime charge** — **config/admin only**; **no** application to balance/PnL found.
4. **Fees:** **`fee` transaction type exists** but **no populated fee rows** in dev DB; **no** per-order commission logic found in the **order placement** path reviewed.
5. **Alarming:** **Admin swap page claims application at rollover without matching backend job**; **Lua balance update still marked simplified**.
