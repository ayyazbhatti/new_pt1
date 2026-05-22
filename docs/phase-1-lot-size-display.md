# Phase 1 — Lot size display (shared formatter)

## Step 1 — Data flow (Path A vs B)

### User positions (`GET /v1/users/:user_id/positions`)

Implemented in `backend/auth-service/src/routes/deposits.rs::get_user_positions`. Positions are built from **Redis** hashes via `hash_to_position_json` — fields are whatever the engine stored (e.g. `symbol`, `size`). There is **no JOIN** to `symbols` for `contract_size` or `asset_class`.

```3601:3624:backend/auth-service/src/routes/deposits.rs
fn hash_to_position_json(
    pos_id_str: &str,
    pos_data: std::collections::HashMap<String, String>,
) -> serde_json::Value {
    let mut pos_json = serde_json::Map::new();
    pos_json.insert(
        "id".to_string(),
        serde_json::Value::String(pos_id_str.to_string()),
    );
    for (k, v) in pos_data {
        if let Ok(num) = v.parse::<f64>() {
            pos_json.insert(
                k,
                serde_json::Value::Number(
                    serde_json::Number::from_f64(num).unwrap_or(serde_json::Number::from(0)),
                ),
            );
        } else if v == "null" || v.is_empty() {
            pos_json.insert(k, serde_json::Value::Null);
        } else {
            pos_json.insert(k, serde_json::Value::String(v));
        }
    }
    serde_json::Value::Object(pos_json)
}
```

### User orders (`list_orders` in `backend/auth-service/src/routes/orders.rs`)

SQL **LEFT JOIN symbols** only to expose `s.code as symbol_code`. Response DTO does **not** include `asset_class` or `contract_size` from symbols.

### Admin positions / orders

`AdminPosition` / `AdminOrder` in `backend/auth-service/src/routes/admin_trading.rs` include `symbol` and numeric `size` only — **no** symbol metadata fields.

### Outcome: **Path B**

Position and order API payloads expose **symbol code + raw numeric size** only. Phase 1 uses a **client-side lookup** over the same enabled-symbol list as the terminal (`listAllSymbolsMatching({ is_enabled: 'true' })`), cached with React Query key `TERMINAL_ENABLED_SYMBOLS_QUERY_KEY` (shared with `useAllEnabledSymbolsForTerminal`).

**Backend DTO extension:** **Not required** for Phase 1 (per scope: no new endpoints).

---

## Step 2 — Formatter + tests

| Item | Location |
|------|-----------|
| Formatter | `src/shared/finance/sizeFormat.ts` |
| Types | `FormattedSize`, `SymbolMeta`, `SizeUnitLabel` |
| Unit tests | `src/shared/finance/sizeFormat.test.ts` (Vitest) |

Rules implemented:

- **FX / forex market:** lots = units ÷ contract_size; tooltip = formatted raw units + base currency when known.
- **Crypto:** primary + base currency label; no secondary tooltip (unit matches trader expectation).
- **Stocks:** integer shares (`Math.round`); label `shares`.
- **Indices / metals / commodities:** lots if `contract_size > 1`, else default “units” with raw tooltip.
- **Fallback:** missing or unknown symbol → locale-formatted raw units string.

---

## Step 3 — Symbol lookup hook

| Item | Location |
|------|-----------|
| Hook | `src/features/terminal/hooks/useSymbolMetaLookup.ts` |
| Helper | `getSymbolMetaForCode(map, symbolCode)` |
| Shared query key | `TERMINAL_ENABLED_SYMBOLS_QUERY_KEY` exported from `src/features/symbols/hooks/useSymbols.ts` |

`useAllEnabledSymbolsForTerminal` now uses the same **stable** query key constant so the symbol list is **not fetched twice**.

---

## Step 4 — Files touched (display sites)

### Terminal

- `src/features/terminal/components/BottomDock.tsx` — open positions (mobile + desktop), pending orders, order history (size + filled), position history, **close position dialog** (size + raw line when applicable).
- `src/features/terminal/components/TerminalHistoryView.tsx` — closed positions + filled orders.

### Admin (live tables + modals + mock panels)

- `src/features/adminTrading/components/PositionsTable.tsx`
- `src/features/adminTrading/components/PositionDetailsModal.tsx` (store-driven)
- `src/features/adminTrading/modals/PositionDetailsModal.tsx` (props-driven legacy)
- `src/features/adminTrading/components/ClosePositionModal.tsx`
- `src/features/adminTrading/components/PositionsAdminPanel.tsx` (mock table)
- `src/features/adminTrading/components/OrdersTable.tsx`
- `src/features/adminTrading/components/OrderDetailsModal.tsx` (store-driven)
- `src/features/adminTrading/modals/OrderDetailsModal.tsx` (props-driven legacy)
- `src/features/adminTrading/components/OrdersAdminPanel.tsx` (mock table)

### Tooling

- `package.json` — `vitest` devDependency, `npm run test`
- `vite.config.ts` — `vitest/config`, `resolve.alias` preserved, `test.include`

---

## Verification

```text
npx tsc --noEmit   # pass
npm run test       # vitest run — sizeFormat.test.ts (6 tests) pass
```

---

## Smoke test (manual — not executed in CI here)

1. Terminal: FX open position → quantity column shows `N.NN lots` (if symbol meta loaded); hover → raw units tooltip.
2. Crypto → `amount BASE` style.
3. Stock → `N shares`.
4. Close position dialog → shows formatted size + optional raw line.
5. Admin positions/orders tables and detail modals → same behavior when symbol list is loaded.

If symbol meta is missing (symbol not in enabled list), UI falls back to formatted raw units (no crash).

---

## Phase 2 (order ticket / lots input)

**Still needed** for:

- Re-enabling / UX for **Lots** vs **Units** on the ticket (`SHOW_ONLY_UNITS_SIZE_MODE` and related investigation).
- Optional: server-side validation of size vs `contract_size` / min lot — out of scope for this doc.

Phase 1 intentionally **does not** change `RightTradingPanel` or `SHOW_ONLY_UNITS_SIZE_MODE`.
