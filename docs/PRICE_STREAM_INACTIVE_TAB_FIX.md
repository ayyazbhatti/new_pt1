# Price stream inactive-tab fix — validated solution

## Problem

When the trading terminal tab is inactive for several minutes, live symbol prices stop updating. A full page refresh is required to restore data.

## Root cause (verified)

- **ws-gateway** runs a heartbeat monitor every 60s and unregisters connections whose `last_heartbeat` is older than `CONNECTION_TIMEOUT_SECS` (default **300 s**). Unregistered connections no longer receive `price:ticks`.
- **Heartbeat** is updated only on: connection register, subscribe, **client JSON `ping`**, or WebSocket Pong.
- **priceStreamClient** never sends ping, so after ~5 minutes the server stops delivering ticks while the client still has an open socket (no `onclose`, no reconnect).

---

## Solution: client keepalive ping (gateway only)

Send a JSON `{ type: "ping" }` from the price stream client to the gateway at a fixed interval **only when using the gateway** (authenticated). No server or data-provider changes.

### Why this is safe and does not disturb existing behaviour

| Check | Result |
|------|--------|
| **Gateway protocol** | `ClientMessage::Ping` is defined in `backend/ws-gateway/src/ws/protocol.rs` (line 18–19). Session handler in `session.rs` (273–278) calls `registry.update_heartbeat(conn_id)` and sends `ServerMessage::Pong`. No auth check for Ping; if conn is not yet registered, `update_heartbeat` is a no-op. |
| **Validation** | `backend/ws-gateway/src/validation/message_validation.rs` (63–65): `ClientMessage::Ping` has “No validation needed” and passes. |
| **Data-provider** | Ping is sent **only** when `isGatewayUrl(getEffectiveUrl())` is true. When `VITE_DATA_PROVIDER_WS_URL` is set, client uses data-provider URL and we **do not** start the ping timer. No extra messages to data-provider. |
| **Auth flow** | Ping timer is started **only after** `auth_success` in gateway mode. So we never ping before registration; first ping happens when connection is already registered and can receive ticks. |
| **Reconnect** | On `onclose`, we clear the ping timer. After reconnect, in gateway mode we get `auth_success` again and (re)start the timer. No duplicate timers. |
| **disconnect()** | Timer is cleared in `disconnect()` so no ping is sent after explicit disconnect. |
| **Existing messages** | We only **add** sending of `{ type: "ping" }`. We do not change auth, subscribe, or tick handling. Server response `{ type: "pong" }` is ignored by current `onmessage` (no handler), which is correct. |
| **Single connection** | Single `priceStreamClient` instance; single ping timer per connection lifecycle. |

### Implementation details (priceStreamClient.ts)

1. **New private state**
   - `private pingIntervalId: ReturnType<typeof setInterval> | null = null`
   - Or use `setTimeout` and reschedule (avoids long-lived intervals in background tabs if desired); either is valid.

2. **Start ping (gateway only, after authenticated)**
   - In `onmessage`, when `data.type === 'auth_success'`: if `isGatewayUrl(this.getEffectiveUrl())`, call a new method `this.startPingLoop()`.
   - In `onopen`, when **not** gateway mode (data-provider): we already re-subscribe; do **not** start any ping.

3. **startPingLoop()**
   - Clear any existing ping timer first (`if (this.pingIntervalId) { clearInterval(this.pingIntervalId); this.pingIntervalId = null }`).
   - Set interval (e.g. **60 seconds**): callback that checks `this.ws?.readyState === WebSocket.OPEN` and, if true, sends `JSON.stringify({ type: 'ping' })`. Store id in `this.pingIntervalId`.

4. **Stop ping**
   - In `onclose`: clear the ping timer and set `this.pingIntervalId = null`.
   - In `disconnect()`: same (clear timer, set to null).

5. **Constants**
   - Ping interval: **60_000** ms (60 s). Well below 300 s timeout; no need to change server config.

### What we do not change

- **usePriceStream / usePriceStreamConnection / useSymbolPrice**: no changes.
- **AppShellTerminal / LeftSidebar**: no changes (optional visibility-based re-subscribe can be a separate, later step).
- **Gateway**: no code or config change required.
- **Data-provider**: no code change; client does not send ping to it.

---

## Implementation checklist

- [ ] **priceStreamClient.ts**
  - [ ] Add `pingIntervalId` (or equivalent) and `PING_INTERVAL_MS = 60_000`.
  - [ ] Add `startPingLoop()`: clear existing timer; set interval to send `{ type: 'ping' }` when `this.ws?.readyState === WebSocket.OPEN`.
  - [ ] Add `stopPingLoop()`: clear timer, set ref to null.
  - [ ] In `onmessage` on `auth_success`: if `isGatewayUrl(this.getEffectiveUrl())`, call `startPingLoop()`.
  - [ ] In `onclose`: call `stopPingLoop()`.
  - [ ] In `disconnect()`: call `stopPingLoop()`.
- [ ] **Manual test**
  - [ ] Gateway mode: open terminal, wait for prices; switch tab for 6+ minutes; return — prices keep updating without refresh.
  - [ ] Data-provider mode (if used): set `VITE_DATA_PROVIDER_WS_URL`, confirm prices still work and no errors in network/console.
  - [ ] Reconnect: disconnect network briefly, reconnect — prices resume after reconnection and re-subscribe.
  - [ ] Logout/refresh: no timer leaks (e.g. disconnect or navigation clears timer).

---

## Config reference (ws-gateway)

| Env | Default | Purpose |
|-----|---------|--------|
| `CONNECTION_TIMEOUT_SECS` | 300 | Max age of `last_heartbeat` before connection is unregistered. |
| `HEARTBEAT_INTERVAL_SECS` | 30 | Not used by this client; client uses 60 s ping. |

Client sends ping every 60 s, so at least 5 pings within 300 s. No server config change needed.

---

## Optional (later): visibility-based recovery

If you want extra resilience (e.g. browser throttles timers in background), you can add: on `document.visibilityState === 'visible'`, call `triggerResubscribe()` from `usePriceStream` so subscription is re-sent. This is optional and can be done in a follow-up; the ping alone addresses the 5-minute server timeout.
