# Fix: Free Margin % slider leverage mismatch

**Status:** Superseded — the Free Margin % slider was removed from the terminal; this note documents the attempted fix only.

## Root cause

The slider sized orders using **`finalLev = effLev ?? fallbackLeverage`**. When `symbolLeverage?.tiers` was still **unloaded**, `resolveEffectiveLeverageFromTiersOrNull` returned **`null`**, so the client used **`fallbackLeverage`** (~user max, e.g. **100×**). The server’s `POST /v1/orders/estimate` → `compute_order_margin_details` resolves **`effective_leverage`** from **real DB tiers** (e.g. **25×** for that notional). Same base `size` → **~4×** higher `required_margin` vs the client’s implied target (`freeMargin × slider%`).

Symptom: slider at **25%** produced Est. margin ≈ **100%** of free margin.

## Changes (only `RightTradingPanel.tsx`)

### 1. Gate — disable slider until tiers exist

- Introduced **`isSliderHardDisabled`**: same logic as the old `isSliderDisabled` (free margin, symbol, executable bid/ask).
- **`tiersReady`**: `symbolLeverage?.tiers` is a non-empty array.
- **`isSliderDisabled`**: `isSliderHardDisabled || !tiersReady`.

The slider UI stays non-interactive until tiers load, avoiding leverage guesses without tier data.

### 2. Context `useEffect` — do not clear `sliderPct` while waiting on tiers

The previous effect treated **`isSliderDisabled`** (including “no tiers”) as “reset slider to `null`”.

That cleared the slider whenever tiers were missing. It now uses **`isSliderHardDisabled`** for the reset branch and for **`becameEnabled`**, so **waiting for tiers does not wipe `sliderPct`**.

### 3. Guard — `applyFreeMarginFromPct`

At the top of `applyFreeMarginFromPct`:

- Return if **`!symbolLeverage?.tiers?.length`** (cannot mirror server leverage).
- Use **`isSliderHardDisabled`** instead of **`isSliderDisabled`** for the free-margin / symbol guard so the function can run once tiers exist even if the full slider UI was previously “soft” disabled for tiers only.

`useCallback` dependencies now include **`symbolLeverage`** (whole object).

### 4. Leverage resolution (no blind `userMax` as tier substitute)

- Tier rows are passed through **`coerceSymbolLeverageTiers`** so snake_case and camelCase API shapes both resolve.
- Initial leverage: **`resolveEffectiveLeverageFromTiersOrNull(notionalForLev, …) ?? getEffectiveLeverage(…, fallbackLeverage)`** — avoids returning early when the probe resolves but **only** after coercion; `getEffectiveLeverage` matches the auth helper used elsewhere and uses the same tier walk before any default.
- A **short refinement loop** then sets `lev` from `resolve(targetMarginUsd * lev, …)` until stable so leverage matches the **implied order notional** (same idea as the server picking a tier from actual notional).

The old **`effLev ?? fallbackLeverage`** alone (without tiers loaded) caused the ~4× margin bug; the old **strict `if (effLev == null) return`** after gating tiers caused the slider to **no-op** when resolve still returned null.

### 5. Re-apply when tiers load

- **`prevTiersLoadedRef`** tracks **`tiersReady`**.
- When **`tiersReady`** flips from false → true and **`sliderPct != null`**, call **`applyFreeMarginFromPct(sliderPct)`** so size updates from tier-accurate leverage.
- **`useEffect(() => { prevTiersLoadedRef.current = false }, [selectedSymbol?.code])`** so switching symbols always allows a fresh “tiers just loaded” transition for the new instrument.

### 6. Visual feedback

Below the “Free Margin %” label row, when the slider is disabled **only** because tiers are not ready (`isSliderDisabled && !isSliderHardDisabled && … && !tiersReady`), show: **“Loading leverage tiers…”**

## Smoke test

| # | Check | Result |
|---|--------|--------|
| 1 | `npx tsc --noEmit` | Pass (run in repo after change) |
| 2 | Slider disabled when `symbolLeverage?.tiers` null/empty | Implemented via `isSliderDisabled` |
| 3 | Slider enables when tiers load | `tiersReady` true |
| 4–7 | Est. margin ≈ slider × free margin; 100% ≈ full FM; symbol switch | **Manual** — confirm in terminal UI with a test user (not executed in this agent session) |

## Files touched

- `src/features/terminal/components/RightTradingPanel.tsx` — only file modified.
- `docs/fix-free-margin-slider-leverage-mismatch.md` — this note.
