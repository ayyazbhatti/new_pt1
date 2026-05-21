# Account summary & order margin — math audit (read-only)

This document maps **Bottom Dock / account summary** fields and **order placement margin checks** against the **cTrader reference model** provided in the audit brief. Line numbers refer to the repository state at audit time.

---

## 1. Bottom Dock fields — display sources

Data flows: **`useAccountSummary`** → `GET /api/account/summary` (initial) + WebSocket `account.summary.updated` (updates). Types: `src/features/wallet/api.ts` (`AccountSummaryResponse`).

| Field | Frontend file:line where rendered | TypeScript field name | API endpoint | Backend handler |
|-------|-----------------------------------|----------------------|--------------|-------------------|
| Balance | `src/features/terminal/components/BottomDock.tsx:838`, `1651` | `accountSummary.balance` | `GET /api/account/summary` | `backend/auth-service/src/routes/deposits.rs::get_account_summary` (`2229`) |
| Equity | `BottomDock.tsx:839`, `1652` | `accountSummary.equity` | same | same |
| Margin (used) | `BottomDock.tsx:840`, `1653` | `accountSummary.marginUsed` (display gated; see §11) | same | same |
| Free Margin | `BottomDock.tsx:841`, `1654` | `accountSummary.freeMargin` | same | same |
| Margin Level | `BottomDock.tsx:842`, `1656` | `accountSummary.marginLevel` (`string`, `"inf"` or numeric %) | same | same |
| Bonus | `BottomDock.tsx:1655` (not in mobile list at `837–844`) | `accountSummary.bonus` | same | same |
| Realized PnL (“RI PNL”) | `BottomDock.tsx:1657` | `accountSummary.realizedPnl` | same | same |
| Unrealized PnL (“UnR Net PNL”) | `BottomDock.tsx:1658` | `accountSummary.unrealizedPnl` | same | same |

**Hook / fetch**

- `src/features/wallet/hooks/useAccountSummary.ts:20–26` — `queryFn: fetchAccountSummary`
- `src/features/wallet/api.ts:45–47` — `http('/api/account/summary')`

**Router mount**

- `backend/auth-service/src/lib.rs:350` — `.nest("/api/account", routes::deposits::create_account_router(...))`
- `backend/auth-service/src/routes/deposits.rs:3848` — `.route("/summary", get(get_account_summary))` → **`GET /api/account/summary`**

---

## 2. Backend computation — field by field

Core implementation: **`compute_account_summary_inner`** (`deposits.rs:2029–2150`). Cache write: **`compute_and_cache_account_summary_with_prices`** (`1935–1990` hashes `pos:summary:{user}` fields including `free_margin`, `balance`, etc.).

### Balance

**Current formula in code**

- **Source:** `backend/auth-service/src/routes/deposits.rs:2043–2068`, `2110`, `2119–2120`

```text
deposits   = SUM(transactions.net_amount) WHERE type = deposit AND status ∈ {completed, approved} AND currency = 'USD'
withdrawals = SUM(transactions.net_amount) WHERE type = withdrawal AND status = completed AND currency = 'USD'
realized_pnl = sum_closed_realized_pnl_usd(pool, fx_snapshot, user_id)   // closed positions only, FX → USD, includes bonus_loss_absorbed in row sum
balance = deposits - withdrawals + realized_pnl
```

- **SQL inputs:** `transactions` (deposit/withdrawal only in query), `positions` + `symbols` via `sum_closed_realized_pnl_usd` (`140–180`).
- **Units:** USD (explicit `currency = 'USD'` on transactions; closed PnL converted with `fx_rates::convert_with_rates` to `"USD"`).

**vs cTrader**

- ⚠️ **Differs:** cTrader includes **− fees − swaps** in balance. This code only sums **deposits, withdrawals, and closed-position realized PnL** (with `pnl + bonus_loss_absorbed` per row). There is **no** explicit `SUM(fees)` / swap deduction in `compute_account_summary_inner`. If fees/swaps are recorded only as separate `transactions` rows of other types, they are **not** included in this balance unless folded into `net_amount` of deposit/withdrawal rows or into position `pnl`.
- **Severity:** **Medium** (wrong balance vs cTrader if fees/swaps exist off-ledger).

---

### Bonus

- **Source:** `deposits.rs:2112–2118` — `bonus_balance` from `wallets` spot USD:  
  `SELECT COALESCE(bonus_balance, 0) FROM wallets WHERE ... wallet_type = 'spot' AND currency = 'USD'`
- **AccountSummary field:** `bonus` (`deposits.rs:2148`).
- **vs cTrader:** ✅ **Matches intent** — separate from `balance`, added into equity (below), not merged into balance in `compute_account_summary_inner`.

---

### Equity

- **Source:** `deposits.rs:2122`  
  `equity = balance + bonus_balance + unrealized_pnl`
- **Unrealized:** from `fetch_position_aggregates_from_redis` or DB fallback (`2084–2107`), summed in **USD** (`793–794`, `1015–1034`).
- **vs cTrader:** ✅ **Matches** `Balance + Bonus + sum(unrealized open)`.

---

### Used margin (`margin_used`)

- **Primary:** `fetch_position_aggregates_from_redis` (`797–1056`) — sums per-open-position `margin` from Redis `pos:by_id:{id}`, converted **quote → USD** when not in `"net"` margin mode; **net** mode scales margin by net exposure ratio (`1038–1053`).
- **Fallback:** `fetch_position_aggregates_from_db` (`1060–1164`) — open rows, `margin_used` / netting logic, FX to USD.
- **vs cTrader:** ✅ **Conceptually** “sum of initial margin of open positions,” with platform-specific **hedged vs net** handling.
- ⚠️ **Engine / order consistency:** Order-engine Lua uses **`(size * price) / leverage`** without **`contract_size`** (`apps/order-engine/lua/atomic_fill_order.lua` around `458–460`, `116–123`, etc.). Auth-service **`compute_order_margin_details`** uses **`notional = size * execution_price`** only (`orders.rs:295–321`). If `size` is not already “base units × contract_size,” **notional and stored margin can diverge from cTrader’s** `(size × contract_size × price) / leverage`.
- **Severity:** **Critical** for symbols with `contract_size ≠ 1` if `size` is in lots/contracts.

---

### Free margin

- **Source:** `deposits.rs:2123–2127`

```rust
let free_margin = if equity >= margin_used {
    equity - margin_used
} else {
    Decimal::ZERO
};
```

- **vs cTrader:** ✅ **Matches** “Equity − Used Margin, floored at 0.”

---

### Margin level

- **Source:** `deposits.rs:2129–2133`

```rust
let margin_level = if margin_used > Decimal::ZERO {
    format!("{:.2}", (equity / margin_used) * Decimal::from(100))
} else {
    "inf".to_string()
};
```

- **vs cTrader:** ✅ **Matches** `(Equity ÷ Used Margin) × 100`, **`inf`** when `margin_used == 0`.

---

### Realized PnL (display field `realized_pnl`)

- **Source:** Same `sum_closed_realized_pnl_usd` as balance (`2110`), exposed as `AccountSummary.realized_pnl` (`2146`).
- **vs cTrader:** ✅ Aligns with “closed positions” component; **not** net of separate fee ledger unless embedded in `pnl`.

---

### Unrealized PnL

- **Source:** Redis-first mark-to-market (`925–1034`) or DB `positions.pnl` for open rows (`1152–1161`), converted to USD.
- **vs cTrader:** ✅ Open positions only; closed excluded in Redis path by `is_open` (`884–887`).

---

### `get_account_summary` (read path)

- **Redis hit:** `deposits.rs:2237–2290` — reads hash fields written at `1977–1989`.
- **Miss:** `compute_account_summary_inner` then `compute_and_cache_account_summary` (`2294–2304`).

---

### `get_free_margin_from_db_fast` (order path helper)

- **Source:** `deposits.rs:1169–1269`
- Recomputes: USD deposits/withdrawals, `sum_closed_realized_pnl_usd`, `wallets.bonus_balance`, `fetch_position_aggregates_from_db` for `(margin_used, _closed_realized_in_tuple, unrealized)` — **note:** tuple middle value is closed realized from DB aggregate (`1066`), unused for free margin here; **`equity = balance + bonus_balance + unrealized_pnl`** (`1263`), **`free_margin`** floored (`1264–1268`).
- **vs cTrader:** Same equity/free-margin structure as `compute_account_summary_inner`; same balance/fees caveat.

---

### `calculate_wallet_balance` (wallet HTTP / publish — not the same as Bottom Dock summary)

- **Source:** `deposits.rs:528–639`
- Uses **raw** `SUM(pnl)` on open/closed positions **without** the FX pipeline used in `compute_account_summary_inner` (`563–606`).
- **vs account summary:** ⚠️ **Can diverge** from Bottom Dock for non-USD-quoted instruments or when DB PnL and Redis-derived summary disagree.

---

## 3. Equity = balance + bonus + unrealized — verify

| Check | Evidence | Verdict |
|-------|----------|---------|
| `equity = balance + bonus + unrealized` | `deposits.rs:2120–2122` | ✅ |
| USD alignment for summary | FX snapshot required (`2076–2080`); conversions throughout Redis aggregate | ✅ **Intended** (quotes must be in `fx:rates:usd` snapshot) |
| Bonus separate from balance | `2120` vs `2122` | ✅ |
| Unrealized from open only | Redis path `884–887`; DB open query `1086–1088` | ✅ |
| Cached drift | Summary fields written atomically from one `compute_account_summary_inner` pass (`1977–1989`); ticks use `compute_and_cache_account_summary_with_prices` (`1935+`) | ✅ **No client-side equity formula**; drift possible only if Redis position hashes lag DB — mitigated by `position_event_handler` (`position_event_handler.rs:59–60`, `76–77`) calling `compute_and_cache_account_summary` after sync |

---

## 4. Free margin

- **Backend:** floored at zero (`2123–2127`, `1264–1268`, wallet helper `620–624`).
- **vs cTrader:** ✅ Display / math matches “not negative.”

---

## 5. Margin level

- **Backend:** `2129–2133` — percentage or `"inf"`.
- **UI override (`marginLevel === 'inf'` → show `$0.00` used margin):** **Still present**
  - `BottomDock.tsx:840`, `1653`
  - `src/features/wallet/formatAccountSummary.ts:24–27`
  - `LeftSidebar.tsx:396–400`
- **Interpretation:** When the API is consistent, `inf` **implies** `margin_used == 0`, so `$0.00` is correct. If `margin_level` and `margin_used` ever desynced, the UI would **mask** non-zero used margin. **Severity:** Low (defensive coupling; depends on API invariants).

---

## 6. Order placement — which field is checked?

**Handler:** `backend/auth-service/src/routes/orders.rs::place_order` (`366+`).

1. **`compute_order_margin_details`** (`452–466`) → `required_margin` (`472`).
2. **Free margin read:** Redis hash `Keys::account_summary(user_id)` field **`free_margin`** (`512–517`).
3. **Fallback:** `get_free_margin_from_db_fast` (`528–538`) if hash missing/unparseable.
4. **Comparison:** `if required_margin > free_margin` (`542–547`) → `PlaceOrderError::InsufficientMargin` → **HTTP 403** with JSON `error: "INSUFFICIENT_FREE_MARGIN"` (`orders.rs:53–60`).

**vs cTrader**

- ✅ **Field checked:** **Free margin** (not raw wallet `available_balance` at this stage).

**Second gate (wallet ledger)**

- **`bonus_service::lock_margin`** (`orders.rs:560–567`, `bonus_service.rs:251–316`) moves **`available_balance` → `locked_balance`** (cash) and **`bonus_locked`** (bonus). Failure returns **`InsufficientMargin`** mapped to same 403 shape (`562–566`).
- ⚠️ **Conceptual gap vs pure cTrader:** Pre-check uses **accounting free margin** (equity − margin from positions). Lock uses **wallet available cash + revokable bonus**. These **should** align if wallet and summary are kept consistent; if not, **pass free_margin but fail `lock_margin`** or the converse is theoretically possible. **Severity:** Medium — worth monitoring.

---

## 7. Required margin formula

**Auth (pre-trade):** `orders.rs:295–321`

```text
execution_price = limit_price OR Redis bid/ask (side-aware)
notional = size * execution_price
eff_lev = effective_leverage(notional, user_min, user_max, leverage_tiers)   // risk::effective_leverage
required_margin = notional / eff_lev
```

- **Tiers:** DB `leverage_profile_tiers` (`201–214`); **not hardcoded** max leverage beyond user clamp.
- **`crates/risk/src/effective_leverage.rs:11–16`** — tier selection + user min/max.
- **`crates/risk/src/margin.rs:5–7`** — helper `calculate_margin` = `size * entry_price / leverage` (same shape; **not** used directly in `orders.rs`, which inlines `notional / eff_lev`).

**vs cTrader**

- ⚠️ **Missing `contract_size`** in `compute_order_margin_details` and in **order-engine Lua** margin lines (see grep hits under `apps/order-engine/lua/atomic_fill_order.lua`). cTrader: `(size × contract_size × entry_price) ÷ leverage`.
- **Units:** `free_margin` path is **USD**. `required_margin` is derived from **`size * price` in symbol price units** (typically **quote currency**). **If quote ≠ USD**, there is **no explicit FX multiply** in `compute_order_margin_details` before comparing to USD `free_margin`. **UNCERTAIN:** whether all tradable symbols are USD/USDT-quoted in production; if any are not, this is a **critical** unit mismatch.

---

## 8. End-to-end trace — example order (desk check, not executed)

**Assumptions:** USD-quoted symbol, `contract_size` effectively 1, Redis summary warm, `MIN_REQUIRED_MARGIN_USD` met (`orders.rs:28`, `473–487`).

| Step | Operation | Field after (conceptual) | Code |
|------|-----------|--------------------------|------|
| 1 | Client `POST /api/orders` | — | `orders.rs:366` |
| 2 | `compute_order_margin_details` → e.g. required `$155` | — | `452–466`, `295–321` |
| 3 | Read `free_margin` from `pos:summary:{user}` or `get_free_margin_from_db_fast` | e.g. `$1000` | `512–540` |
| 4 | If `required_margin > free_margin` → 403 `INSUFFICIENT_FREE_MARGIN` | — | `542–60` |
| 5 | `lock_margin` in DB tx | wallet `available`↓, `locked`↑ | `554–567`, `bonus_service.rs:283–297` |
| 6 | Insert `orders` row (`pending`) | — | `570–598` |
| 7 | Publish `cmd.order.place` (NATS) | — | `640+` (`orders.rs`) |
| 8 | Engine fills → Redis position + `evt.position.updated` / DB sync | `margin` on position hash from Lua `(size*price)/lev` | `atomic_fill_order.lua` ~`458–475`; listener `position_event_handler.rs:76–77` |
| 9 | `compute_and_cache_account_summary` | Redis hash + WS payload | `compute_and_cache_account_summary_with_prices` `1935+` |
| 10 | UI `account.summary.updated` | BottomDock re-renders | `useAccountSummary.ts:32–77` |

**Corrections vs the brief’s toy table**

- **Balance** does **not** increase on open (no premium paid into balance for margin-only CFD margin model here); **used margin** rises, **free margin** falls, **unrealized** ~0 at entry if price = entry.
- **“Balance = $1000, used_margin = $155”** after fill: **cash wallet** may show lock via `lock_margin`, while **`accountSummary.balance`** still reflects **deposits − withdrawals + closed PnL** only (`2120`) — **not** reduced by initial margin. **Equity** still ~ `$1000 + bonus + unrealized` with unrealized 0 → **equity `$1000`** if bonus 0; **free margin** = `1000 - 155 = 845` if `margin_used` aggregates `$155`. ✅ Consistent with **CFD-style accounting** (margin is allocation, not an immediate balance expense). cTrader treats similarly for **free margin check**; **balance** definition vs cTrader still differs on **fees/swaps** (§2).

---

## 9. Known divergences from cTrader (list)

| # | What | Where | Severity | Recommendation |
|---|------|-------|----------|----------------|
| 1 | Balance omits explicit **fees & swaps** ledger terms | `deposits.rs:2044–2120` | Medium | Fix later / confirm product: encode fees/swaps in `transactions` or `pnl` |
| 2 | **No `contract_size`** in required margin (auth + engine Lua) | `orders.rs:295`; `atomic_fill_order.lua` | Critical (if size ≠ notional units) | Fix now for non-unit contracts |
| 3 | **FX / USD:** `required_margin` not explicitly converted to USD when quote ≠ USD | `orders.rs:295–321` vs `2122–2124` | Critical (if mixed quotes) | Fix now or restrict symbols |
| 4 | **Two-phase** margin: Redis `free_margin` then **wallet `lock_margin`** | `orders.rs:511–567`; `bonus_service.rs:251` | Medium | Harden invariants / single source of truth |
| 5 | **Wallet `calculate_wallet_balance`** vs summary **FX** mismatch | `deposits.rs:528–639` vs `2029+` | Medium | Align or document “wallet endpoint ≠ terminal summary” |
| 6 | **Bottom Dock tooltips** omit **bonus** in equity hint | `BottomDock.tsx:1652` says `Balance + Unrealized` only | Low | Fix tooltip to `Balance + Bonus + Unrealized` |
| 7 | **Mobile** account list (`837–844`) omits **Bonus / RI / UnR** rows present on desktop bar | `BottomDock.tsx` | Low | Product parity |

---

## 10. Summary table

| Aspect | cTrader | This platform | Match? |
|--------|---------|---------------|--------|
| Balance formula | deposits − withdrawals + realized − fees − swaps + … | `deposits − withdrawals + closed PnL (USD)` | ⚠️ Partial |
| Equity formula | balance + bonus + unrealized | `balance + bonus_balance + unrealized` (`2122`) | ✅ |
| Used margin | sum initial margins | Redis/DB aggregates, hedged/net modes | ✅ / ⚠️ engine omit `contract_size` |
| Free margin | equity − used (floor 0) | Same (`2123–2127`) | ✅ |
| Margin level | (equity ÷ used) × 100; ∞ if used = 0 | Same + `"inf"` (`2129–2133`) | ✅ |
| Order check field | Free margin | Redis `free_margin` / DB fast path (`512–540`) | ✅ |
| Order rejection | insufficient margin | **403** `INSUFFICIENT_FREE_MARGIN` (`53–60`); not the string `"InsufficientMargin"` | ⚠️ Code name differs; behavior OK |
| Units | account currency (USD) | Intended USD for summary; **UNCERTAIN** for `required_margin` if quote ≠ USD | ⚠️ |

---

## 11. UI vs backend consistency

- **Numeric fields:** Bottom Dock uses **`accountSummary`** from API/WS **without recomputing** equity or free margin (only **formatting** via `useFormatFromUsd` / `useFormatSignedFromUsd`, `BottomDock.tsx:171–172`).
- **`marginLevel === 'inf'` → forced `$0.00` margin display:** Still in **`BottomDock.tsx:840`, `1653`** and shared **`formatAccountSummary.ts:24–27`**. Backend sets `inf` only when `margin_used == 0` (`2129–2133`), so normally consistent.
- **Equity tooltip text** understates bonus (`1652`) vs backend (`2122`).

---

## 12. Non-cTrader features

| Feature | Respect in math? | Notes |
|---------|------------------|-------|
| **Bonus** (`wallets.bonus_balance`, locked via `bonus_locked`) | ✅ In equity (`2122`); not in balance (`2120`) | `lock_margin` allocates required margin cash-first then bonus (`bonus_service.rs:276–277`) |
| **Bonus loss absorbed** | ✅ In closed PnL sum | `sum_closed_realized_pnl_usd` uses `pnl + bonus_loss_absorbed` (`165`) |
| **Multi wallet types** | Spot USD only in these queries | `wallet_type = 'spot'` (`2113–2114`, `609`, `1217`) — **margin / funding wallets ignored** in this summary path |
| **Net vs hedged margin** | ✅ | `margin_calculation_type` user field (`2035–2041`, `1226–1234`) |

---

## Audit metadata

- **Read-only:** no application code was modified; this file was added as the deliverable.
- **Residual UNCERTAINTIES:** (1) whether all live symbols are USD/USDT-quoted for margin comparison; (2) whether `size` in API already embeds `contract_size`; (3) whether fees/swaps are posted into `transactions` types not included in balance queries.
