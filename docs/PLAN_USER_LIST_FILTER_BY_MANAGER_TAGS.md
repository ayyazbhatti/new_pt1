# Plan: Filter Admin Users List by Manager’s Tags (Tag → Group Scoping)

## 1. Overview

**Goal:** When a manager (or non–super-admin) views the Admin Users page, the list is restricted to users in groups that are linked to the manager’s assigned tags. Full admins (role `admin`) continue to see all users.

**Example:**  
User `accessrighttest@gmail.com` has tag **tag1**; **tag1** is assigned to group **White Label**. On `/admin/users`, this user sees only users whose group is **White Label**.

---

## 2. Business Rules (Summary)

| Actor | Tags | Result on Users list |
|-------|------|----------------------|
| **Admin** (role `admin`) | Any / none | See **all** users (no filter). |
| **Manager** with ≥1 tag(s) | tag1 → White Label, tag2 → Gold | See users in **White Label OR Gold** (union of groups linked to their tags). |
| **Manager** with no tags | — | See **no users** (least privilege). |
| **Manager** without `users:view` | — | 403 Forbidden (unchanged). |

- **Tag → Group link:** Same as today: a group has tags via `tag_assignments` (entity_type `group`, entity_id = group_id). A manager has tags via `tag_assignments` (entity_type `manager`, entity_id = manager_id).
- **Resolution:** Manager’s tag IDs → groups that have any of those tag IDs → list only users with `group_id` in that set.

---

## 3. Scope

**In scope**

- **GET /api/auth/users**: allow managers with `users:view` to call it (currently only role `admin` can); apply group filter when caller is a manager.
- Apply the same filter for both **paginated** (page, page_size, search, status, group_id) and **non-paginated** (limit, offset) list modes so all callers (Admin Users page and dropdowns) see consistent “my” users when the caller is a manager.

**Out of scope**

- Filtering other list pages (e.g. Groups, Managers) by tags.
- New permissions; re-use existing `users:view` and list endpoint.
- UI filter controls for “my groups”; filter is implicit from the logged-in user.

---

## 4. Backend Changes

**Service:** Auth-service.  
**Endpoint:** **GET /api/auth/users** (auth router, protected). Used by frontend `listUsers()` in `src/shared/api/users.api.ts` for Admin Users page and for user dropdowns (Create Manager, Support, etc.).

**Access control:** Allow list if role is `admin` **or** if caller is a manager with `users:view` (same permission check pattern as other admin routes). Otherwise 403.

### 4.1 Resolve “allowed group IDs” for the caller

- **If caller’s role is `admin`:** do not apply any group filter (return all users as today).
- **Else (manager):**
  - Get caller’s **manager id** from `managers` by `user_id = claims.sub`.
  - If no manager row, treat as “no tags” → **allowed_group_ids = []** (see 4.2).
  - If manager exists, get **manager’s tag IDs** from `tag_assignments` where `entity_type = 'manager'` and `entity_id = manager.id`.
  - If no tags → **allowed_group_ids = []**.
  - If there are tag IDs, get **allowed group IDs**:  
    `SELECT DISTINCT entity_id FROM tag_assignments WHERE entity_type = 'group' AND tag_id = ANY(manager_tag_ids)`.
  - **allowed_group_ids** = that list (can be empty).

### 4.3 Apply filter in the service layer

- **AuthService** must accept optional **allowed_group_ids: Option<Vec<Uuid>>** in:
  - `list_users_paginated(..., allowed_group_ids)` 
  - `list_users(limit, offset, allowed_group_ids)`
- **If allowed_group_ids is None (admin):** no extra WHERE; current behaviour.
- **If allowed_group_ids is Some(ids)** and ids is empty: return empty list and total 0.
- **If allowed_group_ids is Some(ids)** and ids is non-empty: add to both COUNT and SELECT:
  - `AND group_id = ANY($allowed_group_ids)` (NULL group_id excluded by ANY).
- **UI group_id:** When allowed_group_ids is set, only apply the request’s `group_id` if it is in `allowed_group_ids`; otherwise ignore it so the filter is only by allowed groups.

### 4.4 Edge cases

- **Manager with tags but none of those tags are on any group:**  
  allowed_group_ids = [] → show no users.
- **User’s group_id is NULL:**  
  Exclude from manager view (only show users that belong to an allowed group).
- **Performance:**  
  Resolve allowed_group_ids once per request (small query); add index if needed on `tag_assignments (entity_type, entity_id)` and `(entity_type, tag_id)` for manager and group lookups.

---

## 5. Frontend Changes

- **No mandatory UI changes.**  
  The list is filtered by the backend; the existing Admin Users page keeps calling the same list endpoint. If the backend returns only “my” users, the table will only show those.

- **Optional (nice-to-have):**  
  - Show a small notice when the list is scoped (e.g. “Showing only users in your assigned groups.”).  
  - This can be done by a new response header or a field in the list response, e.g. `scoped_by_manager_tags: true`, and the UI shows the notice when that flag is set.

---

## 6. Data Model (Existing)

- **tag_assignments:**  
  `(tag_id, entity_type, entity_id, ...)`  
  - `entity_type = 'manager'`, `entity_id = manager.id` → manager’s tags.  
  - `entity_type = 'group'`, `entity_id = group.id` → group’s tags.
- **users:**  
  `group_id` = user’s group (nullable).
- **managers:**  
  `id`, `user_id` (links to users.id).

No schema change required.

---

## 7. Testing (Checklist)

- [ ] Admin (role admin) sees all users (no filter).
- [ ] Manager with tag1 (tag1 → White Label): sees only White Label users.
- [ ] Manager with tag1 and tag2 (tag1 → White Label, tag2 → Gold): sees White Label + Gold users.
- [ ] Manager with no tags: sees no users (empty list).
- [ ] Manager with tag that is not assigned to any group: sees no users.
- [ ] Pagination and search still work when filter is applied.
- [ ] Optional: UI shows “scoped” notice when applicable.

---

## 8. Rollout

- Backend change is backward-compatible: admins behave as today; only managers get the new scoping.
- Deploy backend first; then optional frontend notice if desired.
- No migration required.

---

## 9. File / Area Summary

| Area | Action |
|------|--------|
| **auth-service** `src/routes/auth.rs` | In `list_users`: allow manager with `users:view`; resolve allowed_group_ids; pass to service. |
| **auth-service** `src/services/auth_service.rs` | Add `allowed_group_ids` to `list_users_paginated` and `list_users`; add `AND group_id = ANY(...)` when set. |
| Auth-service: optional | Add response flag `scoped_by_manager_tags` for UI notice. |
| Frontend: Admin Users page | Optional: show “Showing only users in your assigned groups” when flag is set. |

---

## 10. Implementation Notes (Validated)

- **Handler:** `src/routes/auth.rs` — function `list_users` (around line 1338). Currently allows only `role == "admin"`; extend to allow manager with `users:view`, then resolve allowed_group_ids and pass to service.
- **Service:** `src/services/auth_service.rs` — `list_users_paginated` (line 356), `list_users` (line 331). Add parameter `allowed_group_ids: Option<Vec<Uuid>>`; when `Some(ids)` and non-empty, add `AND group_id = ANY($n)` to both COUNT and SELECT.
- **Manager lookup:** `SELECT id FROM managers WHERE user_id = $1` (claims.sub).
- **Tag resolution:** `tag_assignments` with `entity_type = 'manager'` and `entity_id = manager.id` (manager tags); then `entity_type = 'group'` and `tag_id = ANY(manager_tag_ids)` (groups that have those tags). No schema change.

---

*Document version: 1.1. Feature: Filter Admin Users list by manager’s tags (tag → group scoping).*
