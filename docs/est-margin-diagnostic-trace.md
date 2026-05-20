# Est. Margin — code-grounded diagnostic trace

Dense technical reference for another assistant designing features on top of this logic. Exact identifiers from the codebase.

## Files read (for this trace)

`src/features/terminal/components/RightTradingPanel.tsx`, `src/features/terminal/components/ChartTradingStrip.tsx`, `src/features/terminal/api/orders.api.ts`, `src/shared/api/http.ts`, `src/shared/api/auth.api.ts`, `backend/auth-service/src/routes/orders.rs`, `backend/auth-service/src/lib.rs`, `backend/auth-service/src/routes/auth.rs`, `backend/auth-service/src/routes/deposits.rs`, `backend/auth-service/src/utils/jwt.rs`, `crates/risk/src/effective_leverage.rs`, `crates/risk/src/margin.rs`, `crates/redis-model/src/keys.rs`, `apps/order-engine/src/engine/tick_handler.rs`, `apps/order-engine/src/engine/order_handler.rs`, `backend/auth-service/src/models/user.rs` (via grep), `infra/migrations/005_margin_calculation_type.sql` / `database/migrations/0020_margin_calculation_type.sql` (via grep)

---

## 1. UI ENTRY POINT

- **Trading panel (right-side order ticket)**  
  - `src/features/terminal/components/RightTradingPanel.tsx` — exported component `RightTradingPanel`.

- **Cost Breakdown**  
  - Same file: inline block under comment `{/* Cost Breakdown - Enhanced */}` (not a separate file).

- **Exact JSX for “Est. Margin”**  
  - Label: `<span className="text-muted/80">Est. Margin</span>`  
  - Value: spinner + `estMarginDollars == null ? '—' : \`$\${estMarginDollars.toFixed(2)}\``  
  - Location:

```tsx
// src/features/terminal/components/RightTradingPanel.tsx (Cost Breakdown block)
<div className="flex justify-between items-center py-1 border-b border-white/5">
  <span className="text-muted/80">Est. Margin</span>
  <span className="font-semibold text-accent inline-flex items-center gap-1.5">
    {isEstimatingServerMargin && canEstimateServerMargin && estMarginDollars == null ? (
      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted shrink-0" />
    ) : null}
    {estMarginDollars == null ? '—' : `$${estMarginDollars.toFixed(2)}`}
  </span>
</div>
```

- **State / hook feeding the displayed value**  
  - `estMarginDollars` (`number | null`) derived from:
    - `parsedServerMarginUsd` ← `serverMarginEstimate?.requiredMargin` (React Query `data` from `estimateOrderMargin`)
    - else `fallbackMarginUsd` ← `clientMarketFallbackMarginUsdOrNull(...)`  
  - Definition in `RightTradingPanel.tsx`: `parsedServerMarginUsd`, `fallbackMarginUsd`, then `const estMarginDollars: number | null = parsedServerMarginUsd != null ? parsedServerMarginUsd : fallbackMarginUsd`

- **Formatting / rounding / NaN**  
  - Display: only `toFixed(2)` when `estMarginDollars != null`; if `parseFloat` on `requiredMargin` is not finite → treated as `null` → `—`.  
  - No explicit `NaN` string path if value is null; non-finite parse yields null → `—`.

- **What triggers recalculation**  
  - **Server estimate** (`useQuery`): `queryKey` includes `selectedSymbol?.code`, `sizeCalculations.currentUnits`, `orderType`, `limitPrice`, `previewOrderSide`. `enabled: canEstimateServerMargin`. `staleTime: 2000` (ms). Any of those changes refetches when enabled.  
  - **Fallback margin** (`useMemo`): same inputs as `fallbackMarginUsd` deps + bid/ask from `selectedSymbol`.  
  - **Preview side** (`previewOrderSide`): updated on Buy/Sell hover/focus/click so margin preview matches side-specific execution price.  
  - **Prices**: bid/ask come from terminal symbol state (`numericPrice` / `numericPrice2`); not part of the estimate query key — **UNCERTAIN:** whether those update on every tick without changing `currentUnits` may still change fallback if deps reference `selectedSymbol` object identity vs fields (object reference updates would rememoize).

---

## 2. FRONTEND CALCULATION LAYER

- **Both**  
  1. **Primary:** POST `/v1/orders/estimate` via `estimateOrderMargin` when `canEstimateServerMargin` is true.  
  2. **Fallback:** `clientMarketFallbackMarginUsdOrNull` in `src/features/terminal/api/orders.api.ts` when server response missing/invalid or query not used.

- **Hooks / services**  
  - `useQuery` in `RightTradingPanel` — `queryKey`: `['v1','orderMarginEstimate', selectedSymbol?.code, sizeCalculations.currentUnits, orderType, limitPrice, previewOrderSide]`; `queryFn` calls `estimateOrderMargin`.  
  - `useQuery` — `['auth','me']`, `me` from `@/shared/api/auth.api`.  
  - `useQuery` — `['auth','symbolLeverage', selectedSymbol?.code]`, `getSymbolLeverage`.  
  - `useTerminalStore` — `selectedSymbol`, `symbols`.  
  - `useAccountSummary` — `freeMargin` (blocks order, not estimate display).  
  - `useMemo`: `sizeCalculations`, `costBreakdown`, `parsedServerMarginUsd`, `fallbackMarginUsd`, `currentOrderNotional`, `effectiveLeverageForCard`.

- **Inputs to margin (server + fallback)**

| Input | Role | Source |
|--------|------|--------|
| `symbol` | Request | `selectedSymbol.code` |
| `side` | BUY→ask, SELL→bid (MARKET) | `previewOrderSide` |
| `orderType` / `limitPrice` | LIMIT uses limit price | `orderType`, `limitPrice` state |
| `size` (string) | Base units sent to API | `String(sizeCalculations.currentUnits)` |
| `bid` / `ask` | Client fallback notional | `selectedSymbol.numericPrice`, `numericPrice2` |
| `tiers` | Tiered leverage | `symbolLeverage?.tiers` from GET `/api/auth/me/symbol-leverage?...` |
| `userMin` / `userMax` | Clamp | `meData?.minLeverage`, `meData?.maxLeverage` from `me` |

- **Debounce / throttle / abort**  
  - No debounce/throttle in panel code.  
  - `http()` uses `AbortController` + 30s timeout (`REQUEST_TIMEOUT_MS` in `src/shared/api/http.ts`). React Query may abort in-flight on key change (library default).

- **Fallback UI states**  
  - **`—`**: `estMarginDollars == null` (server failed or returned bad string; fallback returned null; or query disabled and fallback null).  
  - **Spinner**: `isEstimatingServerMargin && canEstimateServerMargin && estMarginDollars == null`.  
  - **`costBreakdown.margin`** is a **separate** string (`'—'` or `toFixed(2)`) used only inside the memo for spread/fees/margin string — **Est. Margin row does not render `costBreakdown.margin`**; it renders `estMarginDollars` only.

---

## 3. NETWORK CALL (IF ANY)

- **Endpoint**  
  - `POST` **`/v1/orders/estimate`** (also mounted at `/api/orders/estimate` on the same router in `backend/auth-service/src/lib.rs`).

- **Frontend caller**  
  - `estimateOrderMargin` in `src/features/terminal/api/orders.api.ts` → `http<EstimateOrderMarginResponse>('/v1/orders/estimate', { method: 'POST', body: JSON.stringify({...}) })`.

- **Request (TS)** — `EstimateOrderMarginRequest`: `symbol`, `side`, `orderType`, `size`, optional `limitPrice`; JSON body uses camelCase keys matching Rust `#[serde(rename_all = "camelCase")]`.

- **Request (Rust)** — `EstimateOrderMarginRequest` in `backend/auth-service/src/routes/orders.rs`: `symbol`, `side`, `order_type`, `size`, `limit_price`.

- **Response (TS)** — `EstimateOrderMarginResponse`: `notional`, `effectiveLeverage`, `requiredMargin`, `executionPrice` (camelCase from JSON).

- **Response (Rust)** — `EstimateOrderMarginResponse`: `notional`, `effective_leverage`, `required_margin`, `execution_price`.

- **Auth**  
  - Router uses `auth_middleware` (`create_orders_router` `.layer(axum::middleware::from_fn_with_state(..., auth_middleware))`). Same as `POST /v1/orders`. Bearer JWT required (`http()` attaches `Authorization`).

---

## 4. BACKEND HANDLER

- **Route registration**  
  - `create_orders_router` in `backend/auth-service/src/routes/orders.rs`: `.route("/estimate", post(estimate_order_margin))`.  
  - Nested in `backend/auth-service/src/lib.rs`: `.nest("/v1/orders", create_orders_router(...))` and `.nest("/api/orders", ...)`.

- **Handler**  
  - `async fn estimate_order_margin` in `backend/auth-service/src/routes/orders.rs`.

- **Ordered behavior**

1. **Auth / claims** — `Extension(claims): Extension<Claims>` — `claims.sub` = `user_id` (`Uuid`), `claims.group_id` passed into `compute_order_margin_details` as `group_id`.

2. **Validation** — `order_type` ∈ {`MARKET`,`LIMIT`}; `side` ∈ {`BUY`,`SELL`}; `size` parse as `Decimal`, `> 0`; LIMIT requires `limit_price` present and parseable.

3. **DB read (user)** — `SELECT min_leverage, max_leverage, account_type FROM users WHERE id = $1`  
   - **Note:** `trading_access` is **not** selected in estimate (unlike `place_order`).

4. **Core** — `compute_order_margin_details(&pool, orders_state.redis.as_ref(), user_id, claims.group_id, &req.symbol, &side_upper, &order_type_upper, size, limit_price, u_min, u_max, acct).await?`

5. **Response** — JSON `EstimateOrderMarginResponse` from `OrderMarginDetails` fields `notional`, `effective_leverage`, `required_margin`, `execution_price` (all `.to_string()`).

**Inside `compute_order_margin_details`** (`pub async fn compute_order_margin_details` in `orders.rs`):

1. **DB — symbol id** — `SELECT id FROM symbols WHERE code = $1 LIMIT 1`

2. **DB — leverage profile id** — `resolve_leverage_profile_id_for_user_symbol`:  
   - `COALESCE(gs.leverage_profile_id, ug.default_leverage_profile_id)` from `users` + `user_groups` + `symbols` + `LEFT JOIN group_symbols gs`.  
   - If coalesce NULL: `SELECT id FROM leverage_profiles WHERE is_default = true LIMIT 1`.  
   - If main join returns no row: `None` (no platform fallback).

3. **DB — tiers** — `SELECT ... FROM leverage_profile_tiers WHERE profile_id = $1 ORDER BY tier_index ASC` → mapped to `contracts::commands::LeverageTier` (`notional_from`, `notional_to`, `max_leverage` only).

4. **Redis — execution price (MARKET only)** — `get_price_from_redis(redis, symbol_code, &group_id_str)` in `deposits.rs`. Keys via `price_redis_keys`: `prices:{symbol}:{group_id}`; if symbol ends with `USD` but not `USDT`, also `prices:{symbol}T:{group_id}`. JSON string fields `bid`, `ask` → `Decimal`, both `> 0`.

5. **No NATS** in estimate handler.

6. **Crate call** — `risk::effective_leverage(notional, Some(user_min_resolved), Some(user_max_resolved), leverage_tiers.as_deref())` — `crates/risk/src/effective_leverage.rs`, function `pub fn effective_leverage`.

7. **Margin** — `required_margin = notional / eff_lev` (`Decimal`).

---

## 5. THE MARGIN FORMULA (CORE)

**Implemented path (server and client fallback):**

- **`size`**: order quantity in **base units** (UI: `sizeCalculations.currentUnits`). **Not** multiplied by `symbols.contract_size` in `compute_order_margin_details` (no read of `contract_size` there).

- **`execution_price`**: LIMIT = `limit_price`; MARKET = Redis `ask` if `side == "BUY"`, else `bid`.

- **`notional`** — `notional = size * execution_price` (quote-currency notional for typical crypto pairs).

- **`effective_leverage`** (`eff_lev`) — from `risk::effective_leverage`; clamped to `[user_min_resolved, user_max_resolved]` (defaults 1 and 500 if null).

- **`required_margin`** — `required_margin = notional / eff_lev` — same as `calculate_margin` in `crates/risk/src/margin.rs`.

- **`initial_margin_percent` / `maintenance_margin_percent`** — loaded in SQL for tiers but **not** passed into `LeverageTier` / **not** used in `effective_leverage` or `required_margin` for this estimate path.

- **Fees / spread / buffer** — **not** added to `required_margin` in this path.

- **Rounding** — Rust: `Decimal`; response `.to_string()`. UI: `toFixed(2)`.

**Tier selection (server)** — `effective_leverage` in `crates/risk/src/effective_leverage.rs`: pick tier with largest `notional_from` such that `from <= notional` and `notional < to` (or open `to`); else open-ended tier scan; else sub-minimum floor tier; then clamp to user min/max.

**Client mirror** — `resolveEffectiveLeverageFromTiersOrNull` / `clientMarketFallbackMarginUsdOrNull` in `src/features/terminal/api/orders.api.ts`.

---

## 6. LEVERAGE RESOLUTION

**A. Profile for order margin (server)** — `resolve_leverage_profile_id_for_user_symbol`:  
1. `COALESCE(group_symbols.leverage_profile_id, user_groups.default_leverage_profile_id)`.  
2. If NULL: `leverage_profiles.is_default = true`.  
3. If main join returns no row: `None`.

**B. Frontend `getSymbolLeverage`** — `symbol_leverage` in `auth.rs`: same `COALESCE` for profile id **without** the `is_default` fallback when coalesce is null — tiers may be `null` in UI while estimate still resolves via `resolve_leverage_profile_id_for_user_symbol`.

**C. User min/max** — `users.min_leverage`, `users.max_leverage`; resolved in `compute_order_margin_details` with defaults 1 / 500.

**D. Tier mapping** — `risk::effective_leverage::effective_leverage` (`crates/risk/src/effective_leverage.rs`).

**E. UI-selected leverage** — **Not present**: no leverage field in `EstimateOrderMarginRequest`.

---

## 7. PRICE INPUT

- **MARKET** — Server: Redis `prices:{symbol}:{group_id}` (and optional `...USDT` for `...USD` symbols). **BUY → `ask`**, **SELL → `bid`**. Writer: `apps/order-engine/src/engine/tick_handler.rs` — `price_key = format!("prices:{}:{}", tick.symbol, group_id.unwrap_or(""))`.

- **LIMIT** — `execution_price = limit_price` (no Redis).

- **Stale / missing** — `get_price_from_redis` returns `None` → `market_no_price` → HTTP error → client fallback uses WS `numericPrice` / `numericPrice2`.

- **Per-group markup** — In tick pipeline upstream; estimate reads stored Redis bid/ask only.

**Note:** `Keys::tick(symbol)` = `tick:{symbol}` in `crates/redis-model/src/keys.rs` is **not** used by `get_price_from_redis`.

---

## 8. SYMBOL & CONTRACT METADATA

- **`symbols` in estimate** — Only `id` via `WHERE code = $1` (case-sensitive). `contract_size`, tick/lot columns, `market_type`, `data_provider`: **not read** in this handler.

- **`group_symbols`** — affects leverage profile via join on `symbol_id` + `group_id`.

- **`market_type` / asset class** — **not** branched in estimate path.

---

## 9. ACCOUNT & USER FACTORS

- **`users.margin_calculation_type`** — `'hedged' | 'net'`; used in account summary / position aggregates (`deposits.rs`). **Not** used in `estimate_order_margin`.

- **`users.account_type`** — selected in estimate; normalized for `OrderMarginDetails` but **does not change** `required_margin` in the shown logic.

- **`users.trading_access`** — **not** checked in `estimate_order_margin`; **checked** in `place_order`.

- **`MIN_REQUIRED_MARGIN_USD`** — `const MIN_REQUIRED_MARGIN_USD: i64 = 10` in `orders.rs`. Enforced in **`place_order`** only. UI: `MIN_EST_MARGIN_DOLLARS = 10` in `RightTradingPanel.tsx` disables Buy/Sell when estimate below minimum.

---

## 10. WORKED EXAMPLE (assumptions)

**Assumptions:** `BTCUSDT`, `BUY`, `MARKET`, `size = 1` BTC, Redis `ask = 77438.59`, `user_min = 1`, `user_max = 200`, tier `notional_from = 0`, open `notional_to`, `max_leverage = 100`.

1. `execution_price = 77438.59`  
2. `notional = 77438.59`  
3. `effective_leverage = 100` (clamp to `[1,200]` → 100)  
4. `required_margin = 77438.59 / 100 = 774.3859` → UI `$774.39`

If `max_leverage = 500` and user max `200` → effective `200` → margin `387.19`.

---

## 11. WHY “—” IN THE SCREENSHOT

**Displayed value is ticket estimate, not open-position margin.**

- **`estMarginDollars == null` → `'—'`**

**Paths to null while positions still show margin:**

1. **`canEstimateServerMargin` false** — e.g. `sizeCalculations.currentUnits <= 0`, limit without price, no symbol.

2. **Server error** — e.g. `market_no_price` (Redis miss for `prices:{symbol}:{group_id}`).

3. **Fallback null** — empty `tiers` and server failed; or `resolveEffectiveLeverageFromTiersOrNull` returns null.

4. **Invalid `requiredMargin` string** — `parseFloat` not finite.

**Est. Liquidation** — `costBreakdown.liquidation` is hardcoded `'-'` in the `costBreakdown` `useMemo`; the row renders that, not a computed liquidation.

---

## 12. RELATED CALCULATIONS (BRIEF)

- **Est. Liquidation** — hardcoded `'-'` in `RightTradingPanel.tsx` `costBreakdown`. Other liquidation code may exist (e.g. `crates/risk/src/liquidation.rs`) but not wired here.

- **Spread** — `Math.abs(ask - bid)` (with FX quote branch) in `costBreakdown` memo.

- **Fees** — `fees = 0` in same memo.

- **“≈ …” under size** — `costBreakdown.quoteValue` / `baseSize` from `refPriceMid` and `currentUnits`.

- **MAX** — `handleMaxSize` uses hardcoded `2495.56 * 0.01`, not `free_margin`.

---

## 13. EXTENSION POINTS

- **Frontend:** `clientMarketFallbackMarginUsdOrNull`, `estMarginDollars` merge in `RightTradingPanel.tsx`; DTOs in `orders.api.ts`.

- **Backend:** `compute_order_margin_details` and `estimate_order_margin` in `orders.rs`.

- **DB:** `leverage_profile_tiers` (e.g. use `initial_margin_percent` / `maintenance_margin_percent`).

- **Alignment:** `resolve_leverage_profile_id_for_user_symbol` vs `symbol_leverage` default-profile fallback.

- **Redis:** `prices:{symbol}:{group_id}` JSON contract.

- **Constants:** `MIN_REQUIRED_MARGIN_USD` (place) vs `MIN_EST_MARGIN_DOLLARS` (UI).

---

## UNCERTAIN (explicit)

- `symbols.code` case sensitivity in `compute_order_margin_details` vs `LOWER(TRIM)` in leverage resolution — possible mismatch edge case.

- React Query error/cache behavior for failed estimate without reading `package-lock` / query defaults.
