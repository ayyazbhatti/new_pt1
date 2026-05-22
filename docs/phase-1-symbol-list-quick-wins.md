# Phase 1 — Symbol list performance quick wins

**Goal:** Stop remapping the full symbol catalog and re-rendering the whole list on every price tick. **Scope:** frontend only (no backend / WS protocol / Redis).

## Summary of changes (by file)

### 1. `src/features/terminal/pages/AppShellTerminal.tsx`

- **`mapSymbolToTerminal`** now accepts `prices: Map<...> | null`. When `null`, static defaults (`numericPrice` / `numericPrice2` / `price` / `price2` as zeros / `$0.00`); live values come from row-level `useSymbolPrice` via `PriceCell`.
- Replaced **`usePriceStream(symbolCodes)`** with **`usePriceStreamConnection(symbolCodes)`** so the shell does not hold a React `Map` that changes every tick.
- Catalog effect runs **only** when `symbolsData` changes (no `priceMap` dependency):

```144:150:src/features/terminal/pages/AppShellTerminal.tsx
  // Catalog / metadata only — not on every tick
  useEffect(() => {
    if (symbolsData?.items) {
      const mappedSymbols = symbolsData.items.map((symbol) => mapSymbolToTerminal(symbol, null))
      setSymbols(mappedSymbols)
    }
  }, [symbolsData, setSymbols])
```

- **Resubscribe guard** after 3s if connected but no snapshot in the module cache: `hasCachedPriceForAnySymbol(symbolCodes)` + `triggerResubscribe()` (replaces the old `priceMap.size` check).
- **Document title** uses **`useSymbolPrice(selectedSymbol?.priceLookupKey || selectedSymbol?.code)`** so the title updates with ticks without depending on `selectedSymbol.numericPrice`.

### 2. `src/features/symbols/hooks/usePriceStream.ts`

- Added **`hasCachedPriceForAnySymbol(symbols: string[])`** (export) for the terminal resubscribe path.
- **`useSymbolPrice`:** removed high-frequency **`console.log`** calls on subscribe, tick, and cleanup (kept a single `console.warn` for empty symbol).

### 3. `src/features/terminal/store/terminalStore.ts`

- **`setSymbols`:** still re-points `selectedSymbol` to the matching row when the **catalog** array is replaced (metadata sync on refetch). This no longer runs on every tick because `setSymbols` is no longer invoked per tick. Comment updated to clarify intent (`stillExists` branch).

### 4. `src/features/terminal/components/PriceCell.tsx` (new)

- Memoized **`PriceCell`**: calls **`useSymbolPrice(feedSymbol)`** and renders **`PriceDisplay`** with formatted bid/ask from precision.

### 5. `src/features/terminal/components/PriceDisplay.tsx`

- Wrapped implementation in **`React.memo`** (`export const PriceDisplay = memo(PriceDisplayImpl)`).

### 6. `src/features/terminal/components/LeftSidebar.tsx`

- Replaced bulk **`useTerminalStore()`** with **per-field selectors** + **`useShallow((s) => s.getFilteredSymbols())`** for the symbol list.
- Replaced inline **`PriceDisplay`** with **`<PriceCell feedSymbol={symbol.priceLookupKey ?? symbol.code} />`**.

### 7. `src/features/terminal/components/TerminalSymbolsPage.tsx`

- Same **selector + `useShallow` + `PriceCell`** pattern as the sidebar.

### 8. `src/features/terminal/components/RightTradingPanel.tsx`

- **`useSymbolPrice(selectedSymbol?.priceLookupKey || selectedSymbol?.code)`** with **`liveBidNum` / `liveAskNum` / `liveBidStr` / `liveAskStr`** for all trading math and LIVE QUOTE UI.
- **`liveQuoteSpreadFormatted`** now takes explicit bid/ask numbers and optional raw strings for FX spread decimals.

### 9. `src/features/terminal/components/ChartTradingStrip.tsx` & `ChartPlaceholder.tsx`

- Both read live bid/ask via **`useSymbolPrice`** so chart strip orders and chart overlays stay correct after store prices stop updating every tick.

### 10. `src/shared/ws/wsClient.ts`

- Removed the **`data.type === 'tick'`** `console.log` (high-frequency main-thread noise). *Note:* other verbose `wsClient` logs remain; they are not tick-specific.

---

## Verification

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | **Pass** |
| `npm run test` (Vitest) | **Pass** (existing suite) |
| React DevTools Profiler (manual) | **Not run in this environment** — expected: frequent commits on **`PriceCell` / `PriceDisplay`**; **`LeftSidebar` / `TerminalSymbolsPage` / `AppShellTerminal`** should not commit on each tick unless search/tab/symbols catalog changes. |

---

## Deviations from the prompt

1. **`setSymbols` + `selectedSymbol`:** The **`stillExists`** branch was **kept** so that after an admin **catalog refetch** the selected row points at the new `MockSymbol` instance (metadata). It **does not** run on every tick anymore because `setSymbols` is only called from the `symbolsData` effect.
2. **`hasCachedPriceForAnySymbol`:** Added a small exported helper so the “empty prices after 3s → resubscribe” behavior works without a React `priceMap`.
3. **`wsClient`:** Only the **tick** log was removed per scope; other per-message logs still exist and could be gated in a later pass.

---

## Phase 2 — Virtualization (estimate)

- **Dependency:** `@tanstack/react-virtual` is already in `package.json`; the terminal list is still a full **map over all filtered rows** in `LeftSidebar` / `TerminalSymbolsPage`.
- **Effort:** ~**1–2 days** to virtualize the scroll regions, preserve section headers / favourites UX, and regression-test keyboard focus + session badges. **Unlock:** thousands of DOM rows without mounting **N** `useSymbolPrice` subscribers at once (today ~280 rows = ~280 subscribers, which is acceptable for Phase 1 but not for 5k+).

---

## Profiler smoke test (expected vs before)

**Before:** `AppShellTerminal` `useEffect` depended on `priceMap` → **O(symbols)** `setSymbols` + `LeftSidebar` full tree on almost every tick.

**After:** Ticks flow **`priceStreamClient` → `notifySubscribers` → `useSymbolPrice` listeners** in **`PriceCell`** (and other `useSymbolPrice` call sites). List parents should only re-render when **filtered symbol list** or **non-price store fields** they select actually change (mitigated further by **`useShallow`** on `getFilteredSymbols()`).
