# Positions display precision — platform-wide fix (B / C / D)

This document closes out the **display-only** issues described in `docs/audcad-margin-pnl-mismatch-diagnostic.md` for **all symbols**. Wallet math and backend calculations were already correct; the UI mislabeled or over-rounded values.

## The three bugs

| ID | Bug | Symptom | Example |
|----|-----|---------|---------|
| **B** | FX lots rounding | Sub–0.01 lots rounded to 2 decimals looked like `0.01 lots` | `507.52` AUD units on 100k contract → should show **`0.0051 lots`**, not `0.01` |
| **C** | Margin / P&amp;L currency | Values in **quote** currency were formatted as **USD** (`$`) | AUDCAD margin in **CAD** showed as `$24.99` |
| **D** | Instrument price formatting | `Intl` currency style forced **2 decimals + `$`** | Entry `1.08524` showed as **`$1.08`** |

## Shared helpers

### `formatSymbolPrice` — `src/shared/finance/priceFormat.ts`

- Formats bid/ask/entry/exit/mark using `pricePrecision` / `digits`.
- Returns a **plain numeric string** (no `$`). Uses `—` for null/invalid (UI convention in this codebase).

### `useFormatFromQuoteCurrency` — `src/shared/currency/hooks.ts`

- Thin alias of **`useFormatConverted`**: amount is in the symbol’s **quote** currency → user’s **effective display** currency via the same FX map as other UI (`1 USD = N units` per `FxRatesSnapshot`).

### `useFormatSignedFromQuoteCurrency`

- Wraps **`formatSignedConverted`** in `src/shared/currency/format.ts` for signed P&amp;L rows.

### `formatSignedAmount`

- Signs + formats a number **already** in a given ISO/display currency (used where totals were summed after `convertAmount`).

### FX lot display — `src/shared/finance/sizeFormat.ts`

- FX branch uses **`formatFxLotsForDisplay` → `lots.toFixed(4)`** (crypto / stocks unchanged).

### `PositionPnLBreakdown` — `src/shared/components/PositionPnLBreakdown.tsx`

- Optional **`quoteCurrency`**: when set, **market** and **net** lines use quote→display conversion; **swap** and **fees** stay USD-labeled (`accumulatedSwapUsd` / `accumulatedFeesUsd`).

## Callsite enumeration (Step 1) — migrated

| File | Area | Bug | Status |
|------|------|-----|--------|
| `BottomDock.tsx` | Closed row net P&amp;L, breakdown | C / D | Migrated (`formatSignedFromQuote`, breakdown `quoteCurrency`) |
| `BottomDockOpenPositionRows.tsx` | Open rows: margin, prices, unrealized, breakdown | B / C / D | Migrated |
| `BottomDockCloseProfitableLive.tsx` | Close-profitable dialog | — | No price/margin UI (logic only) — N/A |
| `TerminalHistoryView.tsx` | Closed P&amp;L + breakdown | C | Migrated |
| `PositionsTable.tsx` | Margin column | C | Migrated (`useFormatFromQuoteCurrency`) |
| `LivePnlCell.tsx` | Live P&amp;L amount | C | Migrated |
| `PositionsAdminPanel.tsx` | Entry / mark / margin / P&amp;L / liquidation | C / D | Migrated |
| `PositionDetailsModal.tsx` (admin store + modal) | Details | C / D | Migrated |
| `OrderDetailsModal.tsx` (×2) | Limit / avg / stop prices | D | Migrated (`formatSymbolPrice`) |
| `UserPositionsPage.tsx` | Overview totals, table columns | B / C / D | Migrated (converted overview; cell components) |
| `UserDetailsModal.tsx` | Open rows, closed rows, metrics unrealized/margin fallback | B / C / D | Migrated |
| `OrderConfirmationDialog.tsx` | Estimates in USD | — | Verified unchanged (`useFormatFromUsd` for estimates only) |

Additional files touched for plumbing: `src/shared/currency/format.ts`, `hooks.ts`, `index.ts`, `PositionPnLBreakdown.tsx`, `priceFormat.test.ts`, `priceFormat.ts` JSDoc.

## Tests

- `npx tsc --noEmit` — pass  
- `npm run test` (Vitest) — pass (`priceFormat.test.ts`, `sizeFormat.test.ts`)

## Smoke test (manual)

1. Open a mix of **AUDCAD**, **EURUSD**, **USDJPY**, **BTCUSDT**, and a **stock** position.
2. **FX lots**: 4 decimals on FX; crypto base units unchanged; stocks as integer/lot rules from `formatPositionSize`.
3. **Prices**: no `$` on instrument prices; EUR/AUD majors ~5 dp; JPY pairs ~3 dp where `pricePrecision` says so.
4. **Margin / floating P&amp;L**: shown in the user’s **display** currency with correct symbol, not raw quote numerals with `$`.
5. **Footer / account summary**: still sourced from backend USD-anchored summaries where applicable; row-level FX P&amp;L uses the same conversion convention as `convertAmount`.
6. **User positions overview**: exposure / margin / P&amp;L totals sum **after** per-row conversion to display currency (mixed-book sanity).

## Note

This intentionally does **not** change DB `volume_precision`, backend engines, or crypto/stock sizing rules beyond display.

Closes the AUDCAD investigation’s **UI** issues **platform-wide** when combined with earlier BottomDock row work.
