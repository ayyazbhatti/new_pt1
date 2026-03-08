# Admin Trading: Live PnL Column — Solution Design

## 1. Objective

Add a **Live PnL** column to the Admin Trading positions table that updates in real time as mark prices change, **without polling**. Updates must be event-driven (WebSocket or equivalent push).

---

## 2. Constraints

- **No polling:** No `setInterval`, `refetchInterval`, or periodic API calls for positions or prices.
- **Event-driven only:** Use WebSocket (or SSE) for real-time data.
- **Consistency:** PnL calculation must align with backend/terminal semantics (e.g. CFD-style: LONG = (mark − entry) × size, SHORT = (entry − mark) × size).

---

## 3. Architecture Context

| Component | Role |
|-----------|------|
| **Data provider** | Publishes ticks to Redis `price:ticks` (per-symbol, per-group marked-up prices). |
| **ws-gateway** | Subscribes to Redis `price:ticks`, forwards ticks to authenticated WebSocket clients (per user/group). |
| **priceStreamClient** | Frontend client that connects to gateway (or data-provider), subscribes to symbols, receives `tick` events with `symbol`, `bid`, `ask`. |
| **useAdminWebSocket** | Subscribes to `wsClient` for admin events (`admin.position.updated`, etc.). Already handles position updates with throttling. |
| **Admin positions API** | Returns positions with snapshot `markPrice`, `pnl`, `pnlPercent`. |

Live PnL can be achieved either by **pushing updated positions from the backend** or by **subscribing to prices on the frontend and computing PnL locally**. Both are event-driven and polling-free.

---

## 4. Option A — Backend Pushes Position Updates (with live mark / PnL)

**Idea:** Backend subscribes to Redis `price:ticks`. On each tick, for every open position in that symbol (and optionally group), compute updated `mark_price` and PnL, then publish `admin.position.updated` over the admin WebSocket with the new `markPrice` and `pnl` / `pnlPercent`.

**Pros**

- Single source of truth; frontend only displays what it receives.
- PnL formula and rounding live in one place (backend).
- Reuses existing `admin.position.updated` handling and throttling in `useAdminWebSocket`.

**Cons**

- One event per position per tick for that symbol (e.g. 50 positions on BTCUSDT ⇒ 50 events per tick). Needs throttling/batching or symbol-level summary events to avoid flooding.

**Backend changes (outline)**

- In auth-service (or a dedicated worker): subscribe to Redis `price:ticks`.
- On each tick: resolve open positions for that `(symbol, group_id)` (or symbol only if no group), compute `mark_price` (e.g. mid or side-appropriate price), then `pnl` and `pnl_percent` from your standard formula.
- Publish `admin.position.updated` (or a batched variant) over the admin WebSocket channel. Optionally throttle by position or by symbol (e.g. max one update per position per 100 ms).

**Frontend**

- No change to data flow: positions already updated via `useAdminWebSocket` and `upsertPosition`. Add a **PnL** column that displays `position.pnl` and `position.pnlPercent` (and optionally mark). No polling.

---

## 5. Option B — Frontend Subscribes to Price Stream; Computes PnL Locally (Recommended)

**Idea:** Admin trading page (or a dedicated hook) subscribes to the **price stream** for the set of symbols that appear in the current open positions. On each `tick` event, update a **live mark price** map (e.g. `symbol → mid or side-appropriate price`). In the table, for each position, use **live mark** when available to compute PnL; otherwise fall back to the snapshot `markPrice`/`pnl` from the positions API.

**Pros**

- One tick per symbol per update; minimal bandwidth and backend load.
- No backend changes required; reuses existing gateway + `priceStreamClient` (or equivalent).
- Subscription set is derived from visible positions and can be updated when positions list or filters change.

**Cons**

- PnL formula and rounding duplicated on frontend (must match backend for consistency).
- Requires managing subscription set (subscribe when new symbols appear, unsubscribe when no positions use a symbol).

**Data flow**

1. Admin loads positions via existing REST API → store has positions with snapshot `markPrice`, `pnl`, `pnlPercent`.
2. When positions (or filters) change, derive unique symbols from open positions and call `priceStreamClient.subscribe(symbols)`.
3. On each `tick`, update store (e.g. `liveMarkBySymbol[symbol] = mid` or side-appropriate price).
4. Positions table: for each row, if `liveMarkBySymbol[position.symbol]` is set, compute  
   `livePnl = side === 'LONG' ? (liveMark - entryPrice) * size : (entryPrice - liveMark) * size`,  
   and optionally `livePnlPercent = (livePnl / (marginUsed or notional)) * 100`.  
   Otherwise show snapshot `position.pnl` / `position.pnlPercent`.
5. When admin leaves the page or positions list becomes empty, call `priceStreamClient.unsubscribe(symbols)` to avoid unnecessary traffic.

**Frontend changes (outline)**

- **Store:** Add `liveMarkBySymbol: Record<string, number>` (and optionally a setter) to the admin trading store (or a small dedicated store for live prices).
- **Hook:** e.g. `useAdminTradingLivePrices(positionsArray)` that:
  - Derives `symbols = [...new Set(positionsArray.map(p => p.symbol))]`.
  - On mount / when `symbols` change: subscribe to `symbols`, and on each tick update `liveMarkBySymbol`.
  - On unmount (or when symbols shrink): unsubscribe removed symbols.
- **Positions table:** Add a **Live PnL** column that:
  - Reads `liveMarkBySymbol[position.symbol]`.
  - If present, computes and displays live PnL (and optionally %) using the same formula as backend; otherwise displays snapshot PnL.
- **Formula (align with backend):** e.g.  
  - `pnl = side === 'LONG' ? (mark - entryPrice) * size : (entryPrice - mark) * size`  
  - `pnlPercent = marginUsed > 0 ? (pnl / marginUsed) * 100 : 0`  
  (Exact formula and rounding should match auth-service/order-engine.)

---

## 6. Recommendation

- **Option B (frontend price subscription + client-side PnL)** is recommended for a first iteration: no backend changes, minimal events (one per symbol per tick), and clear separation of concerns. Document the PnL formula in one place (e.g. shared util) and reuse in both terminal and admin if needed.
- If later you need a single source of truth or server-side auditing of live PnL, Option A (backend pushes `admin.position.updated` with live mark/PnL) can be added and the frontend can switch to displaying only backend-provided PnL.

---

## 7. Implementation Checklist (Option B)

- [x] **Store:** Add `liveMarkBySymbol` (and setter) to admin trading store (or dedicated store).
- [x] **Hook:** Implement `useAdminTradingLivePrices(positions)` that subscribes to position symbols and updates `liveMarkBySymbol` on tick.
- [x] **PnL util:** Add shared `computePositionPnl(entryPrice, markPrice, size, side)` and `computePnlPercent(pnl, marginUsed)` matching backend semantics.
- [x] **Positions table:** Add **Live PnL** column: use live mark when available, else snapshot; format as currency and percentage.
- [x] **Cleanup:** Tick listener removed on unmount; symbols left subscribed so other parts of the app (e.g. terminal) are unaffected.
- [x] **No polling:** No `setInterval`/`refetchInterval`; all updates from WebSocket tick events only.

---

## 8. Files to Touch (Option B)

| Area | File(s) |
|------|--------|
| Store | `src/features/adminTrading/store/adminTrading.store.ts` |
| Hook | New: `src/features/adminTrading/hooks/useAdminTradingLivePrices.ts` (or extend `useAdminWebSocket` with price subscription) |
| Price client | `src/shared/ws/priceStreamClient.ts` (use existing `subscribe` / `onTick`) |
| PnL util | New: `src/features/adminTrading/utils/pnl.ts` or shared under `src/shared/utils/` |
| Table | `src/features/adminTrading/components/PositionsTable.tsx` (add Live PnL column) |
| Column widths | Update `COLUMN_WIDTHS` and `TABLE_MIN_WIDTH` in `PositionsTable.tsx` for new column |

---

## 9. Summary

- **Requirement:** Live PnL column, no polling.
- **Approach:** Use existing WebSocket price stream; subscribe to position symbols; compute PnL on the frontend from live mark price; display in a new column with fallback to snapshot PnL when no tick has arrived yet.

---

## 10. Implementation Status (Option B — Completed)

| Item | File(s) |
|------|--------|
| PnL util | `src/features/adminTrading/utils/pnl.ts` |
| Store | `src/features/adminTrading/store/adminTrading.store.ts` — `liveMarkBySymbol`, `setLiveMark`, `clearLiveMarks` |
| Hook | `src/features/adminTrading/hooks/useAdminTradingLivePrices.ts` — subscribes to position symbols, sets auth token, updates store on tick |
| Table | `src/features/adminTrading/components/PositionsTable.tsx` — **Live PnL** column after Mark; uses live mark when available |
| Page | `src/features/adminTrading/pages/AdminTradingPage.tsx` — calls `useAdminTradingLivePrices(positionsArray)` |

Updates are event-driven only (WebSocket ticks); no polling is used.
