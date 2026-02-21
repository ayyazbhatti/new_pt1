# Managers Page – Dynamic Implementation Plan

**Status:** Ready for implementation  
**Page:** `/admin/manager`  
**Goal:** Replace mock data with real backend APIs so the Managers page is fully dynamic and production-ready.

---

## 1. Executive Summary

- **Current state:** The Managers UI is complete and static (mocks only). The backend has `users.permission_profile_id` and `PUT /api/admin/users/:id/permission-profile` but no dedicated manager resource.
- **Recommended approach:** **Option B – dedicated `managers` table.** This matches the existing UI (notes, status active/disabled, create/edit/delete) and keeps a single source of truth for “who is a manager” and “what profile they have” without overloading the `users` table.
- **Scope:** One new migration, one new admin router in auth-service, one new frontend API module, and wiring the existing Managers page to it. No change to permission resolution (still driven by `users.permission_profile_id`; we keep it in sync with `managers` when status is active).

This plan is validated against the current codebase (auth-service routes, migrations, frontend `Manager` type and `http` client). Following it will produce a working end-to-end flow.

---

## 2. Current State (Reference)

| Area | What exists today |
|------|-------------------|
| **Frontend** | Full UI: KPI cards, filters (search, status, permission profile), table (Name, Email, Permission profile, Status, Created, Last login, Actions). Create / Edit / Delete / Enable–Disable modals. Uses `useCanAccess('users:view' | 'users:edit')`. |
| **Data** | `mockManagers` and `mockUsersAvailableForManager`. All create/edit/delete/disable only update React state. |
| **Backend** | `users.permission_profile_id` (nullable). `PUT /api/admin/users/:id/permission-profile` to set/clear. No managers table, no manager-specific notes or status. |

---

## 3. Backend: Two Approaches (Option B Recommended)

### Option A – Managers = users with a permission profile (no new table)

- **List:** New endpoint returns users where `permission_profile_id IS NOT NULL`.
- **Create/Edit:** Use existing `PUT /api/admin/users/:id/permission-profile`.
- **Disable/Delete:** Set `permission_profile_id = NULL` (or add a `manager_disabled` flag on `users` and enforce in auth).
- **Notes:** Would require a new column on `users` (e.g. `manager_notes`).

**Pros:** Minimal backend change.  
**Cons:** No first-class manager entity; notes and “disabled manager” require extra columns and logic on `users`. UI would not match current design without those additions.

### Option B – Dedicated `managers` table (recommended)

- New table `managers` holds: `id`, `user_id`, `permission_profile_id`, `status` ('active' | 'disabled'), `notes`, timestamps.
- **Single source of truth for “manager” list:** Only rows in `managers` appear on the Managers page.
- **Auth unchanged:** When a manager row exists and `status = 'active'`, keep `users.permission_profile_id` equal to `managers.permission_profile_id`. When `status = 'disabled'` or the row is deleted, set `users.permission_profile_id = NULL`.

**Pros:** Full parity with current UI (notes, status, create/edit/delete). Clear semantics and no extra columns on `users`.  
**Cons:** One new table and sync logic in create/update/delete.

**Decision:** The rest of this document specifies **Option B** so that implementation is unambiguous and will work 100% with the existing UI.

---

## 4. Option B – Full Specification

### 4.1 Migration

- **Location:** Add a new migration file (e.g. `database/migrations/0023_managers.sql` or `infra/migrations/009_managers.sql` depending on which folder your pipeline runs).
- **Content:**

```sql
-- Managers: users promoted to admin with a permission profile. One row per manager.
-- users.permission_profile_id is kept in sync when status = 'active'.

CREATE TABLE IF NOT EXISTS managers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  permission_profile_id UUID NOT NULL REFERENCES permission_profiles(id) ON DELETE RESTRICT,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_managers_user_id ON managers(user_id);
CREATE INDEX IF NOT EXISTS idx_managers_status ON managers(status);
CREATE INDEX IF NOT EXISTS idx_managers_permission_profile_id ON managers(permission_profile_id);
```

- **Backfill (optional):** If you already have users with `permission_profile_id` set and want them to appear on the Managers page, run a one-time insert (after migration) for those users, e.g. insert into `managers` (user_id, permission_profile_id, status) from users where permission_profile_id is not null and not already in managers. Implementation can do this in the same PR or a follow-up.

### 4.2 API Base Path and Auth

- **Base path:** `/api/admin/managers`
- **Server:** Auth-service (same as other admin routes). Register the new router in `main.rs` with `.nest("/api/admin/managers", create_admin_managers_router(pool.clone()))`.
- **Auth:** Use existing `auth_middleware` and require `claims.role == "admin"` (same pattern as `admin_users`, `admin_permission_profiles`). No new permission checks unless you later add something like `managers:view` / `managers:edit`.

### 4.3 API Contract (Option B)

All request/response bodies use **snake_case** (Rust/JSON convention). Frontend will map to camelCase in the API layer.

**Errors (4xx/5xx):** Respond with HTTP status and body:

```json
{ "error": { "code": "SOME_CODE", "message": "Human-readable message" } }
```

Existing frontend `http()` throws on non-2xx and attaches `error.response.data` with this shape; mutations can show `error.response?.data?.error?.message` in a toast.

---

#### GET /api/admin/managers

- **Purpose:** List all managers (for table + filters).
- **Query params (optional):**
  - `status` – filter by `active` | `disabled`
  - `permission_profile_id` – filter by profile UUID
  - `search` – optional; filter by user first_name, last_name, or email (case-insensitive substring)
- **Response:** `200 OK`, body: array of manager objects (see below).

**Response item (snake_case):**

```ts
{
  id: string              // UUID of managers.id
  user_id: string
  user_name: string       // e.g. first_name + ' ' + last_name from users
  user_email: string
  permission_profile_id: string
  permission_profile_name: string
  status: 'active' | 'disabled'
  notes: string | null
  created_at: string      // ISO 8601
  last_login_at: string | null  // from users.last_login_at
}
```

- **Implementation:** Single query joining `managers` ↔ `users` ↔ `permission_profiles`. Apply optional filters in WHERE. Order by `managers.created_at DESC` (or similar).

---

#### POST /api/admin/managers

- **Purpose:** Create a new manager (promote a user).
- **Request body:**

```ts
{
  user_id: string         // UUID
  permission_profile_id: string
  notes?: string | null
}
```

- **Validation:**
  - User must exist.
  - User must not already have a row in `managers` (return 409 Conflict with code e.g. `ALREADY_MANAGER`).
  - Permission profile must exist.
- **On success:** Insert into `managers` (status = 'active'), set `users.permission_profile_id = permission_profile_id` for that user. Return `201 Created` with the full manager object (same shape as list item).
- **Errors:** `400` (validation), `404` (user or profile not found), `409` (already a manager).

---

#### PUT /api/admin/managers/:id

- **Purpose:** Update a manager (profile, notes, or status).
- **Params:** `id` = manager UUID (managers.id).
- **Request body (all optional):**

```ts
{
  permission_profile_id?: string
  notes?: string | null
  status?: 'active' | 'disabled'
}
```

- **Validation:** If `permission_profile_id` is provided, profile must exist. Manager must exist.
- **On success:**
  - Update `managers` row (only provided fields).
  - **Sync rule:** If `status` is omitted or `'active'`, set `users.permission_profile_id = managers.permission_profile_id` (after update). If `status == 'disabled'`, set `users.permission_profile_id = NULL`.
  - Return `200 OK` with the full manager object (same shape as list item).
- **Errors:** `400`, `404` (manager or profile not found).

---

#### DELETE /api/admin/managers/:id

- **Purpose:** Remove manager access (delete manager record and revoke profile on user).
- **Params:** `id` = manager UUID.
- **On success:** Delete the `managers` row, set `users.permission_profile_id = NULL` for that user. Return `204 No Content` or `200` with a simple `{ "success": true }`.
- **Errors:** `404` if manager not found.

---

### 4.4 Backend Implementation Checklist (Option B)

- [ ] Add migration file (e.g. `0023_managers.sql` or `009_managers.sql`) with the `managers` table and indexes.
- [ ] Create `routes/admin_managers.rs` (or equivalent): implement list (with optional filters), create, update, delete; use existing auth middleware and admin role check.
- [ ] In create/update/delete, keep `users.permission_profile_id` in sync as specified above.
- [ ] Register router in `main.rs` at `/api/admin/managers`.
- [ ] (Optional) One-time backfill script or migration step for existing users that already have `permission_profile_id` set, so they appear in the new managers list.

---

## 5. Frontend Implementation

### 5.1 API Module

- **File:** `src/features/managers/api/managers.api.ts`
- **Base URL:** Same as rest of app; `http()` uses `/api/admin/managers` (no base path prefix needed).
- **Types:** Define a DTO type matching backend response (snake_case), then map to existing `Manager` type (camelCase) in the API layer so the rest of the app keeps using `Manager`.
- **Functions:**
  - `listManagers(params?: { status?: string; permission_profile_id?: string; search?: string })` → `GET /api/admin/managers?...`
  - `createManager(payload: { user_id: string; permission_profile_id: string; notes?: string | null })` → `POST /api/admin/managers`
  - `updateManager(id: string, payload: { permission_profile_id?: string; notes?: string | null; status?: 'active' | 'disabled' })` → `PUT /api/admin/managers/:id`
  - `deleteManager(id: string)` → `DELETE /api/admin/managers/:id`
- **Error handling:** Let `http()` throw; in components/mutations use try/catch and `toast.error(err.response?.data?.error?.message ?? err.message)`.

### 5.2 Managers Page

- Remove `mockManagers` and local `useState(managers)`.
- Use `useQuery(['managers', filters], () => listManagers(filters))` (or pass filters as query params if backend supports them; otherwise fetch once and filter client-side).
- Use `useMutation` for create/update/delete; on success invalidate `['managers']` and close modal / show toast.
- Keep existing filters (search, status, permission profile). If backend supports query params, pass them to `listManagers`; otherwise filter in memory from full list.
- Loading: show skeleton or spinner while loading. Error: show message and optional retry.

### 5.3 Create Manager Modal

- **User dropdown:** Call existing `listUsers({ limit })` from `@/shared/api/users.api`. From the result, exclude any user whose `id` is in the current managers list (from `listManagers()` or from the managers query data). Display name and email in the dropdown.
- **Submit:** Call `createManager({ user_id, permission_profile_id, notes })`. On success: close modal, invalidate `['managers']`, toast success. On failure: toast error from response.

### 5.4 Edit Manager Modal

- **Submit:** Call `updateManager(manager.id, { permission_profile_id, notes, status })` with the form values. On success: close modal, invalidate `['managers']`, toast. On failure: toast error.

### 5.5 Delete and Disable/Enable

- **Delete:** Call `deleteManager(manager.id)`. On success: close confirm modal, invalidate `['managers']`, toast.
- **Disable/Enable (table action):** Call `updateManager(manager.id, { status: 'disabled' | 'active' })`. On success: invalidate `['managers']`, toast.

### 5.6 Data Shape

- Backend returns snake_case. In `managers.api.ts`, map each list/create/update response to the existing `Manager` type (id, userId, userName, userEmail, permissionProfileId, permissionProfileName, status, createdAt, lastLoginAt, notes). This keeps the rest of the feature unchanged.

### 5.7 Permissions and Export

- Keep existing `useCanAccess('users:view')` and `useCanAccess('users:edit')` for the page and actions. No change required unless you introduce dedicated manager permissions later.
- **Export:** Can remain “coming soon” or be implemented client-side (build CSV from current filtered list and trigger download). Out of scope for “minimal dynamic” unless you request it.

---

## 6. Implementation Order (Recommended)

1. **Backend:** Migration → create `managers` table.
2. **Backend:** Implement admin managers router (list, create, update, delete) and register in `main.rs`.
3. **Frontend:** Add `managers.api.ts` with DTO types and mappers to `Manager`.
4. **Frontend:** Managers page: switch to `useQuery(listManagers)` and mutations; remove mocks.
5. **Frontend:** Create modal: use `listUsers()` and exclude existing manager user ids.
6. **Frontend:** Edit/Delete/Disable: wire to `updateManager` / `deleteManager`.
7. **Manual test:** Create manager, edit, disable, enable, delete; confirm list and permissions behave as expected.

---

## 7. Success Criteria

- Managers list loads from `GET /api/admin/managers` (no mocks).
- Create manager: user dropdown shows only users not already managers; submit creates a manager and updates the list.
- Edit manager: change profile/notes; list updates.
- Disable/Enable: status toggles and list updates; when disabled, user’s admin access is revoked (`users.permission_profile_id` null).
- Delete manager: row removed and user’s `permission_profile_id` cleared.
- Filters (search, status, profile) work (server-side if implemented, otherwise client-side).
- Loading and error states are handled; errors show in toasts.

---

## 8. What I Need From You to Start

- **Confirm:** You approve **Option B** (dedicated `managers` table) and this specification.
- **Confirm:** I should implement **both backend and frontend** (migration + auth-service routes + frontend API + wiring the page). If you prefer only backend or only frontend first, say which.
- **Optional:** Do you want a one-time backfill so existing users with `permission_profile_id` already set appear on the Managers page? (Yes/No.)
- **Optional:** Include Export (CSV) in this phase? (Yes/No; default No.)

Once you confirm, implementation can start and will follow this plan so the result is valid and professional and works end-to-end.
