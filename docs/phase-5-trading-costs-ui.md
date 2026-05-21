# Phase 5 — Trading costs UI

User-facing and admin UI for swap/fee accumulators, wallet transactions, first-swap notifications, and bottom-dock account math tooltips. Backend/API work is Phase 4; this phase is **frontend-only** (plus notification copy in `NotificationsPanel`).

## `PositionPnLBreakdown`

**File:** `src/shared/components/PositionPnLBreakdown.tsx`

- **`PositionPnLBreakdown`:** Renders **Net P&L** (headline) and optional lines for **Market P&L**, **Swap**, and **Fees**. Accumulated swap/fees from the API are positive when they are a cost to the user; the UI shows them as a negative P&L impact via `formatSigned(-swap)` / `-fees`.
- **`openPositionPnlParts` / `closedPositionPnlParts`:** Shared math for terminal and admin. See file header comment for open vs closed semantics.

## Wire-up locations

| Surface | File | Behavior |
|--------|------|----------|
| Terminal open positions (mobile) | `BottomDock.tsx` | Expanded row shows **P&L breakdown** via `PositionPnLBreakdown`. List column shows **net** unrealized P&L. |
| Terminal open positions (desktop) | `BottomDock.tsx` | Chevron in **P&L** column toggles a detail row (`colSpan={12}`) with the same breakdown. Main row still opens edit on click. |
| Terminal position history | `BottomDock.tsx` | **Net** P&L in table (market − costs). Chevron expands a row with breakdown. |
| Mobile History tab | `TerminalHistoryView.tsx` | Closed positions: net in header; expand chevron reveals breakdown. |
| Admin position detail | `PositionDetailsModal.tsx` | Section **P&L breakdown** under the main grid; engine P&L labeled **PnL (engine)**. |

## Open positions: net P&L in lists

`openPositionsWithComputed` in `BottomDock.tsx` now uses `openPositionPnlParts` so the quoted P&L matches **net** (market minus accrued swap/fees), including **Close only profitable** and mobile cards.

## Transaction history (`fee` / `swap`)

- **Shared:** `src/shared/finance/transactionPresentation.ts` — labels/subtitles from `methodDetails`.
- **Shared UI:** `src/shared/components/TradingTransactionTypeDisplay.tsx` — icon + primary label + subtitle for `fee` and `swap`.
- **Admin:** `FinanceTransactionsPanel.tsx`, `FinanceOverviewPanel.tsx` — type column and signed amounts for fee/swap; filter options include swap where applicable.
- **Admin user funding table:** `UserDetailsModal.tsx` — same type/amount pattern as finance panels.
- **Admin transaction detail:** `TransactionDetailsModal.tsx` — **Trading cost** card for `fee` / `swap` with subtitle + JSON meta.

## Notifications

**File:** `src/features/terminal/components/NotificationsPanel.tsx`

- **`notificationDisplayMessage`:** For `meta.kind === 'swap_first_charge'` or `kind === 'SWAP_FIRST_CHARGE'`, with `amount_usd` (or parsed amount), shows: *Overnight financing of … was accrued on your {symbol} position. It will be settled when the position closes.*
- **Badge:** `SWAP_FIRST_CHARGE` maps like other system kinds; short label **Swap**.

**Types:** `src/shared/ws/wsEvents.ts` — `NotificationPushPayload.kind` includes `'SWAP_FIRST_CHARGE'`.

## Bottom dock tooltips

**File:** `BottomDock.tsx` — bottom stats bar hover copy updated for:

- **Balance** — deposits, withdrawals, closed P&L, fees at placement, swap on close.
- **Equity** — `Balance + Bonus + Unrealized P&L` with multiline explanation aligned to wallet math.
- **Free margin** — `Equity − Margin Used` and “available to open new positions”.
- **UnR Net P&L** — net on open positions (market minus accrued swap; fees already in balance).

Tooltip portal uses `max-w-xs`, `whitespace-pre-line`, and `text-left` so multiline strings render correctly.

## Visual smoke test

Not run in this environment (no live terminal session). Recommended manual check:

1. User with fees + swap: open position → confirm dock P&L matches net; expand breakdown (mobile + desktop).
2. After rollover: first-swap notification wording; transaction list shows `fee` / `swap` rows where applicable.
3. Close position: position history shows net P&L + breakdown; admin position modal shows breakdown.

## `tsc`

Run from repo root:

```bash
npx tsc --noEmit
```

Fix any reported issues before merge.
