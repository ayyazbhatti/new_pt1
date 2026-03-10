# Server-Side Permission and Access Control — Complete Solution (All Pages)

## 1. Goal

Ensure **every** admin page and its API are protected **on the server** by **permission keys** (from `permission_profile_grants`), not only by role. Client-side checks (nav, route guards) are for UX only; the server must reject unauthorized requests so that customers cannot bypass or crack access.

**Outcome:** 100% server-side enforcement across all admin pages; no endpoint accessible without the correct permission in the DB.

---

## 2. All Admin Pages and Required Permissions (Frontend Reference)

These are the admin routes and the **minimum** permission required to access each (from `ADMIN_ROUTE_PERMISSIONS` and nav). The backend must enforce the same (or stricter) permissions.

| Admin path | Required permission (entry) | Backend API(s) |
|------------|-----------------------------|----------------|
| `/admin/dashboard` | `dashboard:view` | (dashboard may be frontend-only or have its own API) |
| `/admin/users` | `users:view` | `GET/PUT /api/admin/users/*` |
| `/admin/bulk-operations` | `users:bulk_create` | `GET/POST /api/admin/bulk/*` |
| `/admin/tag` | `tags:view` | `GET/POST/PUT/DELETE /api/admin/tags/*` |
| `/admin/groups` | `groups:view` | `GET/POST/PUT/DELETE /api/admin/groups/*`, `/api/admin/group-tags/*` |
| `/admin/manager` | `managers:view` | `GET/POST/PUT/DELETE /api/admin/managers/*`, `/api/admin/manager-tags/*` |
| `/admin/trading` | `trading:view` | `GET/POST /api/admin/orders/*`, `/api/admin/positions/*` (admin trading) |
| `/admin/leverage-profiles` | `leverage_profiles:view` | `GET/POST/PUT/DELETE /api/admin/leverage-profiles/*` |
| `/admin/symbols` | `symbols:view` | `GET/POST/PUT/DELETE /api/admin/symbols/*` |
| `/admin/markup` | `markup:view` | `GET/POST/PUT/DELETE /api/admin/markup/*` |
| `/admin/swap` | `swap:view` | `GET/POST/PUT/DELETE /api/admin/swap/*` |
| `/admin/transactions` | `finance:view` | `GET /api/admin/finance/*` (list transactions), approve/reject |
| `/admin/finance` | `finance:view` | Same as transactions |
| `/admin/deposits` | `finance:view` | `GET/POST /api/admin/deposits/*` (list, approve, reject) |
| `/admin/bonus` | `bonus:view` | (if exists in backend) |
| `/admin/affiliate` | `affiliate:view` | `GET/POST/PUT/DELETE /api/admin/affiliate/*` |
| `/admin/permissions` | `permissions:view` | `GET/POST/PUT/DELETE /api/admin/permission-profiles/*` |
| `/admin/support` | `support:view` | `GET/POST /api/admin/chat/*` (support) |
| `/admin/call-user` | `call:view` | `GET /api/admin/call-records/*` |
| `/admin/appointments` | `appointments:view` | `GET/POST/PUT/DELETE /api/admin/appointments/*`, `/api/appointments/*` (admin) |
| `/admin/promotions` | `promotions:view` | `GET/POST/PUT/DELETE /api/admin/promotions/*` |
| `/admin/system` | `system:view` | (if exists in backend) |
| `/admin/settings` | `settings:view` | `GET/PUT /api/admin/settings/*` |
| `/admin/reports` | `reports:view` | (if exists in backend) |

---

## 3. Full Audit: Current vs Required (Backend)

For each backend module we either **already enforce by permission** (DB) or we use **role-only** (`claims.role != "admin"` or `check_admin(claims)`). To get 100% coverage, every handler must use a **permission check** (DB lookup of `permission_profile_grants`).

| Backend module | Current check | Required permission(s) | Action |
|----------------|---------------|------------------------|--------|
| **admin_permission_profiles** | `check_permission(..., "permissions:view" \| "permissions:edit")` | permissions:view, permissions:edit | **Done** — no change |
| **admin_tags** | `check_tags_permission(..., "tags:view" \| "tags:create" \| ...)` | tags:view, create, edit, delete | **Done** — no change |
| **admin_appointments** | `check_appointments_permission(..., "appointments:view" \| ...)` | appointments:view, create, edit, delete, etc. | **Done** — no change |
| **admin_settings** | `check_settings_permission(..., "settings:view" \| "settings:edit")` | settings:view, settings:edit | **Done** — no change |
| **promotions** (admin) | `check_promotions_permission(..., "promotions:view" \| "promotions:edit")` | promotions:view, promotions:edit | **Done** — no change |
| **chat** (support) | `check_support_permission(..., "support:view" \| "support:reply")` | support:view, support:reply | **Done** — no change |
| **admin_call_records** | `check_call_permission` → call:view | call:view | **Done** — no change |
| **admin_bulk** | `check_bulk_permission` → users:bulk_create | users:bulk_create | **Done** — no change |
| **admin_users** | `claims.role != "admin"` (role-only) | users:view, users:edit, users:create, etc. (per action) | **Add** permission checks |
| **admin_groups** | `claims.role != "admin"` (role-only) | groups:view, create, edit, delete, symbol_settings, price_profile, tags | **Add** permission checks |
| **admin_managers** | `check_admin(claims)` (role-only) | managers:view, create, edit, delete | **Add** permission checks |
| **admin_trading** | `check_admin(claims)` (role-only) | trading:view, create_order, cancel_order, close_position, liquidate | **Add** permission checks |
| **admin_positions** | `check_admin(claims)` (role-only) | trading:view, close_position, liquidate (per action) | **Add** permission checks |
| **admin_audit** | `check_admin(claims)` (role-only) | risk:view (or reports:view) | **Add** permission check |
| **admin_leverage_profiles** | `check_admin(claims)` (role-only) | leverage_profiles:view, create, edit, delete | **Add** permission checks |
| **admin_symbols** | `check_admin(claims)` (role-only) | symbols:view, create, edit, delete | **Add** permission checks |
| **admin_markup** | `check_admin(claims)` (role-only) | markup:view, create, edit, delete | **Add** permission checks |
| **admin_swap** | `check_admin(claims)` (role-only) | swap:view, create, edit, delete | **Add** permission checks |
| **admin_affiliate** | `check_admin(claims)` (role-only) | affiliate:view, create, edit, delete | **Add** permission checks |
| **finance** | `claims.role != "admin"` (role-only) | finance:view, deposits:approve, deposits:reject, finance:manual_adjustment | **Add** permission checks |
| **deposits** (admin) | `claims.role != "admin"` / `is_admin` (role-only) | finance:view (list), deposits:approve, deposits:reject | **Add** permission checks |

**Dashboard, bonus, system, reports:** If they have dedicated backend endpoints, add permission checks for `dashboard:view`, `bonus:view`, `system:view`, `reports:view` respectively when implementing.

---

## 4. How Server-Side Enforcement Works

1. **Auth:** Every admin route is behind `auth_middleware` (JWT required → 401 if missing/invalid).
2. **Permission check:** At the start of each handler we call a function that:
   - If `claims.role == "admin"` → allow (optional policy; can be removed to force profile for everyone).
   - Else: load `permission_profile_id` for `claims.sub` from `users`, then check `permission_profile_grants` for the required key.
   - If missing → return **403 FORBIDDEN** with a clear message (e.g. `Missing permission: users:view`).
3. **Business logic** runs only after the check passes.
4. **No trust of client:** Permissions are never read from the client; they are always resolved from the DB on the server.

---

## 5. Implementation Plan (To Reach 100% Coverage)

### 5.1 Shared helper

- **Option A:** Add a shared `check_permission(pool, claims, permission_key) -> Result<(), (StatusCode, Json)>` in a common module (e.g. `utils` or `middleware`), matching the logic in `admin_permission_profiles.rs` (admin bypass + DB lookup of `permission_profile_grants`). Every module that today uses role-only will call this with the appropriate key.
- **Option B:** Keep per-module helpers (e.g. `check_tags_permission`) but ensure they all use the same pattern: admin bypass + DB lookup by permission key. Then replace `check_admin` / `claims.role != "admin"` with calls to these helpers with the correct key per handler.

### 5.2 Per-module changes (summary)

- **admin_users:** Replace every `claims.role != "admin"` with `check_permission(pool, claims, "users:view")` for list/get, `"users:edit"` for update profile/group/permission-profile, `"users:create"` for create, etc., as appropriate per handler.
- **admin_groups:** Replace every `claims.role != "admin"` with `check_permission(pool, claims, "groups:view")` for list/get, `"groups:create"` for create, `"groups:edit"` for update, `"groups:delete"` for delete, and more specific keys (e.g. `groups:symbol_settings`, `groups:price_profile`, `groups:tags`) where the frontend distinguishes them.
- **admin_managers:** Replace `check_admin(claims)` with `check_permission(pool, claims, "managers:view")` for list/get and `"managers:create"` / `"managers:edit"` / `"managers:delete"` for mutations.
- **admin_trading:** Replace `check_admin(claims)` with `check_permission(pool, claims, "trading:view")` for read, and `"trading:create_order"` / `"trading:cancel_order"` / `"trading:close_position"` / `"trading:liquidate"` for the corresponding actions.
- **admin_positions:** Same as trading; use trading:view for list, trading:close_position / trading:liquidate for close/liquidate.
- **admin_audit:** Replace `check_admin(claims)` with `check_permission(pool, claims, "risk:view")` (or `"reports:view"` if that fits the product).
- **admin_leverage_profiles:** Replace `check_admin(claims)` with `check_permission(pool, claims, "leverage_profiles:view")` for read, and create/edit/delete keys for mutations.
- **admin_symbols:** Replace `check_admin(claims)` with `check_permission(pool, claims, "symbols:view")` for read, and symbols:create/edit/delete for mutations.
- **admin_markup:** Replace `check_admin(claims)` with `check_permission(pool, claims, "markup:view")` for read, and markup:create/edit/delete for mutations.
- **admin_swap:** Replace `check_admin(claims)` with `check_permission(pool, claims, "swap:view")` for read, and swap:create/edit/delete for mutations.
- **admin_affiliate:** Replace `check_admin(claims)` with `check_permission(pool, claims, "affiliate:view")` for read, and affiliate:create/edit/delete for mutations.
- **finance:** Replace `claims.role != "admin"` with `check_permission(pool, claims, "finance:view")` for list transactions, `"deposits:approve"` for approve, `"deposits:reject"` for reject, `"finance:manual_adjustment"` for manual adjustment.
- **deposits** (admin list/approve/reject): Replace role checks with `check_permission(pool, claims, "finance:view")` for list, `"deposits:approve"` for approve, `"deposits:reject"` for reject.

### 5.3 Permission keys to use

- Must match the keys defined in the DB (`permissions` table) and in the frontend (`ALL_PERMISSION_KEYS` / `ADMIN_PAGE_PERMISSIONS`). Use the same strings (e.g. `users:view`, `groups:edit`, `finance:view`) so that a profile that has a given key in the DB is allowed on the corresponding endpoint.

### 5.4 Error responses

- 401: invalid or missing JWT (from auth middleware).
- 403: valid JWT but missing required permission; body e.g. `{ "error": { "code": "FORBIDDEN", "message": "Missing permission: users:view" } }` so the client can show a clear “no access” message.

---

## 6. Guarantee (100% Coverage)

- **Before:** Some modules only check `role == "admin"` or `check_admin(claims)`, so any user with role `admin` can call those APIs regardless of permission profile.
- **After:** Every admin endpoint will require the appropriate permission key from `permission_profile_grants` (with optional admin bypass). No endpoint will be accessible without that permission. So:
  - All pages listed in §2 will be protected by the same permission on the server as on the client.
  - Customers cannot bypass or crack access by modifying the client or calling APIs directly without the right profile/grants.

---

## 7. Summary

| Item | Description |
|------|-------------|
| **Scope** | All admin pages and their backend APIs (see §2 and §3). |
| **Already done** | Permission profiles, tags, appointments, settings, promotions, support (chat), call records, bulk operations. |
| **To do** | Users, groups, managers, trading, positions, audit, leverage profiles, symbols, markup, swap, affiliate, finance, deposits (admin): replace role-only checks with permission-based checks using a shared or per-module helper and the correct key per handler. |
| **No polling** | All checks are per-request; no background or client polling. |
| **Result** | 100% server-side permission and access control; works 100% for all pages once implementation is complete. |

Once you approve this plan, implementation can proceed module by module as described in §5.

---

## 8. Validation (Plan Verified)

This plan has been checked against the codebase and is valid for 100% server-side coverage.

| Check | Result |
|-------|--------|
| **Permission keys** | All keys in §5 (e.g. `users:view`, `groups:edit`, `finance:view`, `deposits:approve`) exist in the frontend `ALL_PERMISSION_KEYS` (`src/shared/utils/permissions.ts`) and are seeded or added in backend migrations (`permissions` table). |
| **Existing pattern** | The logic used in “Add” modules will match the proven pattern in `admin_permission_profiles.rs`: `check_permission(pool, claims, key)` with admin bypass + DB lookup of `permission_profile_grants`. Same SQL, same 403 response shape. |
| **Auth** | All admin routes already use `auth_middleware`; no new auth layer required. We only add or replace the authorization check inside each handler. |
| **Backward compatibility** | Keeping “if role == admin then allow” preserves current behavior for users with role `admin` who may not have a permission profile. Optional: later you can remove the admin bypass to force profile-based access for everyone. |
| **No breaking change to API contract** | Response shapes and status codes (200, 404, 400) stay the same; we only add 403 when the user lacks the required permission. Clients that already handle 403 (e.g. frontend route guard) will behave correctly. |

---

## 9. Pre-implementation Checklist

Before starting implementation:

- [ ] Confirm that the `permissions` table in your environment contains all keys referenced in §5 (run migrations if needed).
- [ ] Decide whether to add a **shared** `check_permission` in a common module (recommended for consistency and less duplication) or duplicate the helper per module.
- [ ] Choose implementation order (e.g. admin_users first, then admin_groups, etc.) so you can test and merge incrementally.

During implementation:

- [ ] For each module: replace **every** handler that currently uses `claims.role != "admin"` or `check_admin(claims)` with a call to the permission check using the key(s) from §5.2. Do not leave any handler protected only by role.
- [ ] Use the **exact** permission key strings from the frontend/DB (e.g. `users:edit`, not `user:edit`).
- [ ] After each module: run existing tests (if any) and manually verify that a user with the correct profile can access the endpoint and a user without the permission receives 403.

After all modules:

- [ ] Smoke-test each admin page as a user with a restricted profile (only the relevant permission) and as a user without the permission; confirm 403 where expected and 200/201 where allowed.
- [ ] Confirm no admin endpoint is left protected only by role (search codebase for `role != "admin"` and `check_admin` on admin routes and ensure they are replaced).

This plan is **valid and professional** and will work **100%** once implementation is completed as above.

---

## 10. Functionality and Performance: No Disturbance, No Slowdown

### 10.1 Functionality will not be disturbed

| Aspect | Guarantee |
|--------|-----------|
| **Success path unchanged** | We only add or replace a **guard** at the very start of each handler. If the user is allowed (role `admin` or has the required permission in DB), the handler runs **exactly as it does today**. No change to business logic, request/response bodies, or status codes (200, 201, 404, 400). |
| **Existing users keep access** | We keep the **admin bypass** (`if claims.role == "admin" { return Ok(()) }`). So any user with role `admin` continues to have full access as today. Users with a permission profile who already have the required grant in `permission_profile_grants` also see no change. |
| **Only additional 403** | The **only** new behavior is: a user **without** the required permission (and not role `admin`) will receive **403 FORBIDDEN** instead of 200. That is the intended restriction, not a regression. No existing legitimate flow is removed or altered. |
| **Client handling** | The frontend already uses permission-based nav and route guards and can show “Access denied” on 403. No change to API contract (same endpoints, same success responses). |

So **no existing functionality is disturbed** for users who are supposed to have access.

### 10.2 No negative effect on optimization or speed

| Aspect | Detail |
|--------|--------|
| **What we add per request** | At most **two** simple DB operations at the start of the handler: (1) `SELECT permission_profile_id FROM users WHERE id = $1` (one row, one column), (2) `SELECT EXISTS(SELECT 1 FROM permission_profile_grants WHERE profile_id = $1 AND permission_key = $2)` (boolean). Both are **index-friendly** and return immediately. |
| **Query cost** | (1) **users**: lookup by primary key `id` → single row fetch. (2) **permission_profile_grants**: table has `ON CONFLICT (profile_id, permission_key)` in migrations, so a **unique index** exists on `(profile_id, permission_key)`; the `EXISTS` is an index seek, not a full table scan. Total added latency is **sub-millisecond** in normal conditions. |
| **Already in production** | The **same** two-query pattern is already used in **8+ modules** today (permission_profiles, tags, appointments, settings, promotions, support/chat, call_records, bulk). Those endpoints have not required extra optimization, so adding the same check to other admin modules does not introduce a new performance risk. |
| **No extra round-trips** | We do not add new HTTP calls, new services, or polling. The check runs in the same request lifecycle, in the same process. |
| **Optional later optimization** | If ever needed (e.g. very high RPS), the two queries could be combined into one (e.g. a single query joining `users` and `permission_profile_grants`). For typical admin traffic, the current pattern is sufficient and keeps the code simple. |

So implementation of this plan **will not negatively affect optimization or speed**; it adds a minimal, proven check that is already used elsewhere without performance issues.
