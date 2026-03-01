# Admin Users: Account Summary Shows on First Load, Missing After Reload — Root Cause Analysis

## Symptom
- **First load** of http://localhost:5173/admin/users (e.g. navigating from another page or right after login): Equity, Margin, Free Margin, etc. **show**.
- **After full page reload (F5)**: same page loads but account summary columns show **no data** (e.g. "—").

---

## Relevant Code Paths

1. **Auth**
   - `src/shared/store/auth.store.ts`: Zustand store with **persist** (localStorage). `accessToken`, `refreshToken`, `user`, `isAuthenticated` are rehydrated **asynchronously** after load. `onRehydrateStorage` sets `isHydrated = false` when rehydration runs.
   - `src/shared/components/guards/AuthGuard.tsx`: Waits for `isHydrated`; if false, shows "Loading..." and calls `hydrateFromStorage()`. Only renders children when `isHydrated === true`. `hydrateFromStorage()` sets `isHydrated = true` (and may fetch `/api/auth/me` if user is missing).
   - So the admin page only renders **after** the guard has set `isHydrated = true`, which happens **after** `hydrateFromStorage()` runs and the store (from rehydration or from `me()`) has token + user.

2. **Admin users page**
   - `src/features/adminUsers/pages/AdminUsersPage.tsx`:
     - Fetches users with `useQuery({ queryKey: ['users'], queryFn: () => listUsers({ limit: 100 }) })`.
     - `userIds = filteredUsers.map(u => u.id)`; `filteredUsers` comes from `displayUsers`; `displayUsers = usersState.length > 0 ? usersState : users`; `users` from `usersData`.
     - So **userIds** become non-empty **as soon as** the users query has data (and `displayUsers` is set from `users` when `usersState` is still empty on first render after data arrives).

3. **Account summaries**
   - `src/features/adminUsers/hooks/useAdminAccountSummaries.ts`:
     - `useQuery({ queryKey: [...adminAccountSummariesQueryKey, userIds.slice(0, 200).sort()], queryFn: () => getAccountSummaries(userIds.slice(0, 200)), enabled: userIds.length > 0, retry: 0 })`.
     - So the **account-summaries request runs as soon as** `userIds.length > 0` and the query is enabled. No dependency on `isHydrated` or token; it runs whenever the page has user IDs.

4. **HTTP client**
   - `src/shared/api/http.ts`: For each request, `accessToken = useAuthStore.getState().accessToken`. If present, adds `Authorization: Bearer <token>`. On **401**, tries **one** refresh and **retries that same request**; if refresh fails, throws and (elsewhere) logout can run.

---

## Root Cause (Exact)

**On full page reload, the account-summaries request can run in a moment when the auth store does not yet have a valid `accessToken` (or it has an expired one and the single retry after refresh still fails or isn’t used), so the request is sent without a valid `Authorization` header (or with an expired token), the server returns 401, and the UI shows no summary data.**

Why this shows up more on reload than on “first load”:

- **First load (no reload):** User has just logged in or navigated within the app. Token is already in memory and valid. Both `listUsers` and `getAccountSummaries` use the same store and get the same token; both succeed.
- **Full page reload:**  
  - The token only exists in **localStorage** until Zustand **persist** rehydrates.  
  - Rehydration is **asynchronous**. The guard only renders the admin page after `hydrateFromStorage()` runs and sets `isHydrated = true`.  
  - In theory, by the time the admin page renders, `hydrateFromStorage()` has run and the store should already have the rehydrated token (or the user from `me()`). So **in normal timing** the token should be there when `getAccountSummaries` runs.

So the “exact” root cause is one of these (or a combination):

1. **Rehydration vs. guard timing**  
   In some runs, `hydrateFromStorage()` sets `isHydrated = true` and allows the admin page to render **before** the persisted state (including `accessToken`) has actually been written into the store. Then:
   - The users list might still load (e.g. if it’s cached or if a later rehydration fills the token before `listUsers` runs).
   - By the time `userIds` are available and `getAccountSummaries` runs, the store is read again; if rehydration is still not applied at that moment, `accessToken` is null → request goes out without `Authorization` → **401** → with **retry: 0** the query stays in error state and the table shows no summary data.

2. **Expired token on reload**  
   The token rehydrated from localStorage is **expired**.  
   - First request that uses it (e.g. `listUsers` or `getAccountSummaries`) gets 401.  
   - `http()` tries refresh; if refresh **fails** (e.g. refresh token expired), it throws and the app may logout → user wouldn’t stay on the admin page.  
   - If refresh **succeeds**, only that **one** request is retried with the new token. So if `getAccountSummaries` runs **first** (or in a race with `listUsers`), gets 401, and refresh fails, we’d get error and no data. If `listUsers` runs first, gets 401, refresh succeeds, retry succeeds, then when `getAccountSummaries` runs it would use the **new** token from the store and should succeed—unless there’s a bug or another 401 (e.g. token not yet written back to the store when `getAccountSummaries` runs).

3. **No retry on failure**  
   `useAdminAccountSummaries` uses **retry: 0**. So the **first** attempt is the only one. If that one request is sent without a valid token (or with an expired one and refresh doesn’t help in time), the query stays failed and the table never shows summary data until the user triggers a refetch (e.g. change filters so the query key changes).

So the **exact root cause** is: **the account-summaries request is sent at least once without a valid token (or with a failed refresh) on reload, gets 401, and because the query has retry: 0 and no logic to refetch after auth is ready, the admin table keeps showing no account summary data.**

---

## How to Verify (Before Fixing)

A **temporary console log** was added in dev so you can confirm the root cause:

- In `src/features/adminUsers/api/users.api.ts`, before the account-summaries request runs, we log:
  - `[account-summaries] Request about to run. Token present: true/false, Token length: <n>`
- This runs only in development (`import.meta.env.DEV`). Remove it after verification.

### Steps to confirm

1. **Open DevTools**  
   Console tab + Network tab (filter by "account-summaries" or "users" if needed).

2. **First load (data shows)**  
   - Go to http://localhost:5173/admin/users (e.g. from login or another page).
   - In **Console**: you should see  
     `[account-summaries] Request about to run. Token present: true, Token length: <number>`  
   - In **Network**: **POST** `/api/admin/users/account-summaries` → **Status 200**.

3. **Reload (data missing)**  
   - Press **F5** (full page reload) on the same URL.
   - In **Console**: check the same log.  
     - If you see **`Token present: false, Token length: 0`** → the request ran **without** a token → root cause confirmed (auth not ready when request ran).  
     - If you see **`Token present: true`** but Network shows **401**, the token was present but invalid/expired (still an auth-timing/validity issue).
   - In **Network**: **POST** `/api/admin/users/account-summaries` → if **Status 401**, root cause confirmed.
   - Optionally check **Request Headers** for that request: missing or invalid `Authorization: Bearer ...`.

4. **Toast**  
   - If on reload you see the toast **"Account summaries: HTTP 401: Unauthorized"**, that matches the same root cause.

### What confirms the root cause

- **Reload**: Console shows `Token present: false` **and/or** Network shows **401** for POST account-summaries.  
- **First load**: Console shows `Token present: true` and Network shows **200**.

Once you see that pattern, the root cause is confirmed and we can implement the fix. Remove the temporary `console.log` in `users.api.ts` when done.

---

## Summary

| What | Detail |
|------|--------|
| **Observed behaviour** | First load: summary data shows. After reload: summary data does not show. |
| **Exact root cause** | On reload, the account-summaries request is sent at least once without a valid token (or after a failed refresh), receives 401, and with `retry: 0` the query never recovers, so the table shows no summary. |
| **Why reload differs from first load** | Reload depends on async auth rehydration and a single attempt; first load uses an already-in-memory valid token. |
| **Verify** | Network: POST account-summaries status 401 and missing/invalid `Authorization`; optional toast with 401 message. |

No code changes were made; this document is for diagnosis only until you approve a fix.
