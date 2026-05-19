# User Events History – Plan & Specification

This document describes a **safe, additive** plan for recording user activity and exposing it in a new **Admin → User Events History** page. Review and approve this plan before implementation.

**Status:** Draft for review (not implemented). Includes **§14 Performance & reliability** — read before approval.

**Related codebase today:**

- `audit_logs` table + `log_audit()` in `auth_service.rs` — only `auth.register`, `auth.login`, `auth.logout`
- `user_sessions` — IP, user agent, per login session (no admin UI)
- `users.last_login_at`, `users.created_at` — shown on Admin Users
- Admin Trading **Audit** tab — API stub returns empty (`admin_audit.rs` TODO)
- User Details **“Online Status”** — misleading (based on `lastLogin`, not live presence)

---

## 1. Goals & non-goals

### 1.1 Goals

1. **Record** a consistent stream of user-related events (starting with auth, expanding later).
2. **New admin page** to search, filter, and inspect events (who, what, when, IP, device).
3. **Link from Users** — open event history for a specific user (optional deep link / filter).
4. **Safe rollout** — no changes to login, trading, wallet, or WebSocket behavior beyond **append-only** writes after successful operations.
5. **Permission-gated** — only roles with explicit permission can view events.
6. **Align with existing patterns** — same layout as Leads, Transactions, Users (`ContentShell`, `PageHeader`, tables, filters).

### 1.2 Non-goals (out of scope for v1)

- Full product analytics (page views, clickstream, heatmaps).
- Real-time “user is online now” / session duration tracking (can be a later phase).
- Replacing or breaking existing `audit_logs` / `user_sessions` (keep them; extend or mirror).
- Logging inside hot paths before success (e.g. do not log failed login attempts in v1 unless explicitly requested).
- User-facing “activity log” for traders (admin only in v1).

---

## 2. Design principles (safety)

| Principle | What it means |
|-----------|----------------|
| **Additive only** | New table(s), new routes, new page — no destructive migrations on existing tables. |
| **Log after success** | Write events only after auth/trading/finance operations succeed (same transaction optional; prefer separate insert so failures don’t roll back business logic). |
| **Fail open for logging** | If event insert fails, log server error but **do not** fail login/trade/deposit for the user. |
| **No polling** | Admin list loads on navigation + filter change; live updates via existing WebSocket only if we add a dedicated channel later (not required for v1). |
| **Backward compatible API** | Existing endpoints unchanged; new `/api/admin/user-events` only. |
| **Idempotent migrations** | SQL migrations use `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` like existing permission migrations. |

---

## 3. Event data model

### 3.1 Recommendation: new `user_events` table

Use a dedicated table instead of overloading `audit_logs`, because admin needs:

- **Subject user** — the account the event is about (always set).
- **Actor user** — who performed it (same as subject for self-service login; admin id for impersonation / admin actions).
- Structured **event_type**, **category**, **IP**, **user_agent**, **metadata** JSON.

`audit_logs` can remain for legacy rows; new code writes to `user_events`. Optional one-time backfill from `audit_logs` + `user_sessions` (see §8).

### 3.2 Proposed schema (Postgres)

```sql
CREATE TABLE IF NOT EXISTS user_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type      TEXT NOT NULL,
  category        TEXT NOT NULL,
  ip              INET NULL,
  user_agent      TEXT NULL,
  meta            JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_events_subject_created
  ON user_events (subject_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_events_type_created
  ON user_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_events_created
  ON user_events (created_at DESC);
```

**Field notes:**

| Column | Description |
|--------|-------------|
| `subject_user_id` | User the event is about (the customer). |
| `actor_user_id` | User who triggered it; NULL = system/job. For login, actor = subject. For admin edit, actor = admin. |
| `event_type` | Machine key, e.g. `auth.login`, `auth.register`, `profile.password_change`. |
| `category` | UI grouping: `auth`, `profile`, `trading`, `finance`, `admin`, `security`. |
| `ip` | From `X-Forwarded-For` / `X-Real-IP` when available (same as login today). |
| `user_agent` | From `User-Agent` header when available. |
| `meta` | JSON: email (redacted optional), symbol, order_id, deposit_id, old/new status, etc. No passwords/tokens. |

### 3.3 Event catalog – Phase 1 (must-have)

Recorded from day one of the feature:

| event_type | category | When | meta (examples) |
|------------|----------|------|-----------------|
| `auth.register` | auth | Successful registration | `email`, `country`, `referred_by_user_id`, `group_id` |
| `auth.login` | auth | Successful login | `email` |
| `auth.logout` | auth | Successful logout | — |
| `auth.session_created` | auth | New refresh session row | `session_id` (uuid only) |

**Also capture IP + user_agent** on login/register when headers exist (register today does not pass IP into session — fix in instrumentation only, no UX change).

### 3.4 Event catalog – Phase 2 (recommended soon after v1 page ships)

| event_type | category | When |
|------------|----------|------|
| `auth.login_failed` | security | Failed login (optional; watch PII/volume) |
| `profile.updated` | profile | User updates name via `/me` |
| `profile.password_changed` | security | Password change |
| `finance.deposit_requested` | finance | User creates deposit request |
| `finance.deposit_approved` | finance | Admin approves deposit |
| `finance.withdrawal_*` | finance | Withdrawal lifecycle |
| `trading.order_placed` | trading | Order accepted (high volume — consider sampling or admin-only) |
| `trading.position_closed` | trading | Position closed |
| `admin.impersonation_started` | admin | Admin impersonates user |
| `admin.user_updated` | admin | Admin edits user from User Details |

Phase 2 items are **listed for completeness**; implement incrementally after Phase 1 is stable.

### 3.5 What we will NOT store in `meta`

- Passwords, refresh tokens, access tokens, API keys.
- Full payment card data.
- Raw WebSocket payloads.

---

## 4. Backend (auth-service)

### 4.1 New module

- `backend/auth-service/src/routes/admin_user_events.rs`
- `backend/auth-service/src/services/user_events_service.rs` (insert + list + filters)

Register router in `lib.rs`:

```text
.nest("/api/admin/user-events", create_admin_user_events_router(...))
```

### 4.2 Write path – `UserEventsService::record(...)`

Single internal helper used by auth and (later) other routes:

```rust
// Pseudocode
async fn record(EventInput { subject_user_id, actor_user_id, event_type, category, ip, user_agent, meta }) {
    if let Err(e) = insert_user_events(...).await {
        tracing::warn!("user_events insert failed: {}", e);
    }
}
```

**Instrumentation points (Phase 1 only — minimal touch):**

| Location | Change |
|----------|--------|
| `AuthService::register` | After user + session created → `record(auth.register)` + IP/UA if we add headers to register handler |
| `AuthService::login` | After success (alongside existing `log_audit`) → `record(auth.login)` |
| `AuthService::logout` | After success → `record(auth.logout)` |
| `create_session_with_metadata` | Optional `auth.session_created` |

**Keep existing `log_audit()` calls** until we decide to deprecate `audit_logs` (no removal in v1).

### 4.3 Read path – Admin API

**Permission:** `user_events:view` (new permission in Users or new “Compliance” category).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/user-events` | Paginated list, filters |

**Query parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `user_id` | uuid | Filter by subject user |
| `event_type` | string | Exact or prefix e.g. `auth.` |
| `category` | string | `auth`, `finance`, … |
| `from` / `to` | ISO datetime | Date range |
| `search` | string | Search email in meta, or user email via join |
| `cursor` | string | Keyset pagination on `(created_at, id)` |
| `limit` | int | Default 50, max 100 |

**Response shape (align with existing admin list APIs):**

```json
{
  "items": [
    {
      "id": "uuid",
      "subjectUserId": "uuid",
      "subjectEmail": "user@example.com",
      "subjectName": "John Doe",
      "actorUserId": "uuid | null",
      "actorEmail": "admin@example.com | null",
      "eventType": "auth.login",
      "category": "auth",
      "ip": "203.0.113.1",
      "userAgent": "Mozilla/5.0 ...",
      "meta": {},
      "createdAt": "2026-05-19T12:00:00Z"
    }
  ],
  "cursor": "...",
  "hasMore": true,
  "total": 1234
}
```

**Manager scoping:** If the viewer is a manager/agent with group/tag scope (same as Admin Users list), restrict `subject_user_id` to users they can see. Reuse existing scoped-access helpers from `admin_users` / `scoped_access` — do not invent a parallel rule set.

### 4.4 Optional: per-user shortcut API

`GET /api/admin/users/:user_id/events` — thin wrapper around list with `user_id` fixed. Convenient for User Details drawer; same permission.

---

## 5. Permissions

New permission (migration):

| Key | Label | Category |
|-----|-------|----------|
| `user_events:view` | View user events history | Users (or new “Compliance”) |

- Nav item and route guarded by `user_events:view`.
- Grant to `super_admin` / full-access profile by default (follow pattern in `040_full_access_profile.sql`).
- Managers: only if product wants them to see events for their scoped users (recommended: yes, with same scope as `users:view`).

**Do not** reuse `risk:view` for this page — that permission is tied to the empty Trading Audit stub.

---

## 6. Frontend – Admin User Events History page

### 6.1 Routes & navigation

| Route | Description | Permission |
|-------|-------------|------------|
| `/admin/user-events` | Global event history (all users) | `user_events:view` |

**Sidebar:** New item **“User events”** (icon: `History` or `ScrollText`), placed after **Users** or under **Reports**.

```text
{ label: 'User events', path: '/admin/user-events', icon: History, permission: 'user_events:view' }
```

Register in:

- `src/app/config/nav.ts`
- `src/app/router/adminRoutes.tsx`

### 6.2 Feature folder structure

```text
src/features/adminUserEvents/
  api/userEvents.api.ts
  types.ts
  pages/AdminUserEventsPage.tsx
  components/UserEventsTable.tsx
  components/UserEventsFiltersBar.tsx
  index.ts
```

Follow patterns from `adminLeads` / `admin/transactions`.

### 6.3 Page layout (`/admin/user-events`)

**Page header**

- **Title:** User events history
- **Description:** Sign-in activity, account changes, and other recorded events. Filter by user, type, or date.

**Filters toolbar**

| Control | Behavior |
|---------|----------|
| **Search** | User email, name, or user ID (debounced 300ms). Clear (X) when non-empty. |
| **User** | Optional searchable user picker (reuse pattern from admin trading / user search if available). |
| **Category** | All \| Auth \| Profile \| Finance \| Trading \| Admin \| Security |
| **Event type** | Dropdown or text prefix `auth.` |
| **Date range** | From / to (date pickers) + presets: Today, Last 7 days, Last 30 days |
| **Clear filters** | Resets to defaults |

**Table columns**

| Column | Content |
|--------|---------|
| Time | `createdAt` (local + relative tooltip) |
| User | Subject name + email (link to `/admin/users` or open User Details) |
| Event | Human label from `event_type` + category badge |
| Actor | “Self”, admin email, or “System” |
| IP | `ip` or — |
| Device | Truncated `user_agent` with tooltip |
| Details | Expand row or “View” for `meta` JSON (formatted, no secrets) |

**Pagination:** Cursor-based “Load more” or page numbers — match Transactions/Leads pattern.

**Empty / loading:** Skeleton rows while loading; empty state when no rows.

**No polling:** Fetch on mount and when filters change only.

### 6.4 Integration with Admin Users (Phase 1.1 – small addition)

On **User Details** modal (overview tab):

- Button or link: **“View event history”** → navigates to `/admin/user-events?userId=<id>` or opens filtered view.
- Fix misleading **“Online Status”** label separately (optional follow-up): rename to **“Last login”** or show `last_login_at` timestamp — **not** real-time online.

---

## 7. Human-readable event labels (UI)

Map `event_type` → label in frontend (backend can optionally send `label` later):

| event_type | Display label |
|------------|----------------|
| `auth.register` | Signed up |
| `auth.login` | Logged in |
| `auth.logout` | Logged out |
| `auth.session_created` | New session |
| `profile.updated` | Profile updated |
| … | … |

Category badges: color-coded chips (Auth = blue, Security = red, Finance = green, etc.).

---

## 8. Data migration & backfill (optional)

### 8.1 Schema migration

- File: `infra/migrations/054_user_events.sql` (and mirror in `backend/auth-service/migrations/` if that is your deploy path).

### 8.2 Backfill (optional, run once)

| Source | Target events |
|--------|----------------|
| `audit_logs` where `action` in (`auth.register`, `auth.login`, `auth.logout`) | Copy to `user_events` with `subject_user_id = actor_user_id` |
| `user_sessions` | `auth.session_created` or `auth.login` per row with IP/UA |

Backfill is **not required** for the page to work; only improves history before go-live.

---

## 9. Implementation phases

### Phase 1 – Foundation (recommended first PR)

1. Migration: `user_events` table + `user_events:view` permission.
2. `UserEventsService::record` + wire auth register/login/logout (keep `log_audit`).
3. `GET /api/admin/user-events` with filters + manager scope.
4. Admin page `/admin/user-events` (list + filters).
5. Nav + route + permission guard.
6. Manual test checklist (§11).

### Phase 2 – UX polish

1. User Details → “View event history” deep link.
2. Register handler: pass IP/UA like login.
3. Optional backfill script.
4. Rename/fix “Online Status” in User Details.

### Phase 3 – More events

1. Finance events (deposit/withdrawal).
2. Admin events (user edit, impersonation).
3. Profile/password events.
4. Trading events (evaluate volume; may need aggregation or admin-only).

---

## 10. Files likely touched (reference)

**New**

- `infra/migrations/054_user_events.sql`
- `backend/auth-service/migrations/…_user_events.sql`
- `backend/auth-service/src/services/user_events_service.rs`
- `backend/auth-service/src/routes/admin_user_events.rs`
- `src/features/adminUserEvents/**`

**Modified (careful, small diffs)**

- `backend/auth-service/src/services/auth_service.rs` — call `record` after auth success
- `backend/auth-service/src/routes/auth.rs` — optional IP/UA on register
- `backend/auth-service/src/lib.rs` — nest router
- `src/app/config/nav.ts`, `src/app/router/adminRoutes.tsx`

**Not modified in v1**

- Order engine, ws-gateway, Redis position logic
- Existing `audit_logs` table structure
- Trading Audit stub (can stay; separate from this feature)

---

## 11. Test plan (acceptance)

### 11.1 Recording

- [ ] New user registers → `user_events` row `auth.register` with correct `subject_user_id`.
- [ ] User logs in → `auth.login` with IP and user_agent when behind proxy headers.
- [ ] User logs out → `auth.logout`.
- [ ] Failed login does **not** break login response if event insert fails (simulate DB error in dev).

### 11.2 Admin UI

- [ ] User without `user_events:view` does not see nav item; direct URL returns 403.
- [ ] User with permission sees paginated list.
- [ ] Filter by `user_id` shows only that user’s events.
- [ ] Date range and category filters work.
- [ ] Search by email finds events.
- [ ] Manager sees only events for users in their scope (if scoping enabled).

### 11.3 Regression

- [ ] Login / register / logout still work exactly as before.
- [ ] Admin Users list and User Details unchanged except optional new link.
- [ ] No new polling timers on the page.

---

## 14. Performance, speed & reliability guarantees

This section answers: **Will this slow down the platform?** and **Will it work reliably?**

### 14.1 Impact on user-facing speed (login, trading, terminal)

| Area | Impact in Phase 1 | Why |
|------|-------------------|-----|
| **Login / register / logout** | **Negligible** (sub‑millisecond to ~2ms extra per auth) | Today login already runs: password check → `UPDATE users.last_login_at` → `INSERT user_sessions` → `INSERT audit_logs`. Phase 1 adds **one** extra single-row `INSERT` into `user_events` — same pattern as existing `log_audit()`. |
| **Terminal / positions / prices / WebSocket** | **Zero** | No code changes in order-engine, ws-gateway, data-provider, or positions APIs. |
| **Symbol list / chart load** | **Zero** | Admin-only list API; traders never call it. |
| **Admin Users page** | **Zero** (unless optional “View history” link) | No extra query on users list in Phase 1. |

**Phase 1 does not log trading, ticks, or balance WebSocket events** — so there is no high-volume write path added in v1.

### 14.2 How we keep auth fast and safe

1. **Log only after success** — Same as today: failed login never writes `user_events`.
2. **Fail-open (critical)** — If `INSERT user_events` fails (DB timeout, disk full, migration not run), the server logs a warning and **login/register/logout still return success**. Users are never blocked because audit logging failed. This matches how production systems should treat non-critical telemetry.
3. **Separate insert, not one big transaction** — Event write is **not** tied to session creation in a single DB transaction that could roll back login. Business commit first, then event row (same as current `log_audit` after session).
4. **Optional implementation (if you want 0ms on response path):** fire-and-forget `tokio::spawn` for the insert after tokens are returned. Trade-off: rare event loss on process crash mid-flight. **Default recommendation:** await insert with fail-open (simpler, ~99.99% durability); only use spawn if load tests show measurable latency (unlikely for one INSERT).

### 14.3 Impact on admin page speed

| Control | Guarantee |
|---------|-----------|
| **No polling** | Page loads data once on open + when filters change (workspace rule). |
| **Pagination** | Default `limit=50`, max `100`; cursor/keyset on `(created_at, id)` — no “load entire table”. |
| **Indexes** | `(subject_user_id, created_at DESC)`, `(created_at DESC)`, `(event_type, created_at DESC)` — list queries use index scans, not full table scans. |
| **Filtered by user** | When `user_id` is set, query uses `subject_user_id` index (same pattern as fast open-positions fix: filter early). |
| **Default date range** | UI defaults to **Last 7 days** (or 30) so first paint does not scan years of rows. |

Expected admin list latency: **under 200ms** for typical filters on indexed columns (comparable to Leads/Transactions lists).

### 14.4 Database & storage growth

| Topic | Plan |
|-------|------|
| **Volume (Phase 1)** | ~1–3 rows per login/logout/register per user — low compared to orders/ticks. |
| **Volume (Phase 3 trading)** | **Not in Phase 1** — trading events deferred until retention/index strategy agreed (see §12 Q4). |
| **Table size** | Append-only; indexes add ~20–30% storage overhead — normal for audit tables. |
| **Migration** | `CREATE TABLE IF NOT EXISTS` only — **no ALTER** on `users`, `user_sessions`, or Redis. Deploy does not lock existing hot tables. |
| **Retention (optional later)** | Partition or purge events older than N days — not required for launch; can add without breaking v1. |

### 14.5 What “100% works” means (explicit)

| Feature | Guarantee level |
|---------|-------------------|
| **User can always log in** | **100%** — event logging failure cannot break auth (fail-open). |
| **Every successful login is recorded** | **Best-effort ~99.99%+** — same class as current `audit_logs` (if DB is up, row is written). Process crash between response and spawn (only if spawn used) is the rare gap. |
| **Admin page shows events** | **100%** when permission + migration applied — standard CRUD list; errors return clear API error, not silent empty. |
| **No regression on existing features** | **Required** — §11.3 regression checklist must pass before merge. |

We do **not** claim infinite history instant search without filters — admins must use date range / user filter for large datasets (same as Transactions).

### 14.6 Code change boundary (nothing else touched)

Phase 1 PR will **only**:

- Add `user_events` migration + permission migration.
- Add `user_events_service` + `admin_user_events` route.
- Add **3–4 call sites** in `auth_service.rs` (register/login/logout) — same file that already calls `log_audit`.
- Add new frontend feature `adminUserEvents` + nav + route.

Phase 1 PR will **not** modify:

- `get_user_positions`, Redis Lua, order-engine, `usePriceStream`, symbol pagination, `BottomDock`, deposit approval logic, or admin trading tables.

### 14.7 Pre-merge verification (required before deploy)

| Check | Pass criteria |
|-------|----------------|
| Load test (light) | 100 sequential logins with event logging enabled; p95 login latency increase **under 5ms** vs baseline without insert (or identical if within noise). |
| Fail-open test | Disable `user_events` table (rename in dev) → login still returns 200 + tokens. |
| Admin list | 10k seeded rows, filter last 7 days + `user_id` → response **under 500ms**. |
| Regression | §11.3 all checked. |

### 14.8 Rollback plan

If anything goes wrong after deploy:

1. **Disable writes** — feature flag or comment out `record()` calls (auth works; no new rows).
2. **Hide nav** — remove permission from profiles or hide route (admin page unused).
3. **Drop table** — only if abandoning feature; optional, not required for emergency rollback.

No rollback needed on `users` / `user_sessions` because they are unchanged.

---

## 15. Approval checklist (sign-off)

Before implementation starts, confirm:

- [ ] **§14** performance & reliability approach is acceptable.
- [ ] Phase 1 scope (auth events only) is enough for first release.
- [ ] Fail-open logging is acceptable (login never fails due to audit).
- [ ] Admin default date filter (7/30 days) is acceptable.
- [ ] Answers to **§12** open questions (permission name, sidebar label, etc.).

---

## 12. Open questions for product sign-off

Please confirm before implementation:

1. **Permission name** — `user_events:view` OK, or prefer `users:events_view` / under `reports:view`?
2. **Failed login logging** — Include in v1 or Phase 2?
3. **Retention** — Keep all events forever, or archive/delete after N days (not in v1 unless required)?
4. **Trading events** — Needed in first release or later (volume concern)?
5. **Sidebar label** — “User events”, “Activity log”, or “Audit trail”?
6. **Backfill** — Run historical backfill from `audit_logs` / `user_sessions` on deploy?

---

## 13. Summary

| Item | Plan |
|------|------|
| Storage | New `user_events` table (additive) |
| Phase 1 events | Register, login, logout only (low volume) |
| Admin UI | New `/admin/user-events` page; paginated, indexed, no polling |
| User-facing speed | No change to terminal/trading/WS; auth +1 INSERT fail-open |
| Safety | Log after success; logging failures don’t break user flows |
| Existing code | Keep `audit_logs`, `user_sessions`, all current APIs |
| Permissions | New `user_events:view` |
| Proof before deploy | §14.7 load + fail-open + regression tests |

Once **§15** is checked and **§12** is answered, implementation can proceed phase by phase without disturbing existing functionality or measurable platform speed.

---

## 16. Implementation status (completed)

| Phase | Item | Status |
|-------|------|--------|
| 1 | `user_events` migration + `user_events:view` permission | Done |
| 1 | Auth register/login/logout recording (fail-open) | Done |
| 1 | `GET /api/admin/user-events` + manager scope | Done |
| 1 | Admin page, nav, route, permission guard | Done |
| 2 | User Details → View event history link | Done |
| 2 | Register IP/UA + session metadata | Done |
| 2 | Last login label fix (User Details) | Done |
| 2 | Date range filters (7/30/90/custom) | Done |
| 2 | Backfill script | Done — `infra/scripts/backfill_user_events.sql`, `cargo run --bin backfill_user_events` |
| 3 (partial) | `admin.impersonate`, `finance.deposit_*`, `auth.password_reset` | Done |
| 3 (partial) | `auth.session_created` on backfill from sessions | Done |
| Tests | `parse_cursor` unit tests in `user_events_service` | Done |

**Deploy checklist**

1. Run migrations (`054_user_events.sql` or auth-service migration).
2. Optional: `cargo run --bin backfill_user_events` (with `DATABASE_URL` set).
3. Rebuild and restart `auth-service` + frontend.
4. Grant `user_events:view` to required permission profiles (Full Access auto-granted).

**Not in scope (future)**

- Failed-login event logging
- Trading / order events (volume)
- Withdrawal events, profile edit events
- Automated integration tests against live DB
- Event retention/archival policy
