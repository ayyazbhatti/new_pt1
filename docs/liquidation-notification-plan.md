# Plan: Liquidation notifications (same pattern as SL/TP)

| Field | Value |
|-------|--------|
| **Status** | Draft — pending approval |
| **Scope** | Auth-service (backend), frontend terminal notifications only |
| **Performance** | Zero impact on critical path (see § Performance & latency) |

---

## 1. Objective

Add in-app notifications and optional HTML email for **liquidation**, using the same pattern as **Stop Loss** and **Take Profit**: backend creates a notification row, publishes to Redis for real-time delivery, and the terminal notifications panel shows it with a distinct style (e.g. liquidation = danger/red).

**Out of scope:** Changes to order-engine execution, margin/liquidation trigger logic, or any hot path that affects latency or throughput.

---

## 2. Performance & latency (no impact on optimization/speed)

- **Critical path is unchanged.**  
  Liquidation is triggered in auth-service when `margin_level < 0`; order-engine closes positions and publishes `event.position.closed`. Account summary recompute and margin checks remain exactly as today. No new work is added to that path.

- **Notification work is off the critical path.**  
  When auth-service receives `event.position.closed` with `trigger_reason: "liquidated"`, it will **spawn a separate async task** (e.g. `tokio::spawn`) that runs `create_liquidation_notifications_and_push(...)`. The subscriber loop does **not** await this task. So:
  - The `event.position.closed` handler returns immediately after spawning.
  - DB insert, Redis publish, and email send run in the background.
  - Any delay or failure in notifications does not block account summary recompute or subsequent events.

- **Same pattern as SL/TP.**  
  SL/TP already use this fire-and-forget spawn; we are only adding one more branch (`trigger == "liquidated"`) and a new function that mirrors `create_sltp_notifications_and_push`. No new awaits on the subscriber loop, no new blocking calls.

- **Order-engine and deposits hot path.**  
  No changes in order-engine or in `compute_and_cache_account_summary` / `try_publish_liquidation_close_all`. Notification logic lives only in the existing async subscriber that already runs SL/TP notification tasks.

**Conclusion:** Implementation will not affect optimization or speed of liquidation trigger, position close, or account summary; notification work is explicitly decoupled and non-blocking.

---

## 3. Current behaviour

### 3.1 Liquidation flow (where it runs)

1. **Auth-service** (`backend/auth-service/src/routes/deposits.rs`):
   - `try_publish_liquidation_close_all`: when `margin_level < 0`, publishes NATS `cmd.position.close_all` with `"reason": "liquidated"` and sets Redis cooldown `pos:liquidation:triggered:{user_id}` (60s).
2. **Order-engine** (`apps/order-engine/src/engine/position_handler.rs`):
   - Handles `cmd.position.close_all`; for each position calls Lua close with `close_reason_arg = Some("liquidated")`, sets status **Liquidated**.
   - Publishes **evt.position.updated** (status Liquidated) and **event.position.closed** with `trigger_reason: Some("liquidated")`, plus `user_id`, `position_id`, `symbol`, `side`, `exit_price`, `realized_pnl`, etc.
3. **Auth-service** (`backend/auth-service/src/services/position_event_handler.rs`):
   - Subscribes to **evt.position.updated**; on status **Liquidated** syncs DB, recomputes account summary, and sends **liquidation email only** (plain text via `send_liquidation_email_impl`). **No notification row and no Redis push today.**

### 3.2 SL/TP notification flow (to mirror)

- **Auth-service** (`backend/auth-service/src/main.rs`): subscribes to **event.position.closed**; when `trigger_reason` is `"SL"` or `"TP"`, spawns `create_sltp_notifications_and_push(pool, redis, inner)`.
- **deposits.rs** (`create_sltp_notifications_and_push`):
  - Parses `user_id`, `position_id`, `symbol`, `side`, `realized_pnl`, `exit_price`, `trigger_reason` from payload.
  - Dedupes by `(user_id, kind, meta->>'positionId')` within 2 minutes.
  - Inserts into `notifications` (kind `POSITION_SL` or `POSITION_TP`, title, message, meta).
  - Publishes JSON to Redis `notifications:push` for the user (and per admin).
  - Sends HTML email via `build_sltp_email_html` + `send_email_html_sync` (fire-and-forget).
- **Frontend**: `NotificationPushPayload.kind` includes `POSITION_SL` and `POSITION_TP`; `notificationsStore` dedupes by `kind` + `positionId` + `message`; terminal `NotificationsPanel` maps kind to badge (SL = red/danger, TP = green/accent) and shows in panel; real-time via `notification.push` WebSocket.

---

## 4. Implementation plan

### 4.1 Backend: trigger liquidation notifications from `event.position.closed`

**File: `backend/auth-service/src/main.rs`**

- In the existing `event.position.closed` subscriber, extend the trigger check:
  - Today: `if trigger == Some("SL") || trigger == Some("TP")` → `create_sltp_notifications_and_push(...)`.
  - Add: `else if trigger == Some("liquidated")` → **spawn** `create_liquidation_notifications_and_push(pool, redis, inner)` via `tokio::spawn` (do **not** await). Same fire-and-forget pattern as SL/TP.
- Ensure `create_liquidation_notifications_and_push` is imported from `routes::deposits`.

**Rationale:** Order-engine already publishes `event.position.closed` with `trigger_reason: "liquidated"` and the same payload shape (user_id, position_id, symbol, side, exit_price, realized_pnl). Reusing this stream keeps one place for “position closed” notifications and gives exact exit_price/realized_pnl.

---

### 4.2 Backend: `create_liquidation_notifications_and_push` in deposits.rs

**File: `backend/auth-service/src/routes/deposits.rs`**

Add a new function (same structure as `create_sltp_notifications_and_push`):

- **Signature:** `pub async fn create_liquidation_notifications_and_push(pool: PgPool, redis: redis::Client, inner_payload: serde_json::Value)`.
- **Parse payload:** `user_id`, `position_id`, `symbol`, `side`, `realized_pnl`, `exit_price` (same fields as SL/TP; `event.position.closed` from order-engine includes these).
- **Dedupe:** `SELECT EXISTS(...) FROM notifications WHERE user_id = $1 AND kind = 'POSITION_LIQUIDATED' AND meta->>'positionId' = $2 AND created_at > NOW() - INTERVAL '2 minutes'`. If exists, log and return.
- **Build content:**
  - `kind = "POSITION_LIQUIDATED"`.
  - `title = "Position liquidated"`.
  - `message`: e.g. `"{symbol} {side} · Liquidated · PnL: {realized_pnl_display}  |  Exit: {exit_price_display}"` (reuse `format_pnl_display` / `format_number_display`).
  - `meta`: `positionId`, `symbol`, `side`, `triggerReason: "liquidated"`, `realizedPnl`, `exitPrice`.
- **Insert** one notification for the **user** (trader); then **publish** the same event JSON to Redis `notifications:push` (same channel as SL/TP; gateway routes by userId).
- **Email:** Option A (recommended): Add `build_liquidation_email_html(symbol, side, realized_pnl_display, exit_price_display)` and call it from here, then `send_email_html_sync` (fire-and-forget), so liquidation email is consistent with SL/TP (HTML). Option B: Call existing `send_liquidation_email_impl` from here (keep plain text). In both cases, send **only from this path** and **remove or skip** the email send in `position_event_handler` when status is Liquidated so the user gets a single email per liquidation.
- **Admins:** Query admins (`SELECT id FROM users WHERE role = 'admin' AND deleted_at IS NULL`); for each admin insert a notification (same title/message, kind `POSITION_LIQUIDATED`, meta including `targetUserId`) and publish to Redis `notifications:push` for that admin (same as SL/TP).
- **Logging:** Log success/failure and dedupe skip; do not block or panic (fire-and-forget).

Reference implementation: `create_sltp_notifications_and_push` in the same file (~lines 1002–1268).

---

### 4.3 Backend: Avoid duplicate liquidation email

**File: `backend/auth-service/src/services/position_event_handler.rs`**

- Today: on `PositionStatus::Liquidated` we call `send_liquidation_email_if_configured(...)`.
- **Change:** Remove the call to `send_liquidation_email_if_configured` from the Liquidated branch (both the VersionedMessage and direct deserialize paths), so the **only** liquidation email is sent from `create_liquidation_notifications_and_push` (either new HTML builder or existing `send_liquidation_email_impl` called from deposits.rs). This avoids two emails (one from position_event_handler, one from notification flow).

If you prefer to keep the existing plain-text email in `position_event_handler` and not send email from the new function, that is possible but then liquidation would differ from SL/TP (which send HTML from the notification path). The plan recommends a single path: notification + email from `create_liquidation_notifications_and_push`.

---

### 4.4 Frontend: Notification kind and store dedupe

**File: `src/shared/ws/wsEvents.ts`**

- Extend `NotificationPushPayload` `kind` with `'POSITION_LIQUIDATED'`:
  - `kind: '...' | 'POSITION_SL' | 'POSITION_TP' | 'POSITION_LIQUIDATED'`

**File: `src/shared/store/notificationsStore.ts`**

- In `push`: add dedupe for `POSITION_LIQUIDATED` in the same way as SL/TP (e.g. if `kind === 'POSITION_LIQUIDATED'` and `meta?.positionId` present, skip if same `positionId` + `message` already in state).
- In `loadNotifications`: when filtering/deduping by kind + positionId + message, include `POSITION_LIQUIDATED` in the same logic so one notification per liquidated position is shown.

---

### 4.5 Frontend: Terminal NotificationsPanel styling

**File: `src/features/terminal/components/NotificationsPanel.tsx`**

- **getKindType:** Map `POSITION_LIQUIDATED` to a type used for styling. Recommended: map to `'sl'` so it reuses the danger/red style (liquidation is also a loss/risk). Alternatively introduce `'liquidation'` and use the same `getTypeColor` as `'sl'` (e.g. `bg-danger/10 text-danger`).
- **getTypeLabel:** For `POSITION_LIQUIDATED` return a short label, e.g. `'L'` or `'LIQ'`, so the badge in the list is clear.
- **getTypeColor:** If you added `'liquidation'`, use the same danger style as `'sl'`.

No backend API change is required for listing notifications; the existing `GET /api/notifications` already returns `kind` and the new kind will be stored and returned like `POSITION_SL` / `POSITION_TP`.

---

## 5. Assumptions

- Order-engine will continue to publish `event.position.closed` with `trigger_reason: "liquidated"` and the same payload shape as today (user_id, position_id, symbol, side, exit_price, realized_pnl, etc.).
- Existing `notifications` table and `GET /api/notifications` API remain unchanged; no schema migration.
- WS delivery uses the same Redis `notifications:push` channel; gateway routing by userId already supports arbitrary `kind` values.

---

## 6. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Duplicate notifications (NATS redelivery) | Dedupe in backend by (user_id, kind, positionId) within 2 minutes; frontend dedupe by positionId + message. |
| Notification DB/Redis slow or down | Fire-and-forget task; errors logged only. Critical path (account summary, margin checks) is not blocked. |
| Two liquidation emails | Single email sent only from `create_liquidation_notifications_and_push`; remove send from position_event_handler. |

---

## 7. Files to touch (checklist)

| Area        | File(s) |
|------------|---------|
| Backend    | `backend/auth-service/src/main.rs` – extend event.position.closed branch for `trigger_reason == "liquidated"`, spawn `create_liquidation_notifications_and_push`. |
| Backend    | `backend/auth-service/src/routes/deposits.rs` – add `create_liquidation_notifications_and_push`; optionally `build_liquidation_email_html`; reuse format helpers. |
| Backend    | `backend/auth-service/src/services/position_event_handler.rs` – remove (or skip) liquidation email send so only the new path sends email. |
| Frontend   | `src/shared/ws/wsEvents.ts` – add `POSITION_LIQUIDATED` to `NotificationPushPayload.kind`. |
| Frontend   | `src/shared/store/notificationsStore.ts` – dedupe by `POSITION_LIQUIDATED` + positionId + message in `push` and `loadNotifications`. |
| Frontend   | `src/features/terminal/components/NotificationsPanel.tsx` – handle `POSITION_LIQUIDATED` in `getKindType`, `getTypeLabel`, and (if needed) `getTypeColor`. |

---

## 8. Optional: WS gateway

If the WS gateway (e.g. `backend/ws-gateway` or `apps/gateway-ws`) explicitly maps `notification.push` payloads by `kind` for routing or logging, add `POSITION_LIQUIDATED` there too so it is treated like `POSITION_SL`/`POSITION_TP`. From the codebase, the gateway appears to broadcast the payload as-is; if so, no change is required.

---

## 9. Testing suggestions

1. **Backend:** Trigger a liquidation (margin level &lt; 0) so order-engine sends `event.position.closed` with `trigger_reason: "liquidated"`. Assert one new row in `notifications` with `kind = 'POSITION_LIQUIDATED'` and correct meta; assert Redis `notifications:push` received; assert one email (if SMTP configured) and no second email from position_event_handler.
2. **Dedupe:** Send the same event twice (e.g. replay or duplicate NATS); assert only one notification row and one push.
3. **Frontend:** Open terminal notifications panel; trigger liquidation; confirm new notification appears with danger/red badge and correct title/message; confirm dedupe when the same event is pushed twice.

---

## 10. Summary

- Reuse **event.position.closed** with `trigger_reason: "liquidated"` (already published by order-engine) and add a **create_liquidation_notifications_and_push** path in auth-service, mirroring SL/TP.
- One notification per liquidation (user + admins), one email per liquidation from the new path, and terminal panel showing liquidation with the same notification UX as SL/TP (with a distinct label/colour, e.g. danger/red like SL).
- No DB schema change: reuse `notifications` table and existing `kind` semantics.
- **Performance:** Notification work is spawned in a separate task and not awaited; no impact on liquidation trigger, position close, or account summary speed.

---

## 11. Verification (chain traced for 100% correctness)

The following was verified against the codebase so the flow works end-to-end:

| Step | Verified in code |
|------|-------------------|
| **1. Order-engine publishes `event.position.closed` for liquidation** | `apps/order-engine/src/engine/position_handler.rs` ~391–404: when `reason == "liquidated"`, builds `PositionClosedEvent` with `trigger_reason: Some(reason.to_string())` (i.e. `"liquidated"`) and calls `publish_event(EVENT_POSITION_CLOSED, &event)`. |
| **2. Payload shape** | `apps/order-engine/src/models.rs` `PositionClosedEvent`: `position_id`, `user_id`, `symbol`, `side`, `closed_size`, `exit_price`, `realized_pnl`, `trigger_reason`. Order-engine `nats.rs` wraps in `VersionedMessage` → JSON has `payload` object with those fields. |
| **3. Auth-service receives and parses** | `main.rs` ~274–278: parses JSON, `inner = payload.get("payload").cloned().unwrap_or(payload)`, then `inner.get("trigger_reason").and_then(\|v\| v.as_str())`. So `trigger == Some("liquidated")` will be true when order-engine sends liquidation close. |
| **4. Same payload fields as SL/TP** | `create_sltp_notifications_and_push` uses `inner.get("user_id")`, `position_id`, `symbol`, `side`, `realized_pnl`, `exit_price` (handles both String and Number). PositionClosedEvent serializes all of these; `side` is `"LONG"`/`"SHORT"` (contracts enums `rename_all = "UPPERCASE"`). Reusing the same parsing in the new function works. |
| **5. Notifications table** | `deposits.rs` INSERT uses `id, user_id, kind, title, message, read, created_at, meta`. No schema constraint on `kind`; existing `GET /api/notifications` returns all kinds for the user. `POSITION_LIQUIDATED` is just another value. |
| **6. Redis and WS delivery** | `deposits.rs` SL/TP publishes to `notifications:push` with JSON containing `userId`. `backend/ws-gateway/src/stream/broadcaster.rs` `broadcast_notification` uses `payload.get("userId").or_else(\|\| payload.get("user_id"))` to route to the user. Same payload shape (including `userId`) in the new function → delivery to the correct user is guaranteed. |
| **7. Frontend receives and displays** | Terminal `NotificationsPanel` subscribes to `notification.push` and calls `push(event.payload)`. `notificationsStore.push` accepts any `NotificationPushPayload`; adding `POSITION_LIQUIDATED` to the `kind` type and to `getKindType`/`getTypeLabel` in the panel ensures the new kind is shown with the correct badge. |

**Edge cases covered:** Dedupe (backend 2-min window + frontend by positionId+message) avoids double notifications on NATS redelivery. Removing the liquidation email from `position_event_handler` and sending only from `create_liquidation_notifications_and_push` avoids duplicate emails.

---

*Approval: _____________  Date: _____________*
