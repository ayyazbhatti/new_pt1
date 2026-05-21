# Free Margin % slider — bug diagnostic (read-only)

**Status:** The Free Margin % slider was **removed** from the terminal order ticket; this document is retained for historical context only.

**Symptom (reported):** Free margin ≈ $200; slider at **25%**; **Est. margin** ≈ $200 (≈100% of free margin). Expected margin ≈ **$50** (25% of free margin). Reproducible across symbols.

**Scope:** Frontend sizing path in `RightTradingPanel.tsx`, server margin in `POST /v1/orders/estimate` → `compute_order_margin_details` (auth-service). No code fixes in this document.

---

## Step 1 — Locate the slider

**File:** `src/features/terminal/components/RightTradingPanel.tsx`

1. **Slider JSX** — `<input type="range" …>` with `min={1}`, `max={100}`, `step={1}`:

```1439:1458:src/features/terminal/components/RightTradingPanel.tsx
                  <input
                    type="range"
                    min={1}
                    max={100}
                    step={1}
                    value={sliderPct == null ? 1 : Math.round(sliderPct * 100)}
                    onChange={handleFreeMarginSliderChange}
                    disabled={isSliderDisabled}
                    className={cn(
                      // h-6 gives vertical room so the thumb can sit centered on the track (h-2 alone clips/misaligns the thumb).
                      'h-6 w-full cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed',
                      '[&::-webkit-slider-runnable-track]:h-2 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-slate-300 dark:[&::-webkit-slider-runnable-track]:bg-white/10',
                      '[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:-mt-1 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-emerald-500 [&::-webkit-slider-thumb]:shadow-none',
                      '[&::-moz-range-track]:h-2 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-slate-300 dark:[&::-moz-range-track]:bg-white/10',
                      '[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:box-border [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-emerald-500',
                      isSliderDisabled && 'pointer-events-none opacity-50'
                    )}
                    list={freeMarginTicksListId}
                    aria-label="Allocate percent of free margin to order size"
                  />
```

2. **State for slider position** — `sliderPct` is stored as a **fraction in (0, 1]** (e.g. `0.25` = 25%). When disabled/unknown it is `null`. Default constant is `0.15` (15%).

```217:220:src/features/terminal/components/RightTradingPanel.tsx
  /** Free Margin % slider: null when disabled or unknown; default 15% when symbol/side context applies. */
  const [sliderPct, setSliderPct] = useState<number | null>(null)
  /** Default % of free margin used for slider + size on new symbol/side (or when slider becomes enabled). */
  const DEFAULT_FREE_MARGIN_SLIDER_PCT = 0.15
```

Display confirms fraction × 100: `` `${Math.round(sliderPct * 100)}%` `` (see line 1436 in same file).

3. **onChange handler** — `handleFreeMarginSliderChange`: reads **1–100** from the DOM, divides by 100, updates `sliderPct`, then calls `applyFreeMarginFromPct(pct)`.

```525:533:src/features/terminal/components/RightTradingPanel.tsx
  const handleFreeMarginSliderChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const intPct = parseInt(e.target.value, 10)
      if (!Number.isFinite(intPct) || intPct < 1 || intPct > 100) return
      const pct = intPct / 100
      setSliderPct(pct)
      applyFreeMarginFromPct(pct)
    },
    [applyFreeMarginFromPct]
  )
```

**Conclusion Step 1:** There is **no** 0–100 vs 0–1 bug in the handler itself (`intPct / 100` is correct).

---

## Step 2 — Trace size calculation (slider → `size` → base units)

### 2a. `applyFreeMarginFromPct` (core slider math)

```465:511:src/features/terminal/components/RightTradingPanel.tsx
  /** Apply free-margin % to size input (same math as range input). */
  const applyFreeMarginFromPct = useCallback(
    (pct: number) => {
      if (!(pct > 0 && pct <= 1)) return
      const fm = accountSummary?.freeMargin
      if (fm == null || fm <= 0 || !selectedSymbol || isSliderDisabled) return
      const execPrice = previewOrderSide === 'BUY' ? selectedSymbol.numericPrice2 : selectedSymbol.numericPrice
      if (!Number.isFinite(execPrice) || execPrice <= 0) return
      const targetMarginUsd = fm * pct
      const userMin = meData?.minLeverage ?? 1
      const userMaxRaw = meData?.maxLeverage ?? 100
      const fallbackLeverage = Math.max(userMin, Math.min(userMaxRaw, 500))
      const notionalForLev = targetMarginUsd * fallbackLeverage
      const effLev = resolveEffectiveLeverageFromTiersOrNull(
        notionalForLev,
        symbolLeverage?.tiers ?? null,
        meData?.minLeverage,
        meData?.maxLeverage
      )
      const finalLev = effLev ?? fallbackLeverage
      const notional = targetMarginUsd * finalLev
      const rawSize = notional / execPrice
      // ... optional notional cap from top tier ...
      const baseSize = Number(cappedSize.toFixed(6))
      if (currency === selectedSymbol.quoteCurrency) {
        const quoteSize = baseSize * execPrice
        setSize(quoteSize.toFixed(2))
      } else {
        setSize(String(baseSize))
      }
    },
```

| Step | Variable | Formula (as coded) | Inputs |
|------|-----------|-------------------|--------|
| A | `pct` | From slider: `intPct / 100` | DOM 1–100 |
| B | `fm` | — | `accountSummary?.freeMargin` from **`useAccountSummary()`** (see Step 5) |
| C | `execPrice` | BUY → `numericPrice2`, SELL → `numericPrice` | `selectedSymbol`, `previewOrderSide` |
| D | `targetMarginUsd` | `fm * pct` | Intended **initial margin** budget in USD terms |
| E | `fallbackLeverage` | `max(userMin, min(userMaxRaw, 500))` | `meData?.minLeverage`, `meData?.maxLeverage` |
| F | `notionalForLev` | `targetMarginUsd * fallbackLeverage` | Used **only** to call `resolveEffectiveLeverageFromTiersOrNull` |
| G | `finalLev` | `effLev ?? fallbackLeverage` | `symbolLeverage?.tiers` from **`getSymbolLeverage`** query |
| H | `notional` | `targetMarginUsd * finalLev` | Intended position **notional** (USD) if margin ≈ notional/leverage |
| I | `rawSize` / `baseSize` | `notional / execPrice` (then optional cap) | Base units before quote conversion |
| J | `setSize` | If quote currency: `quoteSize = baseSize * execPrice`; else base string | `currency` vs `selectedSymbol.quoteCurrency` |

**Free margin field:** `accountSummary?.freeMargin` only — not `equity`, not `balance`, not `useWalletStore`.

### 2b. `sizeCalculations.currentUnits` (what `/estimate` receives)

```323:346:src/features/terminal/components/RightTradingPanel.tsx
  const sizeCalculations = useMemo(() => {
    const symbolForCalc = getSymbolForCalculations()
    if (!symbolForCalc || !selectedSymbol || selectedSymbol.numericPrice <= 0) {
      return {
        pipValuePerLot: 0,
        currentLotSize: 0,
        currentUnits: 0,
        currentPipPosition: 0,
      }
    }

    const price = selectedSymbol.numericPrice
    const pipValuePerLot = calculatePipValuePerLot(symbolForCalc, price, pipPositionCurrency)

    let currentLotSize = 0
    let currentUnits = 0
    let currentPipPosition = 0

    if (sizeMode === 'units') {
      const sizeNum = parseFloat(size) || 0
      currentUnits = sizeNum
      if (currency === selectedSymbol.quoteCurrency && price > 0) {
        currentUnits = sizeNum / price
      }
```

- **Base-currency mode:** `currentUnits = parseFloat(size)` — matches `setSize(String(baseSize))` from slider path.
- **Quote-currency mode:** `currentUnits = sizeNum / price` where **`price` is always `selectedSymbol.numericPrice`** (bid side for typical feeds), while `applyFreeMarginFromPct` used **`execPrice`** (ask for BUY, bid for SELL). For **BUY + USDT quote**, this can **inflate** `currentUnits` vs the strict ask-based base count by roughly **ask/bid** (usually small for liquid pairs; **not** a clean 4× unless prices are wrong).

---

## Step 3 — Est. margin: hook, request body, response field, JSX

**Hook:** `useQuery` in `RightTradingPanel.tsx` (not a separate `useOrderEstimate` hook). `queryFn` calls `estimateOrderMargin` from `../api/orders.api`.

```560:591:src/features/terminal/components/RightTradingPanel.tsx
  /** Server-side margin (same as place_order). Uses Redis execution price + risk::effective_leverage. */
  const canEstimateServerMargin =
    !!selectedSymbol &&
    Number.isFinite(sizeCalculations.currentUnits) &&
    sizeCalculations.currentUnits > 0 &&
    (orderType === 'market' || (orderType === 'limit' && limitPrice.trim() !== ''))

  const {
    data: serverMarginEstimate,
    isFetching: isEstimatingServerMargin,
    isError: isMarginEstimateError,
  } = useQuery({
    queryKey: [
      'v1',
      'orderMarginEstimate',
      selectedSymbol?.code,
      sizeCalculations.currentUnits,
      orderType,
      limitPrice,
      previewOrderSide,
    ],
    queryFn: () =>
      estimateOrderMargin({
        symbol: selectedSymbol!.code,
        side: previewOrderSide,
        orderType: orderType === 'limit' ? 'LIMIT' : 'MARKET',
        size: String(sizeCalculations.currentUnits),
        limitPrice: orderType === 'limit' && limitPrice.trim() ? limitPrice : undefined,
      }),
    enabled: canEstimateServerMargin,
    staleTime: 2000,
  })
```

**Request body** (`src/features/terminal/api/orders.api.ts`): POST `/v1/orders/estimate` with JSON `symbol`, `side`, `orderType`, `size`, optional `limitPrice`. **`size` is `String(sizeCalculations.currentUnits)`** (base units).

```162:174:src/features/terminal/api/orders.api.ts
export async function estimateOrderMargin(
  payload: EstimateOrderMarginRequest
): Promise<EstimateOrderMarginResponse> {
  return http<EstimateOrderMarginResponse>('/v1/orders/estimate', {
    method: 'POST',
    body: JSON.stringify({
      symbol: payload.symbol,
      side: payload.side,
      orderType: payload.orderType,
      size: payload.size,
      limitPrice: payload.limitPrice,
    }),
  })
}
```

**Displayed margin:** `parsedServerMarginUsd` from `serverMarginEstimate.requiredMargin`, else `fallbackMarginUsd`; combined as `estMarginDollars`.

```685:721:src/features/terminal/components/RightTradingPanel.tsx
  const parsedServerMarginUsd = useMemo(() => {
    const s = serverMarginEstimate?.requiredMargin
    if (s == null || s === '') return null
    const n = parseFloat(s)
    return Number.isFinite(n) ? n : null
  }, [serverMarginEstimate?.requiredMargin])

  const fallbackMarginUsd = useMemo(() => {
    if (!selectedSymbol) return null
    const limitPx =
      orderType === 'limit' && limitPrice.trim() !== '' ? parseFloat(limitPrice) : Number.NaN
    const limitExecutionPrice = Number.isFinite(limitPx) && limitPx > 0 ? limitPx : null
    return clientMarketFallbackMarginUsdOrNull({
      bid: selectedSymbol.numericPrice || 0,
      ask: selectedSymbol.numericPrice2 || selectedSymbol.numericPrice || 0,
      side: previewOrderSide,
      baseUnits: sizeCalculations.currentUnits,
      tiers: symbolLeverage?.tiers,
      userMin: meData?.minLeverage,
      userMax: meData?.maxLeverage,
      orderType: orderType === 'limit' ? 'LIMIT' : 'MARKET',
      limitExecutionPrice,
    })
  }, [
    selectedSymbol,
    previewOrderSide,
    sizeCalculations.currentUnits,
    symbolLeverage?.tiers,
    meData?.minLeverage,
    meData?.maxLeverage,
    orderType,
    limitPrice,
  ])

  /** Resolved margin: server estimate when valid, else strict client fallback (no 2% guess). */
  const estMarginDollars: number | null =
    parsedServerMarginUsd != null ? parsedServerMarginUsd : fallbackMarginUsd
```

**JSX (Est. margin line):**

```1754:1761:src/features/terminal/components/RightTradingPanel.tsx
              <div className="flex justify-between items-center py-1 border-b border-slate-200 dark:border-white/5">
                <span className="text-slate-600/90 dark:text-muted/80">Est. Margin</span>
                <span className="font-semibold text-accent inline-flex items-center gap-1.5">
                  {isEstimatingServerMargin && canEstimateServerMargin && estMarginDollars == null ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-600 dark:text-muted shrink-0" />
                  ) : null}
                  {estMarginDollars == null ? '—' : formatMoney(estMarginDollars)}
                </span>
              </div>
```

**Server mirror:** `compute_order_margin_details` uses Redis bid/ask for MARKET, `notional = size * execution_price`, `eff_lev = effective_leverage(...)`, `required_margin = notional / eff_lev`.

```302:342:backend/auth-service/src/routes/orders.rs
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

Rust tier algorithm: `crates/risk/src/effective_leverage.rs` (`effective_leverage`).

---

## Step 4 — Manual numeric trace ($200 free margin, 25% slider, BTC ~$77,500)

**Assumptions for illustration:** `pct = 0.25`, `fm = 200` → `targetMarginUsd = 50`. User max leverage fallback **100** (default `meData?.maxLeverage ?? 100`). Execution price **77,500** (ask for BUY).

### Intended chain (if client leverage == server leverage == L)

1. Slider 25% → `pct = 0.25`.
2. `targetMarginUsd = 200 × 0.25 = 50`.
3. `notional = 50 × L`. If `L = 100`, `notional = 5,000`.
4. `rawSize = 5,000 / 77,500 ≈ 0.064516` BTC.
5. `POST /v1/orders/estimate` with `size ≈ "0.064516"` → server `notional ≈ 5000`, `required_margin ≈ 5000 / 100 = 50`.

### Where the reported **~$200** margin comes from (matches **4×**)

Server: `required_margin = notional_client / eff_lev_server`.

If the **client oversized notional by 4×** *or* the **server applies ¼ the leverage** the client assumed when building notional:

- Example A — **leverage mismatch only:** Client uses `finalLev = 100` so `notional = 50 × 100 = 5000`. Server resolves **`eff_lev = 25`** for that notional → `required_margin = 5000 / 25 = 200`. **Ratio 100/25 = 4** → exactly the reported error scale.

- Example B — **units sent 4× too large:** If `sizeCalculations.currentUnits` is **4×** `rawSize` (e.g. quote/bid bug with bad bid, or other conversion), server notional quadruples → margin quadruples.

**Slider math lines 473–485 are internally self-consistent for “target margin = fm × pct”** *given* `finalLev`. The failure mode above is **not** “forgot to divide slider by 100”; it is **downstream leverage or unit mismatch** between:

- **Leverage used to build `notional`** (`finalLev` from `resolveEffectiveLeverageFromTiersOrNull` + fallback), and  
- **Leverage server uses** (`risk::effective_leverage` on DB tiers + Redis execution notional), and/or  
- **`currentUnits` vs the base size implied by the slider** (quote mode + bid vs ask).

---

## Step 5 — Wallet / account summary / store

| Source | Role on this page |
|--------|-------------------|
| `useAccountSummary()` | **Only** source for `freeMargin` in slider math (`fm`), insufficient-margin checks, toasts. Fetches `GET /api/account/summary` via `fetchAccountSummary` (`src/features/wallet/api.ts`). |
| WebSocket `account.summary.updated` | `useAccountSummary` merges into React Query cache (`useAccountSummary.ts`). |
| `useWalletStore` (`src/shared/store/walletStore.ts`) | **Not imported** in `RightTradingPanel.tsx` — slider does **not** read this store. |
| `WalletBalanceResponse` / `fetchBalance` | Not used by the slider path in this file. |

**“Free margin: $200” in terminal chrome:** `BottomDock` / `TerminalHistoryView` also use **`accountSummary.freeMargin`** from the same hook pattern — **same field family** as the slider, not a second legacy wallet endpoint for that label (see `BottomDock.tsx` grep for `formatMoney(accountSummary.freeMargin)`).

**Residual risk:** If **another** UI showed free margin from a different source, that would be a discrepancy; for `RightTradingPanel` + `BottomDock`, the diagnostic shows **one** summary source.

---

## Step 6 — Git history (recent touches to `RightTradingPanel.tsx`)

```text
06011b8 feat: terminal light theme polish, notifications, settings, and ops docs
7782451 Dev: Postgres 5434, WS gateway resilience, BottomDock loading
b7c6dc4 deploy: order margin estimate API, terminal cost breakdown, order-engine, data-provider
738fe2f feat: show provider symbol description in terminal details
e6091db feat: add full MMDPS integration and terminal symbol/data-provider updates
2e70629 Order-engine: JetStream acks, tick fallback; deploy scripts, Docker log limits, migrations & UI updates
18c063c Chart tab: mobile trading strip, Positions search & bulk actions, theme fixes
e795dc5 Mobile terminal: Quotes/Positions/History tabs, symbol dropdown search, pinch-zoom disable, Account reorder
8a65106 Terminal promotion slider: admin UI, API, carousel in right panel
8d7e6d1 chore: admin markup modals, account summary WS, liquidation verification, position/engine fixes
ec0cb52 Fix terminal symbol live data: data-provider HTTP port, GET /prices, CORS, JWT_SECRET in root .env
58322b5 feat: margin calculation type, trading access, friendly error messages
903de76 Admin Swap: dynamic API, backend CRUD, free margin slider
efca3e5 Fix frontend load: single account summary fetch, API proxy, deposit timing
0ced8c1 Fix /ws-health 404 and WS error noise: proxy order, Balance from wallet, Equity/Margin from account summary
5ecd5b9 Block order when Est. Margin > Free Margin (server + client)
518fe51 Account summary fixes, Core API PlaceOrderCommand, Margin Level UI, server scripts
23c3326 Leverage by exposure: tiers + user min/max, UI indicators
c4fac63 Symbol leverage & leverage tiers in trading panel; persist collapse state
fa8774d Terminal: chart live bid updates + promo carousel
```

**Notable:** `903de76` introduced the **free margin slider**; `b7c6dc4` / `23c3326` / `c4fac63` introduced **margin estimate API** and **tiered leverage** — interactions between **tier resolution on the client** (`resolveEffectiveLeverageFromTiersOrNull` + **fallback**) and **Rust `effective_leverage`** are the highest-signal area for a **4×** margin error.

---

## Step 7 — Summary

### End-to-end path (slider → Est. margin)

1. **Slider DOM** → `handleFreeMarginSliderChange` → `pct ∈ (0,1]`.  
2. **`applyFreeMarginFromPct(pct)`** → `targetMarginUsd = accountSummary.freeMargin * pct` → `notional = targetMarginUsd * finalLev` → `setSize(...)`.  
3. **`sizeCalculations`** → `currentUnits` (quote mode divides by **`numericPrice`** only).  
4. **`useQuery`** → `estimateOrderMargin({ …, size: String(sizeCalculations.currentUnits) })` → `/v1/orders/estimate`.  
5. **`estMarginDollars`** ← `requiredMargin` (or client fallback) → **Est. Margin** JSX.

### Primary bug hypothesis (best fit to **4×**)

**Client assumes a higher `finalLev` when building `notional` than the server’s `effective_leverage` for the actual order notional** — classic pattern: `finalLev = 100` (e.g. `resolveEffectiveLeverageFromTiersOrNull` returned **`null`** and **`effLev ?? fallbackLeverage`** used user max), while the server resolves **`eff_lev = 25`** for the resulting `notional`, yielding `required_margin = notional / 25` = **4×** `notional / 100`. The suspect lines are **`finalLev = effLev ?? fallbackLeverage`** and **`notional = targetMarginUsd * finalLev`** together with **tiers being `null`/unresolved on the client** when the server has real tiers.

**Secondary hypothesis (stale sizing):** `symbolLeverage?.tiers` arrives **after** the first `applyFreeMarginFromPct` / default-slider effect; the **context-keyed** `useEffect` (lines 536–558) may **not** re-apply the slider when only `applyFreeMarginFromPct`’s identity changes, leaving **size** sized with **fallback** leverage while the estimate query later uses **loaded** tiers — same leverage mismatch class.

**Tertiary hypothesis (BUY + quote units):** `applyFreeMarginFromPct` sizes with **`execPrice` (ask for BUY)**; `sizeCalculations` converts quote → base with **`numericPrice` (bid)** only — usually a **tiny** spread skew; only explains **large** errors if bid/ask are inconsistent or `numericPrice` is wrong.

### Recommended fix (concept only — no patch here)

1. **Single source of truth for leverage:** Drive slider notional from the **same** tier + user min/max resolution the server uses (`risk::effective_leverage`), or call a small **“preview leverage for notional”** endpoint, or reuse the **estimate** response iteratively — avoid **`effLev ?? fallbackLeverage`** overshooting when tiers are missing or notional-for-tier is wrong.  

2. **Re-run `applyFreeMarginFromPct(sliderPct)` when `symbolLeverage` tiers transition from empty → loaded** (or debounce until tiers exist) so size is not stuck on fallback leverage.  

3. **Align quote→base conversion** with the same execution side (`bid`/`ask`) used for sizing and for the server MARKET leg.

---

## Appendix — `applyFreeMarginFromPct` guard

```467:468:src/features/terminal/components/RightTradingPanel.tsx
    (pct: number) => {
      if (!(pct > 0 && pct <= 1)) return
```

If `pct` were ever passed as **25** instead of **0.25**, this would **return without updating** (not the reported “full margin” symptom). The reported bug is therefore **not** this guard misfiring with raw 0–100 values on the internal API of `applyFreeMarginFromPct` (the handler already divides by 100).
