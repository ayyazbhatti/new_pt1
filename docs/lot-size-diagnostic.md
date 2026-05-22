# Lot size / unit display — read-only diagnostic

**Date:** 2026-05-22  
**Scope:** Repo + migration/schema sources only. Live PostgreSQL was not available (`DATABASE_URL` unset in this environment), so **Step 1** uses `information_schema`-equivalent knowledge from SQL migrations and checked-in schema files, not a running DB sample.

---

## Step 1 — Schema inspection (`symbols` size-related columns)

### Live SQL

The requested queries were not executed against a database here. To reproduce locally:

```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'symbols'
  AND (column_name ILIKE '%lot%'
       OR column_name ILIKE '%contract%'
       OR column_name ILIKE '%size%'
       OR column_name ILIKE '%units%'
       OR column_name ILIKE '%step%');
```

### What the codebase shows

| Column / concept | Present in repo schema? | Notes |
|------------------|-------------------------|--------|
| `lot_size` | **No** | `rg lot_size` across the repo returns **no matches**. There is no `lot_size` column in migrations reviewed. |
| `contract_size` | **Yes** | `database/schema.sql`, `database/migrations/0005_symbols_schema.sql` (new-table branch), `backend/auth-service` models/queries. |
| `lot_min`, `lot_max` | **Yes** | `database/schema.sql` lines 170–171; auth `Symbol` model `lot_min` / `lot_max`. |
| `min_size`, `step_size` | **Legacy / alternate** | `infra/migrations/001_initial_schema.sql` defines `min_size`, `step_size` on an older `symbols` shape; newer canonical schema in `database/schema.sql` uses `contract_size` + lot bounds instead. |
| `volume_precision` | **Yes** | Migrations + `AdminSymbol` / auth-service. |

**Representative definitions**

```19:21:infra/migrations/001_initial_schema.sql
    min_size DECIMAL(20, 8) NOT NULL,
    step_size DECIMAL(20, 8) NOT NULL,
    price_tick DECIMAL(20, 8) NOT NULL,
```

```159:171:database/schema.sql
CREATE TABLE symbols (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255),
    market market_type NOT NULL,
    base_currency VARCHAR(10) NOT NULL,
    quote_currency VARCHAR(10) NOT NULL,
    digits INTEGER NOT NULL DEFAULT 2,
    tick_size NUMERIC(20, 8) NOT NULL DEFAULT 0.01,
    contract_size NUMERIC(20, 8) NOT NULL DEFAULT 1,
    price_precision INTEGER NOT NULL DEFAULT 2,
    lot_min NUMERIC(20, 8) NOT NULL DEFAULT 0.01,
    lot_max NUMERIC(20, 8),
```

```91:96:database/migrations/0005_symbols_schema.sql
            volume_precision INTEGER NOT NULL DEFAULT 2,
            contract_size NUMERIC(20, 8) NOT NULL DEFAULT 1,
            is_enabled BOOLEAN NOT NULL DEFAULT true,
            trading_enabled BOOLEAN NOT NULL DEFAULT true,
            leverage_profile_id UUID NULL REFERENCES leverage_profiles(id) ON DELETE SET NULL,
```

### Sample row query (`EURUSD`, `BTCUSDT`, …)

Not run without DB. **Expectation from schema:** `contract_size` and `lot_min`/`lot_max` are **per-row configurable**; forex seeds/mocks often use large `contract_size` (e.g. 100000) vs crypto (1). Admin UI + `admin_symbols_service` expose `contract_size` for editing.

---

## Step 2 — Frontend lot/unit helpers (`positionCalculations.ts`)

**File:** `src/features/terminal/utils/positionCalculations.ts`

There is **no** function named `formatSizeForDisplay`; display helpers are `formatLotSize` and `formatUnits`.

### Functions (signatures & symbol fields)

| Function | Reads from `AdminSymbol` | Role |
|----------|---------------------------|------|
| `calculatePipValuePerLot` | `tickSize`, `contractSize`, `assetClass` | Pip value; defaults tick 0.0001 and contract 100000 for `FX`. |
| `normalizeLotSize` | `volumePrecision`, `lotMin`, `lotMax` | Rounds/clamps lots. |
| `calculateLotSizeFromPipPosition` | (via above) | Pip $ → lots. |
| `calculateUnitsFromLots(lots, symbol)` | `contractSize`, `assetClass` | `units = lots * contractSize`; default contract 100000 if unset and `FX`, else 1. |
| `calculateLotsFromUnits(units, symbol)` | same + `normalizeLotSize` | `units / contractSize` then normalized. |
| `normalizeVolumeInUnits` | (via lots helpers) | Units → lots → units (snap to lot grid). |
| `formatLotSize`, `formatUnits` | `volumePrecision` | String formatting; `formatUnits` uses K/M suffix for large values. |

**Raw excerpts**

```94:116:src/features/terminal/utils/positionCalculations.ts
export function calculateUnitsFromLots(lots: number, symbol: AdminSymbol): number {
  if (lots <= 0) return 0

  const contractSize = parseFloat(symbol.contractSize) || (symbol.assetClass === 'FX' ? 100000 : 1)
  return lots * contractSize
}

export function calculateLotsFromUnits(units: number, symbol: AdminSymbol): number {
  if (units <= 0) return 0

  const contractSize = parseFloat(symbol.contractSize) || (symbol.assetClass === 'FX' ? 100000 : 1)
  if (contractSize === 0) return 0

  const lotSize = units / contractSize
  return normalizeLotSize(lotSize, symbol)
}
```

### `grep` hits under `src/features/terminal/` (lot / contract / calculate*)

- `RightTradingPanel.tsx`: imports and uses `calculateUnitsFromLots`, `calculateLotsFromUnits`, `formatLotSize`, `formatUnits`, `contractSize: '1'` in fallback `AdminSymbol`.
- `positionCalculations.ts`: all definitions above.
- No other terminal files import these conversion helpers (repo-wide grep: only `RightTradingPanel` + `positionCalculations`).

---

## Step 3 — Order ticket input mode (`RightTradingPanel.tsx`)

### Size input

- **Primary visible path today:** a single numeric **“Size”** field in **units mode** (base vs quote chosen by adjacent currency `<select>`). Step `0.000001`.
- **`sizeMode` state:** `'units' | 'lots' | 'pipPosition'`, default from localStorage or **`'units'`**.

```200:201:src/features/terminal/components/RightTradingPanel.tsx
  const [sizeMode, setSizeMode] = useState<'units' | 'lots' | 'pipPosition'>(() => loadTradingPanelState().sizeMode || 'units')
```

### Lots / Pip UI — **disabled in production flag**

```50:51:src/features/terminal/components/RightTradingPanel.tsx
/** When true, only Units size mode is shown; Lots and Pip Position are hidden (set to false to show them again). */
const SHOW_ONLY_UNITS_SIZE_MODE = true
```

Effects:

- Size mode `Segmented` (Units / Lots / Pip Position) is **not rendered** when `SHOW_ONLY_UNITS_SIZE_MODE` is true.
- Lots and Pip Position inputs are gated behind `!SHOW_ONLY_UNITS_SIZE_MODE`.

```1311:1326:src/features/terminal/components/RightTradingPanel.tsx
          {/* Size Mode Selector - hidden when only Units is shown */}
          {!SHOW_ONLY_UNITS_SIZE_MODE && (
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
          )}
```

### What gets sent to the API

Margin estimate and (by same path) place order use **`sizeCalculations.currentUnits`** as the server `size` string — i.e. **base units after conversion from quote if user selected quote currency**, not “lots” as the wire format.

```497:503:src/features/terminal/components/RightTradingPanel.tsx
    queryFn: () =>
      estimateOrderMargin({
        symbol: selectedSymbol!.code,
        side: previewOrderSide,
        orderType: orderType === 'limit' ? 'LIMIT' : 'MARKET',
        size: String(sizeCalculations.currentUnits),
```

(Place order uses the same `currentUnits` path in the same file — see `size: String(sizeCalculations.currentUnits)` in the submission block around the `placeOrder` call.)

### Default on first render

- `sizeMode`: `'units'` unless overridden by `localStorage` key `trading-panel-state`.
- **Lots mode cannot be chosen in UI** while `SHOW_ONLY_UNITS_SIZE_MODE === true`.

---

## Step 4 — Position & history displays

### `BottomDock.tsx` — positions tab

Open positions: **`sizeNum.toFixed(6)`** in desktop table; mobile card **`sizeNum.toFixed(8)`**. Raw `pos.size` parse — **no lot conversion, no “shares” label**.

```1244:1244:src/features/terminal/components/BottomDock.tsx
                          <td className="px-4 py-3 text-text font-medium">{sizeNum.toFixed(6)}</td>
```

```996:996:src/features/terminal/components/BottomDock.tsx
                              <span className="font-bold text-text ml-1">{sizeNum.toFixed(8)}</span>
```

Orders tab: shows **`order.size`** as returned (string), no formatting helper.

```1431:1431:src/features/terminal/components/BottomDock.tsx
                      <td className="px-4 py-3 text-text font-medium">{order.size}</td>
```

Position history rows: **`sizeNum.toFixed(6)`** from `pos.size` / `original_size`.

```1651:1651:src/features/terminal/components/BottomDock.tsx
                          <td className="px-4 py-3 text-text font-medium">{sizeNum.toFixed(6)}</td>
```

### `TerminalHistoryView.tsx` (mobile)

Closed positions: **`sizeNum.toFixed(4)`** next to symbol/side — raw units.

```321:339:src/features/terminal/components/TerminalHistoryView.tsx
              {filteredClosedPositions.map((pos) => {
                const sizeVal = (pos.status === 'CLOSED' || pos.status === 'LIQUIDATED') && pos.original_size ? pos.original_size : pos.size
                const sizeNum = parseFloat(sizeVal || '0')
                ...
                        <div className="text-sm font-medium text-text">
                          <span className="font-mono">{pos.symbol}</span>
                          <span className="ml-1 font-bold">{pos.side === 'LONG' ? 'Buy' : 'Sell'}</span>
                          <span className="ml-1 font-bold">{sizeNum.toFixed(4)}</span>
                        </div>
```

Filled orders: **`filledSize.toFixed(4)`**.

```403:413:src/features/terminal/components/TerminalHistoryView.tsx
                const filledSize = parseFloat(order.filled_size || order.size || '0')
                ...
                          <span className="ml-1 font-bold">{filledSize.toFixed(4)}</span>
```

### Admin trading — `PositionsTable.tsx` / `PositionsAdminPanel.tsx`

```149:152:src/features/adminTrading/components/PositionsTable.tsx
        accessorKey: 'size',
        header: 'Size',
        cell: ({ row }) => (
          <span className="text-sm font-mono text-text">{row.original.size.toLocaleString()}</span>
```

### Admin — `ClosePositionModal.tsx`

Uses **`position.size.toLocaleString()`** for full close label and max placeholder — still **numeric position size from API**, not lots.

```69:86:src/features/adminTrading/components/ClosePositionModal.tsx
              <SelectItem value="full">Full Close ({position.size.toLocaleString()})</SelectItem>
...
              placeholder={`Max: ${position.size.toLocaleString()}`}
```

### Admin — `PositionDetailsModal.tsx`

```91:93:src/features/adminTrading/modals/PositionDetailsModal.tsx
          <div>
            <div className="text-xs text-text-muted mb-1">Size</div>
            <div className="font-mono text-text">{position.size}</div>
          </div>
```

### Terminal user “Close position” confirmation (`BottomDock.tsx`)

Dialog text is **position id only** — **no size shown** in the confirmation copy.

```1999:2005:src/features/terminal/components/BottomDock.tsx
            <Dialog.Title className="text-lg font-semibold text-text mb-2 flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-danger" />
              Close Position
            </Dialog.Title>
            <Dialog.Description className="text-sm text-slate-600 dark:text-muted mb-6">
              Are you sure you want to close position {closePositionId}? This action cannot be undone.
            </Dialog.Description>
```

---

## Step 5 — Asset-class-aware logic for **size display**

### `grep` results (as requested)

- `asset_class` / `assetClass` in `src/features/terminal/` and `src/shared/`: **only** pip/spread and symbol listing — **not** used to choose “lots vs shares vs coins” for size columns.
  - `positionCalculations.ts`: defaults for FX vs non-FX **contract/tick**.
  - `RightTradingPanel.tsx`: `isForexTerminalSymbol` for **quote digit formatting**, not size labels.
  - `TerminalSymbolsPage.tsx`, `symbolCategories.ts`, `AppShellTerminal.tsx`, `terminalFeedSymbol.ts`: watchlist / feed behavior.

- **`isForexSymbol` / `isCryptoSymbol` / `isStockSymbol`:** **no matches** in `src/`.

- **`market ===`** in `src/features/terminal/`: no substantive size-formatting pattern found in the grep slice (navigation/filtering elsewhere).

**Conclusion:** There is **no** centralized “display size as lots for FX, base coin for crypto, shares for stocks” layer. Size UI is **uniform numeric** outside the (currently hidden) lots branch of the ticket.

---

## Step 6 — Backend size handling

### `place_order` — `req.size`

Parsed as `Decimal`, validated `> 0`, stored and forwarded to NATS as **`PlaceOrderCommand.size`** — same numeric quantity the engine uses for **notional = size × price**.

```513:519:backend/auth-service/src/routes/orders.rs
    let size = Decimal::from_str(&req.size).map_err(|_| {
        error!(order_id = %order_id, user_id = %user_id, "place_order FAILED stage=parse_size reason=invalid size");
        PlaceOrderError::Status(StatusCode::BAD_REQUEST)
    })?;
```

```923:929:backend/auth-service/src/routes/orders.rs
    let place_order_cmd = PlaceOrderCommand {
        order_id,
        user_id,
        symbol: req.symbol.clone(),
        side,
        order_type,
        size,
```

### `PlaceOrderCommand.size`

```15:22:crates/contracts/src/commands.rs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaceOrderCommand {
    pub order_id: Uuid,
    pub user_id: Uuid,
    pub symbol: String,
    pub side: Side,
    pub order_type: OrderType,
    pub size: Decimal,
```

Comment on leverage tiers: **`notional = size * price`**.

```39:40:crates/contracts/src/commands.rs
    /// Symbol leverage tiers (exposure -> max leverage); used at fill time with notional = size * price
```

### Order engine

```86:101:apps/order-engine/src/execution.rs
    let notional = cmd.size * fill_price;
    let leverage = effective_leverage(
        notional,
        cmd.min_leverage,
        cmd.max_leverage,
        cmd.leverage_tiers.as_deref(),
    )
```

**Convention:** Backend pipeline treats **`size` as the traded quantity in “base units”** (whatever the platform defines per symbol: contracts’ notional uses `size * fill_price`). **Lots are not a separate wire type**; conversion belongs in the client (or future server validation against `contract_size`).

### `orders.size` / `positions.size`

Initial infra migration: `DECIMAL` quantity on both tables (generic “size”).

```37:57:infra/migrations/001_initial_schema.sql
    size DECIMAL(20, 8) NOT NULL,
...
    size DECIMAL(20, 8) NOT NULL,
```

No lot-specific column on orders/positions in the reviewed paths.

---

## Step 7 — Gaps & natural integration points

### What already works

1. **Schema + API:** `symbols.contract_size`, `lot_min`, `lot_max`, `volume_precision`, `asset_class` / `market` are modeled end-to-end (auth-service + frontend `AdminSymbol`).
2. **Conversion math:** `calculateUnitsFromLots` / `calculateLotsFromUnits` and related pip helpers in `positionCalculations.ts`.
3. **Order ticket pipeline:** Internally computes `currentUnits` and sends **units** to `estimateOrderMargin` / `placeOrder` — correct for a unit-based backend.
4. **Optional lots UI:** Implemented in `RightTradingPanel` but **gated off** by `SHOW_ONLY_UNITS_SIZE_MODE = true`.

### What is inconsistent

1. **Ticket vs tables:** Ticket logic *could* show lots, but **flag forces units-only**; positions/history always show **raw decimals** without asset-specific labels.
2. **Naming:** UI says “Units” generically — not “lots”, “shares”, or “BTC” depending on `assetClass`.
3. **`calculateLotsFromUnits` normalizes** through `normalizeLotSize` (lot min/max grid). Using the same helper for **pure display conversion** might not match product intent for partial sizes (diagnostic note only).

### What is missing

1. **Asset-class-aware default size mode** (and labels): no `isStockSymbol`-style helpers; no default “lots for FX” in the visible UI.
2. **Shared formatter** for positions, orders, history, admin tables: e.g. `formatPositionSizeForDisplay(units, symbolMeta)` — **does not exist**; duplicated `toFixed` / `toLocaleString`.
3. **`lot_size` column:** not in repo; **contract_size** is the lever for “units per lot”.
4. **Terminal close dialog:** does not show size at all (trust issue vs admin modal).

### Natural integration points

| Fix | Where |
|-----|--------|
| Re-enable lots / pip ticket | `SHOW_ONLY_UNITS_SIZE_MODE` in `RightTradingPanel.tsx` + QA margin path |
| Default mode per `assetClass` | `RightTradingPanel` state init + `loadTradingPanelState` merge |
| Display formatter | New util (e.g. next to `positionCalculations.ts`) consumed by `BottomDock`, `TerminalHistoryView`, optionally admin |
| Symbol metadata in dock | Positions WS/API payload may need `contract_size` / `asset_class` on the client if not already joined (verify feed — out of scope here) |

---

## Step 8 — Status classification

**Chosen: Status C — Schema + helpers only** (with **UI forced to units** today, so user-visible behavior is close to **D** for “lots/shares semantics everywhere”).

**Evidence**

- DB/API: `contract_size`, `lot_min`, `lot_max` exist; **no** `lot_size`.
- Helpers exist and are **wired only in `RightTradingPanel`**, and lots UI is **disabled** (`SHOW_ONLY_UNITS_SIZE_MODE = true`).
- Positions/history/admin: **raw numeric** `size` / `toFixed` / `toLocaleString` — **no** lot/share/coin-specific formatting.
- Backend: **single `size` in base quantity** end-to-end; comments assume **notional = size × price**.

If the product goal is “forex in lots everywhere,” the work is **front-loaded on the terminal + admin UIs** (and ensuring each client has symbol `contract_size` wherever size is shown), not a new orders table column.

---

## Rough effort (engineering judgment)

To reach “lots / units / shares **displayed** correctly per asset class **everywhere**” (ticket + open positions + history + admin + consistent labels + sensible defaults):

- **~3–5 days** for a small team: shared formatter + thread symbol meta into list views + re-enable and test lots mode + copy/i18n + edge cases (quote-currency size entry, partial closes, very large crypto sizes).
- Add **+1–2 days** if WS/list payloads lack `contract_size` / `asset_class` and require API or denormalization changes.

---

## Appendix — `grep` command transcripts (frontend)

Suggested commands were approximated with ripgrep:

- `asset_class` in terminal/shared: see Step 5 (terminal uses `assetClass` TypeScript field; limited to non-size features).
- `isForexSymbol|isCryptoSymbol|isStockSymbol`: **no matches** in `src/`.
- `market ===` in terminal: present for non-size concerns (not expanded here).

**Note:** `RightTradingPanel` defines **`isForexTerminalSymbol`** (local helper) for spread formatting, not for size column labeling.

```102:104:src/features/terminal/components/RightTradingPanel.tsx
function isForexTerminalSymbol(s: MockSymbol): boolean {
  return s.assetClass === 'FX'
}
```
