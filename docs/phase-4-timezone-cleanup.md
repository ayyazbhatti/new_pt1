# Phase 4 — Timezone formatter consolidation (refactor)

**Goal:** Zero user-visible change. Remove duplicate formatter modules; route date/time display through `@/shared/datetime`; move non-date helpers to small shared utils.

---

## Step 1 — Import map (pre-change)

### `src/features/adminUsers/utils/formatters.ts`

| Export | Used by |
|--------|---------|
| `formatCurrency` | `UsersTable.tsx`, `UserDetailsModal.tsx`, `BulkDepositSection.tsx` |
| `formatAccountAge` | `UserDetailsModal.tsx` |
| `formatDateTime` (UTC fallback) | **No remaining imports** (Phase 3: hooks from `@/shared/datetime`) |
| Re-export hooks | **No remaining imports** |

### `src/features/adminTrading/utils/formatters.ts`

| Export | Used by |
|--------|---------|
| `formatPercent` | `PositionsAdminPanel.tsx`, `PositionDetailsModal.tsx` |
| `formatNumber` | **Unused** (dead) |
| Date helpers / hook re-exports | **No remaining imports** |

### `src/features/adminFinance/utils/formatters.ts`

| Export | Used by |
|--------|---------|
| `formatCurrency` (incl. BTC/USDT branch) | All `adminFinance/**` panels/modals via `../utils/formatters`; `DashboardPage`, `FeesChart`, `RevenueChart`, `ManagerDetailPage` via `@/features/adminFinance/utils/formatters` |
| Date helpers | **No remaining imports** |

### `src/features/adminMarkup/utils/formatters.ts`

| Export | Used by |
|--------|---------|
| (all) | **No imports** — dead after Phase 3 |

### `src/features/adminLeads/utils/formatDate.ts`

| Export | Used by |
|--------|---------|
| (all) | **No imports** — dead after Phase 3 |

### `src/features/managers/utils/formatters.ts`

| Export | Used by |
|--------|---------|
| (all) | **No imports** — dead after Phase 3 |

### `src/features/appointments/utils/format.ts`

| Export | Used by |
|--------|---------|
| `formatDate`, `formatTime` | `UserAppointmentsPage.tsx`, `MonthCalendar.tsx` → **migrated to** `useFormatDate` / `useFormatTime` |
| `getStatusBadgeClasses` | `StatusBadge.tsx` → **moved to** `appointmentStatusBadges.ts` |
| Hook re-exports | Unused from this path |

### `src/shared/utils/format.ts`

| Export | Used by |
|--------|---------|
| (all) | **No imports** — removed; leverage profiles keep their own `features/leverageProfiles/utils/format.ts` (USD **integer** margin labels — different contract). |

### `src/shared/utils/time.ts`

| Before | After |
|--------|--------|
| UTC fallbacks `formatDate` / `formatDateTime` / `formatRelative` + hook re-exports | **Hooks-only re-export** barrel toward `@/shared/datetime` (no `format*` functions) |

---

## Files deleted

1. `src/features/adminUsers/utils/formatters.ts`
2. `src/features/adminTrading/utils/formatters.ts`
3. `src/features/adminFinance/utils/formatters.ts`
4. `src/features/adminMarkup/utils/formatters.ts`
5. `src/features/adminLeads/utils/formatDate.ts`
6. `src/features/managers/utils/formatters.ts`
7. `src/features/appointments/utils/format.ts`
8. `src/shared/utils/format.ts` (unused duplicate of `formatPercent` / partial `formatCurrency`)

---

## Files added

| Path | Role |
|------|------|
| `src/shared/utils/currency.ts` | Single `formatCurrency` — **merged** adminUsers (plain Intl) + adminFinance **BTC/USDT** branch |
| `src/shared/utils/number.ts` | `formatNumber`, `formatPercent` (from admin trading) |
| `src/shared/utils/duration.ts` | `formatAccountAge` |
| `src/features/appointments/utils/appointmentStatusBadges.ts` | `getStatusBadgeClasses` only |

---

## Import redirect summary

| Old | New |
|-----|-----|
| `@/features/adminFinance/utils/formatters` → `formatCurrency` | `@/shared/utils/currency` |
| `@/features/adminUsers/utils/formatters` → `formatCurrency` | `@/shared/utils/currency` |
| `../utils/formatters` (adminUsers) | `@/shared/utils/currency` (+ `duration` for account age) |
| `../utils/formatters` (adminFinance) | `@/shared/utils/currency` |
| `../utils/formatters` (adminTrading) → `formatPercent` | `@/shared/utils/number` |
| `../utils/format` (appointments) date fns | `useFormatDate` / `useFormatTime` from `@/shared/datetime` |
| `../utils/format` → `getStatusBadgeClasses` | `../utils/appointmentStatusBadges` |
| `src/shared/utils/index.ts` `export * from './format'` | `export * from './currency'`, `'./number'`, `'./duration'` |

---

## `formatCurrency` consolidation

- **adminFinance** variant kept as canonical: `BTC` / `USDT` use `toFixed(8)` with explicit `+` for non-negative values; other currencies use `Intl.NumberFormat` with 2 fraction digits.
- **adminUsers** previously used plain `Intl` only — **behavior for USD/EUR/etc. unchanged**; crypto rows in finance panels keep the finance-specific formatting.

---

## Other behavior notes

- **Hide leverage** row in `GroupsTable` was already sending full payloads in a prior change; unchanged here.
- **Appointments** `CreateAppointmentModal` / `EditAppointmentModal` already use `fromZonedWallClock` (Phase 3); only display call sites in `UserAppointmentsPage` and `MonthCalendar` were switched from UTC static functions to hooks (effective viewer timezone — aligned with Phase 3 intent).

---

## Verification

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | Pass |
| `npm run build` | Pass |
| `grep -r "from.*adminUsers/utils/formatters" src` | Empty |
| `grep -r "from.*appointments/utils/format" src` | Empty |
| `grep -r "function formatDateTime\\|export function formatDateTime" src` | Only `src/shared/datetime/format.ts` |
| `Intl.DateTimeFormat` in `src/` | `shared/datetime/format.ts`, `shared/datetime/resolve.ts`, `shared/components/TimezoneSelect.tsx`, `features/terminal/components/RightTradingPanel.tsx` |

---

## Bundle size

**After this change** (one `npm run build`, Vite 5.4.21):

- Main JS chunk: `dist/assets/index-*.js` ≈ **2,915 kB** raw, **~745 kB** gzip (filename hash varies per build).

**Before:** not captured in the same session; delta expected small (duplicate modules were thin vs. total app). Re-run two builds on adjacent commits to measure gzip if needed.

---

## Related docs

- `docs/timezone-feature-diagnostic.md` — Appendix updated to “resolved” with pointer here.
- `docs/feature-inventory.md` — “Recent improvements” + “Resolved technical debt” rows.
