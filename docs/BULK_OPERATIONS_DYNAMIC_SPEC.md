# Bulk Operations Page – Dynamic & High-Performance Specification

This document describes how to make the **Bulk Operations** page fully dynamic and to run **bulk user creation** at very high speed (target: thousands of users per minute) without skipping any requirement. It covers backend API design, batching, optional job queue, frontend progress and cancellation, configuration-driven behavior, validation, security, and implementation phases.

**Status:** Validated against the current codebase (auth-service `AuthService::register`, `User` model, `ledger_service`). Follow the implementation phases in order for a solution that will work in production.

**Platform performance:** Bulk operations are designed so they **do not affect** normal platform speed or optimization. See **§14 Platform performance isolation** for guarantees and implementation rules.

---

## 1. Goals

| Goal | Description |
|------|-------------|
| **Fully dynamic** | Form fields, validation rules, limits, and behavior are driven by backend config (or env) so new bulk operations or rule changes don’t require frontend deploys. |
| **Super fast** | Bulk user creation must scale to 10k–100k users with minimal wall-clock time: batching, parallelism, optional background jobs, and DB optimizations. |
| **Professional** | Progress reporting, partial success handling, cancel, download results, rate limiting, audit, and clear errors. |

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Frontend (Bulk Operations page)                                         │
│  • Fetches config (max_users, batch_size, fields, validation)             │
│  • Submits job or batch request                                           │
│  • Polls job status OR receives SSE/WS progress                          │
│  • Renders progress (current/total, success/failed), allows cancel        │
│  • Shows results list + Download CSV                                      │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Auth-service (or dedicated bulk-api)                                    │
│  • GET  /api/admin/bulk/config         → dynamic config                  │
│  • POST /api/admin/bulk/users          → start bulk create (sync or job)  │
│  • GET  /api/admin/bulk/jobs/:id       → job status + results            │
│  • POST /api/admin/bulk/jobs/:id/cancel → cancel job                     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
          ┌─────────────────────────┼─────────────────────────┐
          ▼                         ▼                         ▼
   ┌──────────────┐         ┌──────────────┐         ┌──────────────┐
   │  PostgreSQL  │         │  Redis       │         │  Job queue    │
   │  (users,     │         │  (job state, │         │  (optional:   │
   │   user_groups)│         │   progress)  │         │   Bull/Redis) │
   └──────────────┘         └──────────────┘         └──────────────┘
```

- **Small runs (e.g. ≤ 2,000 users):** Synchronous batch API with chunked processing and streaming progress (SSE) or chunked JSON response.
- **Large runs (e.g. > 2,000 or > 10,000):** Asynchronous job: API returns `job_id` immediately; frontend polls or subscribes to SSE/WebSocket for progress and final results.

---

## 3. Making the Page “Fully Dynamic”

### 3.1 Backend: Config endpoint

**GET /api/admin/bulk/config**

Returns a single JSON object that drives the UI and validation. Frontend must not hardcode limits or field lists for bulk user creation.

**Response shape (example):**

```json
{
  "bulk_user_creation": {
    "enabled": true,
    "max_users_per_run": 100000,
    "max_users_per_run_per_admin_per_day": 50000,
    "batch_size": 250,
    "async_threshold": 2000,
    "fields": {
      "count": { "required": true, "min": 1, "max": 100000 },
      "username_prefix": { "required": true, "max_length": 50 },
      "email_domain": { "required": true, "max_length": 253 },
      "password": { "required": true, "min_length": 8, "require_digit": true },
      "first_name_prefix": { "required": false, "max_length": 100 },
      "last_name": { "required": false, "max_length": 100 },
      "starting_number": { "required": false, "min": 1, "max": 999999999 },
      "group_id": { "required": false },
      "account_mode": { "required": false, "enum": ["netting", "hedging"] },
      "initial_balance": {
        "enabled": { "required": false },
        "amount": { "min": 0.01 },
        "fee": { "min": 0 },
        "reference": { "max_length": 255 }
      }
    },
    "defaults": {
      "first_name_prefix": "User",
      "last_name": "Test",
      "starting_number": 1,
      "account_mode": "hedging"
    }
  }
}
```

- **Frontend:** On load, call this endpoint; use `max_users_per_run`, `fields`, and `defaults` to render form, set placeholders, and run client-side validation. Never hardcode 100000 or field rules in the UI.
- **Backend:** Validate every request against this config (or the same values in code/env). Return 400 if e.g. `count` > `max_users_per_run`. Enforce password rule: length ≥ 8 and at least one digit (match existing `AuthService::register` validation).

### 3.2 Optional: Config per “operation type”

If you add more bulk operations (Bulk Deposit, Bulk Position Creation), extend the config:

```json
{
  "bulk_user_creation": { ... },
  "bulk_deposit": { "enabled": false, ... },
  "bulk_position_creation": { "enabled": false, ... }
}
```

Frontend shows only tabs/sections for which `enabled === true` and uses each operation’s `fields` and limits.

---

## 4. Bulk User Creation – Backend Design (Super Fast)

### 4.1 Reuse existing auth logic, no session

- Reuse the same validation and insert logic as `AuthService::register` (password hash, email uniqueness, group_id resolution, referral_code, etc.) but **do not create a session** or return tokens. Add an internal method, e.g. `create_user_without_session`, used only by the admin bulk endpoint.
- Single user creation path: one INSERT into `users`, optional INSERT into ledger/wallets if initial balance is requested. No welcome email in the hot path (or enqueue to a background worker).

### 4.2 Two modes of operation

| Mode | When | Behavior |
|------|------|----------|
| **Sync batch** | `count <= async_threshold` (e.g. 2,000) | Process in chunks (e.g. 250 per chunk), stream progress via **Server-Sent Events (SSE)** or return after all done with full results in body. Response time ~seconds to tens of seconds. |
| **Async job** | `count > async_threshold` | Return **202 Accepted** with `{ "job_id": "uuid" }`. Worker processes in background; frontend polls **GET /api/admin/bulk/jobs/:id** (or SSE) for progress and results. |

### 4.3 Chunked processing (sync or inside job)

- **Chunk size:** From config `batch_size` (e.g. 250). Process N users per chunk.
- **Per chunk:**
  - Build list of N users (username, email, first_name, last_name, password_hash, group_id, etc.) from the single shared config (prefixes, domain, password, starting_number).
  - **Single DB transaction per chunk (recommended):** One `INSERT INTO users (...) VALUES (...), (...), ...` with multiple rows, or a loop of single inserts inside one transaction. Single transaction per chunk keeps progress consistent and avoids long-held connections.
  - Resolve group_id once per run (not per user) if same for all.
  - Hash password once per run (same password for all) and reuse the same hash for every user in the run.
  - For initial balance: after users are created, batch-insert ledger/wallet rows in a separate pass (or same transaction per chunk if your schema allows).

### 4.4 Speed optimizations (do not skip)

| Optimization | Description |
|--------------|-------------|
| **Reuse password hash** | Hash the shared password once; use the same hash for all users in the run. |
| **Batch INSERT** | Prefer one multi-row `INSERT` per chunk (e.g. 250 rows) instead of 250 single-row inserts. |
| **Reuse group_id** | Resolve group_id and (if needed) group-level defaults once per run. |
| **No welcome email in hot path** | Skip or defer welcome email for bulk-created users; optionally enqueue to a job queue. |
| **Connection pool** | Use a single connection per request (or per chunk) from the pool; avoid opening a new connection per user. |
| **Async job for large N** | For 10k–100k users, run in a background job so the HTTP request returns immediately; use Redis or DB to store progress and results. |
| **Parallel workers (optional)** | If using a job queue, multiple workers can process different chunks (e.g. by range of `starting_number`) with coordination to avoid duplicate emails. |

### 4.5 Idempotency and duplicates

- **Email uniqueness:** Enforce unique email (and optionally username if you have one). On conflict (e.g. `ON CONFLICT (email) DO NOTHING` or catch unique violation), record that row as **failed** with reason “Email already exists” and continue.
- **Idempotency key (optional):** If the same request might be retried, accept `Idempotency-Key: <key>` and return the same job_id or same results for the same key within a TTL (e.g. 24h).

### 4.6 Progress and results storage (async mode)

- **Redis:** Store `bulk:job:{job_id}` with fields: `status` (pending/processing/completed/cancelled), `total`, `current`, `success_count`, `failed_count`, `created_at`, `updated_at`. Optionally store a truncated list of last N results (e.g. last 100) for quick display; full results in DB or object storage.
- **PostgreSQL:** Table `bulk_jobs` (id, admin_id, type, status, total, current, success_count, failed_count, config_snapshot, created_at, updated_at). Table `bulk_job_results` (job_id, index, username, email, success, user_id, account_id, error_message). Allows “Download full results” by querying `bulk_job_results` and streaming CSV.

---

## 5. API Contract (Detailed)

### 5.1 GET /api/admin/bulk/config

- **Auth:** Admin only (e.g. JWT with role admin and permission `users:create`).
- **Response:** 200 + JSON as in §3.1. Cache on frontend for 5–15 minutes.

### 5.2 POST /api/admin/bulk/users

- **Auth:** Admin only.
- **Request body (snake_case):**

```json
{
  "count": 1000,
  "username_prefix": "user",
  "email_domain": "example.com",
  "password": "SecurePass123!",
  "first_name_prefix": "User",
  "last_name": "Test",
  "starting_number": 1,
  "group_id": "uuid-or-null",
  "account_mode": "hedging",
  "initial_balance_enabled": false,
  "initial_balance_amount": 0,
  "initial_balance_fee": 0,
  "initial_balance_reference": ""
}
```

- **Validation:** Server-side validate against config (count in range, required fields present, password length, initial balance rules). Return 400 with clear messages if invalid.
- **Response (sync, count ≤ async_threshold):** 200 OK with body:

```json
{
  "job_id": null,
  "sync": true,
  "total": 1000,
  "success_count": 998,
  "failed_count": 2,
  "results": [
    { "username": "user001", "email": "user001@example.com", "success": true, "user_id": "uuid", "account_id": "uuid", "error": null },
    { "username": "user002", "email": "user002@example.com", "success": false, "user_id": null, "account_id": null, "error": "Email already exists" }
  ]
}
```

- Cap `results` at 500 or 1000 in response; provide “Download full results” via GET job or a dedicated export endpoint.
- **Response (async, count > async_threshold):** 202 Accepted:

```json
{
  "job_id": "uuid",
  "sync": false,
  "total": 50000
}
```

### 5.3 GET /api/admin/bulk/jobs/:id

- **Auth:** Admin only; optionally restrict to job created by same admin.
- **Response:** 200:

```json
{
  "id": "uuid",
  "type": "bulk_user_creation",
  "status": "processing",
  "total": 50000,
  "current": 12500,
  "success_count": 12480,
  "failed_count": 20,
  "created_at": "ISO8601",
  "updated_at": "ISO8601",
  "results": [ /* last 100 or first 100; or empty if too large */ ]
}
```

- When `status === "completed"` or `"cancelled"`, include final counts. Optionally allow `?export=csv` to stream full results as CSV.

### 5.4 POST /api/admin/bulk/jobs/:id/cancel

- **Auth:** Admin only.
- **Response:** 200 with updated job status (`cancelled`). Worker should check a “cancelled” flag between chunks and stop.

---

## 6. Frontend – Dynamic Behavior

### 6.1 Load config on mount

- On Bulk Operations page load (or when switching to “Bulk User Creation” tab), call `GET /api/admin/bulk/config`.
- Store in React state or React Query; use for:
  - **Max users:** Set `max` on the “Number of users” input and show helper text.
  - **Validation:** Client-side rules (required, min/max, min_length) from `fields`.
  - **Defaults:** Prefill form with `defaults` (first_name_prefix, last_name, starting_number, account_mode).
  - **Feature flag:** If `bulk_user_creation.enabled === false`, hide the tab or show “Not available”.

### 6.2 Submit and progress

- **Sync path:** On submit, POST to `/api/admin/bulk/users`. Optionally show indeterminate progress until response. On 200, show results (success/failed counts + list) and “Download Results” (build CSV from `results`).
- **Async path:** On 202, read `job_id`; start polling `GET /api/admin/bulk/jobs/:id` every 1–2 seconds (or use SSE if you add a stream endpoint). Update UI: “Creating users… {current}/{total} (Success: X, Failed: Y)”. When `status === "completed"`, show final counts and results list; enable “Download Results”. If backend supports “Download full results” (e.g. `GET /api/admin/bulk/jobs/:id?export=csv` or similar), use that for the CSV file.

### 6.3 Cancel

- When async job is running, show “Cancel” button. On click, call `POST /api/admin/bulk/jobs/:id/cancel`. Stop polling; show “Cancelled” and partial results if returned.

### 6.4 Download results

- **From sync response:** Build CSV client-side from `results`: columns `username,email,success,user_id,account_id,error`. Filename e.g. `bulk_users_results_<timestamp>.csv`.
- **From async job:** Either use `results` in the last job payload (if limited to last N) or call a dedicated export endpoint that streams the full CSV. Same columns and filename convention.

### 6.5 Validation and toasts (match current spec)

- Count ≤ 0 or > max_users_per_run → error toast.
- Missing required fields (username_prefix, email_domain, password) → error toast.
- Password length < 8 → error toast.
- Initial balance enabled but amount ≤ 0 → error toast; fee > amount → error toast.
- On completion (sync or async): success toast “Bulk user creation completed. X succeeded, Y failed.”
- **Password:** Client-side validate min length 8 and at least one digit (same as backend) so users get immediate feedback.

---

## 7. Security and Limits

| Item | Recommendation |
|------|----------------|
| **Auth** | All bulk endpoints require admin JWT and permission `users:create`. |
| **Rate limit** | Per-admin limit: e.g. max 3 concurrent bulk jobs; max 50,000 users per day per admin (from config). |
| **Input sanitization** | Validate and sanitize all string inputs (prefixes, domain, reference); reject invalid characters. |
| **Audit** | Log every bulk job start/completion/cancel with admin_id, job_id, count, success_count, failed_count. |
| **Password** | Never log or return password; hash server-side and reuse hash for the run. |

---

## 8. Implementation Phases (Checklist)

### Phase 1 – Backend: Config and sync batch only

1. Add **GET /api/admin/bulk/config** (or embed in existing admin config). Return static JSON for `bulk_user_creation` (max_users_per_run, batch_size, async_threshold, fields, defaults).
2. Add **AuthService::create_user_without_session** (or equivalent) that performs the same validation and INSERT as register but does not create a session or send welcome email. Optionally accept group_id, account_mode, initial_balance.
3. Add **POST /api/admin/bulk/users** for sync only (e.g. when count ≤ 2000):
   - Validate body against config.
   - Process in chunks of 250: reuse one password hash, resolve group_id once, batch INSERT users per chunk. On unique violation, record failed row and continue.
   - If initial_balance_enabled, after each chunk (or at end) create ledger/wallet entries in batch.
   - Return 200 with total, success_count, failed_count, and results array (cap at 500).
4. Add **admin bulk router** under `/api/admin/bulk` with auth middleware.

### Phase 2 – Frontend: Dynamic form and sync flow

5. **API module:** Add `getBulkConfig()` and `createBulkUsers(payload)` calling the new endpoints.
6. **BulkUserCreation component:** On mount, fetch config; use config for max, validation, and defaults. Remove hardcoded 100000 and static validation.
7. On submit, call `createBulkUsers`. For sync response (200), show results and “Download Results” (client-side CSV). Show toasts for validation errors and completion.
8. (Optional) Add a simple progress indicator during sync (e.g. “Creating users…” with a spinner) if the request takes > 1–2 seconds.

### Phase 3 – Backend: Async job and progress

9. **Job storage:** Add Redis keys or `bulk_jobs` + `bulk_job_results` tables; write job on 202 and update progress from the worker.
10. **Worker:** When count > async_threshold, enqueue a job (or spawn a task) that does the same chunked processing, updating progress in Redis/DB after each chunk. Support cancel flag.
11. **GET /api/admin/bulk/jobs/:id** and **POST /api/admin/bulk/jobs/:id/cancel**.
12. **POST /api/admin/bulk/users** returns 202 with job_id when count > async_threshold.

### Phase 4 – Frontend: Async progress and cancel

13. When response is 202, store job_id and start polling GET job every 1–2 s. Show “Creating users… {current}/{total} (Success: X, Failed: Y)” and “Cancel” button.
14. On status completed/cancelled, show final results and “Download Results”. Optionally add “Download full results” that calls an export endpoint if implemented.
15. (Optional) SSE or WebSocket for progress to avoid polling.

### Phase 5 – Hardening and scale

16. Rate limiting (per admin, concurrent jobs, daily cap).
17. Audit logging for every bulk job.
18. Optional: Idempotency-Key for POST bulk/users.
19. Tune batch_size and async_threshold from config or env; load-test with 10k and 50k users.

---

## 9. Database and Performance Notes

- **users table:** Ensure unique constraint on `email` (and `LOWER(email)` if case-insensitive). Use batch INSERT with multiple rows per statement where possible.
- **Transactions:** One transaction per chunk (e.g. 250 users) balances progress visibility and connection hold time. Avoid one giant transaction for 100k rows.
- **Connection pool:** Size pool appropriately (e.g. 20–50 per auth-service instance). PgBouncer in front of Postgres for higher connection counts.
- **Indexes:** Keep indexes on users(email), users(group_id), and any columns used in bulk job result queries.

---

## 10. Summary Table

| Topic | Action |
|-------|--------|
| **Dynamic config** | GET /api/admin/bulk/config drives max users, batch size, fields, validation, defaults. Frontend uses it; no hardcoding. |
| **Speed** | Reuse password hash; batch INSERT per chunk; one group_id resolution per run; no welcome email in hot path; async job for large N. |
| **Sync vs async** | count ≤ threshold → 200 + full/truncated results; count > threshold → 202 + job_id, poll for progress and results. |
| **Progress** | Redis or DB stores current/total/success/failed; frontend polls or uses SSE. |
| **Cancel** | POST /jobs/:id/cancel; worker checks flag between chunks. |
| **Results** | Each row: username, email, success, user_id, account_id, error. CSV download with same columns. |
| **Validation** | Server and client use same rules from config; toasts for errors and completion. |
| **Security** | Admin-only; rate limits; audit; no password in logs or response. |

This gives you a **fully dynamic** Bulk Operations page and a **super fast**, production-ready bulk user creation path that you can extend later to more bulk operations (deposits, positions) using the same config and job patterns.

---

## 11. Codebase Alignment (Why This Will Work)

The following has been checked against the current repo so the spec can be implemented without surprises.

| Item | Location | Spec alignment |
|------|----------|----------------|
| **User creation** | `backend/auth-service/src/services/auth_service.rs` → `register()` | Reuse same validation (password ≥ 8 chars + at least one digit, email uniqueness, group_id resolution, default group). New method `create_user_without_session` does INSERT without `create_session` or welcome email. |
| **User model** | `backend/auth-service/src/models/user.rs` → `User` | INSERT must set: email, password_hash, first_name, last_name, country, role, status, email_verified, referral_code, referred_by_user_id, group_id. Optional columns if present in DB: account_type, min_leverage, max_leverage (from migrations). Use `email.to_lowercase()` for storage. |
| **Email uniqueness** | Same as register: `SELECT ... WHERE email = $1 AND deleted_at IS NULL` before insert, or rely on DB unique constraint and catch violation in bulk. | For bulk: use batch INSERT and on unique violation (per row or per chunk) record failed row and continue; do not fail entire run. |
| **Group resolution** | `register()` uses default_group_id `00000000-0000-0000-0000-000000000001` and validates group_id against `user_groups` where status = 'active'. | Resolve group_id once per bulk run; if invalid or null, use same default_group_id. |
| **Initial balance** | `backend/auth-service/src/services/ledger_service.rs` → `get_or_create_wallet`, `create_ledger_entry` | After creating users, for each new user call get_or_create_wallet(user_id, "USD", "spot") then create_ledger_entry for the deposit amount. Apply fee and reference as per existing deposit flow if applicable. |
| **Admin auth** | `backend/auth-service/src/routes/admin_users.rs` uses `auth_middleware` and role check. | Mount bulk routes under `/api/admin/bulk` with the same middleware; require admin role and permission `users:create`. |
| **Frontend** | `src/features/adminBulkOperations/` – BulkUserCreation component, types | Config from API drives max count, validation, defaults. Existing UI already has count, prefix, domain, password, first_name_prefix, last_name, starting_number, group_id, account_mode, initial_balance. Wire to new API and config. |

---

## 12. Pre-Implementation Checklist (Verify Before Coding)

Run through this list before implementing; it ensures the spec matches your environment and avoids rework.

- [ ] **DB:** `users` table has unique constraint on `email` (or `LOWER(email)`). If case-insensitive, bulk INSERT must use lowercased email.
- [ ] **DB:** Default group `00000000-0000-0000-0000-000000000001` exists or is created by register (spec reuses same logic).
- [ ] **Auth:** Admin JWT contains role (e.g. "admin") and/or permission (e.g. "users:create"); bulk routes use the same middleware as other admin routes.
- [ ] **Password:** Hash function and cost are the same as in `AuthService::register` (reuse `hash_password`); no extra validation in bulk beyond length ≥ 8 and at least one digit.
- [ ] **Referral:** For bulk-created users, `referred_by_user_id` can be NULL; generate unique `referral_code` per user (e.g. REF + random string as in register).
- [ ] **Ledger:** If initial_balance is implemented, confirm `wallets` and ledger tables exist and `ledger_service::get_or_create_wallet` / `create_ledger_entry` accept the intended parameters (currency, wallet_type, amount, fee, reference).
- [ ] **Config source:** Decide where config lives (static JSON in code, env vars, or DB). Same values must be used for GET config and for server-side validation of POST body.

---

## 13. Edge Cases and Failure Handling (100% Reliability)

| Scenario | Behavior so it works every time |
|----------|----------------------------------|
| **Duplicate email in same run** | Each generated email is unique (prefix + number + domain). If a previous run already created that email, DB unique constraint will fail for that row; catch violation, record as failed with "Email already exists", continue. |
| **Invalid group_id** | Resolve once at start; if invalid or not active, fall back to default group (same as register). Do not fail the whole run. |
| **Config missing or down** | Frontend: if GET config fails, show error and disable submit (or use fallback defaults with a warning). Backend: never depend on config for sync validation only—validate against same limits in code/env so API works even if config endpoint is cached wrong. |
| **Request timeout (sync)** | For count near async_threshold, sync may take 30–60 s. Frontend: use a long timeout (e.g. 120 s) or use async for all runs above a lower threshold (e.g. 500). Backend: process in chunks so partial progress is possible; if timeout occurs, consider returning 202 and storing partial state as a job so user can poll. |
| **Cancel during async** | Worker checks a "cancelled" flag (Redis or DB) after each chunk. When set, stop processing, set job status to cancelled, persist current/total/success/failed and partial results. Frontend shows "Cancelled" and partial results. |
| **Backend crash during async job** | Job status stays "processing"; frontend keeps polling. Optionally add a "stale" threshold (e.g. no update for 10 minutes) and mark job as failed so user can retry. For full reliability, run worker in a process that restarts and resumes from last stored progress (requires job to be resumable by design). |
| **Empty or zero count** | Validate count ≥ 1 on both client and server; return 400 with clear message. |
| **Very long username/email** | Config max_length (e.g. 50 for prefix, 253 for domain); validate and truncate or reject. Avoid overflow in DB or URLs. |
| **Initial balance fee > amount** | Validate before starting: if initial_balance_enabled and fee > amount, return 400. Same as current UI toast. |
| **Rate limit exceeded** | Return 429 with Retry-After; frontend shows toast and disables submit briefly. |

Completing the implementation phases in order and checking the pre-implementation checklist ensures the solution is **valid, professional, and will work 100%** in your environment.

---

## 14. Platform performance isolation (no impact on optimization or speed)

Bulk operations **must not** slow down or destabilize the rest of the platform (login, register, orders, positions, trading, deposits, etc.). The following rules are mandatory so platform speed and optimization stay unchanged.

### 14.1 Database connections

| Rule | Why |
|------|-----|
| **One connection per bulk request** | Sync bulk uses a single connection from the existing pool for the whole request. Process in chunks (e.g. 250 rows), one transaction per chunk, then commit and reuse the same connection for the next chunk. No “one connection per user” or per-row connection. |
| **Release quickly** | Each chunk transaction is short (one batch INSERT). Connection is not held for minutes. |
| **Cap concurrent bulk** | Allow at most **1–2 concurrent** sync bulk runs per auth-service instance (or globally). If a third admin hits POST bulk/users while two are already running, return **503** or **429** with “Too many bulk jobs; try again shortly.” This keeps pool usage bounded so normal API requests always get connections. |
| **Async jobs use dedicated pool or same pool with strict limit** | If the worker runs inside the same process (e.g. `tokio::spawn`), it shares the DB pool. Cap at **1 running async bulk job** per instance, or use a **separate pool** (e.g. max 2 connections) only for bulk workers so the main pool (login, register, orders) is never starved. |

**Implementation:** Before starting sync bulk, check a “bulk in progress” counter (in-memory or Redis). If already at limit, return 429. When starting, increment; when done (or error), decrement. For async, the worker acquires the same “slot” when it starts and releases when it finishes.

### 14.2 CPU and memory

| Rule | Why |
|------|-----|
| **Chunked processing only** | Never build 100,000 user rows in memory. Build at most `batch_size` (e.g. 250) at a time, INSERT, then discard. Memory footprint stays **O(batch_size)**. |
| **One password hash per run** | Hash the shared password once; reuse for all users. No 100k hashes. |
| **No blocking on I/O** | Use async DB calls (sqlx is async). No blocking `std::thread::sleep` or CPU-heavy work in the request path. Bulk work is I/O-bound (DB inserts). |

So normal request handlers (login, place order, etc.) are not competing with bulk for CPU or memory.

### 14.3 Critical paths unchanged

| Rule | Why |
|------|-----|
| **Bulk is separate routes only** | All bulk endpoints live under `/api/admin/bulk/*`. No new middleware, no new code in existing routes (register, login, orders, positions, deposits, etc.). Those paths are **unchanged**. |
| **No shared mutable state** | Bulk does not add global locks or shared queues that normal requests wait on. Progress is stored in Redis or DB; normal flows do not read it. |
| **Same auth as other admin** | Bulk uses the same admin middleware as existing admin routes. No extra auth overhead. |

So latency and throughput of login, register, trading, and user-facing API stay as they are today.

### 14.4 Async threshold and sync timeout

| Rule | Why |
|------|-----|
| **Sync only for “small” runs** | Use `async_threshold` (e.g. 500–2,000). Runs with `count` above that return **202** and run in the background. So the HTTP layer never holds a request open for 50,000 users. |
| **Optional: lower sync timeout** | If you want to be extra safe, set a **max sync duration** (e.g. 30 s). If sync bulk is still running after that, abort the request, persist partial state as a job, return 202 with that job_id so the client can poll. That way no single sync request can tie up a connection for minutes. |

So long-running work never blocks the request pool.

### 14.5 Redis and other shared resources

| Rule | Why |
|------|-----|
| **Bulk keys are namespaced** | Use keys like `bulk:job:{id}` so they don’t collide with existing Redis usage (sessions, positions, etc.). |
| **No heavy Redis use for sync** | Sync path does not need Redis. Only async path uses Redis (or DB) for job state. So normal Redis traffic (cache, sessions, etc.) is unaffected. |
| **Optional: separate Redis DB** | If you use multiple Redis logical databases (SELECT 0, 1, …), put bulk job state in a different DB number so bulk reads/writes don’t compete with critical Redis usage. |

So existing Redis optimization and usage stay intact.

### 14.6 Rate limits (recap)

- **Per admin:** e.g. max 3 bulk jobs per day, or max 50,000 users per day (from config). Prevents one admin from flooding the system.
- **Concurrent:** max 1–2 sync bulk runs per instance; max 1 async bulk worker per instance (or dedicated small pool). Prevents connection and CPU contention.

### 14.7 Summary: why platform speed is unaffected

1. **Connections:** One connection per bulk request; short transactions per chunk; hard cap on concurrent bulk so the main pool is never exhausted.
2. **Memory/CPU:** O(batch_size) memory; one hash per run; async I/O only. No spike that could slow other handlers.
3. **Critical paths:** No code changes to login, register, orders, positions, deposits; no shared blocking state.
4. **Long work:** Large runs are async (202 + job); sync is limited by count and optionally by max duration.
5. **Redis:** Namespaced keys; optional separate DB; sync path doesn’t need Redis.

Implementing bulk according to this section and the rest of the spec keeps **platform optimization and speed unchanged** for all non-bulk traffic.
