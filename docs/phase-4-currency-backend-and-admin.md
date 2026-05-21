# Phase 4 — Currency backend and admin

This document describes Phase 4 of the display-currency workstream: database columns, `/me` and admin APIs, public FX rates, admin UI, `CurrencyProvider` at app root, and structured notification metadata for deposit flows.

## Migration

- **File:** `infra/migrations/064_display_currency_columns.sql` (parallel copy: `backend/auth-service/migrations/20260524110000_display_currency_columns.sql`)
- **Changes:**
  - `user_groups.display_currency` — optional ISO 4217 default for members.
  - `users.display_currency` — optional per-user override (highest priority).
- **Platform default:** `platform_general_settings.currency` (migration `060`) is wired into resolution; no new DDL.

## Backend — `/api/auth/me` and `UserResponse`

- **File:** `backend/auth-service/src/routes/auth.rs`
- **New fields on `UserResponse`** (JSON snake_case):
  - `display_currency`, `group_display_currency`
  - `effective_display_currency`, `effective_display_currency_origin`
  - `platform_display_currency` — from the singleton general-settings row so the client `CurrencyProvider` can resolve user → group → platform → USD consistently with the server.
- **Resolution:** `build_user_response` joins `user_groups.display_currency AS group_display_currency`, loads `(timezone, currency)` from `platform_general_settings` via `utils::effective_currency::fetch_platform_settings`, and uses `resolve_effective_display_currency` (user → group → platform → `USD`).
- **Timezone:** `build_user_response` now uses the same `fetch_platform_settings` query for platform timezone (replacing a second `fetch_platform_timezone` call).

## Backend — public FX rates

- **File:** `backend/auth-service/src/routes/fx_rates.rs`
- **Route:** `GET /api/fx-rates/current` (nested under `/api/fx-rates` in `lib.rs`).
- **Auth:** Standard `auth_middleware` only (no `settings:view`).
- **Response:** Same JSON shape as admin FX (`FxRatesApiPayload` in `services/fx_rates.rs`), shared with `routes/admin_fx.rs`.
- **Errors:** Redis failure on read returns `503 Service Unavailable`; empty cache returns the same empty payload as admin (`rates: {}`, `source: "none"`, `isStale: true`).

## Backend — admin groups and users

- **Groups:** `admin_groups.rs` — `CreateGroupRequest` / `UpdateGroupRequest` include `display_currency`; `AdminGroupsService::create_group` / `update_group` persist it (empty → NULL). List queries include `display_currency`.
- **Users:** `admin_users.rs` — `UpdateUserProfileRequest` adds `display_currency` (`Option<Option<String>>`); `UPDATE users` sets `display_currency` with the same CASE pattern as `timezone`.
- **List users:** Still `GET /api/auth/users`; each item is built with `build_user_response`, so the new currency fields are present on every `UserResponse`.

## Backend — notification structured `meta`

**File:** `backend/auth-service/src/routes/deposits.rs`

| Location / flow | `meta.kind` | Added structured fields |
|-----------------|-------------|---------------------------|
| Admin notification on new deposit request | `deposit_request` | `amount_usd`, `currency` (plus existing `transactionId`, `userId`, `amount`) |
| User notification on deposit approved | `deposit_approved` | `amount_usd`, `balance_usd`, `currency` (plus existing `transactionId`, `amount`) |
| User notification on deposit rejected | `deposit_rejected` | `amount_usd`, `currency` (plus existing `transactionId`, `amount`, `reason`) |

The `message` strings with `$` were **left unchanged** for backward compatibility.

## Frontend

- **`src/shared/currency/rates.ts`** — `fetchFxRates()` calls `/api/fx-rates/current` (Phase 3 TODO removed).
- **`src/shared/api/auth.api.ts`** — `MeResponse` + `UserResponse` + `mapUserResponseToMe` include currency fields and `platformDisplayCurrency`.
- **`src/shared/api/users.api.ts`** — `UserResponse` extended for admin list.
- **`src/shared/components/CurrencySelect.tsx`** — Native `<select>` with styling aligned to other form controls; options from `Intl.supportedValuesOf('currency')` when available, filtered to a common set plus USDT/USDC.
- **`src/features/groups/**`** — Types, API mapping, and `GroupFormDialog` (field below timezone; hints use platform default from general settings).
- **`src/features/adminUsers/**`** — `CreateEditUserModal` (currency field + hints), `UserDetailsModal` (read-only effective / group / user currency), `UsersTable` (“Currency” column with override badge), `users.api` `UpdateUserProfilePayload`.
- **`src/app/providers/AppShellTimezoneProvider.tsx`** — Wraps children with `CurrencyProvider` fed from `/me` (`displayCurrency`, `groupDisplayCurrency`, `platformDisplayCurrency`).

## Utility

- **`backend/auth-service/src/utils/effective_currency.rs`** — `fetch_platform_settings`, `resolve_effective_display_currency`.

## Smoke tests

Not run in CI from this session. Recommended checks:

1. Migrate dev DB; confirm columns exist on `users` and `user_groups`.
2. Admin: set group currency EUR; reload form — still EUR.
3. User in group without override: `GET /api/auth/me` → `effectiveDisplayCurrency: "EUR"`, `effectiveDisplayCurrencyOrigin: "group"`.
4. Set user override PKR — origin `user`.
5. React DevTools: `CurrencyProvider` value matches `/me`.
6. As trader: `GET /api/fx-rates/current` → 200, camelCase snapshot.
7. Approve deposit — notification `meta` includes `amount_usd` and `currency`.
8. Confirm non-admin monetary UI unchanged (Phase 5 will switch formatters).

## Related files (quick index)

| Area | Paths |
|------|--------|
| Migration | `infra/migrations/064_*`, `backend/auth-service/migrations/20260524110000_*` |
| Resolution + platform row | `utils/effective_currency.rs`, `routes/auth.rs` |
| Public FX | `routes/fx_rates.rs`, `lib.rs`, `services/fx_rates.rs` (payload helpers), `routes/admin_fx.rs` |
| Admin persistence | `routes/admin_groups.rs`, `services/admin_groups_service.rs`, `routes/admin_users.rs`, `models/user.rs`, `models/user_group.rs` |
| Notifications | `routes/deposits.rs` |
| Frontend | `rates.ts`, `auth.api.ts`, `users.api.ts`, `CurrencySelect.tsx`, `AppShellTimezoneProvider.tsx`, `groups/*`, `adminUsers/*` |
