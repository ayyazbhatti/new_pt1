# Phase 5 — Currency wire-up

Monetary UI uses the central `src/shared/currency/` hooks (`useFormatFromUsd`, `useFormatSignedFromUsd`, `useFormatConverted`, `useFormatAmount`) per the Phase 5 brief. **Do not** convert LIVE QUOTE BID/ASK, spread, candle prices, order **size** (base), free-margin **% slider math**, or instrument **quote** execution prices where those are native to the symbol.

## Formatter entry points — see Phase 6

| File | Role |
|------|------|
| `src/shared/utils/currency.ts` | Legacy non-hook `formatCurrency` → `formatAmount` (`@/shared/currency/format`). **Kept.** |
| ~~`src/features/leverageProfiles/utils/format.ts`~~ | **Removed in Phase 6** — importers use `@/shared/currency/format` directly. |
| `src/features/adminTrading/pages/AdminTradingPage.tsx` | Hooks from `@/shared/currency` (no local `formatCurrency`). |
| `src/features/admin/transactions/pages/AdminTransactionsPage.tsx` | Same. |

## Phase 5 continuation — completed

### Section 1 — Terminal (first pass + handoff)

- `RightTradingPanel.tsx` — Est. margin in cost breakdown + related margin toasts/strings; **Fees** row in cost breakdown uses `formatMoney` (USD fee basis); empty-symbol notional hint uses `formatMoney(0)` instead of a hardcoded `USD` string; LIVE QUOTE / spread / ticket size / slider math untouched.
- `ChartTradingStrip.tsx` — Est. margin + insufficient-funds toasts.
- `LeftSidebar.tsx` — Balance, equity, margin, P/L vs balance, balance toasts.
- `TerminalHistoryView.tsx` — Snapshot cards (balance, realized, equity, free margin), closed PnL signed; filled order **execution** prices remain quote-native.
- `TerminalAccountView.tsx` — Balance, equity, margin.
- `PaymentPanel.tsx` — Deposit history via `useFormatConverted(amount, item.currency)`.
- `TerminalPositionsView.tsx` — Mobile positions tab header **UnR Net PNL** via `useFormatSignedFromUsd` (body still reuses `BottomDock`, unchanged per skip list).

### Section 2 — User panel (continuation)

- `UserDashboardPage.tsx` — Stat cards: `useFormatFromUsd` (replaced local `fmtUsd`).
- `UserDepositPage.tsx` — Balance + history rows (`useFormatConverted` per row `currency`); min/max **limits** stay labeled in **USD** (`fmtUsdLimit`); input still USD with `$` adornment; optional `≈ … in your currency` preview when `displayCurrencyCode !== 'USD'`.
- `UserWithdrawPage.tsx` — Withdrawable balance from `useAccountSummary` + `useFormatFromUsd`.
- `UserAffiliatePage.tsx` — Commission history rows: `useFormatConverted(c.amount, c.currency)` (API rows carry `currency`). Stat totals: sum + `formatConverted(…, commissions[0].currency)` (same as legacy single-currency assumption).

### Section 3 — Admin trading (continuation)

- `OrdersAdminPanel.tsx` — **No change**: mock list has no USD account columns; limit/market/stop **prices** stay instrument-native (no `$`).
- `PositionsAdminPanel.tsx` — PnL → `useFormatSignedFromUsd`; margin used → `useFormatFromUsd`; entry/mark/liquidation stay numeric quote display.
- `modals/PositionDetailsModal.tsx` — PnL signed, margin converted; entry/mark/liquidation unchanged (quote).
- `modals/EventDetailsModal.tsx` — Account snapshot (equity, margin, free margin, maintenance) → `useFormatFromUsd`. _(There is no `components/EventDetailsModal.tsx`; only the modal under `modals/`.)_
- `components/OrderDetailsModal.tsx` — Removed misleading `$` prefix on **limit/average price** (quote-native).
- `components/PositionDetailsModal.tsx` — Same as modal + store-driven: PnL/margin converted; quote prices without `$`.
- `LivePnlCell.tsx` — `LivePnlAmountCell` → `useFormatSignedFromUsd`.
- `TradingStatsCards.tsx` — “Total exposure” → `useFormatFromUsd(totalExposure)` (replaces `$/MM` shortcut).

### Earlier Phase 5 pass (do not redo)

BottomDock, UsersTable, UserDetailsModal (+ override), finance panels/modals, dashboard + charts, BulkDepositSection, ManagerDetailPage, NotificationsPanel — per original Phase 5 list.

## Needs decision / follow-up

1. **`TradingStatsCards` “Total exposure”** — `sum(size × markPrice)` mixes instruments (e.g. EURUSD vs BTCUSDT notional). Showing it via `useFormatFromUsd` treats the sum as USD; confirm product definition (USD notional only, per-symbol breakdown, or hide).
2. **`UserAffiliatePage` commission totals** — If the API ever returns **mixed `currency`** on rows, summing amounts then formatting with the first row’s currency is wrong; needs per-currency subtotals or backend USD totals.
3. ~~**`CurrencyOverrideProvider` on admin order/position modals**~~ — **Deferred (Phase 6 Option A):** no `displayCurrency` on DTOs yet; modals stay on admin effective currency until API + types support per-user override. See `docs/phase-6-currency-cleanup.md`.
4. ~~**`MarginEventsAdminPanel` list + `PositionsTable`**~~ — **Done in Phase 6:** account columns use `useFormatFromUsd`; quote prices no longer prefixed with `$`.

## Smoke tests

Not executed here (no live auth/session). **Manual:** set user `display_currency` to EUR; confirm terminal dock/sidebar/history/account + deposit/dashboard/affiliate + admin trading touched surfaces show €; LIVE QUOTE, order prices, and USD deposit **input** behavior per spec.

## Build verification

Latest run (after `TerminalPositionsView` + `RightTradingPanel` fee/notional polish):

```text
$ cd /Users/mab/new_pt1 && npx tsc --noEmit 2>&1; echo "exit:$?"
exit:0
```

Earlier continuation: **Section 1** / **Section 2** / **Section 3** each ended with `npx tsc --noEmit` exit code **0** (no TypeScript diagnostics).
