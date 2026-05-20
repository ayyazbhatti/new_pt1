# Dashboard chart additions

Date: 2026-05-20

## Step 1: recharts installed

- **Version:** 3.8.1 (from `package-lock.json` → `node_modules/recharts`)
- **package-lock.json updated:** YES

## Step 2: Deposit/withdrawal flow chart

- **RevenueChart** rewritten using recharts `AreaChart` + two `Area` series (`src/features/dashboard/components/RevenueChart.tsx`).
- **Transaction types used for deposit/withdrawal:** `deposit` and `withdrawal` (must match `Transaction['type']` in `finance.api.ts`).
- **Status filter applied:** `status === 'completed'` only (pending / rejected / failed / approved excluded). This matches `get_finance_overview` “deposits/withdrawals today” SQL in `backend/auth-service/src/routes/finance.rs` (uses `completed` only). **Note:** If the platform still records some realized deposits as `approved` only, they will **not** appear in this chart.
- **Aggregation:** By local calendar day (`YYYY-MM-DD` from `new Date(tx.createdAt)`), summed `netAmount` per day for each series.
- **Colors:** `success` `#22c55e`, `danger` `#ef4444` from `tailwind.config.js` `theme.extend.colors`.

## Step 3: Fees chart

- **New file:** `src/features/dashboard/components/FeesChart.tsx`
- **Fee logic:** Uses `type === 'fee'` and `type === 'rebate'` with `status === 'completed'`, matching backend `net_fees_today`: per day `fees += -netAmount` for `fee`, `fees += netAmount` for `rebate` (same case expression as `finance.rs` lines 525–528).
- **Chart type:** `AreaChart` with a single filled `Area` (accent stroke/fill).

## Step 4: API helper

- **New function:** `fetchDashboardTransactionsForCharts(daysBack)` in `src/features/dashboard/api/dashboard.api.ts`.
- **Pagination:** Backend clamps `page_size` to **max 100** (`finance.rs` ~784). The helper loops pages until all rows for the date range are fetched (instead of a single `page_size: 10000` request).
- **Date params:** `dateFrom` / `dateTo` as `YYYY-MM-DD` local dates (same window as the 30-day series keys on the dashboard).
- **Query key:** `DASHBOARD_QUERY_KEYS.chartTransactions(daysBack)` → `['dashboard', 'chart-transactions', daysBack]`.
- **Exported types:** `DailyFlow`, `DailyFee` (for chart props).

## Step 5: Today stats

- **Three new cards:** Deposits today, Withdrawals today, Net fees today — new row **below** the original four-stat grid, `grid-cols-1 sm:grid-cols-3`.
- **Field shape:** `depositsToday` / `withdrawalsToday` are `{ count: number; amount: number }`; `netFeesToday` is a **number** (`FinanceOverview` in `finance.api.ts`).
- **Display:** Amount as headline (`formatCurrency(..., 'USD')`); deposits/withdrawals show subtitle `({count} transaction(s))`.

## Step 6: TypeScript check

- **Exit code:** 0
- **New errors:** 0 (`npx tsc --noEmit`)

## Step 7: Page loads

- **Dev server starts:** YES (`vite` ready; if port 5173 is busy, Vite picks another port — log showed **5174** for this run).
- **HTTP check:** `curl` to `http://localhost:5173/admin/dashboard` returned **200** with HTML shell (SPA entry). No import-time crash observed from this check alone.

## Files modified

| Area | Files |
|------|--------|
| Dependencies | `package.json`, `package-lock.json` |
| API | `src/features/dashboard/api/dashboard.api.ts` |
| Charts | `src/features/dashboard/components/RevenueChart.tsx`, `src/features/dashboard/components/FeesChart.tsx` (**new**, untracked until `git add`) |
| Page | `src/features/dashboard/pages/DashboardPage.tsx` |

`git diff --stat` (tracked files only at time of check): `717 insertions(+), 111 deletions(-)` across 5 paths; **FeesChart.tsx** is additional as an untracked new file.

## Decisions made

1. **Pagination:** Implemented multi-page fetches at `pageSize: 100` because auth-service rejects `page_size > 100`.
2. **Platform alerts:** Moved to a **full-width** card **below** the two chart cards so the charts sit side-by-side on `lg` without removing alerts.
3. **Axis tick color:** Recharts `tick={{ fill: '#94a3b8' }}` matches Tailwind `text-muted` from `tailwind.config.js` (Recharts does not read Tailwind classes on SVG ticks).
4. **Net fees empty state:** Treats “all days zero” as empty (shows “No fees recorded…”); negative net on a day still renders the chart.

## Scope rule check

- **Any files touched outside the allowed scope?** **NO** (only the listed dashboard files + `package.json` / `package-lock.json`).

## Ready to deploy: NO

- Not committed, not production-verified; only local `tsc` and a brief dev/curl smoke check.
