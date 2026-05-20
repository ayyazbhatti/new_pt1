# Bottom dock account summary bar — code-grounded diagnostic trace

Technical reference for extending terminal account metrics. Exact identifiers from the codebase.

## Files read (for this trace)

`src/features/terminal/components/BottomDock.tsx`, `src/features/terminal/components/CenterWorkspace.tsx`, `src/features/terminal/pages/TerminalPage.tsx`, `src/features/terminal/pages/AppShellTerminal.tsx`, `src/features/terminal/layout/TerminalLayout.tsx`, `src/features/terminal/components/LeftSidebar.tsx`, `src/features/terminal/components/RightTradingPanel.tsx`, `src/features/wallet/hooks/useAccountSummary.ts`, `src/features/wallet/hooks/useMarginCall.ts`, `src/features/wallet/api.ts`, `src/shared/ws/wsClient.ts`, `src/shared/ws/wsEvents.ts`, `backend/auth-service/src/routes/deposits.rs`, `backend/auth-service/src/lib.rs`, `backend/auth-service/src/services/position_event_handler.rs`, `backend/auth-service/src/services/order_event_handler.rs`, `backend/auth-service/src/services/price_tick_summary_handler.rs`, `backend/auth-service/src/services/account_summary_cache_warmup.rs`, `backend/ws-gateway/src/stream/broadcaster.rs`, `backend/ws-gateway/src/main.rs`, `apps/gateway-ws/src/main.rs`, `crates/redis-model/src/keys.rs`, `src/features/terminal/api/positions.api.ts`, `apps/data-provider/src/main.rs` (grep)

---

## 1. UI COMPONENT

### Bottom dock component

- **Path:** `src/features/terminal/components/BottomDock.tsx` — exported `BottomDock`.
- **Parent:** `src/features/terminal/components/CenterWorkspace.tsx` renders `<BottomDock />` inside a `shrink-0` wrapper when `!isChartFullscreen && !hideBottomDock` (desktop chart layout).  
- **Page chain:** `TerminalPage` → `AppShellTerminal` → `TerminalLayout` + `CenterWorkspace` (among other children).

### Label vs code (8 fields requested)

The **desktop horizontal “Bottom Stats Bar”** (`h-14 border-t …`) shows **eight metrics** from a single mapped array. In code the labels are:

| User naming | Code label string | Data source |
|-------------|-------------------|-------------|
| Balance | `Balance ` | `accountSummary.balance` |
| Equity | `Equity ` | `accountSummary.equity` |
| Margin | `Margin ` | `accountSummary.marginUsed` (0 if `marginLevel === 'inf'`) |
| Free Margin | `Free Margin ` | `accountSummary.freeMargin` |
| Bonus | `Bonus ` | **Hardcoded** `'$0.00'` |
| Margin Level | `Margin Level ` | `accountSummary.marginLevel` (`∞` if `'inf'`) |
| Rl PNL | **`RI PNL `** (not “Rl”) | `accountSummary.realizedPnl` |
| (8th slot) | **`UnR Net PNL `** | `accountSummary.unrealizedPnl` |

**Ping** is **not** rendered on `BottomDock`. **Ping** (REST RTT, green/yellow/red) lives in **`RightTradingPanel.tsx`** (`pingMs`, `setInterval(measurePing, 5000)`). If the product screenshot shows Ping on the same strip as these metrics, **UNCERTAIN:** may be a different build or composite UI; in this repo Ping ≠ BottomDock.

### JSX / hook / formatting (bottom stats bar)

- **Block:** `BottomDock.tsx` — comment `{/* Bottom Stats Bar - hidden on mobile when fullHeight … */}`, `className` includes `h-14 border-t …`.
- **Hook:** `const { accountSummary } = useAccountSummary()` (same file, ~line 93).
- **Snippet pattern:** each row is `{ formula, icon: Icon, label, value, valueClass }` with `value` from `accountSummary` or `'$0.00'` for Bonus; `toFixed(2)` for dollar fields; realized/unrealized use red/green via `cn(..., 'text-danger' | 'text-success')`.
- **Fallbacks:** `accountSummary != null ? … : '—'` for all except Bonus (`'$0.00'` always).
- **Margin display quirk:** when `accountSummary.marginLevel === 'inf'`, Margin shows **`$0.00`** even if `marginUsed` were non-zero (UI treats “inf” as zero margin display).

### Mobile account block (inside Positions tab content)

- **Path:** same `BottomDock.tsx`, `md:hidden` section: labels **Balance, Equity, Margin, Free Margin, Margin Level (%), Total Positions** — **no Bonus / RI PNL / UnR** in that list.

### Conditional rendering

- **`hide_leverage_in_terminal`:** affects **`RightTradingPanel.tsx`** leverage section only (`user_groups.hide_leverage_in_terminal` via `me`); **not** referenced in `BottomDock.tsx`.
- **Bottom stats bar visibility:** `className` uses `fullHeight ? 'hidden md:flex' : 'flex'` — hidden on small screens when `fullHeight` (e.g. mobile Positions standalone).
- **`tradingAccess`:** used in `BottomDock` for close-position actions (`canClosePosition`), **not** for hiding summary numbers.

---

## 2. DATA SOURCE — PRIMARY HOOK / STORE

- **Hook:** `useAccountSummary` in `src/features/wallet/hooks/useAccountSummary.ts`.
- **React Query key:** `['accountSummary']` (exported as `accountSummaryQueryKey`).
- **TS type:** `AccountSummaryResponse` in `src/features/wallet/api.ts`:

```ts
export interface AccountSummaryResponse {
  userId: string
  balance: number
  equity: number
  marginUsed: number
  freeMargin: number
  marginLevel: string
  marginCallLevelThreshold?: number | null
  stopOutLevelThreshold?: number | null
  realizedPnl: number
  unrealizedPnl: number
  updatedAt: string
}
```

- **Initial fetch:** `queryFn: fetchAccountSummary` → `GET /api/account/summary` (`fetchAccountSummary` in `src/features/wallet/api.ts`). `enabled: !!user?.id`. `staleTime: 0`.

### Sync mechanisms

1. **WebSocket — `account.summary.updated`**  
   - `wsClient.subscribe` in `useAccountSummary.ts`; on `event.type === 'account.summary.updated'`, parses `payload` (camelCase or snake_case), matches `userId` to current user, `queryClient.setQueryData(QUERY_KEY, payload)`.  
   - **Does not** require a named “account summary” subscribe channel in `wsClient` — any inbound message of that type updates cache.

2. **React Query `refetchInterval: 5000`** on `useAccountSummary` — **periodic REST refetch every 5s**. This conflicts with workspace **no-polling** rule (`.cursor/rules/no-polling.mdc`); it is present in code.

3. **`refetchOnWindowFocus: false`** — no refetch on focus from this hook.

4. **Other components:** `LeftSidebar.tsx` uses `document.visibilityState === 'visible'` → `queryClient.invalidateQueries({ queryKey: accountSummaryQueryKey })` (on-demand refetch when tab visible).

5. **Wallet store / `wallet.balance.updated`:** updates `useWalletStore` (LeftSidebar balance pulse); **not** the same object as `AccountSummaryResponse`, but related financially.

### Default values

- Until fetch/WS: `accountSummary` is `undefined` → UI shows `—` for computed fields; Bonus still `$0.00`.

---

## 3. WEBSOCKET WIRING

### Client

- **`src/shared/ws/wsClient.ts`:** multiplexed handlers; pushes all `WsInboundEvent` to subscribers. After `auth_success`, non-admin users auto-send `subscribe` with `channels: ['balances', 'wallet']` — **no explicit `accountSummary` channel**; `account.summary.updated` is still delivered if the gateway sends it (connection is user-scoped post-auth).

### Inbound event type

- **`src/shared/ws/wsEvents.ts`:** `type: 'account.summary.updated'` (see grep / protocol).

### Gateway (primary: `backend/ws-gateway`)

- **`backend/ws-gateway/src/main.rs`:** subscribes to Redis channel **`account:summary:updated`** (among others including `price:ticks`, `wallet:balance:updated`).
- **`backend/ws-gateway/src/stream/broadcaster.rs`:** on Redis message `"account:summary:updated"` → `broadcast_account_summary` — builds `ServerMessage::AccountSummaryUpdated { payload }`, dispatches to `registry.get_user_connections(user_id)` where `user_id` is extracted from payload `userId` / `user_id`.

### Alternate gateway (`apps/gateway-ws`)

- **`forward_account_summary_from_redis`** in `apps/gateway-ws/src/main.rs`: subscribes **`account:summary:updated`**, wraps JSON as `{ "type": "account.summary.updated", "payload": payload_json }`, sends to sessions where `session.user_id == event_user_id`.

### Auth binding

- Session `user_id` set after WS auth (implementation in gateway session code — **UNCERTAIN:** exact file without reading `backend/ws-gateway/src/session.rs` in full); payload must include matching `userId`/`user_id` for routing.

### BottomDock second WebSocket

- **`BottomDock.tsx`** opens a **separate** `WebSocket` to `VITE_WS_URL` or `…/ws?group=default` for **positions/orders** (`subscribe` channels `positions`, `orders`, `balances`, `wallet`). This socket is **not** what `useAccountSummary` uses (`wsClient`). Account summary updates for the dock still come from **`useAccountSummary` → `wsClient`**.

---

## 4. REST ENDPOINT

- **Path:** `GET /api/account/summary`  
- **Router:** `create_account_router` in `deposits.rs` — `.route("/summary", get(get_account_summary))` nested under `.nest("/api/account", …)` in `backend/auth-service/src/lib.rs`.

- **Frontend:** `fetchAccountSummary()` in `src/features/wallet/api.ts`.

- **Handler:** `async fn get_account_summary` in `backend/auth-service/src/routes/deposits.rs`.

### Handler steps

1. **Claims:** `Extension(claims): Extension<Claims>`, `user_id = claims.sub`.
2. **Redis cache read:** key `Keys::account_summary(user_id)` → **`pos:summary:{user_id}`** (alias in `keys.rs`). Reads hash fields: `balance`, `equity`, `margin_used`, `free_margin`, `margin_level`, `margin_call_level_threshold`, `stop_out_level_threshold`, `realized_pnl`, `unrealized_pnl`, `updated_at`. If **all** required fields present → returns JSON `AccountSummary` with optional thresholds filled from hash or from `get_margin_call_level_for_group` / `get_stop_out_level_for_group` when hash empty.
3. **Cache miss:** `compute_account_summary_inner(&pool, Some(redis), user_id, None)` then merge thresholds, cache via `compute_and_cache_account_summary` path (see §5).

- **Rust response type:** `AccountSummary` (`deposits.rs`) with `serde(rename_all = "camelCase")` — aligns with TS `AccountSummaryResponse`.

---

## 5. THE SUMMARY CACHE — REDIS

### Canonical key

- **`Keys::account_summary(user_id)`** in `crates/redis-model/src/keys.rs`:

```rust
pub fn position_summary(user_id: Uuid) -> String {
    format!("pos:summary:{}", user_id)
}
pub fn account_summary(user_id: Uuid) -> String {
    Self::position_summary(user_id)
}
```

- **Physical key:** `pos:summary:{user_id}`.

### Storage shape

- **Not** a single JSON blob for primary cache path: **`HSET` multiple fields** in `compute_and_cache_account_summary_with_prices` (`deposits.rs`):  
  `balance`, `equity`, `margin_used`, `free_margin`, `margin_level`, `margin_call_level_threshold`, `stop_out_level_threshold`, `liquidation_level` (literal `"0"`), `realized_pnl`, `unrealized_pnl`, `updated_at`.

- **Pub/Sub:** `conn.publish("account:summary:updated", &json)` where `json` is **full serialized `AccountSummary`** (camelCase JSON string) for gateways/clients that consume the envelope payload.

### Writers (`compute_and_cache_account_summary` / `_with_prices`)

Non-exhaustive list of call sites:

| Trigger | File | Function / context |
|---------|------|----------------------|
| Position NATS update | `backend/auth-service/src/services/position_event_handler.rs` | After `sync_position_to_database`, `compute_and_cache_account_summary` |
| Position closed NATS | `backend/auth-service/src/lib.rs` | `subscribe("event.position.closed")` → `compute_and_cache_account_summary` |
| Order terminal NATS | `backend/auth-service/src/services/order_event_handler.rs` | `evt.order.updated` Filled/Cancelled/Rejected → spawn `compute_and_cache_account_summary` |
| Price ticks | `price_tick_summary_handler.rs` | `compute_and_cache_account_summary_with_prices` |
| Warmup | `account_summary_cache_warmup.rs` | `warm_all_users` → `compute_and_cache_account_summary` per user |
| Deposits / finance / orders routes | `deposits.rs`, `orders.rs`, `finance.rs` (grep) | Various post-mutation calls |

### Readers

- **`get_account_summary`** — Redis hash first.  
- **`get_account_summary_for_user`** (admin) — same key pattern.  
- **`place_order`** — reads `Keys::account_summary` hash `free_margin` for margin check.  
- **WS gateways** — subscribe to **`account:summary:updated`** (full JSON in message body).

---

## 6. PER-METRIC COMPUTATION

**Single source of truth for dock numbers (when cache computed):** `compute_account_summary_inner` in `backend/auth-service/src/routes/deposits.rs`, plus `fetch_position_aggregates_from_redis` / `fetch_position_aggregates_from_db`.

### 6.1 Balance

- **Rust:** `balance` (`AccountSummary.balance` → TS `balance`).
- **Formula:** `balance = deposits - withdrawals + realized_pnl` where `deposits` / `withdrawals` are from **`transactions`** (USD only), `realized_pnl` from position aggregates (see 6.7).
- **SQL (deposits):** `SUM(net_amount)` for `type = 'deposit'`, statuses `completed` or `approved`, `currency = 'USD'`. Withdrawals: `type = 'withdrawal'`, `status = 'completed'`, `currency = 'USD'`.
- **Not** `wallets.available + wallets.locked` in this path (that pattern appears in `calculate_wallet_balance` / `WalletBalanceResponse` — different `free_margin` definition; see §11).

### 6.2 Equity

- **Rust:** `equity`.
- **Formula:** `equity = balance + unrealized_pnl` (`compute_account_summary_inner`).
- **Unrealized aggregation:** `fetch_position_aggregates_from_redis` (preferred) or `_from_db`: for **open** positions, sum mark-to-market unrealized (Redis: live bid/ask from `get_price_from_redis` or `price_overrides`; DB: `SUM(pnl)` on `status = 'open'`).

### 6.3 Margin (margin used)

- **Rust:** `margin_used` (TS `marginUsed`). Redis hash field `margin_used`.
- **Hedged:** sum of hash field **`margin`** on each **`pos:by_id:{id}`** for members of **`pos:{user_id}`** (`Keys::positions_set`) where `status` open (case-insensitive).
- **Net:** group Redis positions by `(symbol, group_id)`, then add `(abs(net_size)/total_abs_size).min(1) * total_margin` per group (`fetch_position_aggregates_from_redis` / `_from_db`).
- **Pending orders:** **not** included in `margin_used` here (only position hashes / DB `positions`).

### 6.4 Free margin

- **Rust:** `free_margin`.
- **Formula:** `if equity >= margin_used { equity - margin_used } else { Decimal::ZERO }` — **not** `balance - margin_used` (contrast `calculate_wallet_balance`).

### 6.5 Bonus

- **Backend `AccountSummary`:** **no `bonus` field.**
- **UI:** hardcoded **`value: '$0.00'`** in `BottomDock.tsx` stats array. **No** activation/expiry logic in this path.

### 6.6 Margin level

- **Rust:** `margin_level` — **string**, either `"inf"` or formatted `"%.2"` of `(equity / margin_used) * 100`.
- **Zero margin:** `"inf"` (division avoided).
- **UI:** displays `∞` when `marginLevel === 'inf'`.
- **Bottom dock colors:** `valueClass: 'font-semibold text-accent'` — **no** red/yellow tiering on the bar itself.
- **Margin call UI:** `useMarginCall.ts` — compares parsed `marginLevel` to `marginCallLevelThreshold ?? 50` when `marginUsed > 0`; thresholds from summary response or default **50** (not from bottom dock coloring).

### 6.7 RI PNL (realized PnL)

- **Rust:** `realized_pnl` (TS `realizedPnl`).
- **Redis path:** for **each** position id in `pos:{user_id}`, **`realized_pnl +=`** hash `realized_pnl` **before** filtering to open for margin/unreal — so closed positions **still in the set** contribute. Open positions’ hash may include partial realized components **UNCERTAIN:** depends on order-engine Redis lifecycle.
- **DB fallback:** `SELECT COALESCE(SUM(pnl), 0) FROM positions WHERE user_id = $1 AND status = 'closed'::position_status` — **closed only**.
- **Scope:** cumulative closed PnL in DB path; Redis path = sum of stored `realized_pnl` fields for all listed position ids.
- **Currency:** computations are USD-centric in `transactions` filters; position PnL numeric **UNCERTAIN:** multi-currency not verified.

### 6.8 UnR Net PNL (8th dock metric)

- **Rust:** `unrealized_pnl` (TS `unrealizedPnl`). Same bar as RI PNL; not “Ping”.

### 6.9 Ping (not on BottomDock)

- **`RightTradingPanel.tsx`:** `measurePing` — `fetch(healthUrl, { method: 'GET', cache: 'no-store' })` with `performance.now()` RTT; `setInterval(measurePing, 5000)`.
- **`healthUrl`:** in **`import.meta.env.DEV`** → **`/ws-health`**; in production → HTTP(S) **`/health`** on the same host as the WS URL (replace `ws`→`http`, strip `/ws?...` path).
- **Colors:** `pingMs == null` → muted; `<= 100` green dot; `<= 300` yellow; else red (`RightTradingPanel.tsx` Ping row).

---

## 7. UPDATE EVENT FLOW (CLOSE POSITION)

**Simplified chain (exact NATS subject names depend on order-engine publish):**

1. **UI:** `BottomDock` / positions table → `closePosition` (`positions.api.ts`) → `POST /v1/users/{userId}/positions/{positionId}/close`.
2. **Order-engine** processes close, updates Redis positions, publishes position lifecycle events (**UNCERTAIN:** exact close command subject without reading order-engine close handler).
3. **Auth-service NATS `evt.position.updated`:** `PositionEventHandler::handle_position_update` → DB `sync_position_to_database` → **`compute_and_cache_account_summary(pool, redis, event.user_id)`**.
4. **Auth-service NATS `event.position.closed`:** `lib.rs` subscriber → parses `user_id` from payload → **`compute_and_cache_account_summary`**; optional SL/TP/liquidation side effects.
5. **`compute_and_cache_account_summary_with_prices`:** writes Redis hash `pos:summary:{user_id}`, **`PUBLISH account:summary:updated`** with full JSON (subject to `AccountSummaryCoordinator.should_publish` throttle **250ms**).
6. **ws-gateway / gateway-ws:** Redis subscriber → WS message `account.summary.updated` to that user’s connections.
7. **`useAccountSummary`:** `setQueryData` → **Bottom dock** re-renders values.

**Cache vs pub:** always **both** write hash and (if throttle allows) publish Redis pub/sub.

---

## 8. PRICE-TICK DRIVEN RECOMPUTE

- **Type:** `PriceTickSummaryHandler` — `backend/auth-service/src/services/price_tick_summary_handler.rs`.
- **Input:** Redis **`PUBLISH price:ticks`** (payload JSON with `symbol`, `prices` array `{g, bid, ask}` or legacy `{bid, ask}`). Publishers include **`apps/data-provider/src/main.rs`** and **`backend/data-provider`** (grep).
- **Flow:** `handle_tick` → `ZRANGE pos:open:{symbol}` (`Keys::positions_open_by_symbol`) → for each position id, read `pos:by_id:{id}`; **status check `== "OPEN"`** (uppercase) — note `fetch_position_aggregates_from_redis` uses **`open`** case-insensitive; **possible inconsistency**.
- **Skip:** if no members in `pos:open:{symbol}`, return immediately (no users recomputed).
- **Throttle:** per-user **`THROTTLE_MS = 100`** in handler; coordinator also **250ms** publish throttle.
- **Compute:** `compute_and_cache_account_summary_with_prices(..., Some(overrides))` with live bid/ask per `(symbol, group_id)`.

**UNCERTAIN:** whether every tick publishes WS or only when `should_publish` allows (250ms gate).

---

## 9. HEDGED VS NET MODE

- **DB column:** `users.margin_calculation_type` — constrained values **`hedged`** / **`net`** (migrations).
- **Read:** `SELECT COALESCE(margin_calculation_type, 'hedged') FROM users WHERE id = $1` in `compute_account_summary_inner`.
- **Branch:** `fetch_position_aggregates_from_redis` / `_from_db` — **hedged** sums margin per open position; **net** scales group margin by `|net_size|/total_abs_size`.
- **UI:** Bottom dock **does not** show mode or alternate rows; same seven numeric fields + Bonus stub.

---

## 10. ADMIN / IMPERSONATION

- **Impersonation:** admin obtains tokens for target user (`impersonate_user`); terminal loads as **that user**. `useAccountSummary` uses `useAuthStore().user.id` → **target user’s** `GET /api/account/summary` and WS payloads filtered by `userId` — dock shows **impersonated trader** summary, not admin’s.
- **`hide_leverage_in_terminal`:** terminal right panel only; dock unchanged.
- **Admin-only routes:** **UNCERTAIN:** if terminal is not mounted, dock not shown.

---

## 11. KNOWN OR LIKELY BUGS / GAPS

- **`refetchInterval: 5000`** in `useAccountSummary.ts` — **polling**; violates repo no-polling rule.
- **Bonus** always `$0.00`; no backend field.
- **Ping** not on BottomDock; **RightTradingPanel** uses **5s interval** REST ping — also periodic polling.
- **Redis vs DB realized PnL** — different definitions (see §6.7).
- **`free_margin` formula** differs from **`calculate_wallet_balance`** (`free_margin = balance - margin_used` there vs `equity - margin_used` in account summary).
- **Position status casing:** `price_tick_summary_handler` uses `"OPEN"`; aggregates use case-insensitive `open` — risk of skipped tick updates.
- **BottomDock second WS** — duplicate connection pattern; account summary still depends on `wsClient` global.
- **`margin_level === 'inf'` → show $0 margin** in UI may mask non-zero `marginUsed` if ever inconsistent.

---

## 12. EXTENSION POINTS

- **Add field:** extend `AccountSummary` (`deposits.rs`) + serde, `compute_account_summary_inner`, `HSET` list in `compute_and_cache_account_summary_with_prices`, `AccountSummaryResponse` + `useAccountSummary` WS patch mapping, `BottomDock` row.
- **Bonus:** replace hardcoded row with API field or remove.
- **New WS channel:** optional; existing `account.summary.updated` already carries full payload.
- **Redis:** extend `pos:summary` hash vs new key — hash is already multi-field.
- **Feature flags:** `hide_leverage_in_terminal` exists for leverage UI only; **no** flag gates dock metrics.

---

## UNCERTAIN

- Exact **`POST …/close`** handler path in auth-service vs proxy to order-engine for position close.
- Whether **`pos:{user_id}`** set retains closed position ids (affects Redis `realized_pnl` sum).
- Which deployment uses **`backend/ws-gateway`** vs **`apps/gateway-ws`** for terminal WS URL `VITE_WS_URL`.
