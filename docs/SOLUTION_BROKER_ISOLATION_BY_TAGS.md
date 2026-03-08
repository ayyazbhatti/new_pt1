# Solution: Broker (Manager) Isolation by Tags

## 1. Purpose

This document describes the end-to-end solution for **multi-tenant broker isolation** on the platform. Each broker (in the product: a manager/admin with a white-label) must only see and act on users that belong to the group(s) linked to their assigned tags. One broker must never see or modify another broker’s users.

**Related:** `docs/PLAN_USER_LIST_FILTER_BY_MANAGER_TAGS.md` covers the list-users scope; this solution extends that to **all** user-scoped admin operations and list endpoints.

---

## 2. Business Model (Recap)

| Term in product | Meaning |
|------------------|--------|
| **Broker** | A staff account with admin/manager access (white-label). In code: user with a row in `managers` and optional tags. |
| **Group** | A user group (e.g. "White Label", "Broker B Group"). Users have `group_id` → one group. |
| **Tag** | A label assignable to managers and to groups. Link: manager has tag T2 ↔ group "White Label" has tag T2 ⇒ that manager is scoped to "White Label" users only. |

**Data model:**

- `managers`: one row per broker (staff); `user_id` → `users.id`.
- `tag_assignments`: `(entity_type, entity_id, tag_id)`.
  - `entity_type = 'manager'`, `entity_id = manager.id` ⇒ tags assigned to that broker.
  - `entity_type = 'group'`, `entity_id = user_groups.id` ⇒ tags assigned to that group.
- **Allowed groups for a broker** = groups that have at least one of the broker’s tags.
- **Scope rule:** A scoped broker may only see and act on users whose `group_id` is in their allowed group set.

**Full platform admin:** A user with role `admin` and **no** row in `managers` is treated as “see all users / no group filter”. Any other admin/manager with a manager row uses tag → group scoping.

---

## 3. Current State

### 3.1 What Already Works

- **GET /api/auth/users** (list users)  
  - Implemented in `backend/auth-service/src/routes/auth.rs`:
    - `resolve_allowed_group_ids_for_list_users(pool, claims)` returns:
      - `None` for full admin (role admin, no manager row) → no filter;
      - `Some(vec![])` for manager with no tags or no manager row → no users;
      - `Some(ids)` for manager with tags → groups that have those tags.
    - `list_users` / `list_users_paginated` in `AuthService` restrict to `group_id = ANY(allowed_group_ids)` when `Some(ids)`.
  - So the **Users** page already shows only users in the broker’s allowed groups for that broker.

### 3.2 What Is Missing (Gaps)

All other admin endpoints that operate on a **target user** (or on data tied to a user) do **not** check that the target user belongs to the caller’s allowed groups. They only check role (e.g. `claims.role != "admin"`). As a result:

- A broker could call APIs with another broker’s user ID and:
  - View or change that user’s profile, group, account type, margin type, trading access, permission profile.
  - Impersonate that user.
  - Send notifications to that user.
  - View or add user notes.
  - Place or cancel orders for that user.
  - View or close positions for that user.
  - Approve/reject that user’s deposit or other transactions.
  - Create users in another broker’s group (bulk create).
  - View support chat for that user, list appointments for that user, etc.

So **listing** is scoped, but **per-user operations and other list endpoints** are not. The solution is to introduce a shared “allowed group IDs” helper and enforce it on every such endpoint.

---

## 4. Safety and Backward Compatibility

The following guarantees ensure that **no existing functionality is disturbed**:

1. **No removal or relaxation of existing checks**
   - Every route that today requires `claims.role == "admin"` (or a specific permission) **keeps that check unchanged**. The scope check is **added after** the caller has already passed the existing auth. We never remove or weaken role/permission checks.

2. **Full platform admin behaviour is unchanged**
   - When `resolve_allowed_group_ids` returns `Ok(None)` (role is admin and no manager row), `ensure_user_in_allowed_groups` returns `Ok(())` immediately for any target user. No extra query, no extra restriction. List endpoints do not add any filter when `allowed_group_ids` is `None`. So **full platform admins see and act on all users exactly as they do today**.

3. **Scope checks are additive only**
   - For callers with a manager row (brokers): we **add** a check that the target user (or resource’s user) is in the broker’s allowed groups. We do not change who is allowed to call the endpoint in the first place (that is still determined by role/permission).

4. **Existing list-users behaviour is preserved**
   - The same resolution logic used today in `auth.rs` is moved or reused in a shared helper. `list_users` continues to receive the same `allowed_group_ids` and behaves identically; only the source of that value is centralized.

5. **Routes not in scope are untouched**
   - Admin routes that do not operate on a specific user or user-scoped list (e.g. groups CRUD, managers CRUD, tags, permission profiles, symbols, leverage profiles, markup, settings, audit, call records) are **not modified**. They keep their current role/permission checks only.

6. **Error shape and codes**
   - New 403 responses use the same `ErrorResponse` structure as existing admin routes. Clients that already handle 403 continue to work; new failures are “access denied”, not new error types.

Implementations **must** follow the order “existing auth → resolve allowed_group_ids → scope check (if applicable)” so that existing behaviour for full admins and for non-scoped routes remains identical.

---

## 5. Solution Overview

1. **Shared helper:** Resolve `allowed_group_ids` for the current `Claims` once per request (same logic as list users). Use it everywhere that must enforce broker scope.
2. **Per–target-user endpoints:** For each endpoint that takes a target `user_id` (or resolves it from a resource id), after resolving `allowed_group_ids`:
   - If `Some(ids)`: load the target user’s `group_id`; if not in `ids` → **403 Forbidden** (and optionally 404 for “user not found” when we want to hide existence).
   - If `None`: no check (full admin).
3. **Update user group:** In addition to the above, ensure the **new** `group_id` in the payload is in `allowed_group_ids` so a broker cannot move a user to another broker’s group.
4. **List endpoints that return user-scoped data:** Restrict results to users in `allowed_group_ids` when the caller is scoped (e.g. list deposits, list transactions, list wallets, list appointments, admin positions list).
5. **Bulk create users:** When scoped, only allow `body.group_id` in `allowed_group_ids`.

---

## 6. Shared Helper: Resolve Allowed Group IDs

### 6.1 Location and Signature

- **Option A (recommended):** New module `backend/auth-service/src/routes/scoped_access.rs` (or `utils/scoped_access.rs`) with a function callable from both `auth.rs` and other route modules:
  - `pub async fn resolve_allowed_group_ids(pool: &PgPool, claims: &Claims) -> Result<Option<Vec<Uuid>>, (StatusCode, Json<ErrorResponse>)>`
  - Return semantics match current `resolve_allowed_group_ids_for_list_users`:
    - `Ok(None)` = full admin, no filter.
    - `Ok(Some(vec![]))` = scoped but no allowed groups (see no users).
    - `Ok(Some(ids))` = scoped to that set of group IDs.

- **Option B:** Move the existing logic from `auth.rs` into a shared module and re-export; keep the same semantics and error type so `list_users` can call it without duplication.

### 6.2 Logic (Same as Today)

1. `manager_id = SELECT id FROM managers WHERE user_id = claims.sub`.
2. If `claims.role == "admin"` and `manager_id.is_none()` → return `Ok(None)`.
3. If role != admin: ensure caller has `users:view` (permission profile); else 403.
4. If `manager_id.is_none()` → return `Ok(Some(vec![]))`.
5. Load manager’s tag IDs: `tag_assignments` where `entity_type = 'manager'` and `entity_id = manager_id`.
6. If no tags → return `Ok(Some(vec![]))`.
7. Load group IDs: `tag_assignments` where `entity_type = 'group'` and `tag_id = ANY(manager_tag_ids)`.
8. Return `Ok(Some(group_ids))`.

### 6.3 Helper: Check Target User In Scope

- Add a function used by all “target user” handlers:
  - `pub async fn ensure_user_in_allowed_groups(pool: &PgPool, allowed_group_ids: Option<&[Uuid]>, target_user_id: Uuid) -> Result<(), (StatusCode, Json<ErrorResponse>)>`
  - If `allowed_group_ids` is `None` → `Ok(())`.
  - If `Some(ids)` and `ids.is_empty()` → return 403 (or 404 if you prefer to hide).
  - Else: `SELECT group_id FROM users WHERE id = $1 AND deleted_at IS NULL`; if no row → 404; if `group_id` not in `ids` (or NULL) → 403.
  - Use a single query that returns `Option<Uuid>` for `group_id` to avoid extra round-trips.

Refactor `auth.rs` so `list_users` uses the shared `resolve_allowed_group_ids` (and no longer defines `resolve_allowed_group_ids_for_list_users` locally, or keeps a thin wrapper that calls the shared one).

**Implementation invariant:** Handlers must call `resolve_allowed_group_ids` only **after** the existing role or permission check has passed. That way, the scope logic never runs for callers who would already receive 403, and full admins (for whom the resolver returns `None`) see no change in behaviour.

### 6.4 Implementation prerequisites (required for 100% correctness)

These codebase details must be respected during implementation so the solution works in all cases:

1. **Finance `list_transactions` and `list_wallets`**  
   Currently these handlers do **not** take `Extension(claims)`. The finance router uses `auth_middleware`, which inserts `Claims` into the request. **Add** `Extension(claims): Extension<Claims>` to both handlers’ parameters so they can call `resolve_allowed_group_ids`. No middleware change is needed.

2. **Finance `reject_transaction`**  
   It currently only selects `status` from the transaction. For the scope check, **add `user_id`** to the initial `SELECT` (e.g. `SELECT user_id, status::text FROM transactions WHERE id = $1`), then call `ensure_user_in_allowed_groups(pool, allowed_group_ids.as_deref(), user_id)` before performing the reject. `approve_transaction` already selects `user_id`, so no change there beyond adding the scope check.

3. **Handlers that return `Result<T, StatusCode>`**  
   Some routes (e.g. in `deposits.rs`, `finance.rs`) return `Result<..., StatusCode>`. The shared helpers return `Result<..., (StatusCode, Json<ErrorResponse>)>`. You can either:
   - **Option A:** Map the error: `.map_err(|(status, _)| status)?` so the handler’s return type stays `Result<T, StatusCode>` (caller gets 403/500 without a JSON body), or  
   - **Option B:** Change the handler to return `(StatusCode, Json<ErrorResponse>)` for consistency with other admin routes.  
   Document the choice per route.

4. **Shared error type**  
   Define `ErrorResponse` and `ErrorDetail` in the shared scope module (or re-export from one existing module) so `resolve_allowed_group_ids` and `ensure_user_in_allowed_groups` return a single, consistent type. The shape is already the same across `auth.rs` and `admin_users.rs` (`error: { code, message }`).

5. **Auth middleware**  
   All listed admin routes already use `auth_middleware`, which inserts `Claims` into the request. No change to middleware is required; handlers only need to extract `Extension(claims)` where it is missing (see point 1).

---

## 7. Endpoints to Update

### 7.1 Admin Users Router (`/api/admin/users`)

**File:** `backend/auth-service/src/routes/admin_users.rs`

All of these take a path parameter `id` (user_id). For each, after existing auth/validation:

1. Resolve `allowed_group_ids` (shared helper).
2. Call `ensure_user_in_allowed_groups(pool, allowed_group_ids.as_deref(), user_id)`.
3. If error, return that error; else continue with existing logic.

| Method | Path | Handler | Note |
|--------|------|---------|------|
| PUT | /:id/profile | update_user_profile | Target user = path id |
| PUT | /:id/group | update_user_group | Target user = path id; **and** require `payload.group_id` in `allowed_group_ids` when scoped |
| PUT | /:id/account-type | update_user_account_type | Target user = path id |
| PUT | /:id/margin-calculation-type | update_user_margin_calculation_type | Target user = path id |
| PUT | /:id/trading-access | update_user_trading_access | Target user = path id |
| PUT | /:id/permission-profile | update_user_permission_profile | Target user = path id |
| POST | /:id/impersonate | impersonate_user | Target user = path id |
| POST | /:id/notify | admin_send_notify | Target user = path id |

**update_user_group (extra rule):** When `allowed_group_ids` is `Some(ids)`, after ensuring the **target user** is in scope, verify that `payload.group_id` (the new group) is in `ids`. If not, return 403. This prevents a broker from moving a user into another broker’s group.

### 7.2 Admin User Notes Router (`/api/admin/user-notes`)

**File:** `backend/auth-service/src/routes/admin_users.rs` (user notes router)

| Method | Path | Handler | Note |
|--------|------|---------|------|
| GET | /:user_id | list_user_notes | Target user = path user_id |
| POST | /:user_id | create_user_note | Target user = path user_id |

Apply the same pattern: resolve `allowed_group_ids`, then `ensure_user_in_allowed_groups` for the path `user_id`.

### 7.3 Admin Trading Router (`/api/admin/orders`)

**File:** `backend/auth-service/src/routes/admin_trading.rs`

| Method | Path | Handler | Note |
|--------|------|---------|------|
| POST | / (place order) | place_admin_order | Request body has `user_id`; ensure that user is in allowed groups before placing order |
| POST | /:id/cancel | cancel_admin_order | Resolve order → user_id from DB; ensure user in allowed groups |
| POST | /:id/force | force_cancel_admin_order | Same as cancel |

List orders (GET) that filter by `user_id`: when scoped, only return orders for users in `allowed_group_ids` (filter by user_id in allowed set or join through users.group_id).

### 7.4 Admin Positions Router (`/api/admin/positions`)

**File:** `backend/auth-service/src/routes/admin_positions.rs`

- **GET list:** Currently returns positions from Redis and optionally filters by `user_id`. When caller is scoped, filter the result set so that only positions whose `user_id` belongs to `allowed_group_ids` are returned (e.g. resolve user_id → group_id and keep only those in allowed set), or restrict the set of user_ids used when building the list.
- **POST /:id/close**, **close-partial**, **modify-sltp**, **liquidate:** Resolve position → user_id (from Redis or DB); then `ensure_user_in_allowed_groups` for that user.

### 7.5 Admin Deposits Router (`/api/admin/deposits`)

**File:** `backend/auth-service/src/routes/deposits.rs`

- **GET list_deposits:** When scoped, filter deposits to those where `transactions.user_id` is in a group in `allowed_group_ids` (e.g. `WHERE user_id IN (SELECT id FROM users WHERE group_id = ANY($1))` or equivalent).
- **POST /:id/approve** (approve_deposit): After loading the transaction, get `user_id`; call `ensure_user_in_allowed_groups` for that user before proceeding.
- **POST /:id/reject** (reject_deposit): Same as approve.

### 7.6 Admin Finance Router (`/api/admin/finance`)

**File:** `backend/auth-service/src/routes/finance.rs`

- **GET list_transactions:** When scoped, add filter so only transactions for users in `allowed_group_ids` are returned (e.g. join users and filter by group_id).
- **GET list_wallets:** When scoped, filter to wallets whose `user_id` is in allowed groups.
- **POST transactions/:id/approve** (approve_transaction): Load transaction → user_id; ensure user in allowed groups before approving.
- **POST transactions/:id/reject** (reject_transaction): Load transaction; get user_id; ensure user in allowed groups before rejecting.

**get_finance_overview:** Decide whether scoped brokers see platform-wide totals or only totals for their users. If only their users, aggregate over users in `allowed_group_ids`; otherwise leave as-is for full admin only and return 403 or empty for scoped (product decision).

### 7.7 Admin Bulk Router (`/api/admin/bulk`)

**File:** `backend/auth-service/src/routes/admin_bulk.rs`

- **POST /users** (post_bulk_users): Request body has `group_id` (optional). When caller has `allowed_group_ids = Some(ids)`, require that `body.group_id` is present and in `ids`. If they send a group_id not in their allowed set, return 403. When `group_id` is optional and omitted, either require it for scoped callers or default to a single allowed group (product rule).

### 7.8 Admin Appointments Router (`/api/admin/appointments`)

**File:** `backend/auth-service/src/routes/admin_appointments.rs`

- **GET list_appointments:** When scoped, filter appointments to those whose `user_id` is in allowed groups (and optionally filter by admin_id as today).
- **GET search-users:** Return only users in `allowed_group_ids` (same as list users scope).
- **GET /:id** (get_appointment): Resolve appointment → user_id; ensure user in allowed groups before returning.
- **PUT /:id** (update_appointment), **POST /:id/reminder**, **PUT /:id/reschedule**, **PUT /:id/cancel**, **PUT /:id/complete:** Resolve appointment → user_id; ensure user in allowed groups.

### 7.9 Admin Chat Router (`/api/admin/chat`)

**File:** `backend/auth-service/src/routes/chat.rs` (admin chat routes)

- **GET conversations/:user_id/messages:** Target user = path user_id; ensure user in allowed groups.
- **POST conversations/:user_id/messages:** Same.

**GET conversations (list):** When scoped, return only conversations for users in `allowed_group_ids` (filter the list by user_id in allowed set).

### 7.10 Admin Account Summary (If Present or Added)

The frontend calls `GET /api/admin/users/:userId/account-summary` from `src/features/adminUsers/modals/MultiUserMetricsModal.tsx`. If this route exists in the backend (or is added), it must:

- Resolve `allowed_group_ids`.
- Call `ensure_user_in_allowed_groups` for `userId` before returning or computing account summary.

If the route is implemented elsewhere (e.g. gateway or another service), the same rule applies there.

### 7.11 Other Admin Routes That Take a User or Resource ID

- **Admin positions close/modify by position id:** Already covered above (resolve user from position).
- **Admin trading cancel by order id:** Already covered (resolve user from order).
- Any other route that eventually operates on a user must enforce the same check.

---

## 8. List Endpoints: Filter by Allowed Groups

For each list endpoint that returns user-scoped data, when `allowed_group_ids` is `Some(ids)`:

- Restrict the query so that only rows belonging to users with `group_id IN allowed_group_ids` are returned.
- If `allowed_group_ids` is `Some(vec![])`, return an empty list (and total 0 if applicable).
- If `None`, keep current behaviour (no filter).

Summary of list endpoints to adjust:

| Router | Handler | Filter |
|--------|---------|--------|
| auth | list_users | Already done |
| deposits | list_deposits | Add filter on transactions.user_id via users.group_id |
| finance | list_transactions | Add filter on transactions.user_id via users.group_id |
| finance | list_wallets | Add filter on w.user_id via users.group_id |
| admin_positions | list (GET) | Only include positions whose user_id is in allowed groups |
| admin_trading | list orders | Only include orders whose user_id is in allowed groups |
| admin_appointments | list_appointments | Filter by appointment user_id in allowed groups |
| admin_appointments | search_users | Only return users in allowed groups (reuse same resolution as list users) |
| chat | list conversations | Only return conversations for users in allowed groups |

---

## 9. Error Responses

- **403 Forbidden:** Caller is scoped but the target user (or chosen group) is not in their allowed set. Use a generic message such as “Access denied to this resource” to avoid leaking existence of users.
- **404 Not Found:** Optionally use when the target user does not exist or is not in scope (so that out-of-scope users are indistinguishable from missing ones). Current plan uses 403 for out-of-scope; 404 only when user truly missing. Document the chosen policy and stick to it.

Use the same `ErrorResponse` shape as existing admin routes (e.g. `{ error: { code, message } }`).

---

## 10. Frontend

- **No strict backend-dependent change required for isolation:** The list already returns only scoped users; per-user actions that hit the new checks will receive 403 when out of scope, and the UI can show a generic “Access denied” or toast.
- **Optional improvements:**
  - **Group filter on Users page:** Populate the Group dropdown from the **real groups API** (not mock data). For scoped brokers, the backend can either return only allowed groups in a dedicated endpoint or the frontend can restrict the dropdown to groups present in the current list response. That way “White Label” (or the broker’s group) is the only selectable option when they have one group.
  - **Label:** Show a short label like “Showing users in your groups” when the caller is scoped, so it’s clear why the list is limited.
- **Impersonation / deep links:** If the frontend allows opening a user detail by ID (e.g. from URL), the backend will now return 403 for out-of-scope users; handle 403 gracefully (redirect or message).

---

## 11. Testing

### 11.1 Unit / Integration (Backend)

- **resolve_allowed_group_ids:**
  - Admin with no manager row → `None`.
  - Manager with no tags → `Some(vec![])`.
  - Manager with tag T2, T2 assigned to group G1 → `Some([G1])`.
  - Manager with tags T2, T3; T2→G1, T3→G2 → `Some([G1, G2])`.
- **ensure_user_in_allowed_groups:**
  - `None` → Ok(()) for any existing user.
  - `Some([])` → 403 for any target user.
  - `Some([G1])`, target user in G1 → Ok(()).
  - `Some([G1])`, target user in G2 → 403.
  - `Some([G1])`, target user group_id NULL → 403 (or define behaviour).
- **Per-endpoint:** For each updated endpoint, at least one test: scoped broker + target user in allowed group → success; scoped broker + target user in other group → 403 (or 404 if chosen).
- **update_user_group:** Scoped broker assigning user to an allowed group → success; assigning to a non-allowed group → 403.
- **Bulk create:** Scoped broker with `group_id` in allowed set → success; `group_id` not in allowed set → 403.

### 11.2 E2E / Manual

- Log in as broker (manager with tag T2, group White Label). Open Users page → only White Label users. Open one user → edit profile, change group (only to White Label), impersonate, send notify → all succeed.
- Same broker, try to open or act on a user ID that belongs to another group (e.g. from DB or another account): expect 403 (or 404) on the relevant API calls.
- Log in as full admin (no manager row): see all users; act on any user; list deposits/transactions/wallets/appointments/positions without group restriction.

---

## 12. Implementation Order

1. **Shared module:** Add `resolve_allowed_group_ids` and `ensure_user_in_allowed_groups`; refactor `auth.rs` list_users to use the shared resolver.
2. **Admin users + user-notes:** Apply scope check to all handlers in `admin_users.rs` (including update_user_group payload check for new group_id).
3. **Deposits:** list_deposits filter; approve_deposit and reject_deposit target user check.
4. **Finance:** list_transactions, list_wallets filter; approve_transaction, reject_transaction target user check.
5. **Admin trading:** place_admin_order, cancel_admin_order, force_cancel_admin_order; list orders filter when scoped.
6. **Admin positions:** list filter; close/modify/liquidate by position id (resolve user, then check).
7. **Admin bulk:** post_bulk_users group_id restriction when scoped.
8. **Admin appointments:** list, search_users, get/update/reminder/reschedule/cancel/complete with user scope.
9. **Admin chat:** list conversations filter; get/post messages for user_id scope.
10. **Account summary (if any):** Add or update GET by user id with scope check.
11. **Finance overview (if scoped):** Adjust get_finance_overview for scoped brokers per product decision.

---

## 13. Rollout and Configuration

- **Feature flag:** Optional. If used, gate the new checks behind a flag so that existing “full admin” behaviour can be restored quickly; default to “enabled” for new deployments.
- **Audit:** Consider logging 403s due to scope (without logging target user id in plaintext if sensitive) for security audits.
- **Documentation:** Update any internal API or admin docs to state that managers (brokers) are restricted to users in groups linked to their tags, and that full admins (no manager row) are not restricted.

---

## 14. Summary Table: All Touched Surfaces

| Area | File(s) | Change |
|------|---------|--------|
| Shared scope logic | New module + auth.rs | `resolve_allowed_group_ids`, `ensure_user_in_allowed_groups`; list_users uses shared resolver |
| Admin users | admin_users.rs | All :id and user_id handlers: resolve allowed groups + ensure target user (and for group update, new group_id) in scope |
| User notes | admin_users.rs | list_user_notes, create_user_note: ensure user_id in scope |
| Admin orders | admin_trading.rs | place/cancel/force: ensure user in scope; list: filter by allowed user set |
| Admin positions | admin_positions.rs | List: filter by allowed users; close/modify/liquidate: resolve user, ensure in scope |
| Admin deposits | deposits.rs | list_deposits: filter by allowed users; approve/reject: ensure transaction user in scope |
| Admin finance | finance.rs | list_transactions, list_wallets: filter; approve/reject transaction: ensure user in scope; overview: product decision |
| Admin bulk | admin_bulk.rs | post_bulk_users: when scoped, require group_id in allowed set |
| Admin appointments | admin_appointments.rs | list, search_users, get, update, reminder, reschedule, cancel, complete: filter or ensure user in scope |
| Admin chat | chat.rs | List conversations: filter; get/post messages: ensure user_id in scope |
| Account summary (admin) | If present | GET by user id: ensure user in scope |

This solution ensures that each broker (manager) can only see and act on users in the group(s) linked to their tags, and that full platform admins retain the ability to see and act on all users.

---

## 15. Pre-implementation verification (100% readiness)

Before starting implementation, the following have been confirmed against the codebase:

| Check | Status |
|-------|--------|
| List users (auth.rs) already uses resolver logic; refactor to shared helper only | ✓ Same logic, no behaviour change |
| All admin user/notes handlers have `State(pool)` and `Extension(claims)` | ✓ Verified in admin_users.rs |
| Deposits list_deposits, approve_deposit, reject_deposit have `Extension(claims)` | ✓ Verified |
| Finance approve_transaction has `Extension(claims)` and selects user_id | ✓ Verified |
| Finance reject_transaction has `Extension(claims)`; must add user_id to SELECT | ✓ Documented in §6.4 |
| Finance list_transactions, list_wallets: must add `Extension(claims)` | ✓ Documented in §6.4 |
| Admin trading list_admin_orders, place/cancel/force have `Extension(claims)` | ✓ Verified |
| Admin positions list and close/modify/liquidate have access to claims | ✓ Verified |
| Admin bulk post_bulk_users has `Extension(claims)` | ✓ Verified |
| Admin appointments and chat handlers have claims (or permission check with pool) | ✓ Verified |
| auth_middleware inserts Claims into request; no middleware change needed | ✓ Verified |
| ErrorResponse shape is identical in auth.rs and admin_users.rs | ✓ Same struct, can be shared |

Implement in the order given in §12, follow §6.4 prerequisites, and keep the guarantees in §4. The solution will then work as specified without disturbing existing functionality.
