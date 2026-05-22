# BottomDock tick-driven re-render fix

## Problem

`BottomDock` subscribed with `usePriceStream(positionSymbols)`, which updates a React `Map` on every price tick. That forced the entire dock (positions, orders, history UI, dialogs) to re-render at tick rate. A render-time `console.log` in the open-positions table path flooded the console.

## Debug logging removed

### `src/features/terminal/components/BottomDock.tsx`

- **Removed** `console.log(\`📋 Rendering ${openPositions.length} open position(s) in positions tab\`)` (previously inside the desktop positions `tbody` render path).
- **Removed** `console.log` in `fetchFilledOrders` (filled-order dump and “loaded” success line).
- **Removed** high-frequency `console.log` on WebSocket `onmessage` for non-tick types (the `if (data.type !== 'pong' && data.type !== 'tick')` branch was deleted entirely).

### `src/shared/ws/wsClient.ts`

- **Removed** four `console.log` lines in `subscribe()` (handler add/remove counts).

## Price subscription change

### Before

```ts
const { prices: livePrices } = usePriceStream(positionSymbols)
```

`openPositionsWithComputed` depended on `[positions, livePrices]`, coupling the whole component to every tick.

### After

```ts
usePriceStreamConnection(positionSymbols)
```

- Parent **only** keeps the data-provider / gateway subscription for open-position symbols.
- **No** `livePrices` / `Map` in `BottomDock` state.

## Row-level live prices and PnL

### New file: `src/features/terminal/components/BottomDockOpenPositionRows.tsx`

- **`BottomDockDesktopOpenPositionRow`** — `memo` row; calls `useSymbolPrice(normalizeSymbolKey(pos.symbol))`, derives bid/ask mark and `openPositionPnlParts` inside the row so ticks re-render **only** that row’s subtree.
- **`BottomDockMobileOpenPositionCard`** — same pattern for the mobile position card (current price line, PnL, expanded breakdown).

### New file: `src/features/terminal/components/BottomDockCloseProfitableLive.tsx`

- **`BottomDockLiveProfitablePresence`** — invisible `PositionNetReporter` children per open position; calls `onHasProfitableChange(boolean)` **only** when the set of positions with positive net PnL changes (not on every tick). Used to disable “Close only profitable positions” in the mobile overflow menu without tick-churning `BottomDock`.
- **`BottomDockCloseProfitableOnlyDialogBody`** — dialog title/description/actions; per-position `useSymbolPrice` + `openPositionPnlParts`; `profitableCount` state updates only when profitability **membership** changes; confirm reads current profitable ids from a ref at click time.

### `BottomDock.tsx` data flow

- **`sortedOpenPositions`** — `useMemo` over `positions` (OPEN, sorted by time); replaces `openPositionsWithComputed` for counts and iteration.
- **`mobileFilteredOpenPositions`** — search filter over `sortedOpenPositions`.

## Smoke test (manual)

**Not run in the agent environment** (no live terminal + browser session here).

**Automated checks run:** `npx tsc --noEmit` (pass), `npm run test` / vitest (pass).

**Suggested manual verification:**

1. Dev terminal, console open, ≥1 open position.
2. Confirm **no** flood of “Rendering N open position(s)” or wsClient handler-count logs.
3. Confirm positions **Current** column and **P&L** (desktop + mobile) still animate with ticks.
4. React Profiler: `BottomDock` should not commit every tick; row/cell components may.

**If the console still floods:** other surfaces still using `usePriceStream(...)` with a full `prices` map include e.g. `UserDetailsModal.tsx` and `UserPositionsPage.tsx` (grep the repo for `usePriceStream`).
