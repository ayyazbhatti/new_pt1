# Plan: Admin send notification to user (Admin Users → action icon → popup)

| Field | Value |
|-------|--------|
| **Status** | Draft — pending approval |
| **Scope** | Admin Users page action column + backend endpoint; user receives in existing notification panel. |
| **Verification** | §9 traces code paths for 100% correctness. |

---

## 1. Objective

On **Admin → Users** (`/admin/users`), add a **notification** action icon in the Actions column. When the admin clicks it:

1. A **popup (modal)** opens with two fields: **Title** and **Details** (message body).
2. Admin submits the form → backend creates a notification for that **user** and pushes it to Redis.
3. The **user** sees the notification in the **same notification panel** they already have (terminal notifications panel / notification list), including real-time delivery if they are connected via WebSocket.

No change to the user-facing app except that they can receive these admin-sent notifications in the existing UI.

---

## 2. Current behaviour (reference)

- **Notifications table:** `notifications` (id, user_id, kind, title, message, read, created_at, meta). Used by SL/TP, liquidation, deposits, etc.
- **Real-time delivery:** Backend publishes to Redis channel `notifications:push` with a JSON payload. WS gateway subscribes and routes by `userId` (or `user_id`) to the user’s WebSocket connection(s). Client listens for `notification.push` and pushes into the notifications store.
- **User panel:** Notifications are shown in the terminal NotificationsPanel (and elsewhere the app uses the same store). `GET /api/notifications` returns the list for the authenticated user.
- **Admin Users table:** `UsersTable.tsx` has an Actions column with icons: Log in as user, View, Edit, Restrict, Disable. Icons use `Button` + Lucide icons (LogIn, Eye, Edit, Shield, X).

---

## 3. Implementation plan

### 3.1 Backend: endpoint for admin to send notification to a user

**File:** `backend/auth-service/src/routes/deposits.rs` (or a small admin-specific module if preferred).

- **New endpoint:** `POST /api/admin/users/:user_id/notify` (or `POST /api/notifications/send` with target user in body; plan assumes path param for clarity).
- **Auth:** Admin only (e.g. require `claims.role == "admin"`; reuse existing admin checks used elsewhere).
- **Request body:** `{ "title": string, "message": string }` (or `details` if you prefer; backend can map to `message`).
- **Behaviour:**
  1. Validate `title` and `message` (non-empty, reasonable length).
  2. Resolve target user: `user_id` from path; optional check that user exists and is not deleted.
  3. Insert one row into `notifications`: `user_id` = target user, `kind` = e.g. `"ADMIN_MESSAGE"`, `title` and `message` from request, `read` = false, `created_at` = now, `meta` = e.g. `{ "sentByAdminId": "<admin_uuid>" }`.
  4. Publish to Redis `notifications:push` with the same payload shape as existing notifications: `id`, `kind`, `title`, `message`, `createdAt`, `read`, **`userId`** (target user’s id so the gateway routes to that user), `meta`.
  5. Return success (e.g. 200 with `{ "success": true, "notificationId": "..." }`).
- **Errors:** 400 if validation fails, 403 if not admin, 404 if target user not found.

Existing patterns in `deposits.rs` (e.g. deposit approved notification) show the exact INSERT and Redis publish shape; replicate that and set `userId` in the published JSON so the gateway delivers to the correct user.

**Router registration:** Add the route to `backend/auth-service/src/routes/admin_users.rs`: `.route("/:id/notify", post(admin_send_notify))`. The handler needs **Redis** to publish to `notifications:push`; the current `create_admin_users_router(pool)` only has `PgPool`. So: (1) extend the router to accept `DepositsState` (or at least Redis) and add it as a layer, e.g. `.layer(axum::extract::Extension(deposits_state))`, and (2) in `main.rs` change the nest to pass it: `create_admin_users_router(pool.clone(), deposits_state.clone())`. Handler then uses `Extension(deposits_state): Extension<DepositsState>` and `deposits_state.redis` for the publish.

**Critical:** The JSON published to Redis **must** include `"userId": "<target_user_uuid>"` (string). The WS gateway (`backend/ws-gateway/src/stream/broadcaster.rs` `broadcast_notification`) routes by `payload.get("userId").or_else(|| payload.get("user_id"))`; without it, the message is broadcast to all connections instead of the target user.

---

### 3.2 Frontend: Admin Users page — notification icon and modal

**Files:**  
- `src/features/adminUsers/components/UsersTable.tsx`  
- New modal component (e.g. `src/features/adminUsers/modals/SendNotificationModal.tsx`).  
- New API function (e.g. in `src/features/adminUsers/api/users.api.ts` or a small `notifications.api.ts` for admin).

**Actions column (UsersTable.tsx):**

- Add one more icon **before** or **after** the existing action buttons (e.g. Bell or MessageSquare from Lucide), with tooltip “Send notification”.
- On click: open a modal that contains the “Send notification to user” form, passing the selected **user** (id and name for display).

**Modal (SendNotificationModal):**

- **Props:** `user: { id: string, name: string }`, `open: boolean`, `onOpenChange: (open: boolean) => void`.
- **Fields:**
  - **Title** (required): single-line text input.
  - **Details** (required): multiline text area (maps to `message` in API).
- **Actions:** “Cancel” (close modal), “Send” (submit).
- **Submit:** Call `POST /api/admin/users/:userId/notify` with `{ title, message: details }`. On success: close modal, optionally show a short success toast (“Notification sent to &lt;name&gt;”). On error: show error message (e.g. toast or inline).
- **Validation:** Title and details non-empty before submit.

**API:**

- `sendNotificationToUser(userId: string, payload: { title: string; message: string })` → `http.post(\`/api/admin/users/${userId}/notify\`, payload)`.

No change to the shared notifications store or to the user-facing notification panel logic: the backend will insert and push the same shape of event, so existing `notification.push` handling and `GET /api/notifications` will show these as well.

---

### 3.3 Frontend: notification kind for admin-sent messages

**Files:**  
- `src/shared/ws/wsEvents.ts`  
- `src/features/terminal/components/NotificationsPanel.tsx` (and any other place that uses `NotificationPushPayload.kind`).

- **Kind:** Add a new value, e.g. `"ADMIN_MESSAGE"`, to the `NotificationPushPayload` type’s `kind` union.
- **Display:** In the notifications panel, map `ADMIN_MESSAGE` to the existing **system** type (neutral badge) and a short label (e.g. “Msg” or “Admin”). No new UI component required; reuse current list item and styling.

Optional: in `notificationsStore`, no special dedupe is required for `ADMIN_MESSAGE` (each send is a distinct notification). If you later add dedupe by (kind, title, message), you can include `ADMIN_MESSAGE` in that logic.

---

## 4. Data flow summary

1. Admin opens **Admin → Users**, clicks the **notification** icon for a user.
2. Modal opens with **Title** and **Details**; admin fills and clicks **Send**.
3. Frontend calls `POST /api/admin/users/:user_id/notify` with `{ title, message }`.
4. Backend (admin-only): inserts into `notifications` (user_id = target, kind = `ADMIN_MESSAGE`, title, message), publishes same payload to Redis `notifications:push` with **userId** = target user.
5. WS gateway receives Redis message and sends to that user’s connection(s).
6. User’s client receives `notification.push` and pushes into the notifications store; notification appears in the **same notification panel** they already have. If the user loads the page later, `GET /api/notifications` returns the same notification.

---

## 5. Files to touch (checklist)

| Area | File(s) |
|------|--------|
| Backend | `admin_users.rs`: new handler `admin_send_notify`, request body `{ title, message }`, admin check, user exists check, INSERT into `notifications`, publish to Redis with **userId** in payload; add `.route("/:id/notify", post(admin_send_notify))`; extend router to accept and layer `DepositsState`. |
| Backend | `main.rs`: change `create_admin_users_router(pool.clone())` to `create_admin_users_router(pool.clone(), deposits_state.clone())` so notify handler can publish. |
| Frontend | `UsersTable.tsx`: add notification icon in Actions column; on click open SendNotificationModal with `user`. |
| Frontend | New `SendNotificationModal.tsx`: Title + Details fields, Cancel/Send, call API, toast on success/error. |
| Frontend | Admin users API: add `sendNotificationToUser(userId, { title, message })`. |
| Frontend | `wsEvents.ts`: add `'ADMIN_MESSAGE'` to `NotificationPushPayload.kind`. |
| Frontend | `NotificationsPanel.tsx`: map `ADMIN_MESSAGE` to system type and label (e.g. “Msg”). |

---

## 6. Assumptions

- The `notifications` table and `GET /api/notifications` remain unchanged; new rows with `kind = 'ADMIN_MESSAGE'` are returned like existing kinds.
- The WS gateway continues to subscribe to Redis `notifications:push` and route by `userId` / `user_id`; no gateway code change required.
- Admin users router can be extended to take `DepositsState` (or Redis) in addition to `PgPool` so the notify handler can publish.

---

## 7. Permissions

- Backend: allow only users with `role == "admin"` (same as other admin user actions).
- Frontend: show the notification icon only to admins (e.g. reuse `useCanAccess('users:edit')` or a dedicated permission if the project has one for “send notification”). If no specific permission exists, “admin only” is sufficient.

---

## 8. Edge cases

- **Target user deleted:** Backend returns 404 and does not insert.
- **Empty title/message:** Backend returns 400; frontend validates before submit.
- **User offline:** Notification is still stored; user sees it when they open the app or refresh; real-time push works when they are next connected.
- **Long text:** Apply reasonable max length on backend (e.g. title 200, message 2000) and optionally in the modal.

---

## 9. Verification (chain traced for 100% correctness)

The following was verified against the codebase so the flow works end-to-end:

| Step | Verified in code |
|------|-------------------|
| **1. Admin Users route** | `main.rs` nests `create_admin_users_router(pool)` at `/api/admin/users`. Routes in `admin_users.rs` use `/:id/...` (e.g. `/:id/impersonate`). Adding `/:id/notify` yields `POST /api/admin/users/:id/notify`; path param is the target user id. |
| **2. Admin check** | All handlers in `admin_users.rs` use `if claims.role != "admin"` and return 403; same pattern for the new handler. |
| **3. User exists** | Same file uses `sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)", user_id)`; replicate for notify to return 404 if not found. |
| **4. Notifications INSERT** | `deposits.rs` (e.g. deposit approved ~2345–2365, SL/TP ~1163–1185): `INSERT INTO notifications (id, user_id, kind, title, message, read, created_at, meta)`. Replicate with `user_id` = path param, `kind = "ADMIN_MESSAGE"`, `title`/`message` from body. |
| **5. Redis publish** | Same file: `conn.publish("notifications:push", serde_json::to_string(&notification_event)?)`. Payload must include `"userId": target_user_id.to_string()` so the gateway routes to that user (`broadcaster.rs` ~500–512: `payload.get("userId").or_else(\|\| payload.get("user_id"))`). |
| **6. Gateway delivery** | `broadcast_notification` sends `ServerMessage::NotificationPush { payload }` to `registry.get_user_connections(user_id)` when `userId` is present; client receives `notification.push` and pushes to store. |
| **7. User panel** | Terminal `NotificationsPanel` and store already display any notification from the store; `getKindType`/`getTypeLabel` need one branch for `ADMIN_MESSAGE` (e.g. system / "Msg"). |
| **8. List on load** | `GET /api/notifications` returns all kinds for the authenticated user; no filter on `kind`, so `ADMIN_MESSAGE` rows will appear. |

**Conclusion:** With the new route, correct Redis payload (including `userId`), and frontend kind/label, the end-to-end flow is valid and will work.

---

## 10. Summary

- **Admin Users:** New notification icon in the Actions column → opens modal with **Title** and **Details**.
- **Backend:** New admin-only `POST /api/admin/users/:user_id/notify` → insert into `notifications` (kind `ADMIN_MESSAGE`) and publish to Redis `notifications:push` with `userId` so the gateway routes to the target user.
- **User:** Receives the notification in the **same notification panel** already used for SL/TP, liquidation, deposits, etc., with real-time delivery when connected and via list on load.

---

## 11. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Gateway receives payload without `userId` | Always set `"userId": target_user_id.to_string()` in the published JSON. |
| Admin router has no Redis | Extend `create_admin_users_router` to accept and layer `DepositsState`; pass from `main.rs`. |
| Long title/message | Enforce max length in backend (e.g. title 200, message 2000) and optionally in modal. |

---

*Approval: _____________  Date: _____________*
