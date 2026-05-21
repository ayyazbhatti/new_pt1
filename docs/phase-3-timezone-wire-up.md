# Phase 3 — Effective timezone wire-up

This document records the Phase 3 work: central datetime hooks in React components, UTC fallbacks in legacy formatter modules, admin viewed-user overrides, terminal clock, and appointment wall-clock handling.

## 1. Eight formatter modules (UTC non-hook + hook re-exports)

These delegate non-hook calls to `@/shared/datetime/format` with `'UTC'` and re-export hooks from `@/shared/datetime/hooks` (or `@/shared/datetime` where applicable):

| File | Notes |
|------|--------|
| `src/shared/utils/time.ts` | `formatDate`, `formatDateTime`, `formatRelative` + hooks |
| `src/features/adminUsers/utils/formatters.ts` | DateTime + `formatCurrency`, `formatAccountAge` unchanged |
| `src/features/adminTrading/utils/formatters.ts` | Seconds variant preserved for trading UI where needed |
| `src/features/adminFinance/utils/formatters.ts` | |
| `src/features/adminMarkup/utils/formatters.ts` | |
| `src/features/adminLeads/utils/formatDate.ts` | `formatRelative` aligned with central copy |
| `src/features/managers/utils/formatters.ts` | |
| `src/features/appointments/utils/format.ts` | `formatDate`, `formatTime`, `formatDateTime` + status helpers |

**Phase 4** (completed): duplicate formatter files removed; see `docs/phase-4-timezone-cleanup.md`. The table above is **historical** for Phase 3.

## 2. Component conversions (hooks from `@/shared/datetime`)

Representative groups updated in this phase:

### Terminal

- `RightTradingPanel.tsx` — Effective TZ clock: `UTC+5 · Asia/Karachi` style label + `en-GB` time/date, 1s tick.
- `BottomDock.tsx` — `useFormatDateTime`, `useFormatDateTimeSeconds`, `useFormatTime` for position/order/history cells.
- `TerminalHistoryView.tsx` — `useFormatDateTimeSeconds` for closed positions and filled orders.
- `NotificationsPanel.tsx` — `useFormatRelative`.
- `SupportChatTab.tsx` / `AiChatTab.tsx` — `useFormatTime` (AiChatTab passes formatter into merge helpers).
- `PaymentPanel.tsx` — `useFormatDateTime` for deposit timestamps.

### Admin — tables & modals

- `UsersTable.tsx` (already), `LeadsTable.tsx`, `TagsTable.tsx`, `ManagersTable.tsx`, `UserEventsTable.tsx`, `UserReportsListTab.tsx`
- Trading: `OrdersAdminPanel`, `PositionsAdminPanel`, `MarginEventsAdminPanel`, `TradingControlsAdminPanel`
- Trading modals: `OrderDetailsModal`, `EventDetailsModal`, `PositionDetailsModal`
- Finance: `FinanceWalletsPanel`, `FinanceOverviewPanel`, `FinanceTransactionsPanel`, `WalletDetailsModal`, `TransactionDetailsModal`
- Markup: `PriceStreamProfilesPanel`
- Appointments: `AdminAppointmentsTable`, `ViewAppointmentModal`, `SendReminderModal`, `CreateAppointmentModal`, `EditAppointmentModal`

### Appointments — wall-clock for trader

- `CreateAppointmentModal.tsx` — Label + `fromZonedWallClock` using selected user’s resolved IANA (or admin effective TZ for lead-only flow).
- `EditAppointmentModal.tsx` — Optional `wallClockTimezone`, `wallClockPartsInTimezone` for init, `fromZonedWallClock` on save.
- `UserSearchResult` (`appointments/types`) — `timezone`, `group_timezone`, `effective_timezone` optional fields for search results.

### Admin user detail

- `UserDetailsModal.tsx` — `TimezoneOverrideProvider`, hooks, inline appointment create uses trader TZ (prior work in this branch).

## 3. `TimezoneOverrideProvider` locations

| Location | Behaviour |
|----------|-----------|
| `UserDetailsModal.tsx` | Subtree uses viewed user’s `timezone` / `groupTimezone` (from user state). |
| `AdminLeadDetailPage.tsx` | When `lead.convertedUserId` is set, subtree wraps `leadDetailMain`; resolves converted user row via `listUsers` search by email for `timezone` / `group_timezone`. |
| `ManagerDetailPage.tsx` | When `listUsers` finds the manager’s backing user row, subtree uses that user’s `timezone` / `group_timezone`. |

List-style admin tables (many users) stay on the **admin’s** effective timezone.

## 4. Terminal clock (`RightTradingPanel`)

Replaced browser-local `getTimezoneOffset` / `toTimeString` strip with:

- `useEffectiveTimezone()`, `useTimezoneOffsetLabel()`
- `Intl.DateTimeFormat('en-GB', { timeZone: tz.iana, … })` for time and date (date segments with `/` → `.`)

## 5. Appointments special case

- Admin types schedule in the **trader’s** wall-clock zone when a user is selected (`CreateAppointmentModal`).
- Lead-only scheduling uses the **scheduler’s** effective timezone (no trader row).
- Edit flow respects `wallClockTimezone` when opened from user context (`UserDetailsModal` passes user effective IANA).

## 6. Remaining / follow-up (not fully converted in this pass)

The diagnostic listed additional surfaces; some still use local `toLocaleString` / ad-hoc `formatDate` helpers. Non-exhaustive examples:

- Several **user panel** pages (`UserDepositPage`, `UserFundedProgramsPage`, …) — local date helpers or `toLocaleString` for timestamps.
- **Dashboard**, **System**, **NotificationBell**, **Admin Kyc**, **Admin calls**, **Affiliate**, **Groups**, **Leverage profiles**, **Admin markup `ProfilesTable`** — verify and switch to hooks where timestamps are shown.

Legacy **non-React** callers should keep using the UTC defaulting functions in the eight formatter modules.

## 7. Build verification

```bash
npx tsc --noEmit
```

Last run in this work: **exit code 0** (no new TS errors).

## 8. Smoke tests

**Not executed in the agent environment** (no live auth). Recommended manual checks:

1. User `Asia/Karachi` → terminal clock shows `UTC+5 · Asia/Karachi` and matching wall time.
2. Positions / notifications / history show Karachi time.
3. Admin (UTC) → users list `created_at` in UTC via hooks context.
4. Open Karachi user in **UserDetailsModal** → times in Karachi; close → list back to admin TZ.
5. Create appointment for Karachi user at 10:00 → user sees 10:00 in their zone; change user TZ to London → stored instant displays as shifted wall time.
