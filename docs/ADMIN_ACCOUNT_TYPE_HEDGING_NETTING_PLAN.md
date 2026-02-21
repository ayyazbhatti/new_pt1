# Admin Users: Account Type (Hedging / Netting) Dropdown – Solution Plan

## Overview

Add an **Account Type** dropdown on the Admin Users page (`/admin/users`) with options **Hedging** and **Netting**, using the same UX pattern as the existing **Group** dropdown. When the admin applies a change, it takes effect in real time (no page reload, no polling). If the user has any **open positions**, the admin must not be allowed to change account type (dropdown disabled or apply rejected with a clear message).

**Constraint:** No polling. All updates are driven by user action (dropdown apply) and immediate API response + local state update.

**Validation:** This plan has been cross-checked against the codebase (routes, schema, migrations, frontend table and API). Implementation order and SQL/API details are specified so the feature works end-to-end.

---

## 1. CFD, Hedging, and Netting – Scope and Guarantees

**Context (CFD):** The platform is a CFD/margin trading system. Position behaviour is determined by **account type**:

- **Hedging (current behaviour):** User can hold both a long and a short position in the same symbol at the same time. Opening an opposite order creates a new position of the opposite side; it does not reduce or close the existing position. This is what the order engine does today (`atomic_fill_order.lua`, `execution.rs`).
- **Netting:** User has one net position per symbol. Opposite orders reduce or close the existing position (or flip from long to short). No simultaneous long and short for the same symbol.

**What this plan implements:**

| Aspect | In scope | Guarantee after implementation |
|--------|----------|--------------------------------|
| **Storage** | Yes | `users.account_type` stores `'hedging'` or `'netting'`; default `'hedging'` for all existing and new users. |
| **Admin UI** | Yes | Admin can see and change account type per user (dropdown); change blocked when user has open positions. |
| **Hedging execution** | No code change | Unchanged. Order engine and position logic continue to behave as today (hedging). **Hedging continues to work 100%.** |
| **Netting execution** | No (Phase 2) | Netting is stored and displayed only. When you later add order-engine logic that reads `account_type` and implements netting (reduce/close opposite position), that logic will use this stored value. This plan does not modify any execution path. |

**Guarantees:**

1. **Hedging works 100%:** No changes to order placement, fill logic, or position creation. Existing hedging behaviour is preserved.
2. **Netting:** After this plan, netting is a **saved preference** and **admin UI only**. Execution remains hedging until a separate change (Phase 2) makes the order engine respect `account_type`. No execution code is touched in this plan.
3. **No other functionality disturbed:** Only the listed files are modified (see §6 and §8). Orders, positions, balance, margin, risk, other admin pages, and the user trading panel are unchanged.

---

## 2. Current Behaviour (Reference)

- **Page:** `src/features/adminUsers/pages/AdminUsersPage.tsx`
- **Table:** `src/features/adminUsers/components/UsersTable.tsx` renders a **Group** column with a per-row `Select` (same pattern we will reuse).
- **Group update:** On value change, `handleGroupChange` calls `updateUserGroup(userId, { group_id })` → `PUT /api/admin/users/:id/group`. On success, `onUserUpdate(userId, { group, groupName })` updates local state so the table reflects the new group without refetch or polling.
- **Users list:** Fetched once via `listUsers()` → `GET /api/auth/users` (auth-service `list_users`). Response includes `group_id`, `group_name`, etc.

---

## 3. Backend Changes

### 3.1 Database

- **Table:** `users`
- **Add column:** `account_type` with allowed values `'hedging'` | `'netting'`.
- **Implementation (recommended for minimal migration surface):**
  - Use `VARCHAR(20)` with a check constraint (no new enum type, consistent with existing `database/migrations` style).
  - Add column: `account_type VARCHAR(20) NOT NULL DEFAULT 'hedging'`.
  - Add constraint: `CHECK (account_type IN ('hedging', 'netting'))`.
- **Migration file:** `database/migrations/0019_account_type.sql` (next number after `0018_user_groups_stop_out_level.sql`).

**Migration SQL (exact):**

```sql
-- Account type: hedging (default) or netting. Used by admin UI; execution logic unchanged in this phase.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS account_type VARCHAR(20) NOT NULL DEFAULT 'hedging';

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_account_type_check;

ALTER TABLE users
  ADD CONSTRAINT users_account_type_check CHECK (account_type IN ('hedging', 'netting'));
```

- Default `'hedging'` keeps current behaviour for all existing users.

### 3.2 Auth-Service: List Users Response

- **Where:** `backend/auth-service/src/routes/auth.rs` – `list_users` handler builds `UserResponse` for each user.
- **Model:** `backend/auth-service/src/models/user.rs` – add `account_type: String` to `User` so that `SELECT * FROM users` (used in `auth_service.list_users`) includes the new column. Use `String` to match `VARCHAR(20)`.
- **UserResponse:** In `auth.rs`, extend `UserResponse` with:
  - `account_type: Option<String>` – from `u.account_type` (serialize as `"hedging"` or `"netting"`).
  - `open_positions_count: Option<i32>` – number of open positions for this user.
- **Open positions count (single batch query, no N+1):**
  - After fetching the list of users, collect all user IDs: `let user_ids: Vec<Uuid> = users.iter().map(|u| u.id).collect();`.
  - If `user_ids` is empty, skip the query and use an empty map.
  - Otherwise run (PostgreSQL `position_status` enum):  
    `SELECT user_id, COUNT(*)::int FROM positions WHERE status = 'open'::position_status AND user_id = ANY($1) GROUP BY user_id`
  - Build `HashMap<Uuid, i32>` from the result; for each user set `open_positions_count: count_map.get(&u.id).copied().unwrap_or(0)`.
  - This avoids N+1 and avoids polling; count is correct at list request time.

### 3.3 Auth-Service: Update Account Type Endpoint

- **Route:** `PUT /api/admin/users/:id/account-type` (path param `id` = user UUID).
- **Where:** `backend/auth-service/src/routes/admin_users.rs` – add handler and register `.route("/:id/account-type", put(update_user_account_type))`.
- **Payload:** `{ "account_type": "hedging" | "netting" }`. Use a small struct e.g. `UpdateUserAccountTypeRequest { account_type: String }`.
- **Logic:**
  1. Require admin (same check as `update_user_group`: `claims.role != "admin"` → 403). Use same `ErrorResponse` / `ErrorDetail` shape as existing handlers in this file.
  2. Parse path `user_id` (Uuid) and body `account_type`. Validate `account_type` is exactly `"hedging"` or `"netting"` (case-sensitive or normalize to lowercase); otherwise return **400** with code e.g. `INVALID_ACCOUNT_TYPE`.
  3. **Guard:** Query open positions count:  
     `SELECT COUNT(*)::int FROM positions WHERE user_id = $1 AND status = 'open'::position_status`  
     If count > 0, return **400** with body: `Json(ErrorResponse { error: ErrorDetail { code: "OPEN_POSITIONS", message: "Cannot change account type: user has open positions. Close all positions first." } })`.
  4. Verify user exists (same as group update): `SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)`. If false → 404.
  5. If count == 0: `UPDATE users SET account_type = $1, updated_at = NOW() WHERE id = $2` (bind normalized value e.g. lowercase).
  6. Return success: `Ok(Json(serde_json::json!({ "success": true, "message": "Account type updated" })))`.
- **Errors:** 400 invalid payload or open positions (same `ErrorResponse` shape), 403 not admin, 404 user not found.

---

## 4. Frontend Changes

### 4.1 Types and API

- **User type:** `src/features/adminUsers/types/users.ts`  
  - Add `accountType: 'hedging' | 'netting'`.
  - Add `openPositionsCount: number` (used to disable the dropdown when > 0; treat missing as 0 for backward compatibility).
- **List users response:** `src/shared/api/users.api.ts` – extend `UserResponse` with:
  - `account_type?: string`
  - `open_positions_count?: number`
- **Mapping:** In `AdminUsersPage.tsx`, inside `mapUserResponse`, set:
  - `accountType: (user.account_type === 'netting' ? 'netting' : 'hedging')`.
  - `openPositionsCount: user.open_positions_count ?? 0`.
- **New API function:** In `src/features/adminUsers/api/users.api.ts`:
  - `updateUserAccountType(userId: string, payload: { account_type: 'hedging' | 'netting' }): Promise<void>`  
  - Calls `PUT /api/admin/users/${userId}/account-type` with JSON body. No polling.
  - On error, the backend returns `{ error: { code, message } }`; frontend should show `error?.response?.data?.error?.message || error?.message` in a toast (same pattern as `handleGroupChange` in UsersTable).

### 4.2 Users Table: Account Type Column

- **Where:** `src/features/adminUsers/components/UsersTable.tsx`.
- **Column placement:** Insert the new **Account Type** column **after** the **Group** column and **before** the **Leverage** column (so it sits next to Group and keeps the table readable).
- **Pattern:** Same as Group column: a `Select` per row with two options: **Hedging**, **Netting**. Value is `user.accountType` (always set from API; default `'hedging'` from backend).
- **State:** Local loading state (e.g. `updatingAccountTypes: Set<string>`) so we can show "Updating..." and disable the control while the request is in flight.
- **Handler:** `handleAccountTypeChange(userId, userName, newValue: 'hedging' | 'netting')`:
  1. Set loading for this user (`updatingAccountTypes`).
  2. Call `updateUserAccountType(userId, { account_type: newValue })`.
  3. On success: `onUserUpdate(userId, { accountType: newValue })` so the row updates immediately (real time, no polling); toast success.
  4. On error: show toast with `error?.response?.data?.error?.message || error?.message` (same as group).
  5. Clear loading in `finally`.
- **Disable rule:** If `(user.openPositionsCount ?? 0) > 0`, **disable** the Account Type dropdown for that row. When disabled, show a tooltip (e.g. via `Tooltip` from shared UI if available) with text: "Cannot change account type: user has open positions."
- **Display:** Select value = `user.accountType`; options only "Hedging" and "Netting" (display labels); underlying values `hedging` and `netting`. Placeholder when updating: "Updating...".

### 4.3 Real-Time Behaviour (No Polling)

- When admin changes the dropdown and the API returns success, only `onUserUpdate(userId, { accountType })` is called. The table state updates from existing React state (same as group). No refetch, no interval, no WebSocket required for this feature.
- If the admin opens the page later, the list request will return the latest `account_type` and `open_positions_count` from the server.

---

## 5. Order Engine / Position Logic (Out of Scope for This Plan)

- This plan only adds **storage** of account type and **admin UI** to view/change it. **No execution code is modified**, so existing CFD hedging behaviour is preserved and no other functionality is disturbed.
- **Execution behaviour** (using netting vs hedging in order fills and position creation) is **not** part of this task. The order engine and position logic (e.g. `atomic_fill_order.lua`, `execution.rs`) are **unchanged** and continue to behave as today (hedging only).
- **Phase 2 (future, optional):** To make netting mode affect execution, a separate change would (1) read `users.account_type` (from DB or cache) when processing a fill, and (2) when `account_type = 'netting'`, implement reduce/close logic for the opposite position instead of creating a new position. That work is outside this plan so that this implementation stays minimal and safe.

---

## 6. File Checklist

| Layer        | File(s) | Change |
|-------------|---------|--------|
| DB          | `database/migrations/0019_account_type.sql` | Add `account_type` column (VARCHAR(20) NOT NULL DEFAULT 'hedging') and CHECK constraint. |
| Backend     | `backend/auth-service/src/models/user.rs` | Add `account_type: String` to `User` struct. |
| Backend     | `backend/auth-service/src/routes/auth.rs` | Extend `UserResponse` with `account_type`, `open_positions_count`; in list_users, run batch query for open position counts and fill these fields. |
| Backend     | `backend/auth-service/src/routes/admin_users.rs` | New handler `update_user_account_type`; register `PUT /:id/account-type`. |
| Frontend    | `src/shared/api/users.api.ts` | Extend `UserResponse` with `account_type`, `open_positions_count`. |
| Frontend    | `src/features/adminUsers/api/users.api.ts` | Add `updateUserAccountType(userId, { account_type })`. |
| Frontend    | `src/features/adminUsers/types/users.ts` | Add `accountType`, `openPositionsCount`. |
| Frontend    | `src/features/adminUsers/pages/AdminUsersPage.tsx` | In `mapUserResponse`, set `accountType` and `openPositionsCount` from API. |
| Frontend    | `src/features/adminUsers/components/UsersTable.tsx` | Add Account Type column (after Group); Select (Hedging/Netting); disable when `openPositionsCount > 0` with tooltip; `updateUserAccountType` + `onUserUpdate`; loading state. |

---

## 7. Validation & Edge Cases

- **Backend list_users:** The auth service uses `SELECT * FROM users` in `auth_service.list_users`. After the migration, the `User` struct must include `account_type` so that the query result maps correctly. If the project ever switches to an explicit column list, include `account_type` in that list.
- **Position count SQL:** The `positions` table uses enum `position_status` ('open', 'closed', 'liquidated'). All position count queries must use `status = 'open'::position_status` for correct filtering (as in `deposits.rs`).
- **Frontend backward compatibility:** If the list response does not yet include `open_positions_count` or `account_type` (e.g. before backend deploy), treat missing as `0` and `'hedging'` so the UI does not break; the update endpoint will still enforce the open-positions rule.
- **Double guard:** Both frontend (disable dropdown when `openPositionsCount > 0`) and backend (reject PUT when user has open positions) enforce the rule, so the feature works even if the list is stale (e.g. user opened a position after page load).
- **No polling:** No refetch, no interval, no WebSocket. The table updates only via `onUserUpdate` after a successful PUT.

---

## 8. What We Do Not Change (No Impact on Other Functionality)

To ensure **no other functionalities are disturbed**, this plan **does not modify** any of the following:

| Area | What stays unchanged |
|------|----------------------|
| **Order engine** | `apps/order-engine/` (Lua scripts, `execution.rs`). No changes to fill logic, position update, or order lifecycle. Hedging behaviour unchanged. |
| **Position creation / update** | Logic that creates or updates positions (same symbol + same side → add; opposite side → new position) is unchanged. No netting execution in this phase. |
| **Positions table** | No schema change to `positions`. No new columns, no new constraints. |
| **Orders table & flow** | No change to orders schema or order placement/cancel flow. |
| **Balance, margin, PnL** | No change to wallet, balance, margin calculation, or account summary logic. |
| **User trading panel** | `RightTradingPanel`, order form, and place-order API are unchanged. Users trade as today. |
| **Other admin pages** | Groups, Risk, Trading, Symbols, Swap, Bonus, Affiliate, etc. – no changes. |
| **Auth / login / sessions** | No change to authentication or session handling. |
| **WebSocket / real-time** | No new subscriptions or events for account type. No polling. |
| **Gateways & data-provider** | No change to gateway-ws, core-api, or data-provider. |

**Only** the files listed in §6 are touched. Everything else continues to work as before.

---

## 9. Summary

- **CFD / Hedging / Netting:** See §1. This plan adds storage and admin UI only. Hedging execution is unchanged and works 100%. Netting is stored and shown; netting execution (order engine reading `account_type` and reducing opposite position) is a separate Phase 2.
- **Dropdown:** Same pattern as Group (per-row Select, apply on change).
- **Backend:** New `account_type` on `users`; list users returns `account_type` and `open_positions_count`; new `PUT .../account-type` that rejects when user has open positions.
- **Real time:** Success path updates local state only; no polling.
- **Restriction:** Dropdown disabled when user has open positions (with tooltip); server also rejects the update.
- **No other functionality disturbed:** Only the files in §6 are modified; §8 lists everything that is explicitly not changed (order engine, positions, orders, balance, trading panel, other admin, etc.).

**Implementation order (recommended):**

1. Run migration `0019_account_type.sql`.
2. Backend: add `account_type` to `User` model; extend list_users (batch position count + UserResponse); add PUT account-type handler in admin_users.
3. Frontend: extend `UserResponse` and `User` type; add `updateUserAccountType` API; in `mapUserResponse` set `accountType` and `openPositionsCount`; add Account Type column and handler in UsersTable.

This order ensures the API contract is in place before the UI depends on it. After implementation, hedging continues to work 100%, netting is available as a stored preference and in the UI, and no other functionality is disturbed.
