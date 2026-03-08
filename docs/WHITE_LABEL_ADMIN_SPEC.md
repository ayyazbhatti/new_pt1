# White Label Admin – Full Specification

**Status:** Draft for review; implementation pending approval  
**Reference:** Admin Tags page (`/admin/tag`) – same structure and patterns  
**Goal:** Add a new admin page **White Label** with full CRUD (create, list, edit, delete, update) for white-label “labels,” following the Tags page implementation exactly.

---

## 1. Executive Summary

- **What:** A new admin section **White Label** at `/admin/white-label` where admins can manage white-label configurations (e.g. per-partner branding: name, domain, logo, colors).
- **Pattern:** Mirrors the existing **Tags** page: same UI layout (page header, summary cards, filters bar, data table, Create/Edit/Delete modals), same tech stack (React Query, modal store, permission checks), and same backend style (auth-service admin router, Postgres table, permission-gated CRUD).
- **Scope:** One new database table `white_labels`, one new backend router `/api/admin/white-labels`, one new frontend feature `whiteLabel`, route + nav + permissions. No polling; data fetched on load and invalidated after mutations.

---

## 2. Reference: Tags Page (Pattern to Follow)

| Layer | Tags implementation | White Label (to implement) |
|-------|---------------------|----------------------------|
| **Route** | `/admin/tag` | `/admin/white-label` |
| **Page** | `TagsPage` in `src/features/tags/pages/TagsPage.tsx` | `WhiteLabelPage` in `src/features/whiteLabel/pages/WhiteLabelPage.tsx` |
| **API base** | `/api/admin/tags` | `/api/admin/white-labels` |
| **Types** | `Tag` in `features/tags/types/tag.ts` | `WhiteLabel` in `features/whiteLabel/types/whiteLabel.ts` |
| **API module** | `features/tags/api/tags.api.ts` (list, create, update, delete) | `features/whiteLabel/api/whiteLabels.api.ts` |
| **Table** | `TagsTable` | `WhiteLabelsTable` |
| **Modals** | CreateTagModal, EditTagModal, DeleteTagModal | CreateWhiteLabelModal, EditWhiteLabelModal, DeleteWhiteLabelModal |
| **Filters** | TagFiltersBar (search) | WhiteLabelFiltersBar (search) |
| **Summary** | TagSummaryCards | WhiteLabelSummaryCards (optional, or reuse pattern) |
| **Permissions** | `tags:view`, `tags:create`, `tags:edit`, `tags:delete` | `white_label:view`, `white_label:create`, `white_label:edit`, `white_label:delete` |
| **Backend** | `admin_tags.rs`, table `tags` | `admin_white_labels.rs`, table `white_labels` |

---

## 3. Data Model

### 3.1 White Labels Table

- **Purpose:** Store white-label (brand) definitions: display name, slug, optional domain, logo URL, primary color, and metadata.
- **Uniqueness:** `slug` unique (case-insensitive) for stable references.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | PRIMARY KEY, default `gen_random_uuid()` |
| `name` | VARCHAR(255) | NOT NULL |
| `slug` | VARCHAR(255) | NOT NULL, UNIQUE (index LOWER(slug)) |
| `domain` | VARCHAR(255) | NULL (e.g. `partner1.example.com`) |
| `logo_url` | TEXT | NULL |
| `primary_color` | VARCHAR(7) | NOT NULL, default `#2563eb` (hex) |
| `support_email` | VARCHAR(255) | NULL |
| `description` | TEXT | NULL |
| `is_active` | BOOLEAN | NOT NULL, default true |
| `created_at` | TIMESTAMPTZ | NOT NULL, default NOW() |
| `updated_at` | TIMESTAMPTZ | NOT NULL, default NOW() |

- **Indexes:** `UNIQUE (LOWER(slug))`, `INDEX (created_at DESC)`, optional `INDEX (is_active)`.

### 3.2 Frontend Type (TypeScript)

```ts
// src/features/whiteLabel/types/whiteLabel.ts
export interface WhiteLabel {
  id: string
  name: string
  slug: string
  domain?: string
  logoUrl?: string
  primaryColor: string
  supportEmail?: string
  description?: string
  isActive: boolean
  createdAt: string
}
```

---

## 4. Migrations

### 4.1 Infra Migration (Postgres)

- **File:** `infra/migrations/020_white_labels.sql` (or next available number).

```sql
-- White labels: per-partner branding (name, domain, logo, colors).

CREATE TABLE IF NOT EXISTS white_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  domain VARCHAR(255),
  logo_url TEXT,
  primary_color VARCHAR(7) NOT NULL DEFAULT '#2563eb',
  support_email VARCHAR(255),
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_white_labels_slug_lower ON white_labels(LOWER(slug));
CREATE INDEX IF NOT EXISTS idx_white_labels_created_at ON white_labels(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_white_labels_is_active ON white_labels(is_active);

COMMENT ON TABLE white_labels IS 'White-label (brand) configurations for multi-tenant branding.';
```

### 4.2 Permission Definitions (auth-service or infra)

- **Option A – New migration in auth-service:** e.g. `backend/auth-service/migrations/YYYYMMDD_add_white_label_permissions.sql`.
- **Option B – Extend infra `019_permission_definitions.sql` or new migration:** Add category and permissions.

**New permission category (if desired):** e.g. "White Label" with `id = 'a0000010-0000-0000-0000-000000000010'` and sort_order after Tags.

**New permissions:**

| permission_key | label | category_id |
|----------------|-------|-------------|
| `white_label:view` | View white labels | Configuration or new White Label category |
| `white_label:create` | Create white labels | same |
| `white_label:edit` | Edit white labels | same |
| `white_label:delete` | Delete white labels | same |

- **Seed:** Insert into `permission_categories` (if new category) and `permissions`; use `ON CONFLICT (permission_key) DO NOTHING` for idempotency.
- **Grant:** Optionally grant `white_label:view` (and create/edit/delete) to existing admin or “full access” profiles so admins see the page without extra steps.

---

## 5. Backend API Specification

### 5.1 Base Path and Auth

- **Base path:** `/api/admin/white-labels`
- **Server:** auth-service.
- **Registration:** In `main.rs`: `use routes::admin_white_labels::create_admin_white_labels_router;` and `.nest("/api/admin/white-labels", create_admin_white_labels_router(pool.clone()))`.
- **Auth:** Same as tags: `auth_middleware` + permission check (not role-only). Helper e.g. `check_white_label_permission(pool, claims, "white_label:view")` using `permission_profile_grants` for non-admin users.

### 5.2 Request/Response Convention

- **JSON:** snake_case in requests and responses (e.g. `primary_color`, `logo_url`, `created_at`). Frontend API module maps to camelCase for the `WhiteLabel` type.
- **Errors:** Same shape as tags: `{ "error": { "code": "STRING", "message": "STRING" } }`, HTTP 4xx/5xx.

### 5.3 Endpoints

#### GET /api/admin/white-labels

- **Permission:** `white_label:view`
- **Query:** Optional `search` (filter by name or slug, case-insensitive).
- **Response:** `200 OK`, body: array of white-label objects (snake_case).

**Response item:**

```json
{
  "id": "uuid",
  "name": "string",
  "slug": "string",
  "domain": "string | null",
  "logo_url": "string | null",
  "primary_color": "string",
  "support_email": "string | null",
  "description": "string | null",
  "is_active": true,
  "created_at": "ISO8601",
  "updated_at": "ISO8601"
}
```

#### POST /api/admin/white-labels

- **Permission:** `white_label:create`
- **Body (snake_case):** `name`, `slug` required; optional: `domain`, `logo_url`, `primary_color`, `support_email`, `description`, `is_active`.
- **Validation:** Name and slug non-empty; slug format e.g. `[a-z0-9-]+`; slug unique (case-insensitive). Return 400 with error message on conflict.
- **Response:** `201 Created`, body: created white-label object (same shape as list item).

#### GET /api/admin/white-labels/:id

- **Permission:** `white_label:view`
- **Response:** `200 OK` single object; `404` if not found.

#### PUT /api/admin/white-labels/:id

- **Permission:** `white_label:edit`
- **Body (snake_case):** All optional: `name`, `slug`, `domain`, `logo_url`, `primary_color`, `support_email`, `description`, `is_active`. Only send provided fields (partial update).
- **Validation:** If `slug` provided, unique (case-insensitive) excluding current id. Return 400 on conflict.
- **Response:** `200 OK`, body: updated white-label object; `404` if not found.

#### DELETE /api/admin/white-labels/:id

- **Permission:** `white_label:delete`
- **Response:** `200 OK` with body e.g. `{ "success": true }` or `204 No Content`. `404` if not found.

### 5.4 Backend Module Layout (Rust)

- **File:** `backend/auth-service/src/routes/admin_white_labels.rs`
- **Contents:** Structs for request/response (snake_case), `check_white_label_permission`, handlers: `list_white_labels`, `create_white_label`, `get_white_label`, `update_white_label`, `delete_white_label`, and `pub fn create_admin_white_labels_router(pool: PgPool) -> Router<PgPool>`.
- **Register:** In `routes/mod.rs`: `pub mod admin_white_labels;`. In `main.rs`: nest router as above.

---

## 6. Frontend Specification

### 6.1 Feature Structure

```
src/features/whiteLabel/
├── api/
│   └── whiteLabels.api.ts    # list, create, get, update, delete; DTO → WhiteLabel
├── components/
│   ├── WhiteLabelFiltersBar.tsx
│   ├── WhiteLabelSummaryCards.tsx   # optional: total, active, inactive
│   ├── WhiteLabelsTable.tsx
│   └── index.ts
├── modals/
│   ├── CreateWhiteLabelModal.tsx
│   ├── EditWhiteLabelModal.tsx
│   ├── DeleteWhiteLabelModal.tsx
│   └── index.ts
├── pages/
│   └── WhiteLabelPage.tsx
├── types/
│   └── whiteLabel.ts
└── index.ts                   # export WhiteLabelPage, WhiteLabel type
```

### 6.2 API Module

- **File:** `src/features/whiteLabel/api/whiteLabels.api.ts`
- **Uses:** `@/shared/api/http` for `http<T>()`.
- **Exports:**
  - `listWhiteLabels(params?: { search?: string }): Promise<WhiteLabel[]>`
  - `createWhiteLabel(payload: CreateWhiteLabelPayload): Promise<WhiteLabel>`
  - `getWhiteLabel(id: string): Promise<WhiteLabel>` (if needed for edit prefetch)
  - `updateWhiteLabel(id: string, payload: UpdateWhiteLabelPayload): Promise<WhiteLabel>`
  - `deleteWhiteLabel(id: string): Promise<void>`
- **Payload types:** `CreateWhiteLabelPayload`, `UpdateWhiteLabelPayload` (mirror backend fields in camelCase). Map backend snake_case response to `WhiteLabel` in a `fromDto` helper.

### 6.3 Page (WhiteLabelPage)

- **Layout:** Same as TagsPage: `ContentShell`, `PageHeader` (title "White Label", description, actions: "Create White Label" button if `white_label:create`).
- **State:** Filters (e.g. `search`), no local CRUD state; all via React Query.
- **Queries:** `useQuery` for list (key e.g. `['whiteLabels', listParams]`), `queryFn: () => listWhiteLabels(listParams)`.
- **Mutations:** `useMutation` for create, update, delete; onSuccess invalidate `['whiteLabels']`, close modal, toast success; onError toast error with message from `error.response?.data?.error?.message`.
- **Handlers:** `handleCreateWhiteLabel` opens CreateWhiteLabelModal and calls create mutation; `handleEditWhiteLabel(label)` opens EditWhiteLabelModal and calls update mutation; `handleDeleteWhiteLabel(label)` opens DeleteWhiteLabelModal and calls delete mutation.
- **Loading/Error:** Loading state show "Loading white labels..."; error state show message + Retry button.
- **Below header:** WhiteLabelSummaryCards (optional), WhiteLabelFiltersBar, WhiteLabelsTable (data, onEdit, onDelete, hasActiveFilters). Permission-based: show Create button only if `useCanAccess('white_label:create')`; table actions Edit/Delete only if `white_label:edit` / `white_label:delete`.

### 6.4 Table (WhiteLabelsTable)

- **Columns:** Name (with optional small color dot or logo thumbnail), Slug, Domain, Primary color (swatch + hex), Support email, Active (badge or Yes/No), Created (formatted date), Actions (Edit, Delete buttons).
- **Props:** `whiteLabels: WhiteLabel[]`, `onEdit?: (label: WhiteLabel) => void`, `onDelete?: (label: WhiteLabel) => void`, `hasActiveFilters?: boolean`.
- **Empty state:** "No white labels found" + hint (clear filters or create first). Use shared `DataTable` and column defs.

### 6.5 Modals

- **CreateWhiteLabelModal:** Form fields: Name, Slug (auto from name if not touched), Domain (optional), Logo URL (optional), Primary color (preset + picker, default `#2563eb`), Support email (optional), Description (optional textarea), Is active (checkbox, default true). Submit calls `onCreated(payload)`; Cancel closes modal. Validation: name and slug required; slug format; duplicate slug → error from API.
- **EditWhiteLabelModal:** Same fields pre-filled from `whiteLabel`; slug editable; submit calls `onSave(payload)`.
- **DeleteWhiteLabelModal:** Confirm text: "Are you sure you want to delete the white label **{name}** ({slug})?"; note "This action cannot be undone."; Cancel / Delete buttons; on confirm call `onConfirm()` then close modal.

### 6.6 Filters Bar

- **WhiteLabelFiltersBar:** Search input (by name or slug), Clear button; `filters: { search: string }`, `onFilterChange`. Same UX as TagFiltersBar.

### 6.7 Summary Cards (Optional)

- **WhiteLabelSummaryCards:** e.g. Total white labels, Active count, Inactive count. Same card layout as TagSummaryCards.

### 6.8 Routing and Nav

- **Route:** In `src/app/router/adminRoutes.tsx` add `{ path: '/admin/white-label', element: <WhiteLabelPage /> }`.
- **Nav:** In `src/app/config/nav.ts` add to `adminNavItems` (e.g. after Tags): `{ label: 'White Label', path: '/admin/white-label', icon: Palette | Layout | Globe, permission: 'white_label:view' }`. Use a suitable Lucide icon (e.g. `Palette`, `Layout`, `Globe`).
- **Guards:** Route is already wrapped in `AuthGuard` and `AdminGuard`; no extra guard. Page and nav visibility gated by `white_label:view`.

### 6.9 Permissions (Frontend)

- **File:** `src/shared/utils/permissions.ts`
- **ADMIN_PAGE_PERMISSIONS:** Add `'/admin/white-label': ['white_label:view', 'white_label:create', 'white_label:edit', 'white_label:delete']`.
- **ADMIN_ROUTE_PERMISSIONS:** Add `'/admin/white-label': 'white_label:view'`.

---

## 7. Implementation Checklist

Use this list to implement and verify; order is recommended but can be adjusted (e.g. backend first, then frontend).

### Database and backend

- [ ] Add migration `infra/migrations/020_white_labels.sql` (or next number) with `white_labels` table and indexes.
- [ ] Add permission category and permissions (new migration or extend 019): `white_label:view`, `white_label:create`, `white_label:edit`, `white_label:delete`; optionally grant to default admin profile.
- [ ] Create `backend/auth-service/src/routes/admin_white_labels.rs`: DTOs, `check_white_label_permission`, list/create/get/update/delete handlers, router.
- [ ] Register `admin_white_labels` in `routes/mod.rs` and nest router in `main.rs` at `/api/admin/white-labels`.
- [ ] Run migrations; smoke-test endpoints (e.g. list empty, create one, get, update, delete).

### Frontend

- [ ] Add `src/features/whiteLabel/types/whiteLabel.ts` with `WhiteLabel` and payload types.
- [ ] Add `src/features/whiteLabel/api/whiteLabels.api.ts` with list, create, get, update, delete and DTO mapping.
- [ ] Add `WhiteLabelFiltersBar`, `WhiteLabelSummaryCards` (optional), `WhiteLabelsTable`, and export from `components/index.ts`.
- [ ] Add `CreateWhiteLabelModal`, `EditWhiteLabelModal`, `DeleteWhiteLabelModal`, and export from `modals/index.ts`.
- [ ] Add `WhiteLabelPage` and export from `features/whiteLabel/index.ts`.
- [ ] Add route `/admin/white-label` and nav item with icon and `white_label:view`.
- [ ] Add `ADMIN_PAGE_PERMISSIONS` and `ADMIN_ROUTE_PERMISSIONS` for `/admin/white-label`.
- [ ] Manual test: open `/admin/white-label`, create, edit, delete, search; confirm no polling (only fetch on load and after mutations).

---

## 8. Out of Scope (This Document)

- **Assignment of users/groups to a white label:** No link from users or groups to `white_labels` in this spec; can be a follow-up (e.g. `user.white_label_id` or join table).
- **Runtime branding:** Using the active white label (e.g. by domain or user assignment) to theme the app (logo, color) is not specified here; only CRUD for the admin list.
- **Polling:** Per project rules, no refetch intervals; use on-demand fetch and invalidation after mutations.

---

## 9. Document History

| Version | Date | Change |
|---------|------|--------|
| 1.0 | 2026-03-09 | Initial spec for review. |

---

**Approval:** Once this document is approved, implementation can proceed according to the checklist above.
