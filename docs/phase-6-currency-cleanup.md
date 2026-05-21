# Phase 6 — Currency cleanup (refactor)

**Goal:** Remove duplicate `formatCurrency` plumbing, close Phase 5 follow-ups on dead `$` in admin mock tables, and document deferred work. **No intentional product/behavior change** beyond matching existing Phase 5 currency rules (USD account values → hooks; quote-native prices → no `$` prefix).

---

## Step 1 — Import map (before deleting `leverageProfiles/utils/format.ts`)

### `src/shared/utils/currency.ts`

| Export | Importers (direct `formatCurrency` usage) |
|--------|-------------------------------------------|
| `formatCurrency` | **None** in `src/` (only the definition + re-export via `src/shared/utils/index.ts`). Call sites use `@/shared/currency` hooks or `formatAmount` from `@/shared/currency/format`. |
| `useFormatFromUsd`, etc. | Many React files via `@/shared/currency` or `@/shared/utils` barrel. |

**Decision:** Keep this file as the documented non-hook entry point (`formatCurrency` → `formatAmount`).

### `src/features/leverageProfiles/utils/format.ts` (deleted)

| Export | Imported by |
|--------|-------------|
| `formatCurrency` | `src/features/leverageProfiles/modals/ManageTiersModal.tsx` (one overlap error string). |

**Note:** `ProfilesTable.tsx` does **not** import this module (diagnostic was outdated).

### Inline `formatCurrency` in `AdminTradingPage.tsx` / `AdminTransactionsPage.tsx`

**Verified:** No `const formatCurrency = …` or `function formatCurrency`. Both use `const formatMoney = useFormatFromUsd()`.

---

## Step 2 — Consolidate / delete

| Action | Detail |
|--------|--------|
| **Kept** | `src/shared/utils/currency.ts` — already minimal: `formatCurrency` delegates to `formatAmount` from `@/shared/currency/format`, hooks re-exported. |
| **Deleted** | `src/features/leverageProfiles/utils/format.ts` — sole export duplicated `formatAmount(..., 'USD')`. |
| **Updated** | `ManageTiersModal.tsx` — imports `formatAmount` from `@/shared/currency/format` for the overlap validation message (same formatting as before). |

---

## Step 3 — Phase 5 “Needs decision” follow-ups

### Item 4 — `MarginEventsAdminPanel` + `PositionsTable` (`$` cleanup)

| File | Change |
|------|--------|
| `MarginEventsAdminPanel.tsx` | **Equity, Margin, Maintenance** columns: `useFormatFromUsd` (USD account snapshot). |
| `PositionsTable.tsx` | **Margin:** `useFormatFromUsd`. **Entry, Mark, SL, TP:** removed misleading `$` prefix; numeric `toFixed` unchanged (quote-native). **Live PnL** unchanged (`LivePnlAmountCell` already uses hooks). |

### Item 3 — `CurrencyOverrideProvider` on admin order/position modals

**Choice: Option A (defer).** No backend or DTO change. Admin modals continue to use the **admin viewer’s** effective currency for USD-denominated fields; when the API adds the owning user’s `display_currency`, wrap modals in `CurrencyOverrideProvider` in a later pass.

---

## Step 4 — `$` audit (sampled)

- **Excluded by spec:** LIVE QUOTE / order ticket / free-margin slider / chart code, tests, docs.
- **Leverage profiles / terminal:** Many template literals for non-monetary UI; `RightTradingPanel` LIVE QUOTE `$` left as-is (quote display).
- **After this phase:** `grep formatCurrency src/` resolves to `src/shared/utils/currency.ts` (export) and `CurrencySelect.tsx` helper name `formatCurrencyLabel` (unrelated).

No repo-wide mechanical replacement of every `` `$`{` `` in JSX was applied; remaining literals are mostly Tailwind/template strings, LIVE QUOTE, or intentional USD copy (e.g. deposit “USD” hints).

---

## Step 5 — Build verification

```text
$ cd /Users/mab/new_pt1 && npx tsc --noEmit 2>&1; echo "exit:$?"
exit:0
```

**Bundle size:** Removing one ~300-byte source file is negligible; no before/after bundle measurement run.

---

## Follow-up items (post–Phase 6)

1. **TradingStatsCards “Total exposure”** — Still ambiguous (mixed notional); see Phase 5 doc.
2. **`UserAffiliatePage` mixed commission currencies** — Still hypothetical; see Phase 5 doc.
3. **Admin order/position `CurrencyOverrideProvider`** — Option B when API exposes user display currency.
4. Optional: sweep `PositionsTable`-style `$` in other admin mocks if new files appear.

---

## Smoke test (manual)

Same as Phase 5: EUR `display_currency` user + admin viewer; confirm monetary surfaces match expectations. Additionally:

- `grep -r "formatCurrency" src/` → only `@/shared/utils/currency` export + unrelated `formatCurrencyLabel` in `CurrencySelect.tsx`.
