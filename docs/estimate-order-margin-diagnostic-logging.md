# Estimate order margin — temporary diagnostic logging

This document describes the **temporary** `tracing` logs added to `backend/auth-service/src/routes/orders.rs` to debug **`POST /v1/orders/estimate`** returning **400** when the Free Margin % slider moves high. All additions are marked with `// DIAGNOSTIC: REMOVE LATER` for easy removal.

---

## Location

| Item | Value |
|------|--------|
| **File** | `backend/auth-service/src/routes/orders.rs` |
| **Handler** | `estimate_order_margin` |
| **Shared logic** | `compute_order_margin_details` |

---

## Branch tags (grep)

### `estimate_order_margin` — `warn!` before plain **400** returns

| Tag | When |
|-----|------|
| `EST_ORDER_TYPE_INVALID` | `order_type` not `MARKET` / `LIMIT` |
| `EST_SIDE_INVALID` | `side` not `BUY` / `SELL` |
| `EST_SIZE_PARSE_FAIL` | `size` string fails `Decimal::from_str` |
| `EST_SIZE_NON_POSITIVE` | Parsed `size <= 0` |
| `EST_LIMIT_PRICE_PARSE_FAIL` | `limit_price` present but invalid decimal |
| `EST_LIMIT_MISSING_PRICE` | `LIMIT` without `limit_price` |

Errors from `compute_order_margin_details` are logged **inside** that function (no separate tag in `estimate_order_margin`).

### `compute_order_margin_details` — `warn!` before **400**-class errors

| Tag | When |
|-----|------|
| `COMD_NO_PROFILE_RESOLVED` | No leverage profile (after resolution) |
| `COMD_TIERS_EMPTY` | Profile has no tiers |
| `COMD_USER_LEVERAGE_INVALID` | User min/max leverage invalid |
| `COMD_LIMIT_MISSING_PRICE` | `LIMIT` path missing limit price (inner check) |
| `COMD_MARKET_NO_PRICE` | Redis price miss (`get_price_from_redis` → `None`) |
| `COMD_EFFECTIVE_LEV_NONE` | `risk::effective_leverage` returned `None` (notional outside all bands / gaps) |
| `COMD_EFFECTIVE_LEV_NON_POSITIVE` | Resolved `eff_lev <= 0` |

### Success

| Tag | Level | When |
|-----|--------|------|
| `EST_OK` | `info!` | Right before `Ok(Json(EstimateOrderMarginResponse { ... }))` |

**Message strings** (for log filtering):

- Failures: `"estimate 400 diagnostic"`
- Success: `"estimate success diagnostic"`

---

## Observed behavior (local `/tmp/newpt-start-all.log`)

### Success — `EST_OK`

Successful estimates emit **`INFO`** lines including:

- `branch="EST_OK"`
- `symbol`, `side`, `order_type`, `size` (request string)
- `notional`, `effective_leverage`, `required_margin`, `execution_price` (computed)

Example shape:

```text
estimate success diagnostic branch="EST_OK" user_id=... symbol=BTCUSDT side=BUY order_type=MARKET size=4.212835 notional=326728.65... effective_leverage=20 required_margin=... execution_price=77555.53
```

### Failure at high slider — `COMD_EFFECTIVE_LEV_NONE`

When **order notional** `size × execution_price` exceeds the **top tier’s exclusive upper bound** (e.g. DB has a single tier `notional_to = 10_000_000` and `effective_leverage` uses `notional < notional_to`), **`effective_leverage` returns `None`**.

Logs include:

- `branch="COMD_EFFECTIVE_LEV_NONE"`
- `notional` (often **≥ 10_000_000** in this scenario)
- `top_tier_notional_to=Some("10000000.00000000")`
- `top_tier_max_leverage=Some(20)`
- `resolved_profile_id`, `tier_count`, `user_min_resolved`, `user_max_resolved`

Example shape:

```text
estimate 400 diagnostic branch="COMD_EFFECTIVE_LEV_NONE" ... notional=10239030.90... top_tier_notional_to=Some("10000000.00000000") top_tier_max_leverage=Some(20)
```

**Interpretation:** The **400** is **`LEVERAGE_CONFIGURATION`** from the server (“notional does not match any configured leverage band”), not a free-margin gate on the estimate path. At very high slider percentages the UI can compute a **BTC size** that implies **notional above the last tier cap**; fixing tiers (e.g. open-ended top band) or clamping size on the client aligns with this signal.

---

## How to tail logs

If services were started with:

```bash
nohup bash scripts/start-all.sh > /tmp/newpt-start-all.log 2>&1 &
```

Filter diagnostic lines:

```bash
grep -E 'estimate (400|success) diagnostic|branch="(EST_|COMD_)' /tmp/newpt-start-all.log
```

Live:

```bash
tail -f /tmp/newpt-start-all.log | grep -E 'estimate (400|success) diagnostic|branch="(EST_|COMD_)'
```

Adjust the log path if auth-service logs elsewhere.

---

## Removal (after debugging)

1. List markers:

   ```bash
   grep -n "DIAGNOSTIC: REMOVE LATER" backend/auth-service/src/routes/orders.rs
   ```

2. Delete each `// DIAGNOSTIC: REMOVE LATER` line and the **`warn!` / `info!` block** immediately following it.

3. Remove the **temporary `let` bindings** used only for diagnostics before `effective_leverage` (if still present):

   - `tier_count`, `top_tier_notional_to`, `top_tier_max_leverage` immediately before `let eff_lev = effective_leverage(...)` **only if** they are not needed for other logic (they were added solely for `COMD_EFFECTIVE_LEV_NONE` / `COMD_EFFECTIVE_LEV_NON_POSITIVE`).

4. Run `cd backend/auth-service && cargo check` and re-test estimate.

---

## Related docs

- `docs/post-v1-orders-estimate-400-diagnostic.md` — branch / status mapping in code
- `docs/postgres-leverage-tiers-readonly-diagnostic.md` — example DB tier caps (e.g. Lev1 `notional_to = 10_000_000`)

---

*This file documents diagnostic behavior only; it is not a substitute for removing temporary logs before production.*
