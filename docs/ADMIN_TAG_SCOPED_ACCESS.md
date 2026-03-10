# Admin Tag-Scoped Access (Page-by-Page)

## 1. Goal

For admin pages that list entities (groups, users, managers, etc.):

- **Super Admin** (`role === 'super_admin'`): sees **all** entities (no filter by tags).
- **Admin / Manager** (other roles with permission): sees only entities that **share at least one tag** with the current user (tag-scoped).

This gives you tag-based scoping per page while keeping super_admin as full access.

---

## 2. Pattern (Backend)

For each list API:

1. **After** the permission check (e.g. `groups:view`, `managers:view`):
   - If `claims.role == "super_admin"` → do **not** apply any tag filter; return full list.
   - Else → resolve **allowed entity IDs** using the current user’s tags, then filter the list to those IDs.

2. **Resolving “allowed” IDs for the current user:**
   - Get tag IDs assigned to the **user**:  
     `tag_assignments` where `entity_type = 'user'` and `entity_id = claims.sub`.
   - From those tag IDs, get the **entity IDs** that have any of those tags (depends on the page):
     - **Groups:** `entity_type = 'group'` → `entity_id` = group ID.
     - **Managers:** (if we scope by “groups the user can see”) use group-based logic; or by manager tags if you scope managers by shared tags.
     - **Users:** (if we scope) e.g. users in groups that share a tag with the user (see existing `resolve_allowed_group_ids_for_user`-style logic).

3. **List query:**
   - If allowed set is **empty** (user has no tags) → return empty list (and total 0).
   - If allowed set is **non-empty** → add e.g. `AND id = ANY($1)` (or equivalent) to the list (and count) query, binding the allowed IDs.
   - If **super_admin** → no `AND id = ANY(...)`; list and count are unrestricted.

---

## 3. Pages to Apply (Checklist)

Use this checklist as you implement tag-scoped access page by page.

| Page (path) | List API(s) | Scope rule | Status |
|--------------|-------------|------------|--------|
| `/admin/groups` | `GET /api/admin/groups` | Show groups that share at least one tag with the current user. Super_admin: all. | **Done** |
| `/admin/leverage-profiles` | `GET /api/admin/leverage-profiles` | Show profiles that share at least one tag with the current user. Super_admin: all. | **Done** |
| `/admin/markup` | `GET /api/admin/markup/profiles` | Show markup (price stream) profiles that share at least one tag with the current user. Super_admin: all. | **Done** |
| `/admin/swap` | `GET /api/admin/swap/rules` | Show swap rules that share at least one tag with the current user. Super_admin: all. | **Done** |
| `/admin/affiliate` (schemes tab) | `GET /api/admin/affiliate/layers` | Show affiliate schemes that share at least one tag with the current user. Super_admin: all. | **Done** |
| `/admin/permissions` | `GET /api/admin/permission-profiles` | Show permission profiles that share at least one tag with the current user. Super_admin: all. Get/Update/Delete/Tags enforced for non–super_admin. | **Done** |
| `/admin/users` | `GET /api/auth/users` (or admin users list) | TBD: e.g. users in groups that share a tag with the user. | Pending |
| `/admin/manager` | `GET /api/admin/managers` | TBD: e.g. managers whose groups share a tag with the user, or by manager tags. | Pending |
| `/admin/tag` | `GET /api/admin/tags` | Already done: admin sees tags assigned to user; super_admin sees all. | **Done** (earlier) |
| (others) | … | Same idea: resolve allowed IDs from user tags + entity type. | Pending |

---

## 4. Implementation Notes

- **Super_admin:** Always pass `allowed_*_ids = None` (or equivalent) so the service returns the full list.
- **Tag resolution:** Reuse the same pattern: user’s tag IDs from `tag_assignments` (user), then entity IDs from `tag_assignments` (entity_type for that page).
- **Empty tags:** If the user has no tags assigned, the allowed set is empty → list and total should be 0 (no entities).
- **Get/Update/Delete single entity:** For non–super_admin, enforce that the target entity is in the allowed set (e.g. same tag-based check) so they can’t open or edit others by ID.

---

## 5. Reference: Groups Implementation

- **Route:** `backend/auth-service/src/routes/admin_groups.rs` → `list_groups`.
- **Helper:** `resolve_allowed_group_ids_for_user(pool, user_id)`:
  - Tags for user: `tag_assignments` where `entity_type = 'user'`, `entity_id = user_id`.
  - Group IDs: `tag_assignments` where `entity_type = 'group'`, `tag_id = ANY(user_tag_ids)` → `entity_id`.
- **Service:** `AdminGroupsService::list_groups(..., allowed_group_ids: Option<&[Uuid]>)`.
  - If `Some(ids)` and empty → return `(vec![], 0)`.
  - If `Some(ids)` and non-empty → add `AND id = ANY($1)` to count and list queries.
  - If `None` → no filter (super_admin).

---

## 6. Leverage Profiles Implementation

- **Route:** `backend/auth-service/src/routes/admin_leverage_profiles.rs` → `list_profiles`.
- **Helper:** `resolve_allowed_leverage_profile_ids_for_user(pool, user_id)`:
  - Tags for user: `tag_assignments` where `entity_type = 'user'`, `entity_id = user_id`.
  - Profile IDs: `tag_assignments` where `entity_type = 'leverage_profile'`, `tag_id = ANY(user_tag_ids)` → `entity_id`.
- **Service:** `AdminLeverageProfilesService::list_profiles(..., allowed_profile_ids: Option<&[Uuid]>)`.
  - If `Some(ids)` and empty → return `(vec![], 0)`.
  - If `Some(ids)` and non-empty → add `AND lp.id = ANY($1)` / `AND id = ANY($1)` to list and count queries.
  - If `None` → no filter (super_admin).

---

## 7. Markup (Price Stream Profiles) Implementation

- **Route:** `backend/auth-service/src/routes/admin_markup.rs` → `list_profiles`.
- **Helper:** `resolve_allowed_markup_profile_ids_for_user(pool, user_id)`:
  - Tags for user: `tag_assignments` where `entity_type = 'user'`, `entity_id = user_id`.
  - Profile IDs: `tag_assignments` where `entity_type = 'markup_profile'`, `tag_id = ANY(user_tag_ids)` → `entity_id`.
- **Service:** `AdminMarkupService::list_profiles(allowed_profile_ids: Option<&[Uuid]>)`.
  - If `Some(ids)` and empty → return `vec![]`.
  - If `Some(ids)` and non-empty → add `WHERE psp.id = ANY($1)` to the list query.
  - If `None` → no filter (super_admin).

---

## 8. Swap Rules Implementation

- **Route:** `backend/auth-service/src/routes/admin_swap.rs` → `list_rules`.
- **Helper:** `resolve_allowed_swap_rule_ids_for_user(pool, user_id)`:
  - Tags for user: `tag_assignments` where `entity_type = 'user'`, `entity_id = user_id`.
  - Rule IDs: `tag_assignments` where `entity_type = 'swap_rule'`, `tag_id = ANY(user_tag_ids)` → `entity_id`.
- **Service:** `AdminSwapService::list_rules(..., allowed_rule_ids: Option<&[Uuid]>)`.
  - If `Some(ids)` and empty → return `(vec![], 0)`.
  - If `Some(ids)` and non-empty → add `AND sr.id = ANY($n)` to the WHERE clause.
  - If `None` → no filter (super_admin).

---

## 9. Affiliate Schemes (Layers) Implementation

- **Route:** `backend/auth-service/src/routes/admin_affiliate.rs` → `list_layers`.
- **Helper:** `resolve_allowed_affiliate_scheme_ids_for_user(pool, user_id)`:
  - Tags for user: `tag_assignments` where `entity_type = 'user'`, `entity_id = user_id`.
  - Scheme IDs: `tag_assignments` where `entity_type = 'affiliate_scheme'`, `tag_id = ANY(user_tag_ids)` → `entity_id`.
- **List logic:** If `allowed_scheme_ids` is `Some(empty)` → return `[]`. If `Some(ids)` → query `WHERE id = ANY($1)`. If `None` → no filter (super_admin).

You can replicate this pattern for each remaining page and list API.
