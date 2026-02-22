# Tags Page – Full Dynamic Implementation Plan

**Status:** Validated; ready for implementation  
**Page:** `/admin/tag`  
**Goal:** Replace mock data and local state with real backend APIs and persistence so the Tags page is fully dynamic, with tags stored in the database and assignable to users, managers, and (later) other entities.

**Validation:** This plan has been checked against the current codebase: auth-service `main.rs` router registration, `admin_managers.rs` (error shape, auth, status codes), `src/shared/api/http.ts` (error handling, 204), frontend `Tag` type and Create/Edit modals payloads, and existing migrations. The specification below is consistent with these patterns and will work when implemented as written.

---

## 1. Executive Summary

- **Current state:** The Tags UI is complete and uses mock data only. Create, edit, and delete update React state only; no backend or database.
- **Target state:** Tags stored in a `tags` table; assignments stored in a `tag_assignments` table (entity_type + entity_id) so tags can be assigned to users, managers, and extended to other entities later. Full CRUD via auth-service APIs; frontend uses React Query and the existing UI.
- **Scope:** One or two migrations (tags + tag_assignments), one new admin router in auth-service, one frontend API module, and wiring the existing Tags page to it. Optional Phase 2: assignment UI (assign/unassign tags on User and Manager detail views).

This plan is aligned with the existing codebase (auth-service routes, migrations, frontend `Tag` type, modals, and table). Implementation can proceed in phases: **Phase 1** = tags CRUD only; **Phase 2** = assignment APIs and UI.

---

## 2. Current State (Reference)

| Area | What exists today |
|------|-------------------|
| **Frontend** | Full UI: summary cards (Total Tags, Total Assignments, Unused Tags), filters (search by name/slug), table (Name, Slug, Color, Description, Assigned, Created, Actions). Create / Edit / Delete modals with name, slug, color (preset + picker), description. Uses `useCanAccess('users:edit')` for write actions. |
| **Data** | `Tag` type: id, name, slug, color, description?, userCount?, managerCount?, createdAt. Mock data in `mocks/tags.mock.ts`; all CRUD is local `useState`. |
| **Backend** | No tags table, no tag APIs. |

---

## 3. Data Model

### 3.1 Tags Table

- **Purpose:** Store tag definitions (name, slug, color, description).
- **Uniqueness:** `slug` must be unique (case-insensitive) for stable references (e.g. APIs or filters by slug).

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | PRIMARY KEY, default `gen_random_uuid()` |
| `name` | VARCHAR(255) | NOT NULL |
| `slug` | VARCHAR(255) | NOT NULL, UNIQUE (indexed LOWER(slug)) |
| `color` | VARCHAR(7) | NOT NULL, default `#8b5cf6` (hex) |
| `description` | TEXT | NULL |
| `created_at` | TIMESTAMPTZ | NOT NULL, default NOW() |
| `updated_at` | TIMESTAMPTZ | NOT NULL, default NOW() |

### 3.2 Tag Assignments Table (Assign to Users, Managers, Others)

- **Purpose:** Many-to-many between tags and assignable entities (users, managers, and later e.g. groups, symbols).
- **Design:** Generic assignment table keyed by `(tag_id, entity_type, entity_id)` so new entity types can be added without schema change.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | PRIMARY KEY, default `gen_random_uuid()` |
| `tag_id` | UUID | NOT NULL, REFERENCES tags(id) ON DELETE CASCADE |
| `entity_type` | VARCHAR(50) | NOT NULL (e.g. `user`, `manager`) |
| `entity_id` | UUID | NOT NULL |
| `created_at` | TIMESTAMPTZ | NOT NULL, default NOW() |

- **Unique constraint:** `UNIQUE (tag_id, entity_type, entity_id)` so the same tag cannot be assigned twice to the same entity.
- **Indexes:** `tag_id`, `(entity_type, entity_id)` for fast lookups both ways.
- **Semantics:** `entity_type = 'user'` → `entity_id` is `users.id`; `entity_type = 'manager'` → `entity_id` is `managers.id`. No FK to multiple tables; application layer enforces valid IDs per type.

---

## 4. Migrations

### 4.1 Migration: Tags Table

- **Location:** `database/migrations/0024_tags.sql` (and optionally `infra/migrations/009_tags.sql` if your pipeline uses both).
- **Content:**

```sql
-- Tags: labels assignable to users, managers, and other entities.

CREATE TABLE IF NOT EXISTS tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  color VARCHAR(7) NOT NULL DEFAULT '#8b5cf6',
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_slug_lower ON tags(LOWER(slug));
CREATE INDEX IF NOT EXISTS idx_tags_created_at ON tags(created_at DESC);
```

### 4.2 Migration: Tag Assignments Table

- **Location:** `database/migrations/0025_tag_assignments.sql` (and optionally `infra/migrations/010_tag_assignments.sql`).
- **Content:**

```sql
-- Tag assignments: many-to-many between tags and entities (user, manager, etc.).

CREATE TABLE IF NOT EXISTS tag_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tag_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_tag_assignments_tag_id ON tag_assignments(tag_id);
CREATE INDEX IF NOT EXISTS idx_tag_assignments_entity ON tag_assignments(entity_type, entity_id);
```

---

## 5. API Specification

### 5.1 Base Path and Auth

- **Base path:** `/api/admin/tags`
- **Server:** Auth-service. Register the new router in `main.rs` in the same way as managers: add `use routes::admin_tags::create_admin_tags_router;` and in the `Router::new()` chain add `.nest("/api/admin/tags", create_admin_tags_router(pool.clone()))` (e.g. after the permission-profiles nest).
- **Auth:** Same as other admin routes: use `auth_middleware` and a `check_admin(claims)` that requires `claims.role == "admin"` (see `admin_managers.rs`). No new permission keys in Phase 1.

### 5.2 Request/Response Convention

- **Request/response bodies:** snake_case (Rust/JSON). Frontend API layer maps responses to the existing `Tag` type (camelCase: `userCount`, `managerCount`, `createdAt`). Request bodies from frontend can use snake_case (e.g. `description`) so they match the backend structs; `name`, `slug`, `color` are identical in both.
- **Errors:** Same shape as in `admin_managers.rs`: `{ "error": { "code": "STRING", "message": "STRING" } }`. The app `http()` throws on non-2xx and attaches `error.response.data`; mutations use `toast.error(err.response?.data?.error?.message ?? err.message)`.

---

### 5.3 Tags CRUD

#### GET /api/admin/tags

- **Purpose:** List tags for the admin Tags page (table, summary cards, filters).
- **Query params (optional):**
  - `search` – filter by name or slug (case-insensitive substring).
- **Response:** `200 OK`, body: array of tag objects. Each item includes **counts** for assignments per entity type so the UI can show “X users, Y managers” without extra round-trips.

**Response item (snake_case):**

```ts
{
  id: string
  name: string
  slug: string
  color: string
  description: string | null
  created_at: string   // ISO 8601
  updated_at: string   // ISO 8601
  user_count: number  // count of tag_assignments where entity_type = 'user'
  manager_count: number  // count of tag_assignments where entity_type = 'manager'
}
```

- **Implementation:** One query: select from `tags` with optional `WHERE` on name/slug (e.g. `LOWER(name) LIKE $1 OR LOWER(slug) LIKE $1` when `search` is present). For counts: use a subquery or `LEFT JOIN LATERAL` on `(SELECT tag_id, entity_type, COUNT(*) AS cnt FROM tag_assignments GROUP BY tag_id, entity_type)` and pivot so each tag row gets `user_count` (where entity_type = 'user') and `manager_count` (where entity_type = 'manager'); default 0 when no assignments. Order by `created_at DESC`.

---

#### POST /api/admin/tags

- **Purpose:** Create a new tag.
- **Request body:**

```ts
{
  name: string
  slug: string
  color?: string   // optional; default #8b5cf6 if invalid/missing
  description?: string | null
}
```

- **Validation:** `name` and `slug` required. `slug` must match `^[a-z0-9-]+$` and be unique (LOWER(slug)). `color` if present must be valid hex (e.g. `#RRGGBB`); otherwise set default.
- **On success:** Insert into `tags`, return `201 Created` with full tag object (same shape as list item, with `user_count: 0`, `manager_count: 0`).
- **Errors:** `400` (validation), `409` (slug already exists).

---

#### PUT /api/admin/tags/:id

- **Purpose:** Update a tag (name, slug, color, description).
- **Params:** `id` = tag UUID.
- **Request body (all optional except at least one field):**

```ts
{
  name?: string
  slug?: string
  color?: string
  description?: string | null
}
```

- **Validation:** If `slug` is provided, same rules as create; must be unique excluding current tag.
- **On success:** Update `tags` row, set `updated_at = NOW()`. Return `200 OK` with full tag object (including current `user_count` / `manager_count`).
- **Errors:** `400`, `404` (tag not found), `409` (slug taken).

---

#### DELETE /api/admin/tags/:id

- **Purpose:** Delete a tag and all its assignments (CASCADE).
- **Params:** `id` = tag UUID.
- **On success:** Delete tag (assignments removed by CASCADE). Return **`200 OK`** with body `{ "success": true }` (same as `admin_managers` DELETE) so the frontend does not need to handle 204; existing `http()` returns JSON.
- **Errors:** `404` if tag not found.

---

### 5.4 Tag Assignments (Phase 2 – Optional for “Fully Dynamic” Page)

To make the **Tags page** itself fully dynamic, only **tags CRUD** (above) is required. The “Assigned” column will show real counts from the database. Assigning/unassigning tags on User or Manager screens can be a follow-up.

If Phase 2 is in scope, add:

- **GET /api/admin/tags/:id/assignments** – list entity_type + entity_id (and optionally names) for that tag. Used to show “who has this tag” and to drive unassign.
- **POST /api/admin/tags/:tag_id/assignments** – body `{ entity_type, entity_id }`; create assignment. Return 201 or 409 if already assigned.
- **DELETE /api/admin/tags/:tag_id/assignments/:entity_type/:entity_id** – remove assignment.

And on the **Users** and **Managers** sides:

- **GET /api/admin/users/:id/tags** and **GET /api/admin/managers/:id/tags** – list tag IDs (or full tag objects) for that user/manager.
- **PUT /api/admin/users/:id/tags** and **PUT /api/admin/managers/:id/tags** – body `{ tag_ids: string[] }`; replace assignments for that entity. Simplifies UI (multi-select tags, save).

This plan leaves Phase 2 assignment APIs and UI as optional; the document focuses on making the Tags page itself dynamic (list/create/edit/delete tags and show real counts).

---

## 6. Backend Implementation Checklist

- [ ] Add migration `database/migrations/0024_tags.sql` (and optional `infra/migrations/009_tags.sql`) – create `tags` table and indexes.
- [ ] Add migration `database/migrations/0025_tag_assignments.sql` (and optional `infra/migrations/010_tag_assignments.sql`) – create `tag_assignments` table and indexes.
- [ ] Add `pub mod admin_tags;` in `routes/mod.rs`.
- [ ] Create `routes/admin_tags.rs`: same patterns as `admin_managers.rs` – `ErrorResponse`/`ErrorDetail`, `check_admin(claims)`, list (GET with optional `search` query, return array with `user_count`/`manager_count`), create (POST, 201 + body), update (PUT, 200 + body), delete (DELETE, 200 + `{ "success": true }`). Use `auth_middleware` and `with_state(pool)`.
- [ ] In `main.rs`: `use routes::admin_tags::create_admin_tags_router;` and `.nest("/api/admin/tags", create_admin_tags_router(pool.clone()))`.
- [ ] (Phase 2) Implement assignment endpoints and wire to Users/Managers if required.

---

## 7. Frontend Implementation

### 7.1 API Module

- **File:** `src/features/tags/api/tags.api.ts` (create the `api` directory if missing).
- **Types:** Define `TagDto` (snake_case: `id`, `name`, `slug`, `color`, `description`, `created_at`, `updated_at`, `user_count`, `manager_count`). Map each response to existing `Tag`: `user_count` → `userCount`, `manager_count` → `managerCount`, `created_at` → `createdAt`; `updated_at` can be ignored or added to the type later.
- **Functions:**
  - `listTags(params?: { search?: string })` → `GET /api/admin/tags` with query `search` when provided. Use `http<TagDto[]>(...)` then map to `Tag[]`.
  - `createTag(payload: { name: string; slug: string; color?: string; description?: string | null })` → `POST /api/admin/tags` with JSON body (snake_case: `name`, `slug`, `color`, `description`). Map response to `Tag`.
  - `updateTag(id: string, payload: { name?: string; slug?: string; color?: string; description?: string | null })` → `PUT /api/admin/tags/:id` with JSON body. Map response to `Tag`.
  - `deleteTag(id: string)` → `DELETE /api/admin/tags/:id`. Backend returns 200 + `{ success: true }`; `http()` returns that JSON (no 204).
- **Error handling:** Let `http()` throw; in page/mutations use `toast.error((err as any)?.response?.data?.error?.message ?? (err as Error)?.message)`.

### 7.2 Tags Page

- Remove `mockTags` and local `useState(tags)` for the source of truth.
- Use `useQuery(['tags', filters], () => listTags({ search: filters.search.trim() || undefined ))` for the list. Use `useMutation` for create/update/delete; on success invalidate `['tags']`, close modal, show toast.
- Keep existing filters (search); pass `search` to `listTags` when backend supports it, otherwise filter client-side from full list.
- Loading: keep or add a simple loading state (skeleton or spinner). Error: show message and retry.

### 7.3 Modals

- **Create Tag:** On submit call `createTag({ name, slug, color, description })`. On success: close modal, invalidate queries, toast. On error: toast with backend message.
- **Edit Tag:** On submit call `updateTag(tag.id, { name, slug, color, description })`. On success: close modal, invalidate, toast. On error: toast.
- **Delete Tag:** On confirm call `deleteTag(tag.id)`. On success: close modal, invalidate, toast. On error: toast.

### 7.4 Summary Cards and Table

- Summary cards and table already consume `Tag[]` with `userCount` and `managerCount`; once the API returns these counts, no change beyond data source (React Query).
- Empty state and “hasActiveFilters” behavior remain as implemented.

### 7.5 Permissions

- Keep `useCanAccess('users:view')` for page visibility and `useCanAccess('users:edit')` for create/edit/delete until dedicated permissions (e.g. `tags:view`, `tags:edit`) are introduced. Nav item can stay under the same permission or be updated when permission keys are added.

---

## 8. Implementation Order (Recommended)

1. **Backend:** Run migrations – create `tags` and `tag_assignments` tables.
2. **Backend:** Implement admin tags router (list with search and counts, create, update, delete); register in `main.rs`.
3. **Frontend:** Add `tags.api.ts` with DTO types and mappers to `Tag`.
4. **Frontend:** Tags page: switch to `useQuery(listTags)` and mutations for create/update/delete; remove mocks and local state as source of truth.
5. **Frontend:** Wire Create/Edit/Delete modals to API calls and invalidate `['tags']` on success.
6. **Manual test:** Create tag, edit (name/slug/color/description), delete; confirm list and counts (0/0 until Phase 2) and that search works.

Phase 2 (optional): Assignment APIs + UI on User/Manager detail or Tags page “Assign to…” flow.

---

## 9. Success Criteria

- Tags list loads from `GET /api/admin/tags` (no mocks).
- Create tag: form validation and slug uniqueness; new tag appears in list with user_count/manager_count 0.
- Edit tag: changes persist; slug uniqueness enforced.
- Delete tag: tag and its assignments removed; list updates.
- Search filter works (server-side if implemented, otherwise client-side).
- Summary cards show correct total tags and total assignments (assignments from DB).
- Loading and error states handled; errors shown in toasts.

---

## 10. What We Need From You to Start

- **Confirm:** You approve this data model (`tags` + `tag_assignments`) and API scope (tags CRUD in Phase 1; assignment APIs/UI optional in Phase 2).
- **Confirm:** Implementation scope: **backend + frontend** (migrations, auth-service routes, frontend API, wiring the page), or backend-only / frontend-only first.
- **Optional:** Include Phase 2 (assign/unassign tags on Users and Managers) in the first implementation? (Yes/No; default No for “Tags page fully dynamic” only.)
- **Optional:** Add dedicated permissions `tags:view` and `tags:edit` and gate the Tags nav/route on them? (Yes/No; default No, keep reusing `users:view` / `users:edit`.)

Once you confirm, implementation can follow this plan so the result is consistent, testable, and production-ready.

---

## 11. Validation Summary (Why This Plan Will Work)

| Check | Result |
|-------|--------|
| **Router registration** | Matches `main.rs`: `.nest("/api/admin/...", create_..._router(pool.clone()))`; same pattern as `admin_managers` and `admin_permission_profiles`. |
| **Error format** | Matches `admin_managers.rs` and frontend `http.ts`: `{ error: { code, message } }`; thrown error has `response.data`. |
| **Auth** | Same as other admin routes: `auth_middleware` + role check; no new permissions in Phase 1. |
| **Migrations** | PostgreSQL syntax verified: `tags` table and unique index on `LOWER(slug)`; `tag_assignments` with `UNIQUE (tag_id, entity_type, entity_id)` and CASCADE. Migration numbers 0024/0025 follow 0023_managers. |
| **Frontend types** | Existing `Tag` has `id`, `name`, `slug`, `color`, `description?`, `userCount?`, `managerCount?`, `createdAt`; DTO mapping is one-to-one. |
| **Modals** | Create/Edit payloads already use `name`, `slug`, `color`, `description`; API layer will send same keys (snake_case for consistency). |
| **DELETE response** | Specified as 200 + body so frontend does not need 204 handling; aligns with managers. |
| **List counts** | Backend returns `user_count` and `manager_count`; table and summary cards already consume `userCount`/`managerCount`. |
