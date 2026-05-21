# Phase 2 — Per-user effective timezone (backend + admin plumbing)

This phase adds database columns, API fields, admin UI to configure timezones, and a root `TimezoneProvider` fed from `GET /api/auth/me`. **No existing timestamp formatters or display callsites were changed** (Phase 3).

## Migrations

- **Infra:** `infra/migrations/063_timezone_columns.sql`  
  - `user_groups.timezone` (optional IANA `TEXT`)  
  - `users.timezone` (optional IANA override `TEXT`)  
  - Comments on columns; platform default remains `platform_general_settings.timezone` (unchanged schema).

- **Auth-service (parallel tree):** `backend/auth-service/migrations/20260524100000_timezone_columns.sql`  
  - Same SQL as infra file (project convention).

## Backend (auth-service)

### Resolution and validation

- **`backend/auth-service/src/utils/effective_timezone.rs`**  
  - `fetch_platform_timezone` reads `platform_general_settings.timezone` (`singleton_id = 1`).  
  - `resolve_effective_timezone`: user → group → platform → `UTC` with origins `user` | `group` | `platform` | `fallback`.  
  - Invalid IANA strings are skipped using **`chrono-tz`** (`Cargo.toml` dependency).

### Models

- `users.timezone` → `User.timezone: Option<String>` in `models/user.rs`.  
- `user_groups.timezone` → `UserGroup.timezone: Option<String>` in `models/user_group.rs` (including legacy `From` helpers in `admin_groups_service.rs`).

### `UserResponse` and `/me`

- `backend/auth-service/src/routes/auth.rs` — `UserResponse` adds (serde default field names = **snake_case** JSON):  
  - `timezone`, `group_timezone`, `effective_timezone`, `effective_timezone_origin`  
- Shared builder **`build_user_response`** loads group row (including `ug.timezone AS group_timezone`), platform timezone, permissions, and fills the four new fields. Used by:  
  - `GET /api/auth/me`  
  - `PATCH /api/auth/me`  
  - `POST /api/auth/login`  
  - `POST /api/auth/register` (still returns `permissions: []` for empty-permission bootstrap)  
  - `GET /api/auth/users` (paginated list)

### Admin groups

- `CreateGroupRequest` / `UpdateGroupRequest` accept optional `timezone` (`Option<String>` / `Option<Option<String>>` for clear-on-update).  
- `AdminGroupsService::create_group` / `update_group` write `user_groups.timezone` (empty → `NULL`).  
- `GET /api/admin/groups/:id` returns `UserGroup` with `timezone` via `RETURNING *`.

### Admin users

- `UpdateUserProfileRequest` adds `timezone: Option<Option<String>>` (serde: omit = no change, `null` = clear override).  
- `PUT /api/admin/users/:id/profile` updates `users.timezone` via `CASE WHEN $7 THEN $8 ELSE timezone END`.

## Frontend

### Types and `/me` mapping

- `src/shared/api/auth.api.ts` — `MeResponse` includes `timezone`, `groupTimezone`, `effectiveTimezone`, `effectiveTimezoneOrigin`; `mapUserResponseToMe` maps snake_case from API.  
- `src/shared/api/users.api.ts` — list `UserResponse` includes `timezone`, `group_timezone`, `effective_timezone`, `effective_timezone_origin`.  
- `src/features/adminUsers/pages/AdminUsersPage.tsx` — `mapUserResponse` copies these onto the table `User` type.

### `TimezoneSelect`

- `src/shared/components/TimezoneSelect.tsx` — native `<select>`, `Intl.supportedValuesOf('timeZone')` with fallback list; labels use `shortOffset` (same styling tokens as other inputs).

### Admin group form

- `src/features/groups/components/GroupFormDialog.tsx` — timezone field + hint; platform default label from `getGeneralSettings()` when the dialog is open.  
- `src/features/groups/api/groups.api.ts` / `types/group.ts` — `timezone` on payloads and `UserGroup`.

### Admin user form

- `src/features/adminUsers/modals/CreateEditUserModal.tsx` — `TimezoneSelect`, hints for effective + group default; `updateUserProfile` sends `timezone`; invalidates `profileQueryKey` when the edited user is the current admin.  
- `src/features/adminUsers/api/users.api.ts` — `UpdateUserProfilePayload.timezone`.

### User details (read-only metadata)

- `src/features/adminUsers/modals/UserDetailsModal.tsx` — overview shows effective, group default, and user override (editing still via Create/Edit modal per existing flow).

### Users table

- `src/features/adminUsers/components/UsersTable.tsx` — **Timezone** column: effective + small **override** badge when `user.timezone` is set.

### `TimezoneProvider` mount

- `src/app/providers/AppShellTimezoneProvider.tsx` — `useQuery(profileQueryKey, me)` when tokens exist after persist rehydrate; passes `userTimezone` / `groupTimezone` into `TimezoneProvider` (`platformTimezone` left `undefined`; `/me` already resolved platform in `effective_*`).  
- `src/app/providers/Providers.tsx` — wraps app shell inside `QueryProvider`: `QueryProvider` → `AppShellTimezoneProvider` → `ToastProvider` → …

## Smoke tests (manual)

> Not executed in this workspace session (no live DB/API). Follow these after deploy:

1. **Migration:** Apply infra migration (or auth-service migration) on staging; confirm existing rows get `NULL` new columns.  
2. **Group:** Admin sets group timezone to `Asia/Karachi`, save, reload — field persists.  
3. **User in group, no override:** As that user, `GET /api/auth/me` → `effective_timezone: "Asia/Karachi"`, `effective_timezone_origin: "group"`.  
4. **User override:** Set user timezone to `Europe/London` → `/me` → `effective_timezone: "Europe/London"`, `effective_timezone_origin: "user"`.  
5. **React:** `TimezoneProvider` context `iana` matches client `resolveEffectiveTimezone` (and should align with `/me` after load).  
6. **Regression:** No non-admin timestamp UI should change except new admin fields above.

## Commands verified locally

- `cargo check -p auth-service` — pass.  
- `npx tsc --noEmit` — pass.

## Lockfile

- `cargo check` pulled **`chrono-tz`** into `Cargo.lock` under `backend/auth-service`.
