# `POST /v1/orders/estimate` — 400 Bad Request diagnostic (large size / Free Margin % slider)

## Files read

| Path | Purpose |
|------|---------|
| `backend/auth-service/src/routes/orders.rs` | `estimate_order_margin`, `compute_order_margin_details`, `PlaceOrderError`, `IntoResponse` |
| `backend/auth-service/src/routes/deposits.rs` | `get_price_from_redis`, `get_price_from_redis_conn` |
| `crates/risk/src/effective_leverage.rs` | `effective_leverage` tier matching / `None` paths |
| `database/migrations/0004_leverage_profiles_schema.sql` | Tier table schema (grep; no tier seed data in that file) |

---

## 1. ALL ERROR EXIT POINTS IN `estimate_order_margin`

**File:** `backend/auth-service/src/routes/orders.rs`  
**Function:** `async fn estimate_order_margin` (lines **752–831**)

| Lines | Condition | Returned error | HTTP | Client-visible body |
|-------|-----------|----------------|------|---------------------|
| **760–761** | `order_type` (uppercased) not `MARKET` and not `LIMIT` | `PlaceOrderError::Status(BAD_REQUEST)` | **400** | Axum plain status (`StatusCode::into_response()` — typically **no JSON** `error.code`) |
| **764–765** | `side` not `BUY` and not `SELL` | `Status(BAD_REQUEST)` | **400** | Same |
| **767–770** | `Decimal::from_str(&req.size)` fails | `Status(BAD_REQUEST)` | **400** | Same |
| **771–772** | `size <= 0` | `Status(BAD_REQUEST)` | **400** | Same |
| **774–779** | `limit_price` string present but fails `Decimal::from_str` | `Status(BAD_REQUEST)` | **400** | Same |
| **784–785** | `LIMIT` and `limit_price` is `None` | `Status(BAD_REQUEST)` | **400** | Same |
| **800–802** | DB error on `SELECT min_leverage, max_leverage, account_type FROM users WHERE id = $1` | `Status(INTERNAL_SERVER_ERROR)` | **500** | Same |
| **809–823** | `compute_order_margin_details(...).await?` | Propagates §2 | §2 | §2 |

**Explicitly absent:** `MIN_REQUIRED_MARGIN_USD` (line **27**), free-margin checks, `InsufficientMargin`, `MinimumMarginNotMet`, `TradingRestricted`.

```46:79:backend/auth-service/src/routes/orders.rs
impl IntoResponse for PlaceOrderError {
    fn into_response(self) -> axum::response::Response {
        match self {
            PlaceOrderError::Status(c) => c.into_response(),
            // ...
            PlaceOrderError::LeverageConfigurationInvalid { message } => {
                let body = serde_json::json!({
                    "error": { "code": "LEVERAGE_CONFIGURATION", "message": message }
                });
                (StatusCode::BAD_REQUEST, Json(body)).into_response()
            }
        }
    }
}
```

---

## 2. ALL ERROR EXIT POINTS INSIDE `compute_order_margin_details`

**File:** `backend/auth-service/src/routes/orders.rs`  
**Function:** `pub async fn compute_order_margin_details` (lines **152–325**)

| Lines | Condition | Error | HTTP | Exact `message` / notes |
|-------|-----------|-------|------|-------------------------|
| **172–174** | Symbol SQL fails | `Status(INTERNAL_SERVER_ERROR)` | **500** | Logs: `compute_order_margin_details symbol query failed` |
| **176–178** | No row for `SELECT id FROM symbols WHERE code = $1` | `Status(NOT_FOUND)` | **404** | Logs: `symbol not found` |
| **185–187** | `resolve_leverage_profile_id_for_user_symbol` returns `Err` | `Status(INTERNAL_SERVER_ERROR)` | **500** | Logs: `leverage profile query failed` |
| **205–207** | Tier SQL fails | `Status(INTERNAL_SERVER_ERROR)` | **500** | Logs: `fetch tiers failed` |
| **227–231** | `resolved_profile_id.is_none()` | `LeverageConfigurationInvalid` | **400** JSON `error.code`: **`LEVERAGE_CONFIGURATION`** | `"No leverage profile is assigned for this symbol. In Admin, set a default leverage profile on the user’s group (Groups) and/or set a per-symbol profile under group symbols, then add notional tiers to that profile."` |
| **233–237** | Tiers missing or empty | `LeverageConfigurationInvalid` | **400** | `"The leverage profile for this symbol has no tiers. In Admin → Leverage profiles, open the profile and add at least one notional band (e.g. from 0 with an upper cap or open-ended) and a max leverage."` |
| **242–245** | `user_min_resolved < 1` or `user_max_resolved < 1` or `user_min_resolved > user_max_resolved` | `LeverageConfigurationInvalid` | **400** | `"User min/max leverage is invalid. Set min and max in Admin (user or group rules) to values between 1 and your platform cap, with min ≤ max."` |
| **267–269** | `LIMIT` and `limit_price` is `None` | `Status(BAD_REQUEST)` | **400** | Logs: `limit order missing limit_price` |
| **273–277** | `get_price_from_redis` returns `None` | `Status(BAD_REQUEST)` | **400** | Logs: `market_no_price` (no structured JSON from this variant) |
| **293–305** | `effective_leverage(...)` returns `None` | `LeverageConfigurationInvalid` | **400** | `"Order notional {notional} does not match any configured leverage band for this symbol. In Admin → Leverage profiles, ensure tiers cover all exposure levels (contiguous bands, e.g. last band open-ended) with no gaps."` (dynamic `notional` interpolation) |
| **307–310** | `eff_lev <= 0` | `LeverageConfigurationInvalid` | **400** | `"Resolved effective leverage is not valid."` |

**Success:** lines **286–312** — `required_margin = notional / eff_lev`.

### 2a. `get_price_from_redis` (`deposits.rs`)

| Lines | Behavior |
|-------|----------|
| **642–648** | Pool `get().await` fails → `None` |
| **610–635** (`get_price_from_redis_conn`) | For each Redis key: `GET` error → continue; JSON parse fail → continue; missing `bid`/`ask` or non-string → continue; `Decimal::from_str` fail → continue; `bid <= 0` or `ask <= 0` → continue; else `Some((bid, ask))` |
| **634–635** | All keys exhausted → `None` |

**Caller** (`orders.rs` **273–277**): `None` → `BAD_REQUEST` + `market_no_price` log.

---

## 3. LEVERAGE TIERS — DO HIGH NOTIONALS BREAK THINGS?

### Schema vs data

Migrations define `leverage_profile_tiers` columns including `notional_from`, `notional_to` (nullable). **Tier band values are DB/admin content** — this repo migration reviewed does not ship concrete production tier rows.

### `risk::effective_leverage` (`crates/risk/src/effective_leverage.rs`)

- **Open-ended upper:** `notional_to` is `None` or trims to `""` → tier matches when `notional >= from` with **no upper bound** (lines **45–50**).
- **Finite upper:** `notional_to` parses → **`in_tier` iff `notional < to`** (strict `<`, lines **47–49**).
- **Primary selection:** among matching tiers, pick largest `notional_from` (lines **40–60**).
- **Gap fallback:** if still no match, scan **reversed** tiers whose `notional_to` is absent/empty — first with `notional >= from` wins (lines **64–75**).
- **Sub-minimum floor:** if still none and `notional > 0`, find smallest `notional_from`; only if **`notional < min_from`** use that tier’s leverage (lines **79–95**). **Does not apply** when notional is **above** all finite caps with no open-ended tier.
- **Final:** `let s = symbol_lev?` (line **97**) → **`None`** if still unmatched.

### If `notional` exceeds the largest finite `notional_to` with no open-ended row

`effective_leverage` returns **`None`** → `compute_order_margin_details` lines **293–305** → **`400`** + `LEVERAGE_CONFIGURATION` + the long “does not match any configured leverage band…” message.

This matches “fails only when size/notional gets large,” not a free-margin gate.

---

## 4. SIZE PARSING & DECIMAL OVERFLOW

- `Decimal::from_str` on strings like `4.999998` or `5.15` is expected to succeed.
- No `i64` truncation of notional in `compute_order_margin_details` after parse.
- Parse failure only at `estimate_order_margin` **767–770** → plain **400** (would fail at any slider %, not only high %).

---

## 5. FREE-MARGIN CHECK ON ESTIMATE?

**No.** `estimate_order_margin` never compares `required_margin` to free margin. `InsufficientMargin` exists only for `place_order` (`IntoResponse` **50–57**).

---

## 6. MIN MARGIN CHECK ON ESTIMATE?

**No.** `MIN_REQUIRED_MARGIN_USD` is not referenced in `estimate_order_margin` or `compute_order_margin_details`. `MinimumMarginNotMet` (**59–66**) is for `place_order` only.

---

## 7. FAILING SCENARIO — STEP-BY-STEP

**Given:** `BTCUSDT` `BUY` `MARKET`, ask ≈ `77488.13`, free margin ≈ `22891.53`, slider ~90% → size ≈ `5.15` BTC.

1. **752–786** — Request passes type/side/size/limit validation.

2. **794–807** — User leverage row loaded (defaults in `compute_order_margin_details` **240–241**: min `1`, max `500` if null).

3. **272–283** — Execution price = **ask** from Redis.

4. **286** — `notional = 5.15 × 77488.13 ≈ 399063.87` (quote units).

5. **287–292** — `effective_leverage(notional, Some(u_min), Some(u_max), tiers)`.

6. If DB tiers end with a **last closed band** below ~399k and **no** open-ended top tier (and no gap fallback applies), line **97** in `effective_leverage.rs` yields **`None`**.

7. **293–305** in `orders.rs` — **`Err(LeverageConfigurationInvalid { message: format!(...) })`** → client **400** JSON **`error.code` = `"LEVERAGE_CONFIGURATION"`** with notional in the message.

**Correlation with “~87%”:** That percentage maps to a **notional threshold** via `size × price`; crossing the profile’s last covered notional band triggers this branch. Exact % depends on tier table and how the frontend maps % → size (must match server `effective_leverage` inputs).

**UNCERTAIN:** Without your live `leverage_profile_tiers` rows, the exact numeric cap cannot be named from the repo alone.

---

## 8. SUGGESTED FIX (do not implement here)

**Recommended single approach:** **Backend / Admin data — add or fix the top leverage tier**

- Add a **final open-ended** tier (`notional_to` NULL or empty string per `effective_leverage.rs` **45–46**) with appropriate `max_leverage`, **or** extend the last finite `notional_to` so max expected open interest is covered.
- Rationale: `estimate` and `place_order` share `compute_order_margin_details` (**151** comment); misconfigured tiers are a **configuration bug**, not something estimate should paper over by skipping validation.

**Optional UX:** Frontend could clamp slider max notional using tier metadata (if exposed) to avoid hitting **400** — secondary to correct tier data.

**Not recommended alone:** “Remove gating from estimate” — there is **no free-margin gating** on estimate; removing `effective_leverage` validation would misstate margin vs risk policy.

---

## Quick confirmation in Network tab

- If response JSON has **`error.code === "LEVERAGE_CONFIGURATION"`** and message contains **“Order notional … does not match any configured leverage band”** → **§2 / §3** (`orders.rs` **300–304**).
- If **404** → symbol row (**176–178**); user-reported “400” may be misread.
- If **400** with no JSON body → likely **`Status(BAD_REQUEST)`** paths (**760–785**, **267–269**, **273–277**).
