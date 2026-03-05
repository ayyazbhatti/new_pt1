# Plan: Admin Calls User (Select User → Call from Admin Panel)

## Overview

Implement a flow where an **admin** selects a **user** from the admin panel and initiates a **call** to that user. The user receives an **incoming call** (ring UI), can **accept** or **reject**, and the admin sees the result. This plan covers **signaling only** (call create, ring, answer, reject, end). **WebRTC media** is Phase 2.

---

## 1. User flow (high level)

1. **Admin** opens **Call user** page (`/admin/call-user`).
2. Admin **searches/selects a user** (by name, email, or ID).
3. Admin clicks **Call**.
4. **User** (if online) sees **incoming call** UI (ring + Accept / Reject).
5. User **accepts** or **rejects**.
6. **Admin** sees **Ringing…** then **Connected** (accepted) or **Declined** (rejected).
7. Either party can **End** the call; the other sees **Call ended**.

**Edge cases:**

- **User offline:** Backend sends no connections for target → admin gets `call.error` (e.g. "User offline"). Admin UI shows error and returns to Idle.
- **Admin calls self:** Backend rejects with `call.error` ("Cannot call yourself").
- **Ring timeout (60s):** Backend sends `call.ended` to admin with `ended_by: "timeout"`; admin shows "No answer".
- **User has multiple tabs:** All receive `call.incoming`. First tab to answer wins; second tab’s answer gets `call.error` ("Call not found" or "Already answered") and modal can close.
- **Admin ends while ringing:** Admin sends `call.end`; backend sends `call.ended` to user with `ended_by: "admin"`; user’s ring modal closes.

---

## 2. Backend (ws-gateway)

### 2.1 Connection must carry role

**Location:** `backend/ws-gateway/src/state/connection_registry.rs`

- Add to `Connection` struct: `pub role: String`.
- When registering a connection (in `session.rs` Auth branch), build `Connection` with `role: claims.role.clone()` (JWT `Claims` already has `role` in `auth/jwt.rs`).

This is required so that when handling `call.initiate` we can check `conn.role == "admin"` without looking up the user elsewhere.

### 2.2 Protocol (Rust) – exact shapes

**Location:** `backend/ws-gateway/src/ws/protocol.rs`

**ClientMessage** – add these variants (flat fields, no nested `payload`; serde `rename` as below):

```rust
#[serde(rename = "call.initiate")]
CallInitiate {
    target_user_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    caller_display_name: Option<String>,
},
#[serde(rename = "call.answer")]
CallAnswer { call_id: String },
#[serde(rename = "call.reject")]
CallReject { call_id: String },
#[serde(rename = "call.end")]
CallEnd { call_id: String },
```

**ServerMessage** – add these variants:

```rust
#[serde(rename = "call.incoming")]
CallIncoming {
    call_id: String,
    admin_user_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    admin_display_name: Option<String>,
},
#[serde(rename = "call.ringing")]
CallRinging { call_id: String, target_user_id: String },
#[serde(rename = "call.accepted")]
CallAccepted { call_id: String, target_user_id: String },
#[serde(rename = "call.rejected")]
CallRejected { call_id: String, target_user_id: String },
#[serde(rename = "call.ended")]
CallEnded { call_id: String, ended_by: String },
#[serde(rename = "call.error")]
CallError {
    call_id: Option<String>,
    code: String,
    message: String,
},
```

**Wire format (JSON):**

- Client sends: `{ "type": "call.initiate", "target_user_id": "...", "caller_display_name": "Optional Name" }` (and similarly flat for answer/reject/end).
- Server sends: e.g. `{ "type": "call.incoming", "call_id": "...", "admin_user_id": "...", "admin_display_name": "..." }`.

### 2.3 Call registry (in-memory)

**New file:** `backend/ws-gateway/src/state/call_registry.rs`

**New module:** In `backend/ws-gateway/src/state/mod.rs` add: `pub mod call_registry;`

**CallState:**

- `call_id: String`
- `admin_user_id: String`
- `target_user_id: String`
- `status: CallStatus` where `CallStatus` is enum `Ringing | Accepted`
- `created_at: std::time::Instant` (for ring timeout)

**CallRegistry:**

- `Arc<DashMap<String, CallState>>` (key = call_id). Using DashMap allows updating a call’s status in place (e.g. Ringing → Accepted) via `get_mut`.
- Methods:
  - `insert(state: CallState)` – insert and optionally spawn ring-timeout task (see below).
  - `get(call_id: &str) -> Option<CallState>`
  - `remove(call_id: &str) -> Option<CallState>`
  - `remove_if_ringing(call_id: &str) -> Option<CallState>` – remove only if status is Ringing (for timeout; so we don’t remove an already accepted call).

**Ring timeout (60s):**

- When inserting a new call with status Ringing, spawn a task that:
  - Sleeps 60 seconds.
  - Calls `remove_if_ringing(call_id)`.
  - If it returns `Some(state)`, send `ServerMessage::CallEnded { call_id, ended_by: "timeout" }` to **admin** (all connections for `state.admin_user_id`) and optionally to **user** (all connections for `state.target_user_id`), using the same “send to user” mechanism below.
- The task needs: `CallRegistry` (clone/Arc), `Broadcaster`, `ConnectionRegistry`. So either pass these into the spawn from session, or have `CallRegistry` hold `Arc<Broadcaster>` and `Arc<ConnectionRegistry>` and a method `spawn_ring_timeout(&self, call_id, duration_secs)` that spawns the task. Prefer passing from session to avoid circular refs: from session, after insert, spawn `tokio::spawn(async move { ... })` with `call_registry.clone()`, `broadcaster.clone()`, `registry.clone()`.

### 2.4 Sending to arbitrary user connections

**Location:** `backend/ws-gateway/src/stream/broadcaster.rs`

- Add public method: `pub fn send_to_connections(&self, conn_ids: &[Uuid], msg: ServerMessage)`.
- Implementation: for each `conn_id` in `conn_ids`, get `connection_txs.get(conn_id)` and if `Some(tx)`, `let _ = tx.send(msg.clone());` (ignore send errors; connection may already be closed).
- `ServerMessage` already derives `Clone`.

Session will then: get `conn_ids = registry.get_user_connections(user_id)` and call `broadcaster.send_to_connections(&conn_ids, msg)`.

### 2.5 AppState and Session wiring

**Location:** `backend/ws-gateway/src/ws/server.rs`

- Add to `AppState`: `pub call_registry: Arc<CallRegistry>`.
- In `Session::new`, add parameter `call_registry: Arc<CallRegistry>` and store it.
- In `main.rs`:
  - `let call_registry = Arc::new(CallRegistry::new());`
  - Add `call_registry: call_registry.clone()` to `app_state`.
- In `ws_handler`, pass `state.call_registry.clone()` into `Session::new(...)`.

### 2.6 Session handler – full logic

**Location:** `backend/ws-gateway/src/ws/session.rs`

- Session must have: `call_registry: Arc<CallRegistry>` (and already has `registry`, `broadcaster`, `response_tx_clone` for current connection).

**All call handlers require the connection to be authenticated:** at the start of handling each call message, `let conn = match registry.get(&conn_id) { Some(c) => c, None => { send call.error "Not authenticated"; continue } };`. Then use `conn.user_id` and `conn.role`.

**CallInitiate:**

1. Get `conn`; require `conn.role == "admin"` (else send `call.error` "Only admins can initiate calls", continue).
2. Require `target_user_id != conn.user_id` (else send `call.error` "Cannot call yourself", continue).
3. `let call_id = Uuid::new_v4().to_string();`
4. Insert `CallState { call_id, admin_user_id: conn.user_id.clone(), target_user_id, status: Ringing, created_at: Instant::now() }` into call_registry.
5. `let target_conn_ids = registry.get_user_connections(&target_user_id);`
6. If `target_conn_ids.is_empty()`: send to **current** connection (response_tx_clone) `CallError { call_id: Some(call_id), code: "USER_OFFLINE", message: "User is offline" }`, remove the call from registry, continue.
7. Else: `broadcaster.send_to_connections(&target_conn_ids, CallIncoming { call_id, admin_user_id: conn.user_id.clone(), admin_display_name: caller_display_name });`
8. Send to **current** connection `CallRinging { call_id, target_user_id }`.
9. Spawn ring timeout task (60s) as in 2.3.

**CallAnswer:**

1. Get `conn`. Get call: `let state = call_registry.get(&call_id)`; if None, send to current `CallError { call_id: Some(call_id), code: "CALL_NOT_FOUND", message: "Call not found or already ended" }`, continue.
2. Require `state.target_user_id == conn.user_id` (else send `call.error` "Not authorized").
3. Require `state.status == Ringing` (else send `call.error` "Already answered" for duplicate answer from second tab).
4. Update state to `Accepted` (if CallState is mutable in the map, or remove and re-insert with Accepted).
5. Send `CallAccepted { call_id, target_user_id }` to admin: `broadcaster.send_to_connections(&registry.get_user_connections(&state.admin_user_id), ...)`.
6. Do **not** remove the call from registry (so `call.end` can find it later).

**CallReject:**

1. Get `conn`, get call; if None or not target_user_id, send error and continue.
2. Send `CallRejected { call_id, target_user_id }` to admin (all admin connections).
3. Remove call from registry.

**CallEnd:**

1. Get `conn`, get call; if None, send `call.error` to current and continue.
2. Require `conn.user_id == state.admin_user_id || conn.user_id == state.target_user_id` (else send error).
3. Send `CallEnded { call_id, ended_by: if conn.user_id == state.admin_user_id { "admin" } else { "user" } }` to **both** admin and target: get both connection lists and send to all.
4. Remove call from registry.

### 2.7 Validation

**Location:** `backend/ws-gateway/src/validation/message_validation.rs`

- In `validate_message`, add branches for:
  - `ClientMessage::CallInitiate { target_user_id, .. }`: require `!target_user_id.is_empty()` and `target_user_id.len() <= 128`.
  - `ClientMessage::CallAnswer { call_id }` / `CallReject { call_id }` / `CallEnd { call_id }`: require `!call_id.is_empty()` and that `call_id` parses as UUID (e.g. `uuid::Uuid::parse_str(call_id).is_ok()`).

---

## 3. Frontend

### 3.1 WebSocket event types (TypeScript)

**Location:** `src/shared/ws/wsEvents.ts`

**Extend `WsOutboundEvent`** (client → server; flat fields to match backend):

```ts
| { type: 'call.initiate'; target_user_id: string; caller_display_name?: string }
| { type: 'call.answer'; call_id: string }
| { type: 'call.reject'; call_id: string }
| { type: 'call.end'; call_id: string }
```

**Extend `WsInboundEvent`** (server → client):

```ts
| { type: 'call.incoming'; call_id: string; admin_user_id: string; admin_display_name?: string }
| { type: 'call.ringing'; call_id: string; target_user_id: string }
| { type: 'call.accepted'; call_id: string; target_user_id: string }
| { type: 'call.rejected'; call_id: string; target_user_id: string }
| { type: 'call.ended'; call_id: string; ended_by: string }
| { type: 'call.error'; call_id?: string; code: string; message: string }
```

**Sending from frontend:** Use the same shape as backend expects, e.g. `wsClient.send({ type: 'call.initiate', target_user_id: selectedUser.id, caller_display_name: user?.name ?? undefined })`. No `payload` wrapper; top-level fields only. `wsClient.send(event)` already accepts `WsOutboundEvent` and sends when authenticated; no change needed in `wsClient.ts` except that the new event types are part of the union.

### 3.2 Admin: “Call user” page

**Route:** `/admin/call-user`

**Files:**

- **Page:** `src/features/adminCalls/pages/AdminCallUserPage.tsx` (or `src/features/admin/callUser/AdminCallUserPage.tsx`).
- **Route:** In `src/app/router/adminRoutes.tsx` add: `{ path: '/admin/call-user', element: <AdminCallUserPage /> }`.
- **Nav:** In `src/app/config/nav.ts`, add to `adminNavItems` array:  
  `{ label: 'Call user', path: '/admin/call-user', icon: Phone, permission: 'support:view' }`  
  (import `Phone` from `lucide-react`).

**User search:**

- Use existing API: `searchUsersForAppointment(q: string, limit?: number)` from `@/features/appointments/api/appointments.api`. It returns `Promise<UserSearchResult[]>` with `{ id, email, first_name?, last_name?, full_name? }`.
- UI: search input (debounced), list of results; on select, show selected user and a **Call** button.

**Page state:**

- `status: 'idle' | 'ringing' | 'connected' | 'declined' | 'error'`
- `currentCallId: string | null`
- `targetUserId: string | null` (for display)
- `errorMessage: string | null` (for call.error)

**WS subscription:**

- On mount: `const unsub = wsClient.subscribe((event) => { ... })`. In the handler:
  - `call.ringing` → set status `ringing`, store `call_id` and `target_user_id` from payload.
  - `call.accepted` → set status `connected`.
  - `call.rejected` → set status `declined`.
  - `call.ended` → reset to `idle`, clear `currentCallId` / `targetUserId` (and if `ended_by === 'timeout'`, optionally set a short “No answer” message).
  - `call.error` → set status `error`, set `errorMessage` from payload; reset to idle after a few seconds or on dismiss.
- On unmount: call `unsub()`.

**Actions:**

- **Call:** `wsClient.send({ type: 'call.initiate', target_user_id: selectedUser.id, caller_display_name: useAuthStore.getState().user?.name })`. Set status to `ringing` optimistically and store `currentCallId` (you don’t have it until `call.ringing`; so either wait for `call.ringing` to set call_id, or backend could echo call_id in a separate field – plan assumes we set `currentCallId` from `call.ringing` payload).
- **End call:** when status is `connected`, `wsClient.send({ type: 'call.end', call_id: currentCallId })`; then reset to idle on `call.ended`.

**UI:**

- Idle: user search + selected user + Call button.
- Ringing: “Ringing…” and optional Cancel (Cancel = send `call.end` so backend sends `call.ended` to user and they stop ringing).
- Connected: “Connected to [user]” + End call button.
- Declined: “User declined” then back to idle.
- Error: show `errorMessage`, then idle.

### 3.3 User: Incoming call (ring UI)

**Location:** Must be visible on every user page → integrate in **UserLayout**.

**Files:**

- **Component:** `src/features/call/components/IncomingCallModal.tsx` (or `src/features/userCall/IncomingCallModal.tsx`).
- **Store or context:** A small store (e.g. Zustand) or React context to hold:
  - `incomingCall: { call_id, admin_user_id, admin_display_name } | null`
  - `activeCallId: string | null` (when user has accepted, so we show “In call” bar with End).
- **Layout:** In `src/shared/layout/UserLayout.tsx`, render a **provider** or a component that:
  - Subscribes to `wsClient.subscribe(...)`.
  - On `call.incoming`: set `incomingCall` to the payload (call_id, admin_user_id, admin_display_name).
  - On `call.ended`: clear `incomingCall` and `activeCallId`.
  - Renders `<IncomingCallModal />` when `incomingCall` is set (ring UI) and optionally a small “In call” bar when `activeCallId` is set (with End button).

**IncomingCallModal:**

- Title: “Incoming call from [admin_display_name ?? 'Admin']”.
- Buttons: **Accept**, **Reject**.
- **Accept:** `wsClient.send({ type: 'call.answer', call_id: incomingCall.call_id })`; then set `activeCallId = call_id`, clear `incomingCall` (close ring modal), show “In call” bar.
- **Reject:** `wsClient.send({ type: 'call.reject', call_id: incomingCall.call_id })`; clear `incomingCall`.
- When `call.ended` is received while modal is open (e.g. admin cancelled), clear `incomingCall` and close modal.

**In-call bar (user side):**

- When `activeCallId` is set: show “Call connected” and **End** button. On End: `wsClient.send({ type: 'call.end', call_id: activeCallId })`; on `call.ended` clear `activeCallId`.

**Important:** The WS subscriber that sets `incomingCall` / `activeCallId` must live in a component that is always mounted when the user is in the user panel (e.g. UserLayout). So either put the subscription and state in UserLayout, or in a `<UserCallProvider>` that wraps `children` in UserLayout and provides context to `IncomingCallModal` and the in-call bar.

### 3.4 WS client

**Location:** `src/shared/ws/wsClient.ts`

- No code change required. `send(event: WsOutboundEvent)` already sends any event when `isAuthenticated && state === 'authenticated'`. The new call events are part of `WsOutboundEvent` and will be sent as JSON. Ensure the JSON shape matches backend (flat: `type`, `target_user_id`, `call_id`, etc.).

---

## 4. Implementation order (checklist)

### Backend

1. [ ] **Connection role:** Add `role: String` to `Connection` in `connection_registry.rs`. In `session.rs` Auth branch, set `role: claims.role.clone()` when building `Connection`.
2. [ ] **Protocol:** In `protocol.rs`, add all `ClientMessage` and `ServerMessage` variants with correct serde renames.
3. [ ] **CallRegistry:** Create `state/call_registry.rs` with `CallState`, `CallStatus`, `CallRegistry` (insert, get, remove, remove_if_ringing). Export in `state/mod.rs`.
4. [ ] **Broadcaster:** Add `send_to_connections(conn_ids, msg)` in `broadcaster.rs`.
5. [ ] **AppState and main:** Add `call_registry` to `AppState` in `ws/server.rs`; in `main.rs` create `CallRegistry`, add to state; pass `call_registry` into `Session::new` in ws_handler.
6. [ ] **Session handlers:** Implement CallInitiate (with admin check, no self-call, user offline check, ring timeout spawn), CallAnswer, CallReject, CallEnd. Use `response_tx_clone` for current connection and `broadcaster.send_to_connections` for other user(s).
7. [ ] **Validation:** In `message_validation.rs`, add validation for CallInitiate (target_user_id non-empty, len ≤ 128) and for CallAnswer/CallReject/CallEnd (call_id non-empty, valid UUID).

### Frontend

8. [ ] **Types:** In `wsEvents.ts`, add all call event types to `WsOutboundEvent` and `WsInboundEvent`.
9. [ ] **Admin page:** Create `AdminCallUserPage.tsx` with user search (`searchUsersForAppointment`), Call button, state machine (idle/ringing/connected/declined/error), WS subscribe for call.ringing/accepted/rejected/ended/error, End call button.
10. [ ] **Route and nav:** Add `/admin/call-user` route in `adminRoutes.tsx`; add “Call user” to `adminNavItems` in `src/app/config/nav.ts` with Phone icon.
11. [ ] **User ring UI:** Create `IncomingCallModal` and call state (store or context); in UserLayout add provider/subscription that sets incoming call and active call state; on call.incoming show modal (Accept/Reject); on accept send call.answer and show “In call” bar with End; on reject send call.reject; on call.ended clear state.

### Polish

12. [ ] **Ring timeout:** Backend spawns 60s task and sends `call.ended` with `ended_by: "timeout"` to admin (and optionally user). Admin UI on `call.ended` with ended_by timeout shows “No answer” then idle.
13. [ ] Optional: Admin “Cancel” while ringing = send `call.end` so user’s ring stops.

---

## 5. Edge cases summary

| Scenario | Backend | Frontend (admin) | Frontend (user) |
|----------|---------|------------------|-----------------|
| User offline | Send `call.error` to admin, remove call | Show error, idle | — |
| Admin calls self | Send `call.error` | Show error, idle | — |
| Ring 60s timeout | Send `call.ended` to admin (ended_by: timeout) | Show “No answer”, idle | If we send to user too, close modal |
| User rejects | Send `call.rejected` to admin, remove call | Show declined, idle | Modal closes |
| User accepts (second tab) | Send `call.error` to second tab | — | Second tab: show error, close |
| Admin ends while ringing | Send `call.ended` to user (ended_by: admin) | Idle | Close ring modal |

---

## 6. Optional: WebRTC (Phase 2)

- After signaling works: add message types for SDP (offer/answer) and ICE candidates, routed by `call_id` to the other peer. Backend only forwards; no media. This plan does not implement WebRTC.

---

## 7. Summary

| Area | What to do |
|------|------------|
| **Backend** | Connection.role; CallRegistry + ring timeout; protocol.rs (all call message types); Broadcaster.send_to_connections; Session handlers (initiate/answer/reject/end); validation. |
| **Admin** | New page `/admin/call-user`, user search via searchUsersForAppointment, Call/End, WS events; route + nav. |
| **User** | IncomingCallModal + in-call bar in UserLayout; WS subscription for call.incoming/ended; Accept/Reject/End. |
| **Types** | wsEvents.ts: WsOutboundEvent and WsInboundEvent extended with call events (flat fields). |

This plan is complete and implementation-ready. After implementation, you can run through the checklist and the edge cases to verify end-to-end behavior.

---

## 8. Safety: no impact on existing functionality or performance

The following guarantees ensure that this feature does not affect existing behaviour or speed.

### 8.1 Existing functionality – unchanged

| Area | What stays the same |
|------|---------------------|
| **Backend protocol** | Existing `ClientMessage` variants (auth, subscribe, unsubscribe, ping) and all `ServerMessage` variants (tick, order_update, position_update, deposit.*, notification.push, wallet.balance.updated, etc.) are **not modified**. Only **new** enum variants are added. Old clients and existing Redis-driven broadcasts continue to work exactly as today. |
| **Session message handling** | Call logic is added only as **new** `match` arms. The existing arms for Auth, Subscribe, Unsubscribe, Ping are **not changed**. Parsing and validation for existing message types are unchanged. |
| **ConnectionRegistry** | Only one change: add optional field `role` to `Connection`. All existing uses (get, get_user_connections, subscribe_symbol, unregister, etc.) only read `user_id` / `conn_id` / `group_id` / `subscriptions`; they do not depend on the absence of `role`. Register is only called in one place (Auth branch); we add `role` there. No other call sites are modified. |
| **Broadcaster** | The existing Redis receive loop and all `handle_message` / `broadcast_*` branches (price:ticks, orders:updates, positions:updates, deposits, notifications, wallet, account summary) are **not modified**. We only **add** a new method `send_to_connections`, which is called **only** from the new call handlers. |
| **Validation** | New validation branches are added only for the new `ClientMessage` variants. Existing validation for Auth, Subscribe, Unsubscribe, Ping is **unchanged**. |
| **Frontend routes & nav** | We **add** one route and one nav item. All existing admin/user routes and nav items stay as they are. |
| **Frontend WS** | We **extend** `WsOutboundEvent` and `WsInboundEvent` with new event types. Existing event types and `wsClient` send/subscribe logic are **unchanged**. No existing handler is modified; we only **add** new subscribers that react to `call.*` events. |
| **User layout** | We add a **new** child (provider/modal) and a **new** WS subscription. Existing UserLayout structure and other children are **unchanged**. |

### 8.2 Performance / optimization – no impact on hot paths

| Area | Why there is no slowdown |
|------|---------------------------|
| **Backend – hot path** | The hot path is: Redis → Broadcaster → `handle_message` → `broadcast_tick` / `broadcast_order_update` / etc. **None of that is changed.** Call handling runs only when a client sends a `call.*` message (rare). No extra work on tick, order, or position updates. |
| **Backend – Connection** | One extra `String` field per connection and one `clone()` at register time. No extra work in `get_user_connections`, symbol subscribe, or heartbeat. |
| **Backend – CallRegistry** | Used only inside the new call handlers. Not touched by Redis, broadcaster loop, or any existing message type. |
| **Backend – Ring timeout** | One spawned task per **call** (only when admin initiates). No timers or work when there is no call. |
| **Frontend – WS dispatch** | `wsClient` already calls every subscribed handler for every message. We add **one** handler (e.g. in UserLayout for user panel). To keep cost minimal: in that handler, **return immediately** if `event.type` is not one of the six call types (e.g. `call.incoming`, `call.ended`, …). So for non-call messages we do a single type check and return; no state updates, no re-renders. |
| **Frontend – Admin call page** | The call WS handler and state live only on `/admin/call-user`. When the admin is on any other page, that component is unmounted and the handler is removed. So no extra handler runs for admin on other pages. |
| **Frontend – Re-renders** | Call-related state (incoming call, active call) updates **only** on `call.*` events. Other WS messages (ticks, wallet, notifications, etc.) do not touch this state, so they do not cause re-renders in the call UI. |

### 8.3 Implementation rules (must follow)

When implementing, adhere to these rules so that safety and performance guarantees hold:

1. **Backend**  
   - Do **not** change any existing `match` arm in `session.rs` (Auth, Subscribe, Unsubscribe, Ping). Only **add** new arms for CallInitiate, CallAnswer, CallReject, CallEnd.  
   - Do **not** change `handle_message` or any `broadcast_*` function in `broadcaster.rs`. Only **add** `send_to_connections`.  
   - Do **not** change existing validation branches in `message_validation.rs`. Only **add** branches for the new client message types.

2. **Frontend – user call handler**  
   - In the WS handler that handles call events (e.g. in UserLayout or UserCallProvider), **first** check: if the event type is not one of `call.incoming`, `call.ringing`, `call.accepted`, `call.rejected`, `call.ended`, `call.error`, **return immediately** without updating state or calling setters. This keeps work per non-call message to a single type check.

3. **Frontend – admin call page**  
   - Subscribe to `wsClient` only when the AdminCallUserPage (or its wrapper) is mounted, and **unsubscribe on unmount** so that when the admin navigates away, the handler is removed.

4. **Connection.role**  
   - Set `role` only in the single place where `Connection` is created (Auth branch in session). Do not add any new code paths that depend on `role` for non-call behaviour.

Following this section and the implementation checklist ensures that existing functionality and optimization/speed are preserved.
