# Timezone feature — read-only diagnostic (UI + API surface map)

**Scope:** Map where timestamps are shown or formatted today, how APIs serialize time, where schema and admin forms live, and what is out of scope. **No code changes** were made for this document.

---

## 1. CURRENT TIMESTAMP RENDERING CONVENTIONS

### Central helpers (partial — not one global formatter)

| Module | Functions | Notes |
|--------|-----------|--------|
| `src/shared/utils/time.ts` | `formatDate`, `formatDateTime`, `formatRelative` | Browser default locale + `undefined` timezone → **viewer local** |
| `src/features/adminUsers/utils/formatters.ts` | `formatDateTime`, `formatAccountAge`, `formatCurrency` | `Intl.DateTimeFormat('en-US', …, timeZoneName: 'short')` → **viewer local** + short TZ label |
| `src/features/adminTrading/utils/formatters.ts` | `formatDateTime`, `formatNumber` | Same `en-US` + `timeZoneName: 'short'` pattern |
| `src/features/adminFinance/utils/formatters.ts` | `formatDateTime`, `formatDate`, `formatCurrency` | Same `Intl` pattern |
| `src/features/adminMarkup/utils/formatters.ts` | (same family as admin trading/finance; used by markup panels) | `Intl` / currency |
| `src/features/adminLeads/utils/formatDate.ts` | `formatRelative`, `formatDateTime` | `toLocaleString(undefined, …)` |
| `src/features/managers/utils/formatters.ts` | `formatDateTime`, `formatRelativeTime` | `toLocaleString` / relative strings |
| `src/features/appointments/utils/format.ts` | `formatDate`, `formatTime`, `formatDateTime` | Fixed `'en-US'` locale |

**Imports of `src/shared/utils/time.ts` found:** `src/features/tags/components/TagsTable.tsx` only (`formatDateTime`).

**`date-fns` usage:** `format`, `parse`, `subDays`, `formatDistanceToNow` in terminal history, admin/user tables, affiliate, groups table, audit panel, etc. **Without `date-fns-tz`**, `format(new Date(iso), …)` uses the **runtime local** offset for that `Date` instance (still not “named IANA zone” aware).

### Patterns in use (with examples)

| Pattern | Example files |
|---------|----------------|
| `new Date(x).toLocaleString(undefined, …)` | `src/features/dashboard/pages/DashboardPage.tsx` (L158), `src/features/terminal/components/BottomDock.tsx` (L861, L1507), `src/features/adminLeads/pages/AdminLeadDetailPage.tsx` (L43) |
| `new Date(x).toLocaleString('en-US', …)` | `src/features/terminal/components/BottomDock.tsx` (L1406), `src/features/terminal/components/SupportChatTab.tsx` (L15) |
| `new Date(x).toISOString()` (payload / keys / sorting) | `src/features/appointments/modals/CreateAppointmentModal.tsx` (L93), `src/features/adminBulkOperations/components/BulkUserCreation.tsx` (L180), `src/shared/components/UserSearchPalette.tsx` (L42–43) |
| `date-fns` `format` / `parse` | `src/features/terminal/components/TerminalHistoryView.tsx` (L18, L187–198, L313, L377), `src/features/adminTrading/components/OrdersTable.tsx` (L146), `src/features/userPanel/pages/UserOrdersPage.tsx` (L194) |
| `date-fns` `formatDistanceToNow` | `src/features/groups/components/GroupsTable.tsx` (L397), `src/features/leverageProfiles/components/ProfilesTable.tsx`, `src/features/adminMarkup/components/ProfilesTable.tsx` |
| `Intl.DateTimeFormat('en-US', …)` | `src/features/adminUsers/utils/formatters.ts` (L12–19), `src/features/adminTrading/utils/formatters.ts` (L23–31), `src/features/adminFinance/utils/formatters.ts` (L21–28) |
| `getTimezoneOffset` + manual clock string | `src/features/terminal/components/RightTradingPanel.tsx` (L857–879) |
| Hand-rolled relative (“Xm ago”) | `src/shared/utils/time.ts` (L11–23), `src/features/terminal/components/NotificationsPanel.tsx` (L15–32), `src/features/dashboard/pages/DashboardPage.tsx` (L82–95), `src/features/managers/hooks/useManagerStats.ts` (L73–88) |

### `package.json` date-related dependencies

**Present:** `date-fns@^2.30.0`, `react-datepicker@^4.25.0` (calendar UI; not TZ-aware by itself).

**Not present:** `date-fns-tz`, `dayjs`, `luxon`, `moment`, `moment-timezone`.

**Implication:** Any named-IANA formatting will require **`date-fns-tz`**, **`luxon`**, or equivalent — or manual `Intl` with `timeZone: resolvedId`.

---

## 2. TERMINAL — TIMESTAMP DISPLAY SURFACE

**Non-display uses (excluded from table below):** `Date.now()`, `performance.now()`, idempotency keys, optimistic `created_at` on local objects, chart data timestamps fed to klinecharts as **epoch ms** (axis is library-internal), `setInterval` for clock/ping (not a “timestamp display” but see **polling note** in workspace rules for unrelated work).

| File | Line(s) | What it shows | Source field | Current formatter |
|------|----------|---------------|--------------|-------------------|
| `RightTradingPanel.tsx` | 855–865, 868–879 | Header clock + `UTC±H` label | `new Date()` | Manual: `getTimezoneOffset`, `toTimeString`, padded day/month/year |
| `BottomDock.tsx` | 860–863, 922, 936 | Mobile open positions: short + long open time | `pos.opened_at` / `pos.updated_at` (ms or s normalized) | `toLocaleString` / `toLocaleDateString` / `toLocaleTimeString` (default locale) |
| `BottomDock.tsx` | 1269–1270, 1312 | Desktop pending orders “Created” column | `order.created_at` | `toLocaleTimeString('en-US', …)` |
| `BottomDock.tsx` | 1405–1411, 1444 | Order History “Created” | `order.created_at` | `toLocaleString('en-US', …)` |
| `BottomDock.tsx` | 1507–1548 | Position History “Closed” | `pos.updated_at` | `toLocaleString()` default |
| `BottomDock.tsx` | — | Desktop open positions table | **No open-time column** in thead (L1048–1060); times only on **mobile** card rows above | — |
| `TerminalHistoryView.tsx` | 187–198 | Date range filter (react-datepicker) | User-picked `Date` | `date-fns` `format`/`parse` to `yyyy-MM-dd` |
| `TerminalHistoryView.tsx` | 313–335 | Closed position row — right column time | `pos.closed_at` / `pos.updated_at` | `toLocaleString(undefined, …)` |
| `TerminalHistoryView.tsx` | 377–399 | Filled order row — right column time | `order.created_at` | `toLocaleString(undefined, …)` |
| `NotificationsPanel.tsx` | 183–184 | Each notification subline | `n.createdAt` | `formatRelativeTime` (relative + `toLocaleDateString` fallback) |
| `SupportChatTab.tsx` | 12–18, 28 | Message bubble time | `dto.createdAt` | `toLocaleTimeString('en-US', hour12: false)` |
| `AiChatTab.tsx` | 27–33, 218+ | AI message timestamps | ISO from API / `new Date().toISOString()` | `toLocaleTimeString('en-US', hour12: false)` |
| `PaymentPanel.tsx` | 11–13, 158 | Deposit history row date | `item.createdAt` | Local `formatDate` → `toLocaleDateString` |
| `ChartPlaceholder.tsx` | 235+ | **Chart candle x-axis** | Bar `timestamp` (ms) from Binance / feed | **klinecharts internal** — no app-level `Intl` for axis in this file |
| `RightTradingPanel.tsx` | 2098–2099 | Promo carousel | `slide.title` / `slide.subtitle` | **No date fields** on `PromotionSlidePublic` (`terminal/api/promotions.api.ts` L3–11) |
| `LeftSidebar.tsx` | — | Wallet toasts / balances | Currency only | **Excluded** (number `toLocaleString` only) |

**Last login / Member since (terminal):** Not shown in terminal chrome; user identity times live in **user panel** / **admin** (see sections 3–4).

---

## 3. USER PANEL — TIMESTAMP DISPLAY SURFACE

| File | Line(s) | What it shows | Source field | Current formatter |
|------|----------|---------------|--------------|-------------------|
| `UserDepositPage.tsx` | 24–26, 333 | Deposit history date | `item.createdAt` | Local `formatDate` |
| `UserOrdersPage.tsx` | 194 | Orders table “created” | `row.original.created_at` | `date-fns` `format('MMM d, HH:mm')` |
| `UserPositionsPage.tsx` | 208 | Open/close time column | `opened_at` / `closed_at` ms | `date-fns` `format('MMM d, yyyy HH:mm')` |
| `UserFundedProgramsPage.tsx` | 52–54, 221 | Purchased at | `plan.purchasedAt` | `toLocaleString(undefined, …)` |
| `UserAffiliatePage.tsx` | 501, 566 | Referral / commission dates | `r.createdAt`, `c.createdAt` | `date-fns` `format` (`PP`, `PPp`) |
| `UserSupportPage.tsx` | 29–32, 50 | Chat message + sidebar preview time | `dto.createdAt` | `toLocaleTimeString('en-US', hour12: false)` |
| `UserAppointmentsPage.tsx` | 144 | Appointment card | `apt.scheduled_at` | `formatDate` + `formatTime` from `appointments/utils/format.ts` |
| `UserProfilePage.tsx` | — | Profile fields | — | **No created/joined timestamp** rendered in first ~200 lines |
| `UserWithdrawPage.tsx` | — | Recent withdrawals | Placeholder empty state | **No timestamps yet** (“backend connected” copy only) |
| `UserKycPage.tsx` | — | (grep) | — | **No `Date`/`format` display** in page source reviewed via search — submission list may be modal-driven elsewhere |

**Auth pages (`src/pages/auth/**`):** No user-visible historical timestamps found (grep empty).

---

## 4. ADMIN PANEL — TIMESTAMP DISPLAY SURFACE

**Implicit timezone today:** Almost all UI uses **browser local** (`undefined` locale / `en-US` / `date-fns` local) or **fixed `en-US`**. Nothing resolves **viewed user’s** IANA zone.

**Admin context for “viewed user”:** `UserDetailsModal` and admin trading/finance routes are **user-scoped** when a `userId` is selected; list pages show **many users** in one table — those cells would need **per-row** effective zone (from row’s user + group) for the product requirement.

### Admin Users

| File | Line(s) | What it shows | Source | Formatter |
|------|---------|---------------|--------|-----------|
| `UsersTable.tsx` | 636 | User created | `createdAt` column | `formatDateTime` (adminUsers utils) |
| `UserDetailsModal.tsx` | 1429, 1469 | Created at, Last login | `userState.createdAt`, `userState.lastLogin` | `formatDateTime` / “Never” |
| `UserDetailsModal.tsx` | 1437 | Account age | `userState.createdAt` | `formatAccountAge` (day-diff based, not TZ-critical) |
| `UserDetailsModal.tsx` | 1123–1125 | Transactions tab — created | `createdAt` | `formatDateTime` |
| `UserDetailsModal.tsx` | 2121–2125 | Positions sub-table open/close | `openedAtMs` / `closedAtMs` | `formatDateTime(new Date(ms).toISOString())` |
| `UserDetailsModal.tsx` | 168, 184, 870 | Support chat bubbles | `dto.createdAt` | `formatChatTime` → `toLocaleTimeString('en-US', hour12: false)` |
| `UserDetailsModal.tsx` | 2409 | Internal notes | `note.createdAt` | `formatDateTime` |
| `AdminUsersPage.tsx` | 38–39 | User search / palette prep | `created_at` / `last_login_at` | `toISOString()` for data, not display |

### Admin User Events

| File | Line(s) | What it shows | Source | Formatter |
|------|---------|---------------|--------|-----------|
| `UserEventsTable.tsx` | 13–15, 35 | Event time | `row.original.createdAt` | `date-fns` `format('MMM d, yyyy HH:mm:ss')` |

### Admin Trading (orders, positions, audit, controls)

| File | Line(s) | What it shows | Source | Formatter |
|------|---------|---------------|--------|-----------|
| `OrdersTable.tsx` | 146 | Created | `row.original.createdAt` | `date-fns` `format` |
| `PositionsTable.tsx` | (no date in grep subset) | — | — | **UNCERTAIN:** confirm if hidden columns exist beyond grep |
| `OrdersAdminPanel.tsx` | 190 | Created | `createdAt` | `formatDateTime` (adminTrading) |
| `PositionsAdminPanel.tsx` | 180 | Opened | `openedAt` | `formatDateTime` |
| `OrderDetailsModal.tsx` | 87, 92 | Created / filled | `order.createdAt`, `order.filledAt` | `date-fns` `PPpp` |
| `PositionDetailsModal.tsx` | 104, 109 | Opened / closed | `openedAt`, `closedAt` | `date-fns` `PPpp` |
| `OrderDetailsModal.tsx` (modals/) | 110 | Margin / risk event time | `item.time` | `formatDateTime` |
| `PositionDetailsModal.tsx` (modals/) | 93, 98 | Opened / closed | `position.openedAt`, `closedAt` | `formatDateTime` |
| `EventDetailsModal.tsx` | 57 | Event time | `event.time` | `formatDateTime` |
| `AdminAuditPanel.tsx` | 77 | Audit log | `log.timestamp` | `date-fns` `PPpp` |
| `TradingControlsAdminPanel.tsx` | 35, 64, 106 | Injected `time` field / column | `new Date().toISOString()` when recording | `formatDateTime` |
| `MarginEventsAdminPanel.tsx` | 76 | Event time | `time` | `formatDateTime` |
| `TradingStatsCards.tsx` | 17–18 | “Today” bucketing | `e.time` | `toDateString()` comparison (logic, affects labels indirectly) |

### Admin Transactions / Finance

| File | Line(s) | What it shows | Source | Formatter |
|------|---------|---------------|--------|-----------|
| `FinanceTransactionsPanel.tsx` | 288 | Transaction created | `createdAt` | `formatDateTime` |
| `FinanceOverviewPanel.tsx` | 101 | Date column | derived `dateValue` | `formatDateTime` |
| `TransactionDetailsModal.tsx` | 79, 84 | Created / updated | `transaction.createdAt`, `updatedAt` | `formatDateTime` |
| `FinanceWalletsPanel.tsx` | 166 | Wallet updated | `updatedAt` | `formatDateTime` |
| `WalletDetailsModal.tsx` | 25 | Ledger time | `time` | `formatDateTime` |

### Admin Leads + Lead detail

| File | Line(s) | What it shows | Source | Formatter |
|------|---------|---------------|--------|-----------|
| `LeadsTable.tsx` | 200 | Lead created | `createdAt` | `formatDateTime` (leads utils) |
| `AdminLeadDetailPage.tsx` | 432, 442, 455, 512, 553 | Lead meta, activities, appts | `createdAt`, `lastActivityAt`, `convertedAt`, `scheduled_at` | Local `formatDate` → `toLocaleString(undefined, …)` |

### Admin Appointments

| File | Line(s) | What it shows | Source | Formatter |
|------|---------|---------------|--------|-----------|
| `AdminAppointmentsTable.tsx` | 113 | Scheduled | `apt.scheduled_at` | `formatDate` + `formatTime` |
| `ViewAppointmentModal.tsx` | 36 | Scheduled | `appointment.scheduled_at` | `formatDateTime` |
| `SendReminderModal.tsx` | 29, 31 | Email subject/body text | `scheduled_at` | `formatDateTime` (user-facing **email** copy) |

### Admin KYC

| File | Line(s) | What it shows | Source | Formatter |
|------|---------|---------------|--------|-----------|
| `AdminKycPage.tsx` | 24–28, 137, 146 | Submitted / reviewed | `submittedAt`, `reviewedAt` | `toLocaleDateString(undefined, …)` |
| `KycSubmissionDetailModal.tsx` | 33–37, 284–286 | Detail header | `submittedAt`, `reviewedAt` | Same |

### Admin Call Records / WebRTC history

| File | Line(s) | What it shows | Source | Formatter |
|------|---------|---------------|--------|-----------|
| `AdminCallUserPage.tsx` | 300 | Initiated at | `row.original.initiatedAt` | `date-fns` `format` |

### Admin Bulk Operations

| File | Line(s) | What it shows | Source | Formatter |
|------|---------|---------------|--------|-----------|
| `BulkUserCreation.tsx` | 180 | CSV filename token | `new Date()` | `toISOString()` slice (export metadata, not a table) |
| `BulkCreateUsersSection.tsx` | — | UI table | — | **No result timestamps** (TODO bulk API) |

### Admin Managers

| File | Line(s) | What it shows | Source | Formatter |
|------|---------|---------------|--------|-----------|
| `ManagersTable.tsx` | 210, 219 | Created / last login | `createdAt`, `lastLoginAt` | `formatDateTime` (managers utils) |
| `ManagerDetailPage.tsx` | 327, 364 | Recent deposits / withdrawals “time” | `row.time` | Precomputed **relative string** in `useManagerStats.ts` (`formatRelativeTime`) |

### Admin Affiliate (separate from user affiliate)

| File | Line(s) | What it shows | Source | Formatter |
|------|---------|---------------|--------|-----------|
| `AffiliatePage.tsx` | 407, 461 | Attribution / payout dates | `attributedAt`, `createdAt` | `date-fns` `format` |
| `SchemeDetailsModal.tsx` | 78, 82 | Layer created/updated | `createdAt`, `updatedAt` | `date-fns` `PPpp` |

### Admin Support / Chat

| File | Line(s) | What it shows | Source | Formatter |
|------|---------|---------------|--------|-----------|
| `UserDetailsModal.tsx` | (see Admin Users) | Admin ↔ user chat | `createdAt` | `formatChatTime` |

**UNCERTAIN:** Dedicated “admin support inbox” page (if any) not found under `admin*Support*` glob; primary path is **inside `UserDetailsModal`**.

### Admin Promotions slides

| Area | Timestamps |
|------|------------|
| `src/features/adminPromotions/**` | **No** `format` / `Date` display grep hits — admin UI appears metadata-light |

### Other admin-adjacent

| File | Line(s) | What it shows | Source | Formatter |
|------|---------|---------------|--------|-----------|
| `TagsTable.tsx` | 107 | Tag created | `createdAt` | `formatDateTime` from `@/shared/utils/time` |
| `AiReports` `UserReportsListTab.tsx` | 113 | Report created | `createdAt` | `formatDateTime` (reuses **adminUsers** formatter) |
| `SystemPage.tsx` | 70 | “Last updated” for stats | `stats.timestamp` | `toLocaleString()` |
| `DashboardPage.tsx` | 152, 158 | Activity feed + new users | `tx.createdAt`, `u.created_at` | `formatRelativeTime` + `toLocaleString` |
| `FeesChart.tsx` / `RevenueChart.tsx` | ~20–22 | Chart axis day labels | Aggregated `yyyy-mm-dd` keys | `toLocaleDateString('en-US', …)` |
| `adminMarkup` / `PriceStreamProfilesPanel` / `ProfilesTable` | various | Profile ages / updated | `updatedAt` etc. | `formatDateTime` / `formatDistanceToNow` |
| `leverageProfiles` components | various | Profile list “updated” | `updatedAt` | `formatDistanceToNow` |

---

## 5. SHARED COMPONENTS WITH TIMESTAMPS

| File | Line(s) | What it shows | Source | Formatter |
|------|---------|---------------|--------|-----------|
| `NotificationBell.tsx` | 105 | Dropdown items | `item.createdAt` | `toLocaleString()` |
| `UserSearchPalette.tsx` | 42–43 | Normalized user DTO | API `created_at` | `toISOString()` (data shaping) |
| `DataTable.tsx` | — | Generic | — | **No default date cell** |
| `DeleteConfirmationPopup.tsx` | — | Position qty/price | — | Numbers only |
| `requestTiming.ts` | `formatTimingForToast` | Dev toast timing | Performance ms | **Not wall-clock** |

---

## 6. BACKEND — WHAT SHIPS TO THE CLIENT

**General pattern:** `chrono::DateTime<Utc>` serializes to **RFC3339 with `Z`** via `serde_json` unless manually stringified. Many list endpoints explicitly call **`.to_rfc3339()`** into a `String` field for stable string typing.

| Area | Format | Naming | Sample reference |
|------|--------|--------|------------------|
| `GET /api/auth/me` (`UserResponse`) | ISO-8601 / RFC3339 for `chrono` fields | JSON keys **`snake_case`** (e.g. `first_name`, `created_at`, `group_id`) — frontend maps to camelCase in `auth.api.ts` | `backend/auth-service/src/routes/auth.rs` L1099–1125; `src/shared/api/auth.api.ts` (e.g. L213) |
| Orders list (`orders.rs`) | RFC3339 strings | `created_at`, `updated_at`, `filled_at`, `cancelled_at` | `orders.rs` ~L1096 |
| Notifications (`get_notifications`) | RFC3339 string | **Rust field** `created_at` with `#[serde(rename_all = "camelCase")]` → JSON **`createdAt`** | `deposits.rs` L2997–3106 |
| User events list | RFC3339 (serialized `DateTime<Utc>`) | `created_at` on items | `user_events_service.rs` L42 |
| Call records | RFC3339 strings | `initiated_at`, `answered_at`, `ended_at`, `created_at`, `updated_at` | `admin_call_records.rs` L325–331 |
| Admin settings general | Plain strings | `siteName`, `timezone`, `currency` (DTO `camelCase`) | `admin_settings.rs` L117–123 |
| Chat messages | **UNCERTAIN:** exact JSON key casing without opening `chat.rs` DTOs — likely `createdAt` / `created_at` mix; frontend accepts both in several places | `SupportChatTab.tsx` L82 |

**Positions / wallet / finance types:** Typically ISO strings or numeric ms in TS types — align per endpoint when implementing (grep `positions.api.ts`, `finance.api.ts`).

---

## 7. USER & GROUP SCHEMA — WHERE TIMEZONE GOES

### `users` (from `infra/migrations/001_initial_schema.sql` + later alters)

- **Initial columns:** `id` UUID PK, `email`, `group_id`, `leverage_profile_id`, `status`, `created_at`, `updated_at` (L2–9).
- **Many later migrations** add profile, auth, KYC, etc. (not fully enumerated here).
- **`timezone`-like column:** **None** found in `infra/migrations` grep for `users` + `timezone`.

### `user_groups` (`infra/migrations/044_create_user_groups.sql` + follow-ons)

- Core group record with `id`, `name`, `description`, `status`, …
- FK: **`users.group_id` → `user_groups.id`** (UUID).
- **`timezone`-like column on group:** **None** in migrations grep.

### Platform default

- `platform_general_settings.timezone` exists (`060_platform_general_settings.sql` L7) — **TEXT**, default `'UTC'`.

### `/api/auth/me` and `group_id`

- Handler loads `user.group_id` and joins group for names (`auth.rs` L1051–1079, L1111).
- **`group_id` is returned** in `UserResponse` (`auth.rs` L1111).

---

## 8. `/api/auth/me` — CURRENT PAYLOAD (Rust `UserResponse`)

**Wire format:** Serde default **snake_case** JSON keys (no `#[serde(rename_all = "camelCase")]` on `UserResponse`). The SPA normalizes to camelCase in `src/shared/api/auth.api.ts`.

From `backend/auth-service/src/routes/auth.rs` L110–156:

- `id`, `email`, `first_name`, `last_name`, `role`, `status`
- Optional: `phone`, `country`, `created_at`, `last_login_at`, `referral_code`
- Optional: `group_id`, `group_name`, `min_leverage`, `max_leverage`, `price_profile_name`, `leverage_profile_name`
- Optional: `account_type`, `margin_calculation_type`, `trading_access`, `open_positions_count`
- Optional: `permission_profile_id`, `permission_profile_name`, `permissions: Vec<String>`
- Optional: `hide_leverage_in_terminal`

**Not present today:** any `timezone` / `effectiveTimezone` / `groupTimezone`.

---

## 9. ADMIN GROUP & USER EDIT FORMS

### Real group CRUD: `GroupFormDialog` + `groups.api.ts`

| Aspect | Detail |
|--------|--------|
| **Files** | `src/features/groups/components/GroupFormDialog.tsx`, `src/features/groups/api/groups.api.ts` |
| **Fields** | `name`, `description`, `status`, `margin_call_level`, `stop_out_level`, `signup_slug`, `hide_leverage_in_terminal` (see dialog L13–21, L73–80) |
| **Submit** | `POST /api/admin/groups`, `PATCH/PUT`-style via `updateGroup(id)` → `http` to `/api/admin/groups/{id}` (see `groups.api.ts` L112+) |
| **Body** | `toSnakeCase` maps camel → snake for API (`groups.api.ts` L47–57) |
| **Validation** | **Zod** + `react-hook-form` + `@hookform/resolvers/zod` |

**Legacy modals (`CreateGroupModal.tsx`, `EditGroupModal.tsx`):** Still present with **zod** + **`toast` only — no `createGroup`/`updateGroup` API** (submit handlers close modal; **not wired** to backend).

### Admin user edit: `CreateEditUserModal.tsx` + `users.api.ts`

| Aspect | Detail |
|--------|--------|
| **Fields** | `firstName`, `lastName`, `email`, `phone`, `country`, `group`, `status`, leverage min/max, `permissionProfile` (`CreateEditUserModal.tsx` L19–33) |
| **Endpoints** | `PUT /api/admin/users/{id}/profile`, `PUT .../group`, permission profile update, role update (`users.api.ts` L46–118) |
| **Validation** | **Zod** + RHF |

**`UserDetailsModal.tsx`:** Large composite (finance, appointments, chat, positions); timezone dropdown likely belongs in **profile** or **new** “Regional” section + **group** dialog.

---

## 10. PLATFORM-LEVEL SETTINGS

| Item | Status |
|------|--------|
| **Table** | `platform_general_settings` (`060_platform_general_settings.sql`) with `timezone TEXT NOT NULL DEFAULT 'UTC'` |
| **API** | `GET/PUT /api/admin/settings/general` (`admin_settings.rs`) — `GeneralSettingsDto { site_name, timezone, currency }` |
| **Admin UI** | `src/features/settings/pages/SettingsPage.tsx` loads/saves timezone via `generalSettings.api.ts` → `/api/admin/settings/general` |
| **Used for display today?** | **No.** Timezone is **stored and edited** but **not referenced** by `formatDateTime` helpers or terminal clock (grep hits only settings + comment in `RightTradingPanel`). |
| **For your feature** | This column is the natural **platform default** in the resolution chain — you will **wire** existing storage into effective-timezone resolution + `/me`, not add a duplicate column. |

---

## 11. CHARTING LIBRARY (`klinecharts`)

| Topic | Finding |
|-------|---------|
| **Init** | `init(CHART_CONTAINER_ID)` in `src/features/terminal/components/ChartPlaceholder.tsx` (L235). |
| **Data** | Fetches klines with `timestamp` in ms (`ChartPlaceholder.tsx` imports `KLineData`). |
| **Timezone option in bundled `klinecharts` v10 beta** | **UNCERTAIN from source grep** in `node_modules/klinecharts` (no `timezone` string hit). Likely need official **klinecharts** doc or read chart instance API for `setLocale` / custom formatter hooks. |
| **Axis labels** | Default library formatting from **bar timestamps** → effectively **local browser** interpretation of those UTC ms unless chart provides TZ override. |
| **On timezone change** | Expect **`dispose` + `init`** or chart API **locale / formatter refresh** if exposed — verify against klinecharts v10 API before implementation. |

---

## 12. WHAT’S OUT OF SCOPE (CONFIRMED NON–USER-FACING OR INTERNAL)

| Item | Why not user-visible / not a display concern |
|------|---------------------------------------------|
| Tick timestamps in WS price stream | Internal streaming / chart data path; users see **formatted prices**, not raw tick epoch in UI grep scope |
| Order matching engine timestamps | Server-only |
| SL/TP trigger evaluation times | Server-only logic |
| Swap charging schedules | Server/batch jobs |
| Idempotency key TTLs | Protocol / storage |
| JWT `exp` / `iat` | Security metadata, not shown in tables |
| `Date.now()` for ping / intervals | Diagnostics, not “calendar time” presentation |
| `formatTimingForToast` | Humanizes **request duration**, not wall time |

---

## 13. COUNT & ESTIMATE

| Metric | Value |
|--------|--------|
| **Distinct timestamp render sites (approx. checklist rows across sections 2–6, incl. modals/tabs)** | **~110** |
| **Distinct TS/TSX files matching common date-display grep patterns (union)** | **67** |
| **Files touched if consolidated through one `@/shared/datetime` module + deleting duplicate `formatDateTime` copies** | **~40–50** (depends how aggressively admin feature utils are merged) |
| **Files touched if every callsite edited in place without shared migration** | **67+** |
| **Estimated engineering effort** | **3–6 days** for MVP (effective zone in `/me`, central formatter, major tables, appointments semantics, admin viewed-user behavior) + **+2–4 days** for chart (`klinecharts` investigation + edge cases) + QA across admin surfaces |

---

### Appendix — duplicate `formatDateTime` implementations (**resolved**)

**Status (Phase 4, May 2026):** Per-feature duplicate formatter modules were removed. Canonical wall-clock formatting: `src/shared/datetime/`. Non-date helpers: `src/shared/utils/currency.ts`, `number.ts`, `duration.ts`. Appointment status badge classes: `src/features/appointments/utils/appointmentStatusBadges.ts`. `src/shared/utils/time.ts` now re-exports datetime hooks only (legacy UTC helpers removed). Full file list and import map: `docs/phase-4-timezone-cleanup.md`.

---

*Generated as read-only inventory. Line numbers refer to the workspace state at diagnostic time.*
