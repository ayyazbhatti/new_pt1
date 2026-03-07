# Permission Changes Not Applied Until Re-Login — Solution

**Status:** Proposal (awaiting approval)  
**Date:** 2026-03-07  
**Affected:** Admin/manager users whose permission profile is changed by another admin while they remain logged in.

---

## Executive Summary

When an admin removes or changes permissions for a user's assigned permission profile (e.g. profile "V2"), that user continues to see and access admin pages as if they still had the old permissions until they log out and log back in. The backend correctly stores and serves updated permissions via `GET /api/auth/me`; the frontend, however, only loads permissions at login and never refetches the current user, so the in-memory (and persisted) permission list stays stale.

This document proposes a **user-data refresh strategy** so that permission changes take effect without requiring re-login: refetch the current user (including permissions) at key moments and align token refresh with user refresh.

**No polling.** This solution does **not** use polling (no `setInterval`, no `refetchInterval`, no "fetch every N seconds"). Refresh happens only **on events**: after token refresh (A), on window focus with throttle (B), and optionally on admin entry when stale (C). Compliant with project rules.

---

## 1. Problem Statement

### 1.1 Observed behaviour

- User **A** (e.g. `accessrighttest@gmail.com`) is logged in with permission profile **"V2"** and has full access to admin pages.
- Admin **B** edits profile **"V2"** and removes all permissions (or reduces them).
- User **A**, still logged in in the same browser tab, continues to see the full admin sidebar and can open all pages.
- After user **A** logs out and logs back in, access is correctly restricted (or expanded) according to the updated profile.

### 1.2 Expected behaviour

Permission changes applied to a user's assigned profile should be reflected in that user's access **without requiring re-login**. The same session should eventually see updated permissions (e.g. after a short delay, on next navigation, or on window focus).

---

## 2. Root Cause (Verified)

### 2.1 Backend

- `GET /api/auth/me` loads the user from the database and computes **effective permissions** via `get_effective_permissions(role, permission_profile_id)`.
- Effective permissions are read from `permission_profile_grants` for the user's current `permission_profile_id`.
- **Conclusion:** The API returns **current** permissions every time it is called. No backend change is required for correctness.

### 2.2 Frontend

- **Source of truth for UI:** The auth store (Zustand) holds `user`, including `user.permissions`, `user.permissionProfileId`, and `user.permissionProfileName`. This state is **persisted to localStorage**.
- **When is `user` (and thus `user.permissions`) set?**
  - On **login** and **register** (from the API response).
  - In **`hydrateFromStorage()`** only when `accessToken && refreshToken && !state.user` (e.g. new tab after impersonation). If the user was rehydrated from localStorage, `state.user` is already set, so **`GET /api/auth/me` is not called** on page load.
  - When **`refreshUser()`** is explicitly called (it calls `GET /api/auth/me` and updates the store).
- **When is `refreshUser()` called?**
  - Only from the auth store's **`refreshAccessToken()`** (after a successful token refresh).
  - The global HTTP client (`http.ts`) does **not** use the store's `refreshAccessToken()`. On 401 it uses its own `refreshAccessToken()`, which only updates the access token via `setTokens()` and **does not** call `refreshUser()`.
- **Conclusion:** After login, the frontend **never** refetches the current user (and thus permissions) in normal use. Token refresh does not trigger a user refresh. Therefore, when an admin changes a user's profile, the affected user's session keeps using the **stale** `user.permissions` until they log out and log back in.

### 2.3 Summary table

| Layer        | Behaviour                                                                 | Result                                      |
|-------------|-----------------------------------------------------------------------------|---------------------------------------------|
| Backend     | `/api/auth/me` returns fresh permissions from DB.                          | Correct.                                    |
| Frontend    | Permissions come only from auth store (and localStorage).                  | Stale after profile change.                 |
| Frontend    | Store is updated only at login/register or when `refreshUser()` runs.      | No refresh in normal use.                   |
| Frontend    | `refreshUser()` is only invoked from store's `refreshAccessToken()`.       | Token refresh does not refresh user.        |

**Root cause:** The frontend does not refetch the current user (and therefore permissions) when the profile may have changed, and token refresh does not trigger a user refresh.

### 2.4 Companion issue: empty permissions fallback

In `getCurrentUserPermissions` (e.g. `src/shared/utils/permissions.ts`), when `user.permissions` is an **empty array** (profile has no permissions), the code currently falls back to `getPermissionsForRole(user.role)`, which for role `admin` returns a non-empty list (e.g. lead permissions). So even after a successful refresh that returns `permissions: []`, the user would still see some admin access. For "remove all permissions" to take effect **fully**, the solution must treat an explicit **empty array** from the API as "no permissions" (return `[]`), and only use the role fallback when `permissions` is undefined (e.g. legacy or no profile). This is included as **Fix 0** below so the end-to-end behaviour is correct.

---

## 3. Solution Overview

### 3.1 Goals

1. **Permission changes take effect without re-login** for the affected user (within a reasonable delay or on a clear trigger).
2. **Minimal UX impact:** No polling; use existing or one-off requests (e.g. on focus, on admin navigation, or after token refresh).
3. **Consistency:** When the app uses permissions (nav, route guards, feature flags), it should eventually see up-to-date data from the server.

### 3.2 Options Considered

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **A. Refetch user on token refresh** | When the HTTP layer refreshes the access token (401), also call the store's `refreshUser()` so the user (and permissions) are updated. | Small change; reuses existing refresh path; no new endpoints. | Permissions only refresh when the token expires and is refreshed (e.g. after 15–60 min depending on config). |
| **B. Refetch user on window focus** | When the tab/window gains focus, call `refreshUser()` (e.g. once per focus, with a short throttle). | User sees updates soon after switching back to the tab. | Extra `/api/auth/me` calls when switching tabs; need throttle to avoid abuse. |
| **C. Refetch user on admin route entry** | When the user navigates into the admin area (e.g. `/admin/*`), call `refreshUser()` once (or when last fetch is older than X minutes). | Updates when they use the admin panel. | Does not help if they never leave the admin tab. |
| **D. Real-time push** | Backend notifies the client when their profile is updated (e.g. WebSocket or SSE). | Near-instant updates. | Requires new backend channel and subscription; more complexity. |

### 3.3 Recommended Approach: **A + B (with optional C)**

- **A (required):** On successful token refresh, call the store's `refreshUser()` so that whenever the token is refreshed (e.g. on 401), the user and permissions are updated. This fixes the fact that today token refresh does not refresh user at all.
- **B (recommended):** On window focus (document `visibilitychange` or `focus`), call `refreshUser()` with a throttle (e.g. at most once per 60–120 seconds). So when an admin has changed the user's profile, the user sees updated permissions shortly after they return to the tab.
- **C (optional):** On first navigation into an admin route in the session (or when last user fetch is older than e.g. 5 minutes), call `refreshUser()`. This adds another refresh trigger without polling.

We do **not** recommend polling (e.g. refetch every N seconds) to comply with project rules and to avoid unnecessary load. Option D can be a future enhancement if instant updates are required.

---

## 4. Detailed Implementation

### 4.0 Fix 0: Treat empty permissions from API as no permissions (required)

**Goal:** When the API returns `permissions: []` (user's profile has no permissions), the UI must grant no admin permissions. Today, `getCurrentUserPermissions` falls back to `getPermissionsForRole(role)` when `user.permissions.length === 0`, so an admin with an empty profile still gets e.g. lead permissions.

**Change:** In `getCurrentUserPermissions`, if `user.permissions` is defined and is an array (including empty), use it as-is. Only call `getPermissionsForRole(user.role)` when `user.permissions` is undefined or not an array (e.g. legacy response).

**Example logic (e.g. in `src/shared/utils/permissions.ts`):**

- If `!user` → return `[]`.
- If `Array.isArray(user.permissions)` → return `user.permissions` (so `[]` means no permissions).
- Otherwise → return `getPermissionsForRole(user.role)`.

**Performance:** In-memory only. One extra `Array.isArray(user.permissions)` check and early return. No network, no loops. Called on every permission check (nav, guards, buttons); the change is a single branch. No negative impact on speed; when `user.permissions` is an array we return immediately without calling `getPermissionsForRole`, so hot path is unchanged or slightly faster.

**Risk:** None. Aligns UI with API: empty profile ⇒ no permissions.

---

### 4.1 A. Refresh user when the access token is refreshed (required)

**Goal:** Ensure that whenever the frontend refreshes the access token (on 401), it also refreshes the current user so that `user.permissions` (and related fields) are updated.

**Current behaviour (e.g. `src/shared/api/http.ts`):**

- On 401 (with valid `accessToken` and not a login/register request), the client calls a local `refreshAccessToken()` that:
  - Calls `POST /api/auth/refresh` with the refresh token.
  - On success, calls `useAuthStore.getState().setTokens(data.access_token, refreshToken)`.
- The auth store's `refreshAccessToken()` (which calls `refreshUser()` after refreshing the token) is never used by the HTTP layer.

**Proposed change:**

- After a **successful** token refresh in the HTTP layer, call the auth store's **`refreshUser()`** so the store fetches the current user via `GET /api/auth/me` and updates `user` (including `user.permissions`).
- **Implementation:** In `http.ts`, after `setTokens(data.access_token, refreshToken)` (so the store has the new token), call `useAuthStore.getState().refreshUser()` inside a **try/catch**. If `refreshUser()` throws (e.g. network error or 401), **catch and log** the error and **do not rethrow**; then continue to retry the original request with the new token. This way:
  - Token refresh succeeded; the retry of the original request proceeds with the new token.
  - If user refresh failed, permissions stay stale until the next trigger (e.g. window focus); the user is not logged out.
- If `refreshUser()` is not called (e.g. we rethrow on failure), a transient network error during `me()` would cause the whole 401 handler to fail and logout the user, which is worse UX.

**Files to touch:**

- `src/shared/api/http.ts`: After `setTokens(data.access_token, refreshToken)` is called, call `refreshUser()` in a fire-and-forget way (do not await), e.g. `try { void useAuthStore.getState().refreshUser() } catch (e) { console.error('Failed to refresh user after token refresh', e) }` (or `.catch(log)` if it returns a Promise). The existing retry of the original request then runs immediately, with no added latency.

**Performance:** One extra `GET /api/auth/me` only when a 401 triggers token refresh (infrequent, e.g. every 15–60 min). Do **not** await `refreshUser()` before retrying the original request: call it in a fire-and-forget manner (e.g. `void refreshUser()` or `refreshUser().catch(...)`) so the retry runs immediately and is not delayed. User data updates in the background.

**Risk:** Low. One extra `GET /api/auth/me` after each token refresh; failure is non-fatal and logged.

---

### 4.2 B. Refresh user on window focus (recommended)

**Goal:** When the user returns to the tab (e.g. after an admin has changed their profile in another tab or on another device), refetch the current user so permissions (and other profile data) update without waiting for token expiry.

**Proposed change:**

- Subscribe to document **`visibilitychange`** (or window **`focus`**) in the app shell or a small auth hook.
- When the document becomes visible (or the window gains focus), call **`refreshUser()`** with a **throttle** (e.g. at most once every 60 or 120 seconds) to avoid excessive calls when the user rapidly switches tabs.
- Only run when the user is authenticated (e.g. `accessToken` and `user` exist). Do not run on initial load (that is handled by hydration); only when transitioning from hidden to visible (or on focus).

**Implementation details:**

- Add a small module or hook, e.g. `useRefreshUserOnFocus.ts`, that:
  - Uses `useEffect` to add a `visibilitychange` listener (or `focus` on `window`).
  - On event: if authenticated and throttle allows, call `useAuthStore.getState().refreshUser()`.
  - Throttle: store last refresh timestamp (e.g. in a ref or in the store) and skip if `Date.now() - lastRefresh < THROTTLE_MS` (e.g. 60_000 ms).
- Mount this hook in the root layout or `App` so it runs for all authenticated sessions (admin and user).

**Files to touch:**

- New file: e.g. `src/shared/hooks/useRefreshUserOnFocus.ts` (or `src/app/hooks/useRefreshUserOnFocus.ts`).
- Root layout or `App.tsx`: use the hook when the user is authenticated.

**Performance:** One `visibilitychange` listener (cheap). At most one `GET /api/auth/me` when the tab becomes visible, and only if the throttle window (e.g. 60 s) has passed. No polling, no intervals. No impact on in-tab navigation or render speed; only runs when the user switches back to the tab.

**Risk:** Low. One extra `GET /api/auth/me` when the user switches back to the tab, throttled. No change to login or token logic.

---

### 4.3 C. Refresh user on admin route entry (optional)

**Goal:** When the user navigates into the admin area, ensure we have a recent copy of the user (and permissions), e.g. if the last fetch is older than 5 minutes.

**Proposed change:**

- In the admin layout or admin route guard, on mount or when the path becomes an admin path, check the time of the last `refreshUser()` (or last `user` update). If older than a threshold (e.g. 5 minutes), call `refreshUser()` once.
- This can be combined with B by having a single “last user fetch” timestamp and a max age; B runs on focus, and C runs when entering admin with stale data.

**Performance:** At most one `GET /api/auth/me` when navigating into admin and last fetch is older than threshold (e.g. 5 min). No impact when data is fresh or when user is not in admin.

**Risk:** Low. Adds at most one request per “admin entry” when data is stale. Can be skipped if the team prefers to rely on A and B only.

---

## 5. Performance and optimization (no negative impact)

| Fix | Impact on speed / optimization |
|-----|--------------------------------|
| **0** | In-memory only: one `Array.isArray()` branch in `getCurrentUserPermissions`. No network, no extra work on hot path. No slowdown. |
| **A** | One extra `GET /api/auth/me` only when token refresh runs (infrequent). **Do not await** `refreshUser()` before retrying the original request so retry latency is unchanged. |
| **B** | One event listener; one request only when tab becomes visible and throttle allows (e.g. once per 60 s). No polling, no intervals. No impact on in-tab navigation or initial load. |
| **C** | One request only when entering admin with stale data. Bounded; no impact otherwise. |

**Guarantees:**

- **No polling:** No `setInterval`, no `refetchInterval`, no periodic refetch. Compliant with project rules.
- **No blocking:** User refresh never blocks the 401 retry (A) or navigation (B/C).
- **No hot-path cost:** Permission checks remain in-memory (Fix 0 is a single branch). Initial page load and render are unchanged.
- **Bounded extra requests:** Only on token refresh (A), visibility change + throttle (B), and optionally admin entry when stale (C).

---

## 6. Scope and Out of Scope

### 6.1 In scope

- Frontend: refresh user (and thus permissions) on token refresh and on window focus (with throttle). Optional: refresh when entering admin with stale data.
- No backend API changes; `GET /api/auth/me` already returns current permissions.
- No change to how permissions are stored or checked (auth store and `permissions.ts`); only when they are refreshed.

### 6.2 Out of scope

- **Real-time push** (e.g. WebSocket/SSE) when an admin changes a user's profile: can be considered later if instant updates are required.
- **Backend validation of permissions on every request:** Backend may already enforce permissions on sensitive routes; that is independent of this frontend refresh strategy.
- **Polling:** Not recommended; project rules and good practice favour event-driven or on-demand refresh.

---

## 7. Testing and Validation

1. **Manual test (permission removal):**
   - User A logged in with profile "V2" (full permissions). Confirm full access.
   - Admin B removes all permissions from "V2".
   - Without re-login: switch to another tab and back (or wait for token refresh if testing A only). Confirm user A's sidebar and route access reflect the new (empty) permissions.
2. **Manual test (permission grant):**
   - User A with profile "V2" (no permissions). Admin B adds e.g. `dashboard:view` to "V2".
   - User A switches tab and back (or triggers refresh). Confirm they see Dashboard and no other admin pages.
3. **Token refresh:** With a short-lived access token, trigger a 401 so the client refreshes the token; confirm that after refresh, `user.permissions` is updated (e.g. by checking store or by observing UI).
4. **Throttle (B):** Switch tabs repeatedly; confirm `/api/auth/me` is not called more than once per throttle window.

---

## 8. Summary

| Item | Description |
|------|-------------|
| **Problem** | Permission profile changes do not apply until the affected user re-logs in. |
| **Root cause** | Frontend only loads permissions at login and never refetches the current user; token refresh does not trigger user refresh. |
| **Companion** | Empty `user.permissions` from API must be treated as no permissions (Fix 0); otherwise role fallback still grants access. |
| **Solution** | **(0)** Treat empty permissions array as no permissions. **(A)** Refresh user after token refresh (non-fatal). **(B)** Refresh user on window focus with throttle. **(C, optional)** Refresh when entering admin with stale data. |
| **Backend** | No change; `/api/auth/me` already returns current permissions. |
| **Risks** | Low; additive frontend behaviour and a few extra `GET /api/auth/me` calls under defined conditions. |
| **Performance** | No negative impact: no polling, no blocking; extra requests only on token refresh, visibility+throttle, and optionally stale admin entry. See §5. |

## 9. Implementation order and validation

To ensure **100% correctness** for the “remove all permissions” scenario:

1. **Fix 0** must be implemented so that after refresh returns `permissions: []`, the UI uses `[]` and does not fall back to role-based permissions.
2. **Fix A** ensures that whenever the token is refreshed (e.g. on 401), the user and permissions are updated; failure of `refreshUser()` is caught so the retry of the original request still succeeds.
3. **Fix B** ensures that when the user returns to the tab (e.g. after an admin changed their profile), one throttled call to `refreshUser()` updates permissions without waiting for token expiry.

**Validation (after implementation):**

- **Stale permissions:** User A with profile “V2” (full permissions). Admin removes all permissions from “V2”. User A switches to another tab and back (or triggers token refresh). User A must see no admin nav items and get redirected or blocked from admin routes (Fix 0 + B or A).
- **Empty profile:** Same setup; after refresh, `user.permissions` is `[]`; `getCurrentUserPermissions` must return `[]` (Fix 0).
- **No regression:** User with valid permissions continues to see correct access; token refresh does not log them out on transient `me()` failure (A with try/catch).

Once approved, implementation can proceed in the order **0 → A → B → C** (if C is desired).
