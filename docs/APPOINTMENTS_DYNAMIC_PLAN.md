# Appointments Feature – Plan to Make It Fully Dynamic

**Status:** Plan (ready for implementation)  
**Scope:** Connect existing admin and user appointment UI to real backend APIs.  
**Prerequisite:** Current UI is built and uses mock data; types and API contract are defined in the feature spec.  
**Performance:** Designed so that list and stats stay fast; no impact on existing app speed (see §4).  
**Validity:** Plan is self-contained, implementable in order, and includes acceptance criteria, risks, and rollback (see §5).

---

## 1. Current State Summary

### 1.1 What Exists (UI + Types)

- **Admin panel** (`/admin/appointments`):
  - **Stats row:** Total, Today’s, Upcoming 7 days, Overdue (from mock stats).
  - **Filters:** Search, Status, Type, User, Start date, End date (persisted search in `localStorage`).
  - **List view:** Table with User, Title, Scheduled, Duration, Status, Type, Created by, Actions. Row click → View modal.
  - **Calendar view:** Month grid; click appointment → View modal.
  - **Actions:** View, Send Reminder, Edit, Reschedule, Mark Complete, Cancel (by status).
  - **Modals:** Create (with user typeahead), View, Edit, Reschedule, Cancel, Complete, Send Reminder.
  - **Data source:** `mockAppointments`, `mockStats`, `mockSearchUsers()` in `src/features/appointments/mocks/index.ts`.

- **User panel** (`/user/appointments`):
  - **Filters:** Search, Status, Type, Clear (search persisted in `localStorage`).
  - **List:** Card grid; each card has Title, status badge, description, date/time, duration, meeting link, location, “View Details”.
  - **Detail modal:** Read-only View + “Join Meeting” when `meeting_link` present.
  - **Data source:** `mockAppointments` filtered by `user_id === currentUser.id`.

- **Types** (`src/features/appointments/types/index.ts`):
  - `Appointment`, `AppointmentStatus`, `AppointmentType`, `ReminderType`, `AppointmentStats`, `AppointmentQueryParams`, `AppointmentsResponse`, `UserSearchResult`, and request DTOs (`CreateAppointmentRequest`, `UpdateAppointmentRequest`, `SendReminderRequest`, `RescheduleAppointmentRequest`, `CancelAppointmentRequest`, `CompleteAppointmentRequest`). All use **snake_case** for API parity.

### 1.2 What Is Missing for “Fully Dynamic”

- **Backend:** No `appointments` table, no appointment routes, no appointment service.
- **Frontend:** No API client; pages and modals still use mock data and local state for create/update/delete.

---

## 2. Backend Plan (auth-service, Rust)

### 2.1 Database

- **Migration** (e.g. `database/migrations/XXXX_appointments.sql` or `infra/migrations/XXX_appointments.sql`):
  - Table `appointments` with columns matching `Appointment`:
    - `id` UUID PRIMARY KEY DEFAULT gen_random_uuid()
    - `user_id` UUID NOT NULL REFERENCES users(id)
    - `admin_id` UUID NOT NULL REFERENCES users(id)
    - `title` VARCHAR(255) NOT NULL
    - `description` TEXT
    - `scheduled_at` TIMESTAMPTZ NOT NULL
    - `duration_minutes` INT NOT NULL
    - `status` VARCHAR(20) NOT NULL CHECK (status IN ('scheduled','confirmed','completed','cancelled','rescheduled'))
    - `type` VARCHAR(20) NOT NULL CHECK (type IN ('consultation','support','onboarding','review','other'))
    - `meeting_link` TEXT
    - `location` TEXT
    - `notes` TEXT
    - `cancelled_at` TIMESTAMPTZ
    - `completed_at` TIMESTAMPTZ
    - `rescheduled_at` TIMESTAMPTZ
    - `cancelled_reason` TEXT
    - `completion_notes` TEXT
    - `created_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
    - `updated_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
  - **Indexes (required for speed):**
    - `(user_id)` — user list and ownership checks.
    - `(admin_id)` — admin filter and stats.
    - `(scheduled_at)` — date range filters, today/upcoming/overdue stats, calendar.
    - `(status)` — status filter and stats aggregates.
    - Optional composite for admin list: `(scheduled_at, status)` if admin list is often filtered by both.
  - No full-table scans: all list and stats queries use the above indexes.

### 2.2 API Routes

**Base path:** `/api` for user, `/api/admin/appointments` for admin (align with existing `nest("/api/admin/...")` pattern).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/appointments` | User (JWT) | List current user’s appointments. Query: `limit`, `offset`, `status`, `type`, `start_date`, `end_date`. Return `{ appointments, total, limit, offset }`. |
| GET | `/api/appointments/:id` | User (JWT) | Get one appointment; 404 if not found or not `user_id = current user`. |
| GET | `/api/admin/appointments` | Admin (JWT + role admin) | List all. Query: `limit`, `offset`, `search`, `status`, `type`, `user_id`, `admin_id`, `start_date`, `end_date`. Return same envelope. |
| GET | `/api/admin/appointments/stats` | Admin | Return `AppointmentStats` (aggregates by status, today count, upcoming 7 days, overdue). |
| GET | `/api/admin/appointments/search-users?q=...&limit=...` | Admin | Search users by email/name; return `UserSearchResult[]` (id, email, first_name, last_name, full_name). |
| GET | `/api/admin/appointments/:id` | Admin | Get one; 404 if not found. |
| POST | `/api/admin/appointments` | Admin | Create. Body: `CreateAppointmentRequest`. Return created `Appointment` (with joined user_email, user_name, admin_email). |
| PUT | `/api/admin/appointments/:id` | Admin | Update. Body: `UpdateAppointmentRequest`. Return updated `Appointment`. |
| DELETE | `/api/admin/appointments/:id` | Admin | Hard delete (or soft delete if you add `deleted_at`). Return 204 or `{ message }`. |
| POST | `/api/admin/appointments/:id/reminder` | Admin | Send reminder. Body: `SendReminderRequest`. Return 200 + optional reminder record. |
| PUT | `/api/admin/appointments/:id/reschedule` | Admin | Reschedule. Body: `RescheduleAppointmentRequest`. Return updated `Appointment`. |
| PUT | `/api/admin/appointments/:id/cancel` | Admin | Cancel. Body: `CancelAppointmentRequest`. Return updated `Appointment`. |
| PUT | `/api/admin/appointments/:id/complete` | Admin | Mark complete. Body: `CompleteAppointmentRequest`. Return updated `Appointment`. |

- **Response envelope:** Either raw JSON (e.g. `Appointment`, `AppointmentsResponse`, `AppointmentStats`) or a consistent envelope `{ success, data?, message?, error? }` if the rest of the app uses it. Frontend will map `data` or the root to the TypeScript types.
- **List limits:** Enforce a maximum `limit` (e.g. 200) on list endpoints to avoid large responses; default 10 or 20. Frontend already uses pageSize 10–200.

### 2.3 Service Layer

- **Appointment service** (e.g. `src/services/appointment_service.rs` or under a new `appointments` module):
  - `list_for_user(pool, user_id, params)` → filter by `user_id`, optional status/type/start_date/end_date, paginate.
  - `list_admin(pool, params)` → optional search (title, user email/name), status, type, user_id, admin_id, start_date, end_date; paginate.
  - `get_by_id(pool, id)` → return option; **single query** with JOIN to `users` (as user and as admin) for user_email, user_name, admin_email — no extra queries per appointment.
  - List queries: **single query** with JOINs for user_email, user_name, admin_email; no N+1 (do not fetch user per row).
  - `get_stats(pool)` → **one aggregated query** (e.g. conditional COUNT with FILTER or GROUP BY status) so stats are a single DB round-trip; avoid N+1 or multiple queries.
  - `search_users(pool, q, limit)` → query `users` by email/name (e.g. ILIKE); **cap limit at 20**; return id, email, first_name, last_name, full_name (or concat). Use existing index on users (email/name) if present.
  - `create(pool, admin_id, req)` → insert; return created row with joins.
  - `update(pool, id, req)` → update non-null fields; return updated row with joins.
  - `delete(pool, id)` → delete by id.
  - `reschedule(pool, id, req)` → set scheduled_at, set rescheduled_at, status = rescheduled; return updated.
  - `cancel(pool, id, req)` → set status = cancelled, cancelled_at, cancelled_reason, additional_details (if you add column); return updated.
  - `complete(pool, id, req)` → set status = completed, completed_at, completion_notes; return updated.
  - `send_reminder(pool, id, req)` → for now log and return OK; later integrate email (e.g. reuse platform email service).

- **User routes:** Extract `user_id` from JWT; call `list_for_user`, `get_by_id` (with ownership check).
- **Admin routes:** Extract admin from JWT; enforce role admin; call service for all admin actions.

### 2.4 Router Registration

- In `main.rs`:
  - `nest("/api/appointments", create_appointments_router(pool))` for user list + get by id.
  - `nest("/api/admin/appointments", create_admin_appointments_router(pool))` for all admin routes.
- Reuse existing auth middleware and admin check (same pattern as `admin_managers`, `admin_settings`).

### 2.5 Order of Backend Implementation

1. Migration: create `appointments` table + indexes.
2. Models: structs for `Appointment` row (and any joined DTOs) with `FromRow` / serialization (snake_case).
3. Service: implement all functions above.
4. User router: GET list, GET :id (auth middleware, scope by current user).
5. Admin router: GET list, GET stats, GET search-users, GET :id, POST, PUT, DELETE, POST :id/reminder, PUT :id/reschedule, PUT :id/cancel, PUT :id/complete.
6. Wire routers in `main.rs` and run migration.

---

## 3. Frontend Plan

### 3.1 API Layer

- **File:** `src/features/appointments/api/appointments.api.ts` (or split into `user.api.ts` and `admin.api.ts`).
- **HTTP client:** Use existing `http` from `@/shared/api/http` (same as managers, settings).
- **User API:**
  - `getUserAppointments(params: AppointmentQueryParams): Promise<AppointmentsResponse>`
    - GET `/api/appointments` with query params (limit, offset, status, type, start_date, end_date). Map response to `AppointmentsResponse`.
  - `getUserAppointment(id: string): Promise<Appointment>`
    - GET `/api/appointments/:id`. Map response to `Appointment`.
- **Admin API:**
  - `getAppointments(params): Promise<AppointmentsResponse>` → GET `/api/admin/appointments?...`
  - `getAppointmentStats(): Promise<AppointmentStats>` → GET `/api/admin/appointments/stats`
  - `searchUsersForAppointment(q: string, limit?: number): Promise<UserSearchResult[]>` → GET `/api/admin/appointments/search-users?q=...&limit=...`
  - `getAppointment(id: string): Promise<Appointment>` → GET `/api/admin/appointments/:id`
  - `createAppointment(req: CreateAppointmentRequest): Promise<Appointment>` → POST `/api/admin/appointments`
  - `updateAppointment(id: string, req: UpdateAppointmentRequest): Promise<Appointment>` → PUT `/api/admin/appointments/:id`
  - `deleteAppointment(id: string): Promise<void | { message: string }>` → DELETE `/api/admin/appointments/:id`
  - `sendAppointmentReminder(id: string, req: SendReminderRequest): Promise<...>` → POST `/api/admin/appointments/:id/reminder`
  - `rescheduleAppointment(id: string, req: RescheduleAppointmentRequest): Promise<Appointment>` → PUT `/api/admin/appointments/:id/reschedule`
  - `cancelAppointment(id: string, req: CancelAppointmentRequest): Promise<Appointment>` → PUT `/api/admin/appointments/:id/cancel`
  - `completeAppointment(id: string, req: CompleteAppointmentRequest): Promise<Appointment>` → PUT `/api/admin/appointments/:id/complete`
- **Response mapping:** If backend returns snake_case (matches our types), use as-is; if camelCase, map to our `Appointment` etc. in the API layer.

### 3.2 Admin Page – Make Dynamic

- **State:**
  - Remove local `appointments` and `stats` from `useState(mockAppointments)` / `mockStats`.
  - Use `useQuery` for list: key `['admin', 'appointments', filters]`, `queryFn` → `getAppointments({ limit: pageSize, offset: pageIndex * pageSize, search, status, type, user_id, start_date, end_date })`. Use `data.appointments` and `data.total` for table and pagination.
  - Use `useQuery` for stats: key `['admin', 'appointments', 'stats']`, `queryFn` → `getAppointmentStats()`. Use `data` for the four stat cards.
  - Keep UI state: `viewMode`, `calendarDate`, `searchQuery`, `statusFilter`, `typeFilter`, `userFilter`, `startDateFilter`, `endDateFilter`, `pageIndex`, `pageSize`.
- **Create modal:**
  - Replace `mockSearchUsers` with a debounced call to `searchUsersForAppointment(q, 10)` (or use `useQuery` with a dynamic key when user types, e.g. `['admin', 'appointments', 'search-users', userQuery]` with enabled: userQuery.length >= 2).
  - On submit: `useMutation(createAppointment)`; onSuccess: invalidate `['admin', 'appointments']` and `['admin', 'appointments', 'stats']`, close modal, toast success.
- **Edit / Reschedule / Cancel / Complete / Send Reminder:**
  - Each modal calls the corresponding API via `useMutation`; onSuccess: invalidate list + stats, close modal, toast.
- **Delete:** If you add a delete action (e.g. in row or view modal), `useMutation(deleteAppointment)`; onSuccess: invalidate list + stats, close modal, toast.
- **View modal:** Read-only; no API call needed if list item has full data; optionally refetch one by id for fresh data (e.g. `useQuery(['appointment', id], () => getAppointment(id), { enabled: !!id })` when modal opens).
- **Calendar view:** Use the same `filteredAppointments` from the list query (filter by calendar month from client or pass `start_date`/`end_date` for that month). No extra endpoint if list returns enough data; otherwise add a month range to the list request when in calendar view.

### 3.3 User Page – Make Dynamic

- **State:**
  - Remove `mockAppointments.filter(user_id === userId)`.
  - Use `useQuery`: key `['user', 'appointments', searchQuery, statusFilter, typeFilter]`, `queryFn` → `getUserAppointments({ limit, offset, status, type, start_date, end_date })`. Use current user from auth store; backend will scope by JWT.
  - Keep UI state: `searchQuery`, `statusFilter`, `typeFilter`.
- **Detail modal:** Use list item as-is, or optionally `getUserAppointment(id)` when opening for fresh data.
- **No create/edit:** User side stays read-only; no new mutations.

### 3.4 Error and Loading Handling

- **Admin:** Show loading state for list (skeleton or spinner) and for stats; on error show message or toast; empty state when `appointments.length === 0`.
- **User:** Same for list; error/empty states as already in spec.
- **Mutations:** On error, show toast with `err?.response?.data?.error?.message ?? err.message` (or whatever the backend returns); keep modal open so user can retry.

### 3.5 Order of Frontend Implementation

1. Add `src/features/appointments/api/appointments.api.ts` with all functions above (user + admin).
2. Admin page: replace mock list and stats with `useQuery`; wire filters and pagination to params; keep calendar using list data for the month.
3. Admin modals: wire Create to `searchUsersForAppointment` + `createAppointment` mutation; wire Edit, Reschedule, Cancel, Complete, Send Reminder (and Delete if present) to their mutations; invalidate list + stats on success.
4. User page: replace mock list with `useQuery(getUserAppointments)`; optional `getUserAppointment` for detail modal.
5. Remove or gate mock data: delete or bypass `mockAppointments`, `mockStats`, `mockSearchUsers` when API is available (e.g. env flag or just remove once backend is deployed).

---

## 4. Performance & Optimization (No Speed Impact)

### 4.1 Backend

- **List endpoints:** Paginated only (`limit` + `offset`). Max `limit` capped (e.g. 200). All list queries use indexes on `user_id`, `admin_id`, `scheduled_at`, `status` — no full scan.
- **Stats:** One aggregated SQL query (COUNT with filters / GROUP BY), not one query per stat. Index on `scheduled_at` and `status` used for today/upcoming/overdue.
- **Search users:** Capped at 20 results; use ILIKE with existing user table indexes where possible.
- **Single appointment:** One SELECT with JOINs; no N+1.
- **Writes (create/update/cancel/complete/reschedule):** Single INSERT/UPDATE; no cascading heavy work in the request path. Reminder can be fire-and-forget (e.g. spawn task to send email) so response is fast.

### 4.2 Frontend

- **Queries:** React Query (`useQuery`) with **staleTime** (e.g. 30–60 seconds) so list and stats are not refetched on every tab focus; invalidate only after mutations (create/edit/cancel/complete/reschedule).
- **User search:** Debounce (e.g. 300 ms) before calling `searchUsersForAppointment`; call only when query length ≥ 2; avoid flooding the backend.
- **Calendar view:** Reuse the **same list data** for the current month (pass `start_date`/`end_date` for that month in the list request when in calendar view), or filter client-side from already-fetched list — **no duplicate list request** for calendar.
- **No extra list fetch for View modal:** Use the appointment from the list row; optional refetch by id only when explicitly needed (e.g. after edit from another tab).

### 4.3 Impact on Rest of App

- New routes and one new table only; no change to existing auth, deposits, or trading paths.
- No new global middleware or heavy startup work; appointment code is isolated.

---

## 5. Validation, Assumptions & Acceptance

### 5.1 Assumptions

- Auth-service remains the backend; JWT and admin role check already exist.
- Existing `users` table has `id`, `email`, `first_name`, `last_name` (or equivalent) for joins and search.
- Frontend `http` client and React Query are already used elsewhere; no new infra.

### 5.2 Acceptance Criteria (Definition of Done)

- [ ] Migration runs cleanly; table and indexes exist.
- [ ] User list/detail return only that user’s appointments; admin list/stats/search-users/CRUD/reminder/reschedule/cancel/complete work with valid JWT and admin role.
- [ ] Admin and user UIs load list (and admin stats) from API; filters and pagination work; create, edit, reschedule, cancel, complete, send reminder work and reflect in list/stats after success.
- [ ] List and stats respond in normal range (e.g. &lt; 500 ms for typical page size); no regression on existing app speed.
- [ ] Errors (4xx/5xx) surface in UI (toast or message); modal stays open on mutation error for retry.

### 5.3 Risks & Mitigation

| Risk | Mitigation |
|------|-------------|
| Stats query slow on large table | Use indexed aggregates only; consider materialized view later if needed. |
| Search users slow | Limit 20; ensure index on email/name; debounce on frontend. |
| List slow with many filters | Indexes on filter columns; keep default page size small (10–20). |

### 5.4 Rollback

- **Backend:** Remove appointment routes from `main.rs`; leave table in place (no drop in rollback unless explicitly desired).
- **Frontend:** Revert to mock data by reintroducing mock imports and local state until APIs are stable.

### 5.5 Non-Goals (Out of Scope for This Plan)

- Recurrence, reminders scheduling (cron), or email delivery implementation — reminder endpoint can log only initially.
- Changes to existing appointment UI/UX beyond wiring to API.
- New permissions beyond “admin” for appointment routes (can be added later).

---

## 6. Testing and Validation

- **Backend:** Run migration; hit each admin and user endpoint with curl/Postman (with valid JWT); verify list, stats, search-users, CRUD, reschedule, cancel, complete, reminder.
- **Frontend:** With backend running, open admin and user appointment pages; verify list loads, stats load, filters and pagination work; create appointment (user search + submit); view, edit, reschedule, cancel, complete, send reminder; user side: list and detail modal.
- **Permissions:** Confirm user cannot call admin endpoints; admin can; user list returns only that user’s appointments.

---

## 7. File Map (Reference)

| Area | File / path |
|------|--------------|
| Backend migration | `database/migrations/XXXX_appointments.sql` or `infra/migrations/XXX_appointments.sql` |
| Backend models | e.g. `backend/auth-service/src/models/appointment.rs` or inline in service |
| Backend service | e.g. `backend/auth-service/src/services/appointment_service.rs` |
| Backend user routes | e.g. `backend/auth-service/src/routes/appointments.rs` (user list + get) |
| Backend admin routes | e.g. `backend/auth-service/src/routes/admin_appointments.rs` |
| Backend main | `backend/auth-service/src/main.rs` (nest user + admin routers) |
| Frontend API | `src/features/appointments/api/appointments.api.ts` |
| Frontend admin page | `src/features/appointments/pages/AdminAppointmentsPage.tsx` |
| Frontend user page | `src/features/appointments/pages/UserAppointmentsPage.tsx` |
| Types (unchanged) | `src/features/appointments/types/index.ts` |

---

## 8. Summary

- **Backend:** One migration (appointments table), one service (list user, list admin, stats, search users, CRUD, reschedule, cancel, complete, reminder), two routers (user + admin), registered under `/api/appointments` and `/api/admin/appointments`.
- **Frontend:** One API module (user + admin methods), admin page switched to `useQuery` (list + stats) and `useMutation` (create, update, delete, reschedule, cancel, complete, reminder), user page switched to `useQuery(getUserAppointments)`; remove mock usage once APIs are live.
- **Result:** Admin and user appointment UIs are fully driven by the backend; no mock data required.
- **Optimization preserved:** Pagination, indexed queries, single-query stats, debounced user search, and React Query caching ensure no negative impact on load time or existing app speed.

This plan assumes the **current UI and types** (user_id, admin_id, title, scheduled_at, status, type, etc.) and the existing auth/middleware patterns in auth-service and frontend. Implementing in the order above will make the appointment feature fully dynamic end-to-end without compromising performance.
