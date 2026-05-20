# Fix: Admin Settings → General tab save and load

## Summary

The General tab had local React state only; **Save Changes** did nothing. **Site name**, **timezone**, and **default currency** now load from and persist to Postgres via new admin settings endpoints. Contact / social fields remain **UI-only** (not in DB) until a follow-up adds columns.

## Migration

**File:** `infra/migrations/060_platform_general_settings.sql`  
**Prefix:** `060`

Creates singleton table `platform_general_settings` (`singleton_id = 1`) with:

- `site_name`, `timezone`, `currency`
- `created_at`, `updated_at`

Seeds one row with defaults (`Trading Platform`, `UTC`, `USD`).

## API endpoints

Mounted under existing **`/api/admin/settings`** (`create_admin_settings_router` in `backend/auth-service/src/routes/admin_settings.rs`).

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `GET` | `/api/admin/settings/general` | `settings:view` | Returns `{ siteName, timezone, currency }` (camelCase JSON). |
| `PUT` | `/api/admin/settings/general` | `settings:edit` | Body same shape; validates site name (non-empty, ≤100 chars), timezone (non-empty), currency (3-letter A–Z). Returns updated object. Errors: `400` with `{"error":{"code":"VALIDATION","message":"..."}}`. |

Implementation mirrors **`get_voiso_config` / `put_voiso_config`**: `check_settings_permission`, `ensure_*_row`, structured errors.

## Frontend

| File | Change |
|------|--------|
| `src/features/settings/api/generalSettings.api.ts` | **New** — `getGeneralSettings`, `updateGeneralSettings`. |
| `src/features/settings/pages/SettingsPage.tsx` | React Query `['admin','settings','general']`; sync `siteName` / `timezone` / `defaultCurrency` from GET; **Save** PUT + toast; **Reset** restores last server snapshot for those three only; Save disabled when not dirty or pending; inputs disabled without `settings:edit`; loading/error when missing `settings:view` or fetch fails. |

## Manual test

1. Apply migration `060` (e.g. `psql` or compose migrations job against your DB).
2. Restart **auth-service**.
3. Open **Admin → Settings → General** as a user with `settings:view` and `settings:edit`.
4. Change **Site name** → **Save Changes** → success toast → hard refresh → name persists.
5. Confirm user without `settings:edit` sees fields read-only and no Save row (unchanged from before).

## Verification

- `cargo check -p auth-service` (from `backend/auth-service`): passes.
- `npx tsc --noEmit` (repo root): passes.
