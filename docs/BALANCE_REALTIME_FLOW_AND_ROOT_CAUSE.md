# Real-time balance flow and root cause (admin approve → user balance not updating)

## Step-by-step flow

### Step 1: Admin approves deposit (auth-service)
- **Where:** `backend/auth-service/src/routes/deposits.rs` → `approve_deposit()`
- **What:** Transaction status set to `approved`, ledger entry created, wallet balance recalculated (total deposits − withdrawals), then:
  - NATS publish: `wallet.balance.updated` with payload containing **`userId`** = the real user’s UUID (e.g. `9c2100e2-29cf-4c72-953f-c1d52be7162b`)
  - Redis publish for other consumers
  - Account summary cache updated
- **Payload shape:** `{ "userId": "<uuid>", "balance", "available", "currency", ... }`

### Step 2: NATS delivers to gateway-ws
- **Where:** `apps/gateway-ws/src/main.rs` → `forward_events()` subscribes to `"wallet.balance.updated"`.
- **What:** When NATS receives the message, `process_event_message()` runs. It parses the payload and gets **`event_user_id`** from `payload.userId`.

### Step 3: Gateway decides which WebSocket sessions get the message
- **Where:** Same file, `process_event_message()` → branch `"wallet.balance.updated"`.
- **Logic:** For each session:
  - It compares **`event_user_id`** (from NATS payload) to **`session.user_id`** (set when the client authenticated over WebSocket).
  - It checks subscription: session must have `"balances"` or `"wallet"` (or `"notifications"`).
  - **Only if** `event_user_id == session.user_id` **and** the session has the subscription does it send the message to that connection.

### Step 4: Where session.user_id is set
- **Where:** `apps/gateway-ws/src/main.rs` → `handle_socket()` → on client message `WsClientMessage::TypeAuth { token, .. }` (or `OpAuth`).
- **Current code (bug):**
  ```rust
  WsClientMessage::TypeAuth { token: _, .. } | WsClientMessage::OpAuth { token: _, .. } => {
      // TODO: Validate JWT token
      let user_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap();
      session.user_id = Some(user_id);
      // ...
  }
  ```
- So **every** authenticated WebSocket session gets **`session.user_id = 00000000-0000-0000-0000-000000000001`**. The JWT is ignored; the real user id from the token (e.g. `sub` = `9c2100e2-...`) is never used.

### Step 5: Why the user never gets the update
- NATS payload has **`userId`** = `9c2100e2-29cf-4c72-953f-c1d52be7162b` (real user).
- Session for that user has **`session.user_id`** = `00000000-0000-0000-0000-000000000001` (hardcoded).
- In the gateway: **`event_user_id == user_id`** → `9c2100e2-... == 00000000-...` → **false**.
- So the gateway **skips** forwarding (logs “Skipping wallet.balance.updated - user mismatch”).
- The frontend never receives `wallet.balance.updated` → **balance does not update in real time**.

### Step 6: Frontend (already correct)
- **Where:** `src/features/terminal/components/LeftSidebar.tsx` → `useWebSocketSubscription()` handles `wallet.balance.updated` and updates the wallet store.
- **Conclusion:** Frontend is fine; it never gets the event because the gateway never sends it.

---

## Root cause (exact)

**In `apps/gateway-ws/src/main.rs`, the WebSocket auth handler does not validate the JWT and does not set `session.user_id` from the token. It always sets a hardcoded `user_id` (`00000000-0000-0000-0000-000000000001`).**

Therefore:

1. Every WebSocket session is associated with the same fake user id.
2. When auth-service (or any service) publishes `wallet.balance.updated` to NATS with the **real** user id (e.g. `9c2100e2-...`), the gateway compares it to **session.user_id**.
3. For the real user’s session, **session.user_id** is the hardcoded UUID, not the real one, so **event_user_id ≠ session.user_id**.
4. The gateway therefore never forwards `wallet.balance.updated` to that user’s connection, so the balance does not update in real time when admin approves a request.

**Fix (implemented):** In gateway-ws, the WebSocket auth handler now validates the JWT (using `JWT_SECRET`, same as auth-service), decodes the `sub` claim as the user’s UUID, and sets **`session.user_id = Some(claims.sub)`**. The session is then written back to the shared map so the event forwarder sees the correct user id. Balance updates for that user are delivered to their WebSocket and the UI updates in real time.

### Configuration required

**gateway-ws** must have **`JWT_SECRET`** set to the **same value** as auth-service. Otherwise WebSocket auth will fail (auth_error) and real-time balance will not work.

- Example: `JWT_SECRET=dev-jwt-secret-key-change-in-production-minimum-32-characters-long`
- When running gateway-ws (e.g. `PORT=8090 cargo run -p gateway-ws`), set `JWT_SECRET` in the environment or in a `.env` file.
- If you use `scripts/start-all.sh`, it sources `.env` from the repo root; ensure `JWT_SECRET` is defined there (same as auth-service).

### If balance still does not update in real time

1. **Restart gateway-ws** after pulling the JWT fix so it runs the new binary.
2. **Confirm JWT_SECRET** is set for gateway-ws (same as auth-service). On startup you should see: `JWT_SECRET is set (real-time balance and WebSocket auth enabled)`.
3. **Confirm the user’s tab is connected** to this gateway (e.g. `ws://localhost:8090/ws` or via Vite proxy). Check browser Network tab: WS connection and that auth succeeds (no `auth_error`).
4. **Check gateway logs** when admin approves:
   - You should see `📨 Received wallet.balance.updated event from NATS` and either `✅ Forwarded wallet.balance.updated to session ...` or `⏭️ Skipping wallet.balance.updated - user mismatch ...`. If you see “user mismatch”, the session’s user id does not match the event (old gateway binary or JWT_SECRET mismatch). If you never see “Received wallet.balance.updated”, NATS is not delivering (check NATS_URL and that auth-service and gateway-ws use the same NATS).
5. **Admin approval path**: real-time balance is published when approval goes through **auth-service** (e.g. `/api/admin/finance/transactions/:id/approve` or deposit approve). If approval is done via another service that does not publish `wallet.balance.updated` to NATS, the gateway will not receive it.
