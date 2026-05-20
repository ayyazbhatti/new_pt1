# Admin Dashboard Diagnostic

Date: 2026-05-20

## D1: Dashboard component

- **Path:** `src/features/dashboard/pages/DashboardPage.tsx`
- **Route registration:** `src/app/router/adminRoutes.tsx` — `path: '/admin/dashboard'` with `element: <DashboardPage />` (lines 33–35). The router is composed with other admin routes in the app router setup (`src/app/router/AppRouter.tsx` references `/admin/dashboard` for redirects).

## D2: Current structure

- **File line count:** 317 (`DashboardPage.tsx`)
- **Imports:**
  - `react-router-dom`: `Link`
  - `@tanstack/react-query`: `useQuery`
  - `@/shared/layout`: `ContentShell`, `PageHeader`
  - `@/shared/store/auth.store`: `useAuthStore`
  - `@/shared/ui/card`: `Card`
  - `@/features/dashboard/components/RevenueChart`: `RevenueChart`
  - `@/features/dashboard/api/dashboard.api`: `fetchDashboardUsers`, `fetchDashboardFinance`, `fetchDashboardRecentTransactions`, `fetchDashboardPositions`, `DASHBOARD_QUERY_KEYS`
  - `@/features/adminFinance/utils/formatters`: `formatCurrency`
  - `lucide-react`: `Users`, `Activity`, `DollarSign`, `AlertTriangle`, `UserPlus`, `CalendarDays`, `Receipt`, `Headphones`, `ArrowRight`, `TrendingUp`, `Bell`, `UserCheck`, `Loader2`
- **JSX outline:**
  - `ContentShell` wrapping the page
  - `PageHeader` (“Dashboard” + role-scoped description)
  - Stats row: four `Card` tiles (Total Users, Active Trades, Revenue, Pending Requests) in a responsive grid
  - “Quick actions” section: grid of `Link` cells to admin sub-routes (users, leads, appointments, trading, transactions, support)
  - Two-column grid (`lg:grid-cols-2`): “Recent activity” `Card` with HTML `<table>`; “Recent registrations” `Card` with `<table>`
  - Second two-column row: “Revenue overview” `Card` wrapping `RevenueChart`; “Platform alerts” `Card` with static placeholder list
  - Full-width “Pending reviews” `Card` with placeholder copy (no live data)
- **Data fetching:** Four `useQuery` calls with keys from `DASHBOARD_QUERY_KEYS`:
  - `fetchDashboardUsers` → `listUsers` (users list + total)
  - `fetchDashboardFinance` → `fetchFinanceOverview`
  - `fetchDashboardRecentTransactions` → `fetchTransactions` (first page)
  - `fetchDashboardPositions` → `fetchAdminPositions` (`limit: 1` to read `total` for open positions)

## D3: Existing UI components on dashboard

| Component | Path | Purpose |
|---|---|---|
| `ContentShell` | `src/shared/layout/ContentShell.tsx` | Centered container with horizontal/vertical padding for admin page body |
| `PageHeader` | `src/shared/layout/PageHeader.tsx` | Page title, optional description, optional actions/back link |
| `Card` | `src/shared/ui/card/Card.tsx` | Styled surface (`card` / `card-elevated` utility classes) for grouped content |
| `RevenueChart` | `src/features/dashboard/components/RevenueChart.tsx` | Inline SVG area/line chart; default **placeholder** monthly series (not wired to API) |

**Note:** `src/features/dashboard/components/StatCard.tsx` exists but is **not** imported on `DashboardPage`; stats are inlined inside `Card` in the page itself.

## D4: Chart libraries

- **Already in `package.json`:** None of `recharts`, `chart.js`, `plotly`, `d3`, `apexcharts`, or `@nivo/*` appear in dependencies or devDependencies (verified by reading `package.json` and ripgrep across repo root).
- **Related dependency:** `klinecharts` (^10.0.0-beta1) — used for the **trading terminal** candlestick chart (`src/features/terminal/`), not for admin analytics.
- **Dashboard charting today:** `RevenueChart` is a **hand-built SVG** (no external chart lib), with hard-coded sample data and an optional `data` prop for future API wiring (`RevenueChart.tsx` lines 6–15, 23–27).
- **Grep for `LineChart|BarChart|AreaChart|PieChart` in `src/`:** Matches are overwhelmingly **Lucide React icon names** (e.g. `LineChart` in `TerminalMobileNav.tsx`), not chart library components. `UserDashboardPage` uses Lucide `PieChart` as an **icon** only.
- **Recommended for new charts:** Add **`recharts`** (or similar React-friendly chart lib) for admin line/bar/area dashboards — consistent API, accessibility, and less custom math than expanding raw SVG. **Do not** reuse `klinecharts` for admin KPI charts; it targets OHLC/time-series trading UI. Alternatively, extend the existing **minimal SVG pattern** in `RevenueChart` only if chart count stays very small and requirements stay simple.

## D5: APIs currently used by dashboard

The dashboard layer explicitly documents that there is **no dedicated backend dashboard endpoint**; it composes existing APIs (`src/features/dashboard/api/dashboard.api.ts` lines 1–5).

| Endpoint | What it returns | File:line (caller → HTTP) |
|---|---|---|
| `GET /api/auth/users?page=1&page_size=5` | Paginated users: `items` (user rows incl. `email`, `created_at`, …), `total` | `dashboard.api.ts` 20–21 → `users.api.ts` 56–60 |
| `GET /api/admin/finance/overview` | Finance snapshot: total wallet balances, pending deposit/withdrawal **counts**, net fees **today**, deposits/withdrawals **today** (count + amount) | `dashboard.api.ts` 24–25 → `finance.api.ts` 80–96 |
| `GET /api/admin/finance/transactions?page=1&page_size=10` | Paginated transactions for activity table | `dashboard.api.ts` 29–30 → `finance.api.ts` 123–136 |
| `GET /api/admin/positions?limit=1` | Paginated positions response; page uses `total` (or `items.length`) for “Active Trades” | `dashboard.api.ts` 34–35 → `positions.ts` 17–18 |

**Backend handlers (auth-service):**

- Users: `GET /users` on nested `/api/auth` router → `list_users` in `backend/auth-service/src/routes/auth.rs` (~690, ~1707+).
- Finance: `create_finance_router` — `/overview`, `/transactions`, … under `/api/admin/finance` (`backend/auth-service/src/routes/finance.rs` 456–465; overview handler ~467+).
- Positions: `GET /` on `/api/admin/positions` → `list_admin_positions` (`backend/auth-service/src/routes/admin_positions.rs` 1133–1138).

## D6: Other admin APIs (potential chart sources)

Below are **representative** admin GET (or list) endpoints that return **structured or time-filterable** data useful for aggregation or trends. Many live under nests declared in `backend/auth-service/src/lib.rs` (lines ~272–346). Time-range support is noted per handler where identifiable.

| Endpoint | What it returns | Time-range support |
|---|---|---|
| `GET /api/admin/finance/transactions` | Paginated `TransactionResponse` rows (amounts, types, status, timestamps) | **Yes** — query `date_from`, `date_to` (`finance.rs` `ListTransactionsQuery` ~79–96; frontend `finance.api.ts` 129–130) |
| `GET /api/admin/finance/wallets` | Paginated wallet balances | Filters by balance range, type, currency; **not** inherently a time-series |
| `GET /api/admin/user-events` | Cursor-paginated user events (audit/compliance) | **Yes** — `from`, `to` (RFC3339 or `YYYY-MM-DD`) (`admin_user_events.rs` 22–31, 92–96) |
| `GET /api/admin/kyc` | KYC submissions list + `total`; rows include `submitted_at`, `status` | Pagination + status/search filters; **no** explicit `from`/`to` on list query (`admin_kyc.rs` 41–47, 123+) |
| `GET /api/admin/appointments/stats` | Aggregate appointment counts (totals, by status, today, next 7 days, overdue) | **Implicit “today / 7-day window”** in SQL (`appointment_service.rs` `get_stats` ~484–555); not an arbitrary date range parameter |
| `GET /api/admin/appointments` | Appointment list | **Yes** — `start_date`, `end_date` on list params (`appointment_service.rs` `ListAppointmentsParams` ~66–77) |
| `GET /api/leads` (admin leads router) | Leads list, CRUD | List endpoint exists (`admin_leads.rs` 210+); charting would derive from list payloads / activities |
| `GET /api/admin/managers/:id/statistics` | Per-manager deposit/withdrawal and related aggregates | Scoped manager stats (`admin_managers.rs` 186–189); **not** a global platform time-series |
| `GET /api/admin/orders` | Admin orders list | Trading filters on `list_admin_orders` (`admin_trading.rs` 1063+) — useful for volume/count **if** queried with filters |
| `GET /api/admin/positions` | Open (and related) positions for admin | Filters (status, symbol, user, …); good for **current** exposure snapshots, not historical PnL series without extra logic |
| `GET /api/admin/audit` | Audit log list | Handler currently returns **empty** payload (TODO) (`admin_audit.rs` 27–44) |

**Registration / user growth:** `GET /api/auth/users` supports pagination but **no** `created_after` filter in the typed frontend `ListUsersParams`; building sign-up **time series** may require backend support or repeated paging (not ideal).

## D7: Design system

- **Tailwind config:** Yes — `tailwind.config.js` at repo root. **`darkMode: 'class'`** is set (line 7). **Extended palette:** semantic colors `background`, `surface`, `surface-1`, `surface-2`, `border`, `text`, `text-muted`, `accent`, `success`, `danger`, `warning`, `info` (lines 14–30). Default radii and a few layout-related `gridTemplateColumns` (lines 31–37).
- **Global CSS:** `src/shared/styles/globals.css` — `@tailwind` layers, base body styling (dark gradient background `#0b1220` / `#0f172a`), form control dark styling, utility classes like `.btn-primary`, `.focus-ring` with `ring-accent` (lines 1–80, 194+).
- **Color tokens:** Primarily **Tailwind `theme.extend.colors`** (hex / rgba literals), not shadcn-style `chart-1` CSS variables. No `chart-1` / `primary` token grep hits in `globals.css` beyond component classes like `.btn-primary`.
- **Theme provider:** `src/app/providers/ThemeProvider.tsx` is currently a **no-op** wrapper (`return <>{children}</>`). The UI is **dark-first** via global/Tailwind colors; toggling light/dark via `class` strategy is configured in Tailwind but not driven by this provider.

## D8: Existing chart patterns in codebase

- **Admin dashboard:** `RevenueChart` — custom SVG, fixed `viewBox`, linear gradient fill, path-based line + area, optional `data` prop; **sample data by default** (`RevenueChart.tsx`).
- **Trading terminal:** `klinecharts` — `init` / `dispose` in `ChartPlaceholder.tsx`, overlays, indicators (`src/features/terminal/`). This is **OHLC / trading** charting, not admin KPI charts.
- **No** widespread use of `recharts` / `Chart.js` component APIs in `src/` for analytics.

**Representative snippet (dashboard placeholder chart):**

```23:98:src/features/dashboard/components/RevenueChart.tsx
export function RevenueChart({
  data = SAMPLE_DATA,
  height = CHART_HEIGHT,
  className = '',
}: RevenueChartProps) {
  const { path, areaPath, xLabels } = useMemo(() => {
    // ... scales path from data ...
    return { path, areaPath, xLabels }
  }, [data, height])

  return (
    <div className={`w-full overflow-hidden ${className}`}>
      <svg viewBox={`0 0 400 ${height}`} preserveAspectRatio="xMidYMid meet" className="w-full h-full min-h-[200px]">
        {/* gradient + area path + line path + x-axis labels */}
      </svg>
    </div>
  )
}
```

## D9: Layout

- **Grid pattern:** Mostly **CSS Grid** with Tailwind: stats `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`; quick actions `grid-cols-2 sm:grid-cols-3 lg:grid-cols-6`; paired sections `lg:grid-cols-2` (`DashboardPage.tsx` ~126, 162, 182, 266).
- **Responsive:** Mobile-first single column for stats; two columns from `sm`; four stats from `lg`. Tables use `overflow-x-auto` wrappers for horizontal scroll on small screens (~189, 230).
- **Scrolling / pagination:** Page content lives in the normal admin scroll context (via `ContentShell`); tables show **all returned rows** for that query page (10 transactions, 5 users) — **no** client-side table pagination on the dashboard itself.
- **Dark mode on dashboard:** Visual design uses **semantic dark tokens** (`text-text`, `bg-surface-2`, `border-border`). There is **no** light-theme alternate in this page’s classes; `ThemeProvider` does not switch themes.

## Observations and gaps

**What’s useful today**

- Role-aware copy for super-admin vs scoped managers (`DashboardPage.tsx` ~117–122).
- Real totals: user count, open positions total, finance overview aggregates, recent transactions list, recent sign-ups (first page of users).

**What’s weak or placeholder**

- “Revenue” stat uses **`totalBalances`** (sum of wallet balances), not revenue/fees — naming mismatch with business meaning (`DashboardPage.tsx` ~92–98 vs card label “Revenue”).
- **Stat “change from last month”** is always `null` — no trend data wired (`statValues` ~95–100).
- **`RevenueChart`** uses **static sample data**, not API-backed series.
- **Platform alerts** and **Pending reviews** are **hard-coded placeholders** (~63–67, ~285–299, ~304–313).
- **Recent registrations** “Source” column is always `'—'`.

**Data available but unused on this page**

- The dashboard **does** call `fetchDashboardFinance`, and the HTTP response includes **`netFeesToday`**, **`depositsToday`**, and **`withdrawalsToday`** (see `FinanceOverview` in `finance.api.ts` lines 3–15), but **`DashboardPage` only reads `totalBalances`, `pendingDeposits`, and `pendingWithdrawals`** (~92–93) — **fees and “today” deposit/withdrawal breakdown are not shown anywhere on the page.**
- Richer transaction fields (amounts, currencies, statuses) only surfaced as `"${tx.type} ${tx.status}"` in the activity table.

**Suggested grep follow-ups (from your prompt)**

- `src/features/adminDashboard/` — **path does not exist** in this repo; dashboard lives under `src/features/dashboard/`.

## Recommended chart additions (DO NOT IMPLEMENT)

Rankings use **effort** and **value** as Low / Medium / High.

| # | Chart name | Data source | Chart type | Time range | Layout position | Effort | Value |
|---|------------|-------------|------------|------------|-----------------|--------|-------|
| 1 | **Deposits & withdrawals (volume or count)** | `GET /api/admin/finance/transactions` with `date_from` / `date_to`; aggregate client-side by day, or add a small backend aggregate later | Stacked bar or grouped bar | Last 7 / 30 days | New row under stats or above “Recent activity” | Medium | High |
| 2 | **Net fees trend** | Same transactions endpoint filtered `type=fee`/`rebate` **or** extend use of `netFeesToday` with new backend series; today-only snapshot exists in `GET /api/admin/finance/overview` | Line or area | 30 days (needs series from txs or new API) | Beside or replace placeholder **Revenue overview** | Medium–High | High |
| 3 | **User / platform activity timeline** | `GET /api/admin/user-events` with `from` / `to` + category filters | Line (events per day) or stacked area by category | 7 / 30 days | Full-width under quick actions | Medium | High |
| 4 | **KYC pipeline funnel** | `GET /api/admin/kyc` — counts by `status` from paginated data or totals if you fetch all pages / add aggregate endpoint | Horizontal bar or funnel | Current snapshot (+ optional “submitted in last 30d” if you filter client-side by `submitted_at`) | Replace part of “Pending reviews” placeholder | Medium | Medium |
| 5 | **Appointment load** | `GET /api/admin/appointments/stats` — status mix, today, overdue | Donut or bar | Snapshot (today + 7-day forward built-in) | Secondary card row next to alerts | Low | Medium |
| 6 | **Wallet / balance distribution** | `GET /api/admin/finance/wallets` (paginate or sample); histogram of equity or available balance | Histogram or bar | Snapshot | New card in lower grid | Medium | Medium |
| 7 | **Open interest by symbol** | `GET /api/admin/positions` with pagination; aggregate `symbol` | Bar (horizontal) | Snapshot | Adjacent to “Active Trades” stat or new row | Medium | Medium |
| 8 | **Registration trend** | Ideally new backend `GROUP BY date(created_at)`; interim: multiple `listUsers` pages **not** recommended | Line | 30 days | Top row extension | High (without backend) / Medium (with) | High |

**Ordering by (effort, value) priority to implement later**

1. **Appointment stats donut/bar** — Low effort, solid operational value.  
2. **Deposit/withdrawal activity from finance transactions** — Medium effort, high value if date filters + aggregation are acceptable.  
3. **User-events timeline** — Medium effort, high compliance/ops value.  
4. **Replace RevenueChart with real series** (fees or volume) — Medium–High effort, high visual impact.  
5. **KYC funnel** — Medium effort, medium value.  
6. **Positions by symbol** — Medium effort, medium value for trading ops.  
7. **Wallet distribution** — Medium effort, medium risk of misleading if only partial pages without backend support.  
8. **True registration cohort curve** — High effort until a dedicated aggregate endpoint exists.

---

*Investigation performed read-only against the repository; no application code or configuration was changed.*
