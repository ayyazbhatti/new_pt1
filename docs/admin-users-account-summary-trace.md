# Admin Users: Account Summary Data Not Showing — Root Cause

## Symptom
On http://localhost:5173/admin/users, the columns **Equity**, **Margin**, **Free Margin**, **Margin Level**, **RI PNL**, and **UnR PNL** show "—" for all rows (or no data). Redis has 104 account summary keys (`pos:summary:*`), so data exists.

---

## Root Cause: **Route order in auth-service**

The batch endpoint **POST /api/admin/users/account-summaries** is **never reached**. The client gets **404**, so the frontend receives no summaries and displays "—" everywhere.

### Why the endpoint returns 404

In **`backend/auth-service/src/main.rs`** the app is built with:

```rust
.nest("/api/admin/users", create_admin_users_router(...))           // 1st
.nest("/api/admin/users/account-summaries", create_admin_users_account_summaries_router(...))  // 2nd
```

In Axum, **nests are matched in the order they are registered**. The first nest whose prefix matches the request path wins.

1. Request: **POST /api/admin/users/account-summaries**
2. Axum tries the first nest: path starts with `/api/admin/users` → **match**.
3. The request is sent to **`create_admin_users_router`**. The path seen by this router is the remainder after the prefix, i.e. **`/account-summaries`**.
4. That router only has routes like **`/:id/group`**, **`/:id/impersonate`**, etc. There is **no** route for **POST /account-summaries** (and no route that is just `/:id`).
5. Result: **404** from the admin users router. The second nest (**/api/admin/users/account-summaries**) is **never tried**.

So the batch account-summaries handler is never executed; the client always gets 404.

### Frontend behavior

- **`getAccountSummaries(userIds)`** calls **POST /api/admin/users/account-summaries**.
- On 404, **`http()`** throws (see `src/shared/api/http.ts`: non-2xx → throw).
- **React Query** marks the query as failed; **data** is undefined, so the hook returns **`summaries = {}`** (default).
- **UsersTable** receives **`accountSummaries = {}`**; **`getSummary(accountSummaries, row.original.id)`** is always **undefined**, so formatters show **"—"**.

So the missing data is a direct consequence of the 404 caused by route order.

---

## Fix

Register the **more specific** nest **before** the general one so **POST /api/admin/users/account-summaries** is handled by the account-summaries router:

**In `backend/auth-service/src/main.rs`**, swap the two lines:

- **Before:**  
  `.nest("/api/admin/users", ...)`  
  then  
  `.nest("/api/admin/users/account-summaries", ...)`

- **After:**  
  `.nest("/api/admin/users/account-summaries", ...)`  
  then  
  `.nest("/api/admin/users", ...)`

After this change, restart the auth-service. The batch endpoint will respond with `{ summaries: { [userId]: {...} } }`, and the admin users table will show Equity, Margin, Free Margin, Margin Level, RI PNL, and UnR PNL from Redis (and computed on miss) as intended.

---

## Quick verification

After applying the fix:

1. Restart auth-service.
2. In browser DevTools → Network, reload the admin users page.
3. Find **POST /api/admin/users/account-summaries** → should be **200** with body `{ "summaries": { "<uuid>": { ... } } }`.
4. Table columns should show values instead of "—".
