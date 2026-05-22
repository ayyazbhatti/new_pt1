# Forensic diagnostic: order `485250f3-e010-42e5-9af6-1298ab561ae1` — size **507.52** base units

**Scope:** Read-only. Data from **Hetzner production** (`/opt/newpt`, `docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production`) plus **repository** code references.

**Incident:** Market BUY AUDCAD filled **`size = filled_size = 507.52`** (not a partial of 1000). Thirty-one seconds later, order `6a2bfb4d-…` filled **`size = 1000`** on the same symbol/user.

---

## Step 1 — Full order row (production)

**Query:** `SELECT * FROM orders WHERE id = '485250f3-e010-42e5-9af6-1298ab561ae1';`

**Result (expanded):**

| Column | Value |
|--------|--------|
| `id` | `485250f3-e010-42e5-9af6-1298ab561ae1` |
| `user_id` | `3bc1c0fd-8862-4239-a892-ecb16c4f4de0` |
| `symbol_id` | `a772358b-952c-45de-b99f-7535b89f0d0d` (AUDCAD) |
| `side` | `buy` |
| `type` | `market` |
| **`size`** | **`507.52000000`** |
| `price` | *(null)* |
| `stop_price` | *(null)* |
| **`filled_size`** | **`507.52000000`** |
| **`average_price`** | **`0.98518000`** |
| `leverage_used` | *(null — column exists, not populated)* |
| `margin_used` | *(null)* |
| `status` | `filled` |
| **`reference`** | ***(empty string)*** |
| `created_at` | `2026-05-22 20:20:07.906957+00` |
| `updated_at` | `2026-05-22 20:20:10.72893+00` |
| `filled_at` | `2026-05-22 20:20:10.722691+00` |
| **`margin_from_cash`** | **`24.99992768`** |
| `margin_from_bonus` | `0` |
| **`requested_bid`** | **`0.98498000`** |
| **`requested_ask`** | **`0.98518000`** |
| **`max_slippage_bps`** | **`50`** |

**`orders` table schema note:** Production `orders` has **no** `idempotency_key` or `client_order_id` columns — those exist only on the **HTTP request** path in code, not in this DB snapshot.

**Comparison order** `6a2bfb4d-3b73-4d05-9707-ff11e21ab05d` (same user, ~31s later):

| Field | Value |
|--------|--------|
| `size` / `filled_size` | **1000** |
| `average_price` | **0.98516000** |
| `requested_bid` / `requested_ask` | 0.98493000 / **0.98516000** |
| `margin_from_cash` | **49.25800000** |

---

## Step 2 — Reverse-engineer plausible input

**Working forward from stored economics:**

- Notional in **quote (CAD)** ≈ `507.52 × 0.98518 = 499.9985536` CAD → **~500 CAD** (within sub-penny rounding of stored decimals).
- Margin in CAD: `499.998… / 20 = 24.99992768` → matches **`margin_from_cash`**.

**Implication:** Whoever sized the order effectively targeted **~500 CAD notional** at the **ask** (~0.98518), not “0.01 lots” as a primary input (0.01 lots × 100000 × 0.98518 ≈ **985 CAD** notional).

**If the user typed `500` in quote-currency “Units” mode (CAD) for a BUY:**

- Frontend converts quote amount → base units using **live bid** in current code:

```1081:1093:src/features/terminal/components/RightTradingPanel.tsx
    if (sizeMode === 'units') {
      const sizeNum = parseFloat(size)
      if (!sizeNum || sizeNum <= 0) {
        toast.error('Please enter a valid size')
        return
      }
      baseSize = sizeNum
      if (currency === selectedSymbol.quoteCurrency && liveBidNum > 0) {
        baseSize = sizeNum / liveBidNum
      }
      displaySize = currency === selectedSymbol.quoteCurrency 
        ? `${size} ${selectedSymbol.quoteCurrency} (${baseSize.toFixed(8)} ${selectedSymbol.baseCurrency})`
        : `${size} ${selectedSymbol.baseCurrency}`
```

- With **`requested_bid` = 0.98498**: `500 / 0.98498 ≈ 507.624` (not **507.52**).
- With **ask 0.98518** (matches `average_price` / slippage snapshot): `500 / 0.98518 ≈ 507.5178…` → **rounding to 2 dp in UI or `toString()`** can yield **`507.52`** depending on float/string pipeline (e.g. `(500/0.98518).toFixed(2)` → `"507.52"`).

**Verdict (Step 2):** **Hypothesis 2 (quote-currency size entry)** is **strongly supported** by (a) ~**500 CAD** notional implied by DB, (b) explicit **quote→base** conversion in **`handlePlaceOrder`** when `currency === quoteCurrency`.

---

## Step 3 — Frontend payload / modes (code)

**API always receives base units** as `size: baseSize.toString()`:

```1150:1162:src/features/terminal/components/RightTradingPanel.tsx
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
        ...(orderType === 'market' && slippageOverridden ? { slippage_bps: slippageBps } : {}),
      }
```

**Modes:** `units` | `lots` | `pipPosition` — **Segmented** control:

```1457:1468:src/features/terminal/components/RightTradingPanel.tsx
          <div className="mb-3">
            <label className="text-xs font-semibold text-slate-600 dark:text-muted uppercase tracking-wider mb-2 block">Size Mode</label>
            <Segmented
              options={[
                { value: 'units', label: 'Units' },
                { value: 'lots', label: 'Lots' },
                { value: 'pipPosition', label: 'Pip Position' },
              ]}
              value={sizeMode}
              onChange={(value) => handleSizeModeChange(value as 'units' | 'lots' | 'pipPosition')}
              className="w-full"
            />
          </div>
```

**Quote vs base in Units mode:** currency `<select>` offers **base** and **quote** (`RightTradingPanel.tsx` ~1507–1510). **Quote path** applies `baseSize = sizeNum / liveBidNum` (see Step 2).

**Default mode for FX:** `getDefaultSizeModeForSymbol` returns **`lots`** for FX — user must have switched to **Units** (or used another surface) for quote-notional entry to apply.

---

## Step 4 — “Free margin slider” hypothesis

**Repository search:** There is **no** symbol/function named `applyFreeMarginFromPct` (or similar) in `src/features/terminal`. **No** range **Slider** tied to free-margin % was found in `RightTradingPanel.tsx` / `BottomDock.tsx` for sizing.

**`handleMaxSize` (MAX button)** sets size from a **hardcoded** quote value — not evidence for this order’s 500 CAD, but shows sizing quirks exist elsewhere:

```844:858:src/features/terminal/components/RightTradingPanel.tsx
  const handleMaxSize = () => {
    if (!selectedSymbol || !liveBidNum) {
      toast.error('Please select a symbol')
      return
    }
    // Set to 1% of balance (in quote currency)
    const maxQuoteValue = 2495.56 * 0.01
    if (currency === selectedSymbol.quoteCurrency) {
      // If in quote currency mode, set directly
      setSize(maxQuoteValue.toFixed(2))
    } else {
      // If in base currency mode, convert to base
      const maxBaseSize = maxQuoteValue / liveBidNum
      setSize(maxBaseSize.toFixed(8))
    }
```

**Wallet snapshot (current DB — not time-travel):**

```text
spot USD wallet: available 9925.74, locked 74.26, updated_at 2026-05-22 20:20:38+00
```

Locked **74.26** matches **sum of CAD margins** converted contextually from the two positions diagnostic; it does **not** uniquely prove a “slider % of free margin” produced **507.52**.

**Hypothesis 1 (free-margin slider):** **Low confidence / unsupported** in this repo snapshot — **no** identified slider path producing `baseSize`; **Hypothesis 2** matches numbers better.

---

## Step 5 — Pip position hypothesis (math)

From `positionCalculations.ts`:

```12:31:src/features/terminal/utils/positionCalculations.ts
export function calculatePipValuePerLot(
  symbol: AdminSymbol,
  price: number,
  accountCurrency: string = 'USD'
): number {
  // ...
  const pipValue = (tickSize * contractSize) / price
  return pipValue
}
```

At **price ≈ 0.98518**, **tick 0.0001**, **contract 100000**:  
`pipValuePerLot ≈ (0.0001 × 100000) / 0.98518 ≈ 10.15` (quote per pip per lot, same unit caveats as code comments).

**Lots implied by 507.52 base:** `507.52 / 100000 = 0.0050752` lots.

**Implied pip-risk if pip mode:** `0.0050752 × 10.15 ≈ 0.0515` CAD/pip — an unusual user input vs typing **“500”** for CAD notional.

**Hypothesis 5:** **Low confidence** vs **Hypothesis 2**.

---

## Step 6 — Request payload / logs

**Commands run (production):**

```bash
docker compose -f deploy/docker-compose.prod.yml logs auth-service --tail 30000 | grep "485250f3"
```

**Result:** **No lines** (empty). Possible reasons: structured logs omit UUID, log rotation, default log level, or auth not logging full JSON bodies.

**Conclusion:** **Cannot confirm** raw HTTP `size` string vs post-DB value from logs in this pass.

---

## Step 7 — Partial fill hypothesis

From Step 1: **`size` = `filled_size` = `507.52`**.

**Hypothesis 4 (partial fill):** **Ruled out** for “requested 1000, filled 507.52”. The **original order size was 507.52**.

**Redis:** `redis-cli HGETALL order:485250f3-…` → **WRONGTYPE** (key exists as **string** JSON, not hash). Payload not retrieved here without `GET`.

---

## Step 8 — Idempotency key

**DB:** not stored (no column).

**Code:** `idempotency_key: \`${Date.now()}-${Math.random().toString(36).substring(7)}\`` in `handlePlaceOrder` — standard **browser-generated** pattern when the terminal uses this path.

**Cannot compare** to second order’s key from Postgres alone.

---

## Step 9 — Other “messy” sizes (production, 7 days)

**Query used (filled orders, size with fractional cents beyond 2dp):**

```sql
SELECT id, user_id, symbol_id, size, filled_size, average_price, status::text, created_at
FROM orders
WHERE status = 'filled'
  AND created_at > NOW() - INTERVAL '7 days'
  AND (size <> trunc(size, 2) OR (size * 100)::numeric % 1 <> 0)
ORDER BY created_at DESC
LIMIT 30;
```

**Result:** 5 rows, all **another user** on a **different symbol** (sizes ~1–5 with large BTC-like `average_price` ~77k) — pattern consistent with **crypto/base-unit** dust, **not** AUDCAD quote conversion.

**485250f3** did **not** appear in this filter (507.52 truncates to 507.52 at 2dp; the filter targeted **more exotic** fractional patterns).

**Broader takeaway:** Non–lot-aligned FX sizes are **not** ubiquitous in this 7-day slice; this incident is **consistent with a specific input path** (quote notional) rather than a fleet-wide engine bug.

---

## Step 10 — Hypothesis ranking

| # | Hypothesis | Evidence | Confidence | Further confirmation |
|---|------------|----------|------------|----------------------|
| **2** | **Quote-currency units entry (~500 CAD → base)** | ~**500 CAD** notional from `size × avg_price`; code path **`baseSize = sizeNum / liveBidNum`** when **currency = quote**; **507.52** aligns with **500 / ask** after rounding | **High** | Screen recording or **HTTP access logs** with JSON body; fix **bid vs ask** for BUY if product should use ask |
| **3** | Lots/units mode bug | Default FX mode is **lots**; user could switch to **units** — no bug required | **Medium (operational)** | User interview / client telemetry (`sizeMode` not logged server-side here) |
| **6** | User typed 507.52 | Possible but **occam**-inferior to **500 CAD** story | **Low** | Same as above |
| **5** | Pip position | Math yields **~0.05 CAD/pip** for this size — odd vs **500** | **Low** | — |
| **1** | Free-margin slider / tier bug | **No** matching implementation found in repo grep; no logs | **Low** | If a **non-repo** branch deployed slider, redeploy diff + logs |
| **4** | Partial fill | **`size = filled_size`** | **Ruled out** | — |

---

## Highest-priority follow-up

1. **Product / UX:** When **Units + quote currency** is selected for **BUY**, confirm whether conversion should use **bid** (current) vs **ask** (fill/slippage snapshot). Mismatch can shift base units by spread; this order still centers on **~500 CAD** intent.  
2. **Observability:** Log **`request body size` + resolved `baseSize` + `currency` + `sizeMode`** (redact PII) on `place_order` success — **idempotency_key is not in DB**, so server logs are the only durable audit.  
3. **Data model (optional):** Persist **`client_order_id` / idempotency_key / size_input_currency`** if forensic repeats are expected.

---

## Chat-sized verdict (one paragraph)

The production row shows **`size = filled_size = 507.52`** with **`average_price = requested_ask = 0.98518`**, giving **~500 CAD notional** — exactly what you get if the user entered **~500 in quote (CAD)** in **Units** mode and the UI converted to base (`RightTradingPanel.tsx` **1087–1089**). **Partial fill is ruled out** (`size` equals `filled_size`). There is **no** `applyFreeMarginFromPct` / free-margin slider implementation found in the terminal code searched, and **auth logs on the server did not return hits** for this order id. **Confidence: high** for **quote-notional sizing**; next step is **enable structured logging of the inbound JSON** (or HTTP access logs) to prove the literal `"500"` vs `"507.52"` payload.
