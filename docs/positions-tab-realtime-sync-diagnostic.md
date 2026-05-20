# Positions tab realtime sync — end-to-end diagnostic

Read-only trace of how a new open position reaches the terminal **Positions** tab after a market fill, why it can appear **immediately or only after reload**, and ranked failure modes. **No code was modified.**

## Files read (primary evidence)

| Area | Paths |
|------|--------|
| Terminal UI | `src/features/terminal/components/BottomDock.tsx`, `src/features/terminal/components/TerminalPositionsView.tsx`, `src/features/terminal/api/positions.api.ts` |
| Global WS | `src/shared/ws/wsClient.ts`, `src/shared/ws/wsEvents.ts` (grep) |
| Account summary hook | `src/features/wallet/hooks/useAccountSummary.ts` |
| ws-gateway | `backend/ws-gateway/src/main.rs`, `backend/ws-gateway/src/stream/broadcaster.rs`, `backend/ws-gateway/src/state/connection_registry.rs`, `backend/ws-gateway/src/ws/session.rs`, `backend/ws-gateway/src/ws/protocol.rs`, `backend/ws-gateway/src/ws/server.rs` |
| Order engine | `apps/order-engine/src/engine/order_handler.rs`, `apps/order-engine/src/engine/tick_handler.rs`, `apps/order-engine/src/engine/position_handler.rs` (partial — Redis `positions:updates` on close path), `apps/order-engine/src/engine/position_events.rs`, `apps/order-engine/src/subjects.rs` |
| Auth service | `backend/auth-service/src/services/position_event_handler.rs`, `backend/auth-service/src/services/order_event_handler.rs` (partial), `backend/auth-service/src/routes/deposits.rs` (`get_user_positions`, `compute_and_cache_account_summary*`, `AccountSummaryCoordinator`) |
| Redis keys | `crates/redis-model/src/keys.rs` |

---

## 1. Positions tab component

- **Primary component:** `src/features/terminal/components/BottomDock.tsx` — renders the bottom-dock **Positions** table/cards when `tabForContent === 'positions'` (desktop) or when `standaloneTab === 'positions'` from mobile wrapper `src/features/terminal/components/TerminalPositionsView.tsx`.
- **State for the open-positions array:** React `useState<Position[]>([])` — `positions` / `setPositions` (not React Query, not Zustand for the list body).
- **Data sources:**
  - **REST:** `fetchOpenPositions` → `getOpenPositions()` in `src/features/terminal/api/positions.api.ts` (`GET /v1/users/{id}/positions?status=open`).
  - **WebSocket (dedicated):** same file’s `useEffect` opens `new WebSocket(wsUrl)`; `onmessage` updates `positions` on `position_update` and triggers refetches on `order_update` when status is terminal (incl. `FILLED`).
- **`useAccountSummary`:** used for header/summary numbers only; it does **not** drive the `positions` array.
- **Empty vs populated:** Desktop/mobile branches use `positionsLoading` for skeleton vs content. Open rows are derived from `positions.filter(p => p.status === 'OPEN')` inside `openPositionsWithComputed` (`useMemo`). A visible “no positions” style path exists where `positions.length === 0` (e.g. around line ~1000 in `BottomDock.tsx` for a combined empty state with orders context).

---

## 2. Initial fetch on mount

- **Endpoint:** `GET /v1/users/{userId}/positions?status=open` — built in `fetchPositionsForUser` → `getOpenPositions()` (`positions.api.ts`).
- **Caller:** `BottomDock.tsx` — `useEffect` on mount: `void fetchOpenPositions()` and `void fetchOrders()` (non-silent → sets `positionsLoading`).
- **React Query:** **Not used** for the Positions tab list in `BottomDock`. No `queryKey` / `staleTime` for positions here; `fetchOpenPositions` is plain `async` + `setPositions`.
- **Backend handler:** `get_user_positions` in `backend/auth-service/src/routes/deposits.rs` — reads **Redis** `Keys::positions_set(user_id)` → `SMEMBERS`, then for each id `HGETALL` on `Keys::position_by_id(pos_id)` (`pos:by_id:{uuid}`). **Not a Postgres-first read** for this list path.

---

## 3. Realtime update paths — all mechanisms

### Path A — BottomDock dedicated WebSocket (**Positions tab uses this**)

| Item | Detail |
|------|--------|
| **File** | `src/features/terminal/components/BottomDock.tsx` (`useEffect` ~L299+) |
| **`VITE_WS_URL`** | `import.meta.env.VITE_WS_URL \|\| (location-based ws/wss://{host}/ws?group=default) \|\| 'ws://localhost:3003/ws?group=default'` |
| **Auth** | On `onopen`, sends `{ type: 'auth', token: accessToken }` (JWT from `useAuthStore`). |
| **Subscribe** | On `auth_success`: `{ type: 'subscribe', symbols: [], channels: ['positions','orders','balances','wallet'] }`. |
| **`position_update`** | Merges by `p.id === positionId`, or appends a **placeholder** `Position` when new+`OPEN`, or removes on `CLOSED`/`LIQUIDATED`. Also schedules `setTimeout(() => { void fetchOpenPositions(true); void fetchOrders(true) }, 500)` on new open row. |
| **`order_update` / aliases** | Parses flat or nested payload; on `FILLED` calls `fetchOpenPositions(true)`, `fetchFilledOrders()`, and delayed `fetchOpenPositions(true)` (~600ms). Also tombstones pending orders. |
| **Dispatcher** | Inline `ws.onmessage` in `BottomDock.tsx` (no separate module). |

**Note:** ws-gateway `broadcast_position_update` / `broadcast_order_update` fan out to `registry.get_user_connections(user_id)` — they do **not** filter on the client `channels` list for these message types (subscription mainly affects ticks/symbol index; see §5).

### Path B — Global `wsClient` (`src/shared/ws/wsClient.ts`)

- **Regular users:** After `auth_success`, auto-subscribe sends `channels: ['balances','wallet']` only — **not** `positions` or `orders`.
- **Positions tab:** Does **not** subscribe to position rows via `wsClient`. Admin-oriented position event types exist in `wsEvents.ts` (`admin.position.*`); those are not the retail terminal dock path.
- **Backend → frontend naming:** ws-gateway emits **`position_update`** and **`order_update`** (see `ServerMessage` in `backend/ws-gateway/src/ws/protocol.rs`). NATS uses separate names (`evt.order.updated`, `evt.position.updated`, `event.position.opened`, etc.) — ws-gateway does not expose NATS subjects directly to the browser; Redis pub/sub bridges `orders:updates` / `positions:updates`.

### Path C — React Query invalidation for terminal positions

- **Grep:** No `invalidateQueries` keyed like `['positions']` for the retail `BottomDock` path. Admin modals use `['user-positions', user.id]` etc. — **not** the same as bottom dock local state.
- **Conclusion:** Terminal positions list is **not** kept fresh via query invalidation.

### Path D — Polling / intervals

- **Positions list:** No `refetchInterval` on positions (no React Query).
- **`useAccountSummary`:** `refetchInterval: 5000` in `src/features/wallet/hooks/useAccountSummary.ts` — updates **account summary cache only**; `BottomDock` does not refetch positions on that interval.
- **BottomDock:** `setInterval` used for **WebSocket ping** only (`WS_HEARTBEAT_INTERVAL_MS`), not REST polling.

---

## 4. Backend → ws-gateway position event flow (successful fill)

### 4.1 Order engine — NATS + Redis

On immediate market fill when a **new** position is created (`fill_action == "created"`), `apps/order-engine/src/engine/order_handler.rs`:

- Publishes NATS `evt.order.updated` via `nats_subjects::EVENT_ORDER_UPDATED` (`"evt.order.updated"` in `apps/order-engine/src/subjects.rs`).
- Publishes NATS `event.position.opened` (`EVENT_POSITION_OPENED` = `"event.position.opened"`).
- **`redis PUBLISH "positions:updates"`** with JSON including `user_id`, `position_id`, `symbol`, `side`, `quantity`, `status: "OPEN"`, `ts`, etc.

Then calls `position_events::publish_position_updated` → NATS **`evt.position.updated`** (`EVT_POSITION_UPDATED`).

`apps/order-engine/src/engine/tick_handler.rs` mirrors the same pattern for tick-driven fills (`created` → Redis `positions:updates` + NATS).

`apps/order-engine/src/engine/position_handler.rs` also **`PUBLISH`es `positions:updates`** on manual/position-close flows (payload shape similar; used for closed-position WS updates).

**Important gap:** When `fill_action == "flipped"` (netting flip), the engine still publishes `event.position.opened` and `publish_position_updated`, but **does not** `PUBLISH positions:updates` to Redis in the `flipped` branch (only `created` gets the Redis WS fan-out in both `order_handler.rs` and `tick_handler.rs`). After a flip, the UI depends more on **`order_update`** / delayed REST.

### 4.2 Auth-service NATS subscribers

- **`PositionEventHandler`** (`backend/auth-service/src/services/position_event_handler.rs`): consumes **`evt.position.updated`**, `sync_position_to_database`, then `compute_and_cache_account_summary` (which may publish **`account:summary:updated`** to Redis — see §4.3). This path does **not** republish `positions:updates` for ws-gateway (UNCERTAIN if any other service duplicates that).
- **`OrderEventHandler`:** On order lifecycle, `publish_order_update_to_redis` → **`PUBLISH "orders:updates"`** with nested payload (`order_event_handler.rs`). That drives **`order_update`** WS messages, not `position_update`.

### 4.3 ws-gateway Redis subscriptions

From `backend/ws-gateway/src/main.rs`, channels include: `price:ticks`, **`orders:updates`**, **`positions:updates`**, `risk:alerts`, `deposits:*`, `notifications:push`, `wallet:balance:updated`, **`account:summary:updated`**.

- **`positions:updates`:** `Broadcaster::broadcast_position_update` → `ServerMessage::PositionUpdate` → JSON type **`position_update`** (`protocol.rs`).
- **`account:summary:updated`:** `broadcast_account_summary` → type **`account.summary.updated`**.

### 4.4 Distinct WS message vs inferred

- **Distinct:** `position_update` carries `position_id`, `symbol`, `side`, `quantity`, `status`, etc. (`broadcaster.rs` + `protocol.rs`).
- **Indirect:** `account.summary.updated` updates aggregates; **`BottomDock` does not handle `account.summary.updated` on its socket** — so the Positions **table** does not refresh from that message in this component.

---

## 5. The two-WebSocket problem

| | **BottomDock `WebSocket`** | **Global `wsClient`** |
|--|---------------------------|------------------------|
| **URL** | Same pattern: `VITE_WS_URL` or `/ws?group=default` (see `BottomDock.tsx`) | Constructed at app init (same gateway pattern in practice) |
| **Auth** | `{ type: 'auth', token }` after open | Same pattern in `wsClient.connect` / `authenticateAsync` |
| **Reconnect** | Exponential backoff, max 30 attempts; stale detection closes socket if no messages > `WS_STALE_TIMEOUT_MS` | Exponential backoff, max 50 |
| **Subscriptions** | Explicit `positions`, `orders`, `balances`, `wallet` after `auth_success` | Regular user: **`balances`, `wallet` only** |
| **Position delivery** | Receives `position_update` + `order_update` if registered in `ConnectionRegistry` and outbound queue not full | **Does not** auto-subscribe to `positions`; handlers in `BottomDock` are not attached to `wsClient` for positions |

**Gateway routing:** `broadcast_position_update` uses **`get_user_connections(user_id)`** — all authenticated connections for that user receive the message **regardless** of whether `Subscribe` ran with `channels: ['positions']`. The `Subscribe` handler (`session.rs`) only populates **symbol** subscriptions for ticks (`registry.subscribe_symbol`); it does not gate `position_update` delivery.

**Race:** If **no** ws-gateway connection exists for the user when Redis publishes (`get_user_connections` empty), the message is **dropped** (no per-user Redis backlog). Reconnect + `auth_success` triggers `fetchOpenPositions(true)` in `BottomDock` to reconcile.

---

## 6. Ranked race hypotheses (a–g)

| Rank | Hypothesis | Verdict / evidence |
|------|------------|---------------------|
| **1** | **(c) REST snapshot overwrites WS-added row** | **Supported.** `fetchOpenPositions` does `setPositions(data)` — **full replace**. Flow: `position_update` appends placeholder row → `setTimeout(..., 500)` or `auth_success` / `FILLED` refetch runs while Redis `pos:{user}` set is still momentarily stale → response **omits** new id → UI **drops** the row. Reload later hits consistent Redis. |
| **2** | **(a) BottomDock socket not connected / message dropped** | **Plausible.** `get_user_connections` empty at publish time → no delivery. Reconnect path mitigates but timing gaps remain. Additionally `try_send` on full queue **drops non-tick** messages (`broadcaster.rs` L23–30) — under load, **`position_update` can be dropped**. |
| **3** | **(b) Gateway only sends `account.summary.updated`; Positions tab ignores** | **Partially true, not sufficient alone.** Summary is throttled and not wired in `BottomDock`; but **`position_update` and `order_update` are distinct** when Redis paths fire. User can still see updates via `position_update` / `order_update` without summary. |
| **4** | **(e) First-time creation only on `evt.position.updated` without WS** | **`position_update` to browser comes from Redis `positions:updates`**, which is **skipped for `flipped`** fills — then UI relies on **`order_update`** + REST. If `order_update` is missed and refetches are stale, same symptom. |
| **5** | **(d) Payload shape mismatch → silent ignore** | **Partially supported.** `BottomDock` requires `data.position_id` for `position_update`; missing id → `return` early. Gateway uses `position_id` from JSON; engine publishes string ids — **normally aligned**. |
| **6** | **(f) `AccountSummaryCoordinator.should_publish` (250ms throttle)** | **Low for Positions table.** Throttle affects **`account:summary:updated`** publish (`deposits.rs`); `BottomDock` **does not** apply summary WS to `positions` state. Could affect **margin header** consistency, not the row list directly. |
| **7** | **(g) Subscribe not ACKed before broadcast** | **Refuted for position fan-out:** `broadcast_position_update` does not check symbol/channel subscription; only **authenticated** presence in `user_connections` matters. |

---

## 7. Why reload fixes it

- Full navigation runs a fresh **`GET /v1/users/{id}/positions?status=open`**, which re-reads Redis **`pos:{user_id}`** + **`pos:by_id:{id}`** hashes (`get_user_positions` in `deposits.rs`).
- By reload time, the order-engine Lua / handlers have typically finished updating Redis; the set membership and hashes are **consistent** for the open tab.
- **Postgres:** `PositionEventHandler` syncs to `positions` table on **`evt.position.updated`**, but the **terminal list endpoint used here is Redis-first**, not “wait for Postgres replica.”

---

## 8. Code smells (evidence-based)

1. **Full `setPositions(data)` replace** on every `fetchOpenPositions` — no merge with in-flight WS rows; strongest contributor to **stale REST wiping** a freshly inserted WS row (`BottomDock.tsx` `fetchOpenPositions`).
2. **`position_update` placeholder** uses hardcoded defaults (`leverage: '50'`, zero prices) until REST catches up — fine visually, but combined with (1) amplifies flicker/miss.
3. **`setTimeout` refetch (500ms / 600ms)** assumes Redis/read-your-write within that window — **not guaranteed** under load or cross-service lag.
4. **Dual sockets** (`BottomDock` + `wsClient`) duplicate gateway connections; more chances for one to be stale-closed (`WS_STALE_TIMEOUT_MS` forces reconnect) or queue pressure — **operational** risk, not strictly required for positions.
5. **Strict Mode / HMR:** effect cleanup closes socket on unmount; double mount can briefly tear down connection — **UNCERTAIN** frequency in production vs dev.
6. **`useAccountSummary` `refetchInterval: 5000`** conflicts with repo **no-polling** rule and **does not refresh** `positions` anyway — misleading “safety net” for this bug.

---

## 9. Evidence-based recommendations (do not implement)

1. **Top pick — Eliminate stale REST clobbering:** After any `getOpenPositions()` response, **merge by `position_id`** (or only replace if response is a superset / newer revision), **or** stop automatic refetch immediately after WS append unless the REST payload contains the same ids. **Reason:** Directly addresses ranked hypothesis **#1** with minimal backend change.
2. **Unify realtime transport:** Drive position + order updates from **one** authenticated pipeline (e.g. extend `wsClient` to subscribe to `positions`/`orders` and lift `BottomDock` state, or share a single connection). **Reason:** Removes duplicate reconnect races and halves queue pressure on the gateway user fan-out.
3. **Backend parity for flips:** On `fill_action == "flipped"`, also **`PUBLISH positions:updates`** (same schema as `created`) so `position_update` always mirrors NATS — reduces reliance on `order_update` ordering.

**Top recommendation:** **(1) merge-safe refetch / avoid blind `setPositions` replace** — smallest blast radius, matches the most concrete code-level race (WS adds row → REST fetch returns older snapshot → row disappears until reload).
