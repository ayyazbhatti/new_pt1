# Position / order table display fixes (AUDCAD follow-up)

Display-only corrections from `docs/audcad-margin-pnl-mismatch-diagnostic.md`. **No backend or DB changes; no change to stored sizes, margins, or prices.**

## Bug B — FX lots rounded away

**Symptom:** e.g. `0.0050752` lots showed as `0.01` lots because `volumePrecision` (often 2) was applied via `toFixed(precision)`.

**Fix:** In `src/shared/finance/sizeFormat.ts`, the **FX-only** branch formats lots with **four fixed decimals** (`formatFxLotsForDisplay`: `lots.toFixed(4)`), so `507.52` base units on `100000` contract → **`0.0051 lots`**.

Indices / metals / commodities lots still use `volumePrecision` (unchanged).

## Bug C — Margin labeled as USD while value is in quote currency

**Symptom:** Margin like `49.26` (CAD for AUDCAD) was passed through `useFormatFromUsd`, which treats the number as **USD** and converts to display currency — wrong label and wrong conversion.

**Fix:** Use existing **`useFormatConverted()`** (`formatConv`): interpret margin as **`posQuote`** (quote currency from `resolveQuoteCurrency`) and convert to the user’s display currency — same pattern as wallet amounts in quote.

**Files:** `BottomDockOpenPositionRows.tsx` (desktop margin column, mobile expanded “Margin” line). Removed unused `formatMoney` prop from row components.

## Bug D — Instrument prices shown as currency (`$0.71`)

**Symptom:** Entry / current / SL / TP used `formatConv` or `Intl` currency style, so FX quotes looked like dollar amounts.

**Fix:** New **`formatSymbolPrice`** in `src/shared/finance/priceFormat.ts`: formats with `symbol.pricePrecision` (fallback `digits`, then **2**), **no currency symbol** — e.g. `0.98518`.

**Symbol meta:** `SymbolMeta` in `sizeFormat.ts` gained `quoteCurrency`, `pricePrecision`, `digits`. `useSymbolMetaLookup` maps `quoteCurrency` and `pricePrecision` from the symbols API.

**Terminal:** `BottomDockOpenPositionRows`, `BottomDock.tsx` (position history entry/exit, order history avg price), `TerminalHistoryView.tsx` (closed position prices, filled order line).

**Admin:** `PositionsTable.tsx` (entry, mark, SL, TP), `OrdersTable.tsx` (limit price column). **Margin** in admin table still uses `useFormatFromUsd` (admin semantics unchanged).

## Tests

- `src/shared/finance/sizeFormat.test.ts` — FX lots expectations updated; AUDCAD near-zero case added.
- `src/shared/finance/priceFormat.test.ts` — `formatSymbolPrice` precision and fallbacks.

## Smoke test (manual)

Not run in CI in this pass. Suggested:

1. Open AUDCAD micro-lot position — size shows **`0.0051 lots`** (or four decimals), not `0.01`.
2. Margin column matches display currency after FX conversion from quote.
3. Entry/current show **5 dp** style quotes without `$`.
4. BTC / stock rows still look correct (crypto/stock paths unchanged in `formatPositionSize`).

## Related UX

Order-ticket **confirmation dialog** (separate work) addresses size **input** verification; this doc covers **table display** only.
