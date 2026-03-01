# SL/TP Trigger → Notification (Persist + Real-Time to User & Admin)

## Goal

When a **Stop Loss (SL)** or **Take Profit (TP)** triggers and closes a position:

1. **Persist** a notification row in the `notifications` table.
2. Deliver that notification **in real time to the user** (trader) who owned the position.
3. Deliver that notification **in real time to admins** (e.g. admin panel NotificationBell).

## Scope and assumptions

- **In scope**: Auth-service only (one new helper + wiring in existing subscriber). No changes to order-engine, ws-gateway, or trading hot path.
- **Out of scope**: Changing how SL/TP is computed or how positions are closed; no new Redis/NATS channels; no schema migrations.
- **Rollback**: Disable by not spawning the notification task or by early-return in the helper; no data migration to revert.

---

## Guarantee: no other functionalities disturbed

| Area | What we do **not** change | Why it stays safe |
|------|----------------------------|-------------------|
| **Order-engine** | No code changes | SL/TP logic, NATS/Redis publish, tick path unchanged. |
| **WS-gateway** | No code changes | `notifications:push` and `broadcast_notification` already route by `userId`; we only publish new messages. |
| **evt.position.updated** | Not touched | Separate NATS subscriber and `PositionEventHandler`; we only extend `event.position.closed` handler. |
| **GET /api/notifications** | No change | Same query `WHERE user_id = $1`; new rows with new `kind` are returned like existing ones. |
| **Deposit/withdrawal notifications** | Not touched | New helper is only called from `event.position.closed`; deposit/withdrawal flows stay as-is. |
| **Account summary** | Logic unchanged; parsing improved | We keep one awaited call: `compute_and_cache_account_summary`. We add correct parsing so `user_id` is read from VersionedMessage when present (see below). |
| **Terminal position toast** | Not touched | Still driven by Redis `positions:updates` → gateway → `position_update`; we don’t change that. |
| **NotificationBell / notificationsStore** | No logic change | They already handle `notification.push`; we only add a new event type in the payload `kind`. |
| **Other NATS subscribers** | Not touched | We only add code in the existing `event.position.closed` loop; no new subjects or consumers. |

---

## Performance and optimization (no impact on speed)

- **Critical path unchanged.** The existing `event.position.closed` handler today does: parse payload → `compute_and_cache_account_summary(pool, redis, user_id)`. That call **must remain the only awaited work** on the hot path. Account summary drives margin/UI and must stay fast.
- **Notification work off the critical path.** When `trigger_reason` is `"SL"` or `"TP"`, we will **spawn a fire-and-forget task** (`tokio::spawn`) that runs the notification logic (DB inserts + Redis publish). The main loop will **not await** this task. So:
  - Latency of the position-closed handler is unchanged (one DB/Redis call for account summary only).
  - Notification creation runs asynchronously; any extra DB/Redis work cannot delay the next `event.position.closed` message.
- **Order-engine and gateway.** No code changes. No impact on tick processing, order execution, or WebSocket forwarding.
- **DB and Redis load.** Notification logic: one INSERT for the user, one SELECT for admin IDs, then one INSERT per admin and one Redis PUBLISH per recipient. This runs only when a position is closed by SL/TP (low frequency). Admin count is small and bounded (e.g. LIMIT in query). No heavy queries, no new indexes.
- **Failure isolation.** Inside the spawned task we will log errors and return; we will not panic or propagate errors to the subscriber. If notification creation fails, account summary and the rest of the system are unaffected.

---

## Current State

### Notifications table and API

- **Schema** (`database/migrations/0007_notifications_table.sql`):  
  `id`, `user_id`, `kind`, `title`, `message`, `read`, `meta`, `created_at`.
- **API**: Auth-service exposes `GET /api/notifications` (returns notifications for the authenticated user). Notifications are created today for deposit/withdrawal flows in `backend/auth-service/src/routes/deposits.rs`.

### How notifications are created and pushed today

- **Create**: Auth-service inserts into `notifications`, then:
  - Publishes to **NATS** subject `notification.push` (versioned message).
  - Publishes to **Redis** channel `notifications:push` (JSON payload).
- **Real-time delivery**: WS-gateway subscribes to Redis `notifications:push`. In `broadcaster.rs`, `broadcast_notification`:
  - If payload has `userId` or `user_id` → send only to that user’s WebSocket connections.
  - If no user id → broadcast to **all** connections (used today for “admin” style notifications).

### Where SL/TP triggers

- **Order-engine** (`apps/order-engine`):
  - **Flow**: `tick_handler` → `sltp_handler.check_and_trigger(symbol, group_id, bid, ask)` → Lua `check_sltp_triggers.lua` → for each triggered position, `atomic_close_position.lua` closes the position.
  - **Events**: Order-engine publishes:
    - **NATS** `event.position.closed` with `PositionClosedEvent` (includes `trigger_reason: Some("SL")` or `Some("TP")`).
    - **Redis** `positions:updates` with payload that includes `trigger_reason`.
  - **Payload**: `PositionClosedEvent` has `position_id`, `user_id`, `symbol`, `side`, `closed_size`, `exit_price`, `realized_pnl`, `trigger_reason`, etc. (`apps/order-engine/src/models.rs`).

### Who consumes position closed

- **Auth-service** already subscribes to **NATS** `event.position.closed` in `main.rs`: it only uses it to call `compute_and_cache_account_summary(pool, redis, user_id)`. It does **not** create notifications for SL/TP today.
- **Gateway** subscribes to Redis `positions:updates` and sends `position_update` to the client; the **terminal** shows a toast in BottomDock when `trigger_reason` is SL/TP (no DB notification).

### User vs admin real-time today

- **User**: NotificationBell (shared) and any app using `useNotificationsStore` + `useWebSocketSubscription` for `notification.push` get notifications only when the backend sends a message with their `userId` (or when broadcast to all).
- **Admin**: Same WS; admins auto-subscribe to `notifications` channel. Today, deposit-request notifications are broadcast to all (no `userId`), so everyone (including admins) sees them. For deposit-approved, the event does not set `userId`, so delivery is currently broadcast.

---

## Proposed Flow

### 1. Who creates the notification

- **Auth-service**, when it receives **NATS** `event.position.closed`, and the payload has `trigger_reason` equal to `"SL"` or `"TP"`.
- No change in order-engine: it already publishes `event.position.closed` with `trigger_reason` set for SL/TP.

### 2. Payload parsing (required for 100% correctness)

Order-engine publishes **VersionedMessage**: `{ "v": 1, "type": "event.position.closed", "payload": { "position_id", "user_id", "symbol", "side", "closed_size", "exit_price", "realized_pnl", "trigger_reason", ... } }`. So `user_id` and `trigger_reason` are inside the inner **payload** object, not at the top level.

- **In the handler:** Parse the NATS message body as `serde_json::Value`. Then:
  - **If** top-level has `"payload"` (VersionedMessage): take `inner = payload.get("payload")` and read `user_id`, `trigger_reason`, `position_id`, `symbol`, `side`, `realized_pnl`, `exit_price` from `inner`.
  - **Else** (flat format): read from the root `payload` for backward compatibility.
- Use the extracted `user_id` for `compute_and_cache_account_summary` and for the notification helper. This ensures account summary is always refreshed and notifications get the right data.

### 3. Where to hook the logic

- **Extend the existing `event.position.closed` subscriber** in `backend/auth-service/src/main.rs` (the same tokio spawn that today only calls `compute_and_cache_account_summary`).
- **Sequence (performance-safe):**
  1. Parse payload (support VersionedMessage and flat); extract `user_id` and, if present, `trigger_reason` and other fields from the **inner** payload.
  2. **Await only** `compute_and_cache_account_summary(pool, redis, user_id)` — unchanged, keeps critical path minimal.
  3. **If** `trigger_reason` is `"SL"` or `"TP"`: **spawn** `tokio::spawn(create_sltp_notifications_and_push(...))` and **do not await** it. The main loop continues immediately.
- Inside the spawned task (helper):
  - Insert one notification for the **user** (trader).
  - Optionally query admins and insert one notification per **admin**; publish to Redis (and optionally NATS) for user and each admin. Log errors; do not panic.

### 4. Notification payload (for DB and push)

Suggested shape for the **user** notification:

- **DB row**:  
  `user_id` = position’s `user_id`,  
  `kind` = `"SL_TP_TRIGGER"` (or `"POSITION_SL"` / `"POSITION_TP"` if you prefer two kinds),  
  `title` = e.g. `"Stop Loss triggered"` / `"Take Profit triggered"`,  
  `message` = e.g. `"Position {symbol} {side} closed by {SL|TP}. PnL: {realized_pnl}."`,  
  `meta` = JSON with `position_id`, `symbol`, `side`, `trigger_reason`, `realized_pnl`, `exit_price`, etc.

- **Push payload** (same as used today for other notifications):  
  `id`, `kind`, `title`, `message`, `createdAt`, `read`, `meta`, and **`userId`** (so the gateway can route to that user).

For **admin** notifications (optional but recommended):

- **DB row**: One row per admin with `user_id` = admin’s id, same `kind`/title/message, and `meta` including the **trader’s** `user_id` (e.g. `target_user_id` or `trader_id`) so admin knows whose position triggered.
- **Push**: Publish one message per admin with `userId` = that admin’s id, so the gateway sends only to that admin (no need to broadcast to everyone).

### 5. Real-time delivery: **push only, no polling**

Real-time notifications use **push over WebSocket only**. There is **no polling** (no interval, no repeated GET /api/notifications for live updates).

- **Flow:** When an SL/TP notification is created, auth-service **publishes once** to Redis channel `notifications:push`. The WS-gateway is **subscribed** to that channel and immediately forwards the message to the relevant WebSocket connection(s). The client receives a `notification.push` event and updates the UI (e.g. NotificationBell). No client or server timer, no periodic fetch.
- **User:** Auth-service publishes to Redis with **`userId`** = position’s `user_id`. Gateway’s `broadcast_notification` sends the message to that user’s WebSocket connection(s) only.
- **Admin:** Same channel; auth-service publishes **one** message per admin with **`userId`** = admin’s id. Gateway sends to that admin’s connection(s).
- **GET /api/notifications** is used only for **initial load** when the user opens the notifications list (e.g. on NotificationBell mount or page load). It is **not** used for real-time updates; real-time updates come exclusively via WebSocket push.
- **Implementation guarantee:** We will not add any polling (no setInterval, no refetch loop, no periodic checks) for real-time notifications. All live delivery is event-driven: Redis pub/sub → gateway → WebSocket → client handler.

### 6. Frontend

- **User (trading terminal)**:
  - **Option A**: Terminal already shows a toast on `position_update` when `trigger_reason` is SL/TP. We can **additionally** subscribe to `notification.push` in the terminal (e.g. via `useNotificationsStore` + WS) so the same event appears in a notification list/bell if the terminal has one.
  - **Option B**: Rely only on the new persisted notification: ensure the terminal uses the shared notifications API/WS so that when the user opens “Notifications”, they see the SL/TP entry. No change to BottomDock toast is required.
- **Admin**: Admin panel already has NotificationBell and subscribes to `notification.push`. Once the backend sends a push with `userId` = admin id, admins will see the SL/TP notification in real time in the bell.

### 7. Types and API

- **Backend**: Add `kind` values (e.g. `SL_TP_TRIGGER` or `POSITION_SL` / `POSITION_TP`) and ensure `GET /api/notifications` returns them (no schema change needed).
- **Frontend**: Extend `NotificationPushPayload` (e.g. in `src/shared/ws/wsEvents.ts`) to include the new `kind`(s) so TypeScript and UI can treat them as position-trigger notifications if needed.

### 8. Validation and edge cases

- **When to run:** Only when `trigger_reason` is exactly `"SL"` or `"TP"`. If missing or any other value (e.g. manual close), skip notification logic entirely.
- **Payload:** If required fields (`user_id`, `symbol`, etc.) are missing, log a warning and return from the helper without inserting or publishing.
- **Admin query:** Use a bounded query (e.g. `LIMIT 50`) to avoid unbounded work; typical admin count is small.
- **Errors:** Inside the spawned task, all errors are logged; no panic, no propagation to the NATS subscriber. Failed notification creation does not affect account summary or other consumers.

---

## Files to Add or Change

### Backend (auth-service)

| File | Change |
|------|--------|
| `backend/auth-service/src/main.rs` | In the `event.position.closed` subscriber: (1) Parse NATS body as JSON; if top-level has `"payload"`, use that as the inner event, else use root. (2) Extract `user_id` from inner; **await only** `compute_and_cache_account_summary(pool, redis, user_id)`. (3) Extract `trigger_reason` from inner; if `"SL"` or `"TP"`, **spawn** `tokio::spawn(create_sltp_notifications_and_push(pool, redis, inner_payload))` and **do not await**. |
| `backend/auth-service/src/routes/deposits.rs` (or new module) | Add `create_sltp_notifications_and_push(pool, redis, inner_payload)`: (1) Parse and validate `user_id`, `symbol`, `side`, `trigger_reason`, `position_id`, `realized_pnl`, `exit_price` from `inner_payload` (serde_json::Value); return early if invalid. (2) Insert one notification for the user. (3) Query admins with `LIMIT` (e.g. 50). (4) For each admin, insert one notification row and publish to Redis `notifications:push` with `userId` = admin id. (5) Publish once to Redis with `userId` = trader id for the user. Use existing Redis publish pattern from deposit flows. Log errors; no panic. |

### Backend (ws-gateway)

| File | Change |
|------|--------|
| No change required | Gateway already routes by `userId` in the payload. |

### Order-engine

| File | Change |
|------|--------|
| No change required | Already publishes `event.position.closed` with `trigger_reason` for SL/TP. |

### Frontend

| File | Change |
|------|--------|
| `src/shared/ws/wsEvents.ts` | Extend `NotificationPushPayload.kind` to include e.g. `'POSITION_SL' \| 'POSITION_TP'` (or a single `'SL_TP_TRIGGER'`) so UI can distinguish. |
| Terminal (optional) | If the terminal has a notification list/bell, wire it to the same `notification.push` subscription and store; otherwise rely on existing position_update toast + admin panel bell. |
| Admin NotificationBell | No change if backend sends with `userId` = admin; existing subscription will receive the event. |

### Database

| File | Change |
|------|--------|
| No new migration | Use existing `notifications` table; new `kind` values only. |

---

## Implementation Order

1. **Auth-service**: Add helper to create SL/TP notification(s) and publish to Redis (and optionally NATS). Wire it from the existing `event.position.closed` subscriber in `main.rs`.
2. **Test**: Trigger SL/TP from order-engine, confirm notification row(s) in DB and real-time push to user and admin (e.g. via NotificationBell).
3. **Frontend**: Update `NotificationPushPayload` kinds and any UI that should display “Position closed by SL/TP” (e.g. admin panel and terminal if they show a notification list).

---

## Summary

- **Create notification**: In **auth-service** on `event.position.closed` when `trigger_reason` is `"SL"` or `"TP"`.
- **Persist**: Insert into existing `notifications` table (one row for user, one per admin if desired).
- **Real-time user**: Publish to Redis `notifications:push` with `userId` = trader; gateway already sends to that user via WebSocket (push only; no polling).
- **Real-time admin**: Publish one message per admin with `userId` = admin id; gateway sends to each admin via WebSocket (push only; no polling).
- **No polling**: Live notifications are delivered only by push (Redis → gateway → WebSocket). GET /api/notifications is for initial load only; no interval or periodic fetch for real-time.
- **Order-engine** and **ws-gateway** stay unchanged; frontend only needs small type and optional UI updates.
- **Performance**: Notification work runs in a **fire-and-forget spawned task**; the critical path only awaits `compute_and_cache_account_summary`. No impact on latency or optimization of the trading/position-closed path.

---

## Why this will work 100% and not disturb other functionality

1. **Single touch point**  
   Only the existing `event.position.closed` loop in auth-service is extended. No other handlers, subscribers, or services are modified.

2. **Correct payload handling**  
   Order-engine sends a VersionedMessage; the plan explicitly parses the inner `payload` so `user_id` and `trigger_reason` are always read correctly. Account summary continues to run; notifications run only when `trigger_reason` is SL/TP.

3. **Critical path unchanged**  
   The only awaited call in the loop remains `compute_and_cache_account_summary`. Notification work is spawned and not awaited, so it cannot block or slow the handler.

4. **Existing behaviour preserved**  
   Deposit/withdrawal notification creation, `GET /api/notifications`, gateway `broadcast_notification`, terminal position toasts, and NotificationBell logic are untouched. We only add a new code path triggered by `event.position.closed` with SL/TP.

5. **Failure isolation**  
   Errors in the spawned task are logged only; they do not affect the NATS loop, account summary, or any other functionality.

6. **No new dependencies or schema**  
   Same `notifications` table and Redis channel; no new NATS subjects or migrations. Rollback is a code-only change (skip spawn or early-return in helper).

7. **No polling for real-time**  
   Real-time delivery is **push-only**: Redis pub/sub → gateway → WebSocket. We do **not** use polling (no interval, no periodic GET /api/notifications). GET /api/notifications is for initial load only; live updates come only via WebSocket `notification.push` events.
