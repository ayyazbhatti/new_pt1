# Phase 4 — Slippage admin UI (platform + groups)

## Step 1 / Step 2 outcome (backend)

Phase 1 added DB columns, but **admin API did not expose them**:

- `GET/PUT /api/admin/settings/general` (`GeneralSettingsDto`) had only `site_name`, `timezone`, `currency`.
- Group `CreateGroupRequest` / `UpdateGroupRequest` and `UserGroup` model / `INSERT`/`UPDATE`/`SELECT` list paths did not include `default_slippage_bps`.

**Step 2 was required** and implemented in `backend/auth-service`:

| Area | Change |
|------|--------|
| `admin_settings.rs` | `GeneralSettingsDto.default_slippage_bps` (default 50 via serde), validation `>= 0`, `SELECT`/`UPDATE` include column |
| `models/user_group.rs` | `default_slippage_bps: Option<i32>` with `#[sqlx(default)]` |
| `admin_groups.rs` | `CreateGroupRequest.default_slippage_bps: Option<i32>`, `UpdateGroupRequest.default_slippage_bps: Option<Option<i32>>` (omit / clear / set) |
| `admin_groups_service.rs` | `create_group` / `update_group` params + SQL; list `SELECT`s include `default_slippage_bps`; `UserGroupRowMinimal` / `WithProfiles` `From` set field |

## Admin UI (frontend)

### 1. Settings → General

- **File:** `src/features/settings/pages/SettingsPage.tsx`
- **API:** `src/features/settings/api/generalSettings.api.ts` — `GeneralSettings.defaultSlippageBps: number`
- Numeric input (min 0, step 1), live **%** readout (`bps / 100`), helper text on platform default vs group / per-order caps.

### 2. Group create / edit

- **File:** `src/features/groups/components/GroupFormDialog.tsx`
- Optional bps input, empty = use platform default; **Clear** sets `null`; helper references loaded platform default from `getGeneralSettings`.
- **Types:** `src/features/groups/types/group.ts` — `UserGroup.defaultSlippageBps`, payload `default_slippage_bps`
- **API mapping:** `src/features/groups/api/groups.api.ts` — `toCamelCase` / `toSnakeCase`

### Validation

- **Platform:** `>= 0` (server `VALIDATION`); UI uses `min={0}` and parsed integer.
- **Group:** Zod `z.union([z.number().int().min(0), z.null()]).optional()`; input only sets non-negative integers or null.

### Group list column

- **Skipped** (table crowded); value visible in group modal.

## Smoke tests

Not run in this session (no admin browser / DB). Manual checks:

1. Settings → General: change bps, save, reload.
2. `SELECT default_slippage_bps FROM platform_general_settings WHERE singleton_id = 1;`
3. Groups → edit: set / clear `default_slippage_bps`, save, reload.
4. `SELECT default_slippage_bps FROM user_groups WHERE id = '…';`
5. Terminal `/me` resolution (group vs platform) unchanged — still Phase 1 backend logic.
