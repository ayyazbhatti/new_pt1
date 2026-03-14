# Admin / Manager Data Scoping — How "His Users", "His Groups", and Related Data Work

This document describes how the platform restricts data so that an admin or manager sees **only their users, their groups, and the related trading/finance data**. It is the basis for making the **Manager Detail (Statistics) page** dynamic later: the same scoping rules and APIs will be used to load real stats for a given manager.

---

## 1. High-level picture

- **Backend does the scoping.** The frontend does **not** send a "manager id" or "scope" parameter to mean "show only my data". The backend uses the **authenticated user** (JWT: user id + role) to decide what to return.
- **super_admin** sees all data (all users, all groups, all orders/positions/transactions).
- **Other roles** (admin, manager, agent) see only data they are allowed to access. The dashboard comment states this explicitly: *"other admins/managers see only users they have access to (same scope as Admin Users, Finance, and Trading pages)."*
- **Permissions** (e.g. `users:view`, `trading:view`) control **whether** a user can open a page; they do **not** define **which** rows are returned. Which rows are returned is determined by the backend when it applies scope to the current user.

So: when a manager opens **Users**, **Groups**, **Trading** (orders/positions), **Transactions**, or **Dashboard**, they see only **their** users, **their** groups, and the orders/positions/transactions that belong to those users. The frontend reuses the same APIs for everyone; the backend filters by current user.

---

## 2. Users

| What | Endpoint / API | Frontend usage | Scoping |
|------|----------------|----------------|---------|
| List users (admin panel, dashboard) | `GET /api/auth/users` | `listUsers()` in `@/shared/api/users.api.ts` | Backend returns only users the current admin/manager is allowed to see. |
| Query params | `page`, `page_size`, `search`, `status`, `group_id` | Used by Admin Users page and Dashboard. | `group_id` is an **optional filter on top of** backend scope: "among the users I can see, filter by this group." |
| User search (e.g. trading lookups) | `GET /api/admin/users?search=...` | `searchAdminUsers()` in `adminTrading/api/lookups.ts` | Backend returns only users in scope; used for Trading page user filter. |

- **Admin Users page** (`AdminUsersPage.tsx`): calls `listUsers({ page, page_size, search, status, group_id })`. Group dropdown options come from `listGroups()` (scoped) and from groups present in the current user list; **UserFiltersBar** still uses `mockGroups` for the filter select — consider switching to the same source as the table (API groups + groups-from-users).
- **Dashboard** (`dashboard.api.ts`): uses `listUsers({ page: 1, page_size: 5 })` for totals and recent registrations; no extra params, backend scope only.

So: **"his users"** = whatever the backend returns from these endpoints when the current user is that manager. The backend’s exact rule (e.g. by manager_id on user, or by group ownership, or by tags) is not visible in the frontend and would need to be confirmed in the backend code or API docs.

---

## 3. Groups

| What | Endpoint / API | Frontend usage | Scoping |
|------|----------------|----------------|---------|
| List groups | `GET /api/admin/groups` | `listGroups()` in `@/features/groups/api/groups.api.ts` | Backend returns only groups the current user can see. No `manager_id` (or similar) is sent from the frontend. |
| Query params | `search`, `status`, `page`, `page_size`, `sort` | Groups page, Trading filters (group dropdown). | All scoping is on the backend. |

- **Group model** (`groups/types/group.ts`): has `createdByUserId`, `createdByEmail` — "user who created this group". So the backend may scope groups by "created by this manager" or by another rule (e.g. assignment); the frontend does not know the exact rule.
- **Trading page** group filter: options come from `fetchAdminGroups()` which calls the same `/api/admin/groups`; so the manager only sees their groups in the dropdown and can filter orders/positions by those groups.

So: **"his groups"** = whatever the backend returns from `GET /api/admin/groups` for the current user.

---

## 4. Trading: orders and positions

| What | Endpoint / API | Frontend usage | Scoping |
|------|----------------|----------------|---------|
| Orders | `GET /api/admin/orders` | `fetchAdminOrders(filters)` in `adminTrading/api/orders.ts` | Backend is expected to return only orders the current user is allowed to see (same scope as users/groups). Frontend can narrow further with filters. |
| Positions | `GET /api/admin/positions` | `fetchAdminPositions(filters)` in `adminTrading/api/positions.ts` | Same as orders. |
| Query params (both) | `status`, `symbol`, `userId`, `groupId`, `search`, `limit`, `cursor` | Set in Trading page from TradingFiltersBar (status, symbol, user search, group select, search). | `userId` and `groupId` are **filters within** the already-scoped set: "among the orders/positions I can see, filter by this user or group." |

- **TradingFiltersBar**: loads groups via `fetchAdminGroups()` and users via `searchAdminUsers(search)`; both are scoped, so the manager only sees their groups and users and can filter orders/positions by them.
- **Data types**: orders and positions include `groupId` (and user info); so "his orders" / "his positions" are those that belong to his visible users/groups, as returned by the backend.

So: **"his orders"** and **"his positions"** = data returned by these endpoints when the current user is that manager, optionally filtered by group or user on the frontend.

---

## 5. Transactions (deposits, withdrawals, finance)

| What | Endpoint / API | Frontend usage | Scoping |
|------|----------------|----------------|---------|
| Finance overview | `GET /api/admin/finance/overview` | `fetchFinanceOverview()` in `adminFinance/api/finance.api.ts` | Backend scopes; no `group_id` or `manager_id` in the request. |
| Transaction list | `GET /api/admin/finance/transactions` (or similar) | `fetchTransactions(params)` in same file | Same; params are `search`, `type`, `status`, `currency`, `dateFrom`, `dateTo` — no manager or group. |

- **Admin Transactions page** uses the same finance APIs; a manager sees only transactions for their scoped users. So **"his" deposits/withdrawals** = whatever the backend returns for the current user.

---

## 6. Leads

| What | Endpoint / API | Frontend usage | Scoping |
|------|----------------|----------------|---------|
| List leads | Leads API with `owner_id` support | `listLeads(params)` in `adminLeads/api/leads.api.ts`; params can include `owner_id`. | Backend likely scopes leads; frontend can filter by `owner_id` (lead owner = often a manager). |
| Lead model | `ownerId`, `ownerName` | Used in Leads table and Assign owner modal. | "Assigned leads" for a manager = leads where `owner_id` equals that manager’s user id (if the backend treats owner as manager). |

- So **"his leads"** can be implemented by filtering list leads with `owner_id = <manager_user_id>` (and possibly relying on backend to only return leads the current user is allowed to see).

---

## 7. Dashboard

- **Dashboard** (`dashboard.api.ts`) explicitly states: *"All of these endpoints are scoped on the backend: super_admin sees all data; other admins/managers see only users they have access to (same scope as Admin Users, Finance, and Trading pages)."*
- It uses:
  - `listUsers` (scoped users)
  - `fetchFinanceOverview` (scoped finance)
  - `fetchTransactions` (scoped transactions)
  - `fetchAdminPositions` (scoped positions)
- So the dashboard already shows "his" stats when the current user is a manager; no extra frontend parameters are used for scope.

---

## 8. What is not in the frontend

- **How** the backend decides "this manager’s users" or "this manager’s groups" is **not** defined in the frontend. Possibilities (to be confirmed in backend):
  - Users or groups have a `manager_id` (or similar) and the backend filters by current user id when role is manager.
  - Groups are scoped by `created_by_user_id` and users by membership in those groups.
  - Some tag-based or permission-based assignment links managers to users/groups.
- The frontend never sends a "scope" or "manager_id" parameter to mean "show only my data" — the backend infers scope from the JWT (current user id + role).

---

## 9. Making the Manager Detail (Statistics) page dynamic

The **Manager Detail** page (`/admin/manager/:id`) currently shows **static** placeholder stats. To make it dynamic for a **specific manager** (e.g. when viewing as super_admin or when viewing self):

### Option A: Reuse existing scoped endpoints (when viewing self)

- When the current user **is** the manager (`id` = current user id), the same pattern as the Dashboard can be used:
  - Call `listUsers`, `listGroups`, `fetchFinanceOverview`, `fetchTransactions`, `fetchAdminOrders`, `fetchAdminPositions` (and optionally leads with `owner_id`).
  - Backend will return only that manager’s data; the frontend can aggregate into the existing UI (counts, totals, recent tables, top traders, top losers, live PnL from positions).
- No new backend contract required for "view my own stats".

### Option B: Dedicated manager statistics endpoint (recommended for "view another manager")

- For a **super_admin** (or admin) viewing **another** manager’s stats, the backend would need to know "which manager’s scope to use". Options:
  1. **Dedicated endpoint:** e.g. `GET /api/admin/managers/:id/statistics` (or `GET /api/admin/managers/:id/stats`) that returns pre-aggregated stats for that manager’s scope (users count, groups count, deposit/withdrawal totals, open positions, orders, live PnL, top traders, top losers, etc.). The backend would:
     - For `id` = current user id (viewing self): use current user’s scope.
     - For `id` ≠ current user id: allow only super_admin (or equivalent) and use that manager’s scope.
  2. **Optional query param on existing endpoints:** e.g. `GET /api/auth/users?manager_id=...` (and similar for groups, orders, positions, finance). Only allowed for super_admin when viewing another manager. The frontend would then call the same endpoints with `manager_id=<id>` and aggregate results. This is more flexible but requires many endpoints to support the param and consistent semantics.

Option A + Option B (dedicated stats endpoint) is a clean split: "my stats" reuses existing scoped calls; "another manager’s stats" uses one new endpoint that encapsulates scope and aggregation on the backend.

### Data to load for Manager Detail (when dynamic)

Using the same concepts as the current static UI, the dynamic page could show:

| Section | Source (when dynamic) |
|--------|-----------------------|
| Total users, groups, active users, assigned leads | `listUsers` (count, filter by scope), `listGroups` (count), leads with `owner_id` (count). |
| Deposits / withdrawals (totals, today, pending) | `fetchFinanceOverview` and/or `fetchTransactions` over scoped users (or from dedicated manager stats endpoint). |
| Recent deposits / withdrawals | `fetchTransactions` with type deposit/withdrawal, limited count. |
| Open positions (count, exposure, list) | `fetchAdminPositions` (scoped); aggregate count, exposure, live PnL. |
| Orders (active, filled today, list) | `fetchAdminOrders` (scoped); aggregate counts and recent list. |
| Live PnL | From positions data (unrealized PnL sum). |
| Top traders / Top losers | From positions + account summaries or a dedicated endpoint that returns per-user PnL/volume for the manager’s users. |

If a dedicated `GET /api/admin/managers/:id/statistics` (or similar) exists, it can return these aggregates and the frontend only needs to call that and map to the existing UI.

---

## 10. Summary table (frontend view)

| Area | Main API / endpoint | Frontend filter params | Who sees what |
|------|---------------------|------------------------|----------------|
| Users | `GET /api/auth/users` | `group_id`, `search`, `status`, `page`, `page_size` | Backend scope + optional group filter. |
| Groups | `GET /api/admin/groups` | `search`, `status`, `page`, `page_size`, `sort` | Backend scope only. |
| Orders | `GET /api/admin/orders` | `status`, `symbol`, `userId`, `groupId`, `search`, `limit`, `cursor` | Backend scope + optional user/group/symbol/status. |
| Positions | `GET /api/admin/positions` | Same as orders | Same as orders. |
| Finance overview | `GET /api/admin/finance/overview` | — | Backend scope only. |
| Transactions | `GET /api/admin/finance/transactions` (or similar) | `search`, `type`, `status`, `currency`, `dateFrom`, `dateTo` | Backend scope only. |
| Leads | Leads API | `owner_id` (optional) | Backend scope + optional owner filter. |

**Conclusion:** The platform shows "his users", "his groups", and related trading/transactions/leads by **relying on backend scoping** on the same APIs used everywhere. The frontend does not send a manager id for "my scope"; it only sends optional filters (e.g. group, user, owner) on top of that scope. For the Manager Detail statistics page, dynamic data can be built from these same endpoints when viewing self, or from a dedicated manager statistics endpoint when viewing another manager (e.g. as super_admin).
