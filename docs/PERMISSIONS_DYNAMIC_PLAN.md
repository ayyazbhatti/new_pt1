# Permissions – Full Dynamic Implementation Plan

This document defines the implementation plan for **permission profiles** and **per-route access control** across the application. It lists every page that must be gated, the exact permission keys to use, and the backend and frontend steps required so that the Permissions page and the rest of the app work correctly with dynamic permissions. No pages are skipped.

**Status:** Plan validated against the current codebase. Ready for implementation upon approval.

---

## 1. Current state

- **Permissions page** (`/admin/permissions`): Static mock only. Admin creates “permission profiles” (name + set of access rights) and assigns a profile to managers. No API, no persistence.
- **Access control today**:
  - **Admin area** (`/admin/*`): `AdminGuard` allows only `user.role === 'admin'`. All other roles are denied.
  - **Leads** (when used under admin/agent): `useLeadPermissions()` uses `useCanAccess(LEAD_PERMISSIONS.*)`. Permissions come from `getCurrentUserPermissions(user)` which uses either `user.permissions` (if set) or hardcoded `ROLE_PERMISSIONS[user.role]` (admin / manager / agent).
- **Backend**: `users` table has `role` (string). No `permission_profiles` table, no `permission_profile_id` on users, no `/api/admin/permission-profiles` or similar. Auth `/me` and login response do not return `permissions`.

---

## 2. Target model and access logic

### 2.1 Data model

- **Permission profile**: Named set of access rights (e.g. “Leads manager”, “Support agent”). Stored in DB, CRUD via API.
- **User** (manager/agent): Has `permission_profile_id` (optional). If set, effective permissions = that profile's grants. If not set, effective permissions = role-based default (see 2.2).
- **Sidebar & routes**: Show or allow only what the user's effective permissions allow.

### 2.2 Effective permissions (backend)

- **Role = admin:** Always treat as having **all** permission keys (full access). No profile required. Login and `/me` must return `permissions` as the full list so the frontend stays consistent.
- **Role = manager or agent, and `permission_profile_id` is set:** Effective permissions = the set of permission keys from that profile (from `permission_profile_grants` or equivalent).
- **Role = manager or agent, and `permission_profile_id` is null:** Effective permissions = **empty list** (or a minimal role default if you prefer). This avoids giving existing managers/agents unintended access before they are assigned a profile.

### 2.3 Frontend access checks

- **`getCurrentUserPermissions(user)`** (in `permissions.ts`): If `user.permissions` is present and non-empty (from API), return it. Else if `user.role === 'admin'`, return the **full list of all permission keys** (admin bypass). Else return role-based default (e.g. current lead-only defaults for manager/agent when no profile).
- **`canAccess(permissionKey, user)`**: True if the permission key is in the effective list (or user is admin with full list). This already works once `user.permissions` is populated and admin bypass is added.

### 2.4 AdminGuard and who can enter `/admin/*`

- **Today:** Only `user.role === 'admin'` can pass AdminGuard; others see "Access denied".
- **After change:** Allow entry for **admin, manager, and agent** so that managers/agents with a profile can reach routes they have permission for. Then:
  - **Per-route guard:** Before rendering each admin route, check the **required permission** for that route. If the user does not have it (and is not admin), render the existing `AccessDenied` component (from `src/features/auth/components/AccessDenied.tsx`) or redirect to dashboard. Admin role always passes the per-route check.
  - **Sidebar:** Show only nav items for which the user has the corresponding permission (e.g. `dashboard:view`, `users:view`). Admins see all items.

---

## 3. Permission keys (unified list)

These are the keys used in profiles and in UI/API checks. Same IDs as on the Permissions page plus any extras needed for other admin areas.

| Key | Description | Used by (page/feature) |
|-----|-------------|------------------------|
| **Leads** | | |
| `leads:view_all` | View all leads | Leads page (admin/agent) |
| `leads:view_assigned` | View assigned leads only | Leads page |
| `leads:create` | Create leads | Leads page |
| `leads:edit` | Edit leads | Leads page |
| `leads:delete` | Delete leads | Leads page |
| `leads:assign` | Assign leads | Leads page |
| `leads:change_stage` | Change stage | Leads page |
| `leads:export` | Export | Leads page |
| `leads:settings` | Leads settings | Leads (e.g. pipeline) |
| `leads:templates` | Templates | Leads |
| `leads:assignment` | Assignment rules | Leads |
| `leads:import` | Import leads | Leads page |
| **Trading & finance** | | |
| `trading:view` | View trading (orders/positions) | Admin Trading |
| `trading:place_orders` | Place orders on behalf of user | Admin Trading |
| `deposits:approve` | Approve deposits | Transactions / Finance |
| `deposits:reject` | Reject deposits | Transactions / Finance |
| `finance:view` | View finance/transactions | Transactions |
| **Support** | | |
| `support:view` | View support chat | Support page |
| `support:reply` | Reply to users | Support page |
| **Users & groups** | | |
| `users:view` | List/view users | Admin Users |
| `users:edit` | Edit user (group, account type, etc.) | Admin Users |
| `users:create` | Create user | Admin Users |
| `groups:view` | View groups | Groups page |
| `groups:edit` | Create/edit groups | Groups page |
| **Configuration** | | |
| `symbols:view` | View symbols | Symbols page |
| `symbols:edit` | Edit symbols | Symbols page |
| `markup:view` | View price markup | Price Markup page |
| `markup:edit` | Edit markup profiles | Price Markup page |
| `swap:view` | View swap rules | Swap Fees page |
| `swap:edit` | Edit swap rules | Swap Fees page |
| `leverage_profiles:view` | View leverage profiles | Leverage Profiles page |
| `leverage_profiles:edit` | Edit leverage profiles | Leverage Profiles page |
| **Risk & reports** | | |
| `risk:view` | View risk | Risk page |
| `risk:edit` | Edit risk settings | Risk page |
| `reports:view` | View reports | Reports page |
| **Other admin** | | |
| `dashboard:view` | View dashboard | Dashboard |
| `bonus:view` | View bonus | Bonus page |
| `bonus:edit` | Edit bonus | Bonus page |
| `affiliate:view` | View affiliate | Affiliate page |
| `affiliate:edit` | Edit affiliate | Affiliate page |
| `permissions:view` | View permission profiles | Permissions page |
| `permissions:edit` | Create/edit/delete profiles | Permissions page |
| `system:view` | View system | System page |
| `settings:view` | View settings | Settings page |
| `settings:edit` | Edit settings | Settings page |

You can trim or extend this list; the implementation should use a single shared list (e.g. in `permissions.ts` and backend).

---

## 4. All pages and their permission(s)

Every route that exists today and how it should be gated (so nothing is skipped).

### 4.1 Public (no login)

| Route | Page | Permission | Notes |
|-------|------|-------------|--------|
| `/login` | LoginPage | — | Public |
| `/register` | RegisterPage | — | Public |

### 4.2 User (trading) app

| Route | Page | Permission | Notes |
|-------|------|-------------|--------|
| `/` | TerminalPage | — | End-user trading; no admin permission. Optional: restrict by `trading_access` (already on user). |
| `/user/trading` | TradingPage | — | Same as above. |

These are not admin; they use AuthGuard only. No permission profile key needed unless you add role-based visibility later.

### 4.3 Admin app (under `/admin/*`)

All below are behind `AuthGuard` + `AdminGuard`. Today `AdminGuard` only allows `role === 'admin'`. After the change, access can be “admin role OR user has required permission for that area”.

| Route | Page | Suggested permission(s) | Notes |
|-------|------|--------------------------|--------|
| `/admin/dashboard` | DashboardPage | `dashboard:view` | Overview. |
| `/admin/users` | AdminUsersPage | `users:view` (list), `users:edit`, `users:create` | Must be able to assign permission profile to user (e.g. when creating/editing manager). |
| `/admin/groups` | GroupsPage | `groups:view`, `groups:edit` | |
| `/admin/trading` | AdminTradingPage | `trading:view`, `trading:place_orders` (for place order actions) | Orders, positions, audit, margin events. |
| `/admin/risk` | RiskPage | `risk:view`, `risk:edit` | |
| `/admin/leverage-profiles` | LeverageProfilesPage | `leverage_profiles:view`, `leverage_profiles:edit` | |
| `/admin/symbols` | SymbolsPage | `symbols:view`, `symbols:edit` | |
| `/admin/markup` | AdminMarkupPage | `markup:view`, `markup:edit` | |
| `/admin/swap` | SwapRulesPage | `swap:view`, `swap:edit` | |
| `/admin/transactions` | AdminTransactionsPage | `finance:view`, `deposits:approve`, `deposits:reject` | Transactions / Finance / Deposits. |
| `/admin/finance` | (redirect to transactions) | — | Same as transactions. |
| `/admin/deposits` | (redirect to transactions) | — | Same as transactions. |
| `/admin/bonus` | BonusPage | `bonus:view`, `bonus:edit` | |
| `/admin/affiliate` | AffiliatePage | `affiliate:view`, `affiliate:edit` | |
| `/admin/permissions` | PermissionsPage | `permissions:view`, `permissions:edit` | Create/edit/delete profiles; assign profile to user is on Users page. |
| `/admin/support` | SupportPage | `support:view`, `support:reply` | |
| `/admin/system` | SystemPage | `system:view` | |
| `/admin/settings` | SettingsPage | `settings:view`, `settings:edit` | |
| `/admin/reports` | ReportsPage | `reports:view` | |

### 4.4 Leads (admin vs agent)

Leads can be under `/admin/leads` or `/agent/leads` depending on routing. **Note:** As of this audit, `adminRoutes` does not include `/admin/leads`, and there is no `/agent/*` layout/routes in `AppRouter`; `agentNavItems` exists in `nav.ts` but the Leads page is not mounted. When you add these routes, use the permission mapping below so no page is skipped.

| Context | Page | Permissions (already used) | Notes |
|---------|------|-----------------------------|--------|
| Admin leads | LeadsPage (basePath `/admin/leads`) | `useLeadPermissions()` → LEAD_PERMISSIONS.* | Already uses `useCanAccess(LEAD_PERMISSIONS.*)`. |
| Agent leads | LeadsPage (basePath `/agent/leads`) | Same | Same hook; permissions from profile or role. |

Leads pages that use `useLeadPermissions`: **LeadsPage**, **LeadHeader**, **LeadsPipelinePage**. No other pages use lead permissions today.

### 4.5 Support

Support page uses `/api/admin/chat/*`. Backend should allow access if user has `support:view` / `support:reply` (or admin). No extra page list; it’s the single Support page above.

### 4.6 Other features that call admin APIs

These don’t define their own “permission key” in the frontend today; they rely on being behind AdminGuard. After going dynamic, they should be gated by the same permission keys as the page they belong to:

- **Admin Users**: CreateEditUserModal, UserDetailsModal, etc. → `users:*`.
- **Groups**: GroupFormDialog, AssignSymbolsModal, etc. → `groups:*`.
- **Admin Trading**: OrdersTable, PositionsTable, OrderCreateModal, etc. → `trading:*`.
- **Symbols**: SymbolsTable, AddSymbolModal, etc. → `symbols:*`.
- **Markup**: ProfilesTable, MarkupEditor, etc. → `markup:*`.
- **Swap**: SwapRulesTable, BulkAssignSwapModal → `swap:*`.
- **Leverage profiles**: ProfilesTable, TiersTable, modals → `leverage_profiles:*`.
- **Transactions / Finance**: FinanceTransactionsPanel, FinanceWalletsPanel, approve/reject → `finance:view`, `deposits:approve`, `deposits:reject`.
- **Support**: SupportPage only; support API → `support:view`, `support:reply`.

So: “all pages” for permissions = every row in section 4.3, plus Leads (4.4) and the single Support page. No page is skipped.

---

## 5. Backend implementation plan

### 5.1 Database

- **Table `permission_profiles`**  
  - `id` (UUID, PK), `name` (VARCHAR), `description` (TEXT, nullable), `created_at`, `updated_at`.
- **Table `permission_profile_grants`** (or JSONB column on profile)  
  - Profile id + permission key. Suggested: `profile_id` (UUID), `permission_key` (VARCHAR), unique (profile_id, permission_key). Alternatively one row per profile with `permission_keys` JSONB array.
- **Users**  
  - Add `permission_profile_id` (UUID, nullable, FK to `permission_profiles`). If set, user’s effective permissions = that profile’s grants. If null, keep current behavior (e.g. role-based defaults for backward compatibility).

### 5.2 Auth service (auth-service)

- **Permission profile CRUD**  
  - `GET /api/admin/permission-profiles` – list (admin only).  
  - `POST /api/admin/permission-profiles` – create (body: name, description?, permission_keys[]).  
  - `GET /api/admin/permission-profiles/:id` – get one.  
  - `PUT /api/admin/permission-profiles/:id` – update.  
  - `DELETE /api/admin/permission-profiles/:id` – delete (check no users assigned).
- **User ↔ profile**  
  - When creating/updating user (admin users API): accept `permission_profile_id` (optional).  
  - `GET /api/admin/users` (and user-by-id if exists): include `permission_profile_id` and optionally profile name.
- **Effective permissions**  
  - Helper: given `user_id`, return list of permission keys (from profile if `permission_profile_id` set, else from role-based default map).
- **Login and /me**  
  - Include in response `permissions: string[]` (effective permission keys) so frontend can store and use without extra round-trip.  
  - Optionally include `permission_profile_id` and `permission_profile_name` for display.
- **Protection of admin endpoints**  
  - For each admin route, define required permission(s). If user is not admin and does not have the required permission, return 403. (Optional: keep “admin role = full access” and only check permissions for non-admin roles.)

### 5.3 Consistency with frontend

- Backend permission keys must match the unified list (section 3). Expose the list from backend (e.g. GET `/api/admin/permission-profiles/keys`) or keep a shared constant and ensure backend uses the same set.

---

## 6. Frontend implementation plan

### 6.1 Auth and user state

- **MeResponse / User type**  
  - Add `permissions?: string[]`, optionally `permissionProfileId?: string`, `permissionProfileName?: string`.
- **Auth store**  
  - After login and after `me()`, set `user.permissions` from API. Use it in `getCurrentUserPermissions(user)` so `canAccess` / `useCanAccess` use API-driven permissions when present; otherwise fall back to role-based (for backward compatibility).
- **Hydration / refreshUser**  
  - When refreshing user or hydrating, merge in `permissions` (and profile fields if added) from `/me`.

### 6.2 Permissions page (fully dynamic)

- **API client**  
  - `GET /api/admin/permission-profiles` → list.  
  - `POST /api/admin/permission-profiles` → create.  
  - `PUT /api/admin/permission-profiles/:id` → update.  
  - `DELETE /api/admin/permission-profiles/:id` → delete.  
  - Permission keys list: either from API or from shared constant (section 3).
- **State**  
  - Replace mock profiles with API data (e.g. React Query). Create/Edit/Delete call API and invalidate list.
- **Tabs**  
  - Keep “Profiles” and “Permissions by profile” tabs; both read from API.
- **Guarding**  
  - Show page only if user has `permissions:view` (or admin). Disable create/edit/delete if no `permissions:edit`.
- **Permission categories in UI**  
  - The Permissions page create/edit profile form must include **all** categories and keys from the unified list (section 3). Today `PERMISSION_CATEGORIES` in `PermissionsPage.tsx` only has Leads, Trading & Finance, and Support. Expand it to include Users & groups, Configuration, Risk & reports, and Other admin so admins can assign any key to a profile.

### 6.3 Admin Users page – assign profile to user

- **User type / API**  
  - Include `permission_profile_id` and optionally `permission_profile_name` in user list and user detail.
- **Create user modal**  
  - Add dropdown “Permission profile” (list from `GET /api/admin/permission-profiles`). Optional for user creation (only for manager/agent if you distinguish).
- **Edit user modal**  
  - Same dropdown; allow changing assigned profile. On save, call API to update user’s `permission_profile_id`.
- **Backend**  
  - PATCH/PUT user to set `permission_profile_id`.

### 6.4 AdminGuard and sidebar

- **Option A – Route-level**  
  - Keep AdminGuard but allow access if `user.role === 'admin'` OR user has at least one “admin” permission (e.g. any key in the unified list). Then per-page or per-section hide UI based on specific permission.
- **Option B – Per-route permission**  
  - For each admin route, define required permission (e.g. `dashboard:view`, `users:view`, …). Guard that route: if user doesn’t have it (and is not full admin), redirect to “Access denied” or dashboard.  
  - Requires a map: `path → requiredPermission` and a guard that reads current path and user permissions.
- **Sidebar**  
  - Filter `adminNavItems`: show item only if user has the permission for that route (e.g. Dashboard → `dashboard:view`, Users → `users:view`, …, Permissions → `permissions:view`). If user has no permission for any page, show a minimal nav or “Access denied” message.
- **Recommendation**  
  - Use Option B (per-route required permission) + sidebar filtering so managers only see and access what their profile allows.

### 6.5 Per-page permission checks (no page skipped)

For each page in section 4.3 and 4.4, apply the following.

- **Route guard**  
  - Before rendering the page, check the required permission(s). If missing, redirect or show “Access denied”.
- **Inside page**  
  - Use `useCanAccess(permissionKey)` (or a small wrapper) to hide/disable create or edit actions when the user has view-only (e.g. `users:view` but not `users:create` / `users:edit`).

Concrete mapping (repeat of section 4.3 + 4.4 for implementation):

| Page | Route | Required to enter | Optional (for buttons) |
|------|--------|-------------------|-------------------------|
| DashboardPage | `/admin/dashboard` | `dashboard:view` | — |
| AdminUsersPage | `/admin/users` | `users:view` | `users:create`, `users:edit` |
| GroupsPage | `/admin/groups` | `groups:view` | `groups:edit` |
| AdminTradingPage | `/admin/trading` | `trading:view` | `trading:place_orders` |
| RiskPage | `/admin/risk` | `risk:view` | `risk:edit` |
| LeverageProfilesPage | `/admin/leverage-profiles` | `leverage_profiles:view` | `leverage_profiles:edit` |
| SymbolsPage | `/admin/symbols` | `symbols:view` | `symbols:edit` |
| AdminMarkupPage | `/admin/markup` | `markup:view` | `markup:edit` |
| SwapRulesPage | `/admin/swap` | `swap:view` | `swap:edit` |
| AdminTransactionsPage | `/admin/transactions` | `finance:view` | `deposits:approve`, `deposits:reject` |
| BonusPage | `/admin/bonus` | `bonus:view` | `bonus:edit` |
| AffiliatePage | `/admin/affiliate` | `affiliate:view` | `affiliate:edit` |
| PermissionsPage | `/admin/permissions` | `permissions:view` | `permissions:edit` |
| SupportPage | `/admin/support` | `support:view` | `support:reply` |
| SystemPage | `/admin/system` | `system:view` | — |
| SettingsPage | `/admin/settings` | `settings:view` | `settings:edit` |
| ReportsPage | `/admin/reports` | `reports:view` | — |
| LeadsPage (admin/agent) | `/admin/leads` or `/agent/leads` | `leads:view_all` or `leads:view_assigned` | Already fine-grained via `useLeadPermissions()` |

- **Leads**  
  - Keep using `useLeadPermissions()`; ensure `getCurrentUserPermissions()` uses `user.permissions` from API when available so lead permissions come from the assigned profile (or role fallback).

### 6.6 Shared permission list and nav config

- **Single source of permission keys**  
  - In `src/shared/utils/permissions.ts` (or similar), export the full list (section 3) and reuse in Permissions page (create/edit profile checkboxes), in sidebar filter, and in route guard map.
- **Nav config**  
  - Add to each `adminNavItems` entry a field like `permission: 'dashboard:view' | 'users:view' | ...`. Sidebar then filters by `canAccess(item.permission, user)`.

---

## 7. Implementation order (suggested)

1. **Backend: DB + profile CRUD + user assignment**  
   - Migrations for `permission_profiles` and `permission_profile_grants` (or equivalent), `users.permission_profile_id`.  
   - Implement permission profile CRUD and “effective permissions” helper.  
   - Add `permission_profile_id` to user create/update and list/detail responses.
2. **Backend: Auth responses**  
   - Add `permissions: string[]` (and optionally profile id/name) to login and `/me`.  
   - (Optional) Enforce permission checks on admin endpoints (403 when missing).
3. **Frontend: Auth + permissions in store**  
   - MeResponse and auth store: persist `permissions` (and profile fields if any).  
   - Ensure `getCurrentUserPermissions` / `canAccess` / `useCanAccess` use `user.permissions` when present.
4. **Frontend: Permissions page API**  
   - Wire Permissions page to profile CRUD API; remove mock data.
5. **Frontend: Admin Users – assign profile**  
   - Add permission profile dropdown to create/edit user; save `permission_profile_id`.
6. **Frontend: Sidebar + route guard**  
   - Add `permission` to nav config; filter sidebar by permission.  
   - Add per-route permission check (or extend AdminGuard) so each admin route requires the right key.
7. **Frontend: Per-page checks**  
   - For each page in section 6.5, add the required permission to the route guard and, where needed, use `useCanAccess` for create/edit visibility.  
   - Leads: already using `useLeadPermissions()`; only ensure data source is API permissions.
8. **Backend: Optional hardening**  
   - Enforce permission on each admin endpoint so that even direct API calls respect profiles.

---

## 8. Risks and assumptions

- **Existing users:** Users with role manager/agent and no `permission_profile_id` get effective permissions = empty list (or minimal default). They will not see admin pages until assigned a profile. This is intentional to avoid unintended access.
- **Admin role:** Admins always get full access. No profile is required for admin. Backend should return the full list of permission keys in login/`/me` for admin so the frontend can show all nav items and pass all route checks.
- **Single source of truth for keys:** The same permission key list must be used in: backend (DB grants, effective-permissions helper, optional `/keys` endpoint), frontend `permissions.ts`, Permissions page categories, nav config, and route guard map. Any new key must be added in all places.
- **API prefix:** Admin permission-profile and user APIs are assumed under the auth service (e.g. `/api/admin/permission-profiles` and user update via existing admin users routes). If your gateway routes `/api/admin/*` to a different service, implement profile CRUD and user assignment there or proxy to auth-service.

---

## 9. Validation checklist (post-implementation)

Use this to verify the plan was implemented correctly:

- [ ] Backend: `permission_profiles` and `permission_profile_grants` (or equivalent) exist; `users.permission_profile_id` exists and is nullable.
- [ ] Backend: Profile CRUD (list, create, get, update, delete) works; delete rejects when users are assigned.
- [ ] Backend: User create/update accepts `permission_profile_id`; list/detail return it (and optionally profile name).
- [ ] Backend: Login and `/me` return `permissions: string[]`; admin gets full list; manager/agent with profile get profile's keys; manager/agent without profile get empty (or defined default).
- [ ] Frontend: Auth store and MeResponse include `permissions`; login and refreshUser set `user.permissions`.
- [ ] Frontend: `getCurrentUserPermissions` uses `user.permissions` when set, else admin => all keys, else role default.
- [ ] Frontend: Permissions page uses real API; create/edit form includes all permission categories from section 3.
- [ ] Frontend: Admin Users page allows selecting/editing permission profile for a user; save updates `permission_profile_id`.
- [ ] Frontend: Nav config has a `permission` per item; sidebar filters items by `canAccess(item.permission)`; admin sees all.
- [ ] Frontend: AdminGuard allows admin, manager, agent; per-route guard (or equivalent) checks required permission and shows AccessDenied when missing; admin bypasses.
- [ ] Each admin page in section 6.5 is gated by the listed required permission; create/edit actions use the listed optional permissions where applicable.
- [ ] Leads: `useLeadPermissions()` and `getCurrentUserPermissions` work with API-driven `user.permissions`.

---

## 10. Summary

- **Pages considered:** All public, user (trading), and admin routes listed in sections 4.1–4.4; Support and Leads explicitly included; all admin sub-features (modals, tables) gated by the same permission as their parent page.
- **Permissions page:** Becomes fully dynamic (CRUD profiles from API, permission matrix from API data; assign profile on Users page).
- **No page skipped:** Every admin and lead page has a required permission and optional create/edit permissions where applicable.
- **Access logic:** Admin always has full access; manager/agent use profile-based permissions with a defined fallback when no profile is set; AdminGuard allows admin/manager/agent, with per-route permission checks and sidebar filtering.

This plan is validated against the current codebase and is ready for implementation. After approval, implement in the order given in section 7 (backend first, then frontend auth, Permissions page, Users assignment, sidebar and guards, per-page checks), and use section 9 to verify completeness.
