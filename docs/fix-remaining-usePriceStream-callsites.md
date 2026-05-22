# Fix remaining `usePriceStream` Map subscriptions (admin + user panel + markup)

## Step 1 — Full codebase sweep (`usePriceStream(`)

Command: `grep -rn "usePriceStream(" src/ --include="*.tsx" --include="*.ts"`

| File | Line (approx.) | Pattern | Action |
|------|----------------|---------|--------|
| `src/features/symbols/hooks/usePriceStream.ts` | 41 | Hook definition | **Skip** (implementation) |
| `src/features/adminUsers/modals/UserDetailsModal.tsx` | was ~671 | `const { prices: livePrices } = usePriceStream(positionSymbols)` | **Migrate** |
| `src/features/userPanel/pages/UserPositionsPage.tsx` | was ~272 | `const { prices: livePrices } = usePriceStream(positionSymbols)` | **Migrate** |
| `src/features/adminMarkup/modals/ConfigureMarkupsModal.tsx` | was ~104 | `const { prices } = usePriceStream(symbolCodes)` | **Migrate** |

No other `usePriceStream(` callsites remained under `src/` after migration (only the hook definition).

**Already migrated (not in grep as `usePriceStream(`):** terminal surfaces per Phase 1 + BottomDock (`usePriceStreamConnection` + `useSymbolPrice` / `PriceCell`).

## Step 2 — Reference pattern (ground truth)

### Row memo + `useSymbolPrice` (BottomDock open positions)

From `BottomDockOpenPositionRows.tsx`: each desktop row is `memo`, normalizes the feed key, and calls `useSymbolPrice` so only that row’s subtree commits on tick.

```tsx
export const BottomDockDesktopOpenPositionRow = memo(function BottomDockDesktopOpenPositionRow({ ... }: BottomDockDesktopOpenPositionRowProps) {
  const feedKey = normalizeSymbolKey(pos.symbol)
  const tick = useSymbolPrice(feedKey)
  // ...
})
```

### Parent: connection only (BottomDock)

From `BottomDock.tsx`: parent keeps the symbol subscription alive without holding a per-tick `Map` in React state.

```tsx
usePriceStreamConnection(positionSymbols)
```

### Per-cell prices (LeftSidebar)

`LeftSidebar` renders `PriceCell` per row; `PriceCell` wraps `useSymbolPrice`:

```tsx
function PriceCellImpl({ feedSymbol, pricePrecision = 2, className }: PriceCellProps) {
  const key = feedSymbol?.trim() || null
  const price = useSymbolPrice(key)
  // ...
}
```

## Step 3 — Migrations (compressed)

### `UserDetailsModal.tsx`

- **Before:** `usePriceStream(positionSymbols)` + `livePrices` in `useMemo(metrics)` and inline in `openPositions.map` table body.
- **After:**
  - `usePriceStreamConnection(positionSymbols)` at modal scope.
  - `UserDetailsOpenPositionRow` (`memo`): current price + unrealized P&L via `useSymbolPrice(normalizeSymbolKey(pos.symbol))`.
  - `UserDetailsMetricsBar` (`memo`): `UserDetailsUnrealizedShard` per open position reports live unrealized into a ref; `useMemo` keyed by `[..., gen]` recomputes balance/equity/margin metrics without re-rendering the whole modal on every tick.
- **Stable handlers:** `handleOpenPositionRowModify` / `handleOpenPositionRowClose` (`useCallback`) passed into memo rows.

### `UserPositionsPage.tsx`

- **Before:** `livePrices` Map fed into `buildPositionColumns` and `totalUnrealizedPnl` → parent + column factory re-ran every tick.
- **After:**
  - `usePriceStreamConnection(positionSymbols)`.
  - `OpenPositionUnrealizedPnlCell` (`memo`) for table “Unrealized P/L” on open positions.
  - `UserPositionsOverviewSection` (`memo`): hidden `UserPositionUnrealizedOverviewShard` children + local tick counter for **aggregate** unrealized on the overview StatCard only (small subtree).

### `ConfigureMarkupsModal.tsx`

- **Before:** `prices` Map in `useMemo` column definitions → whole modal + column defs invalidated every tick.
- **After:** `usePriceStreamConnection(symbolCodes)` + memo cells: `MarkupLiveBidCell`, `MarkupLiveAskCell`, `MarkupBidAfterCell`, `MarkupAskAfterCell`, `MarkupPreviewSpreadCell` (spread uses a single `useSymbolPrice` per row).

## Debug logs

Searched `console.log` / `console.warn` / `console.debug` in the three migrated files: **none removed** (no render-time logs found).

## Step 4 — Verification

| Check | Result |
|--------|--------|
| `npx tsc --noEmit` | Pass |
| `npm run test` (vitest) | Pass (existing suite) |

## Smoke test (manual)

**Not executed in the agent environment** (no live admin session + browser).

Suggested checks:

1. Admin → Users → open user → **User Details**: metrics bar (unrealized / equity) and open positions table (Current, P&L) still update with ticks; React Profiler / console should not show whole-modal churn every tick.
2. User panel → **Positions**: overview unrealized + per-row unrealized column still live; page shell should stay calm.
3. Admin → Markup → **Configure markups**: live bid/ask and “after” columns still animate; modal chrome should not re-render at tick rate.

## Acceptance criteria

1. `tsc` passes.  
2. No remaining `usePriceStream(` **consumer** callsites under `src/` (only hook definition).  
3. Row/cell surfaces use `useSymbolPrice` and are wrapped in `memo` where extracted.  
4. No render-time `console.log` added; none were present to remove.  
5. Backend unchanged; terminal files unchanged in this pass.
