# Handler proliferation and variable account-summary lag — measurement-first diagnostic

**Date:** 2026-05-23  
**Scope:** Read-only (grep + code review + limited production log sample). No application code or DB changes.

**User evidence:** Browser console shows `wallet.balance.updated` and `account.summary.updated` arriving; `[wsClient]` logs **11 handlers** per event, all complete without errors; `[LeftSidebar]` logs `wallet.balance.updated` and `User ID comparison: { match: true }`; balance/equity can change between screenshots; lag is **variable (4–5+ seconds)**.

---

## Step 1 — Enumerate all `wsClient.subscribe` calls

Command:

```bash
grep -rn "wsClient\.subscribe\|wsClient\.subscribe(" src/ --include="*.ts" --include="*.tsx"
```

**Result count:** **17** `wsClient.subscribe(...)` registrations in source (grep lines; `wsHooks.ts` is the shared wrapper). The **11** in the console is `this.handlers.size` at runtime — depends on route, role, and which panels/tabs are mounted.

| # | File:line | Enclosing hook / component | Handler summary |
|---|-----------|------------------------------|-----------------|
| 1 | `src/features/wallet/hooks/useAccountSummary.ts:110` | `useAccountSummary` | `account.summary.updated` → `applyAccountSummaryWsToQueryCache` |
| 2 | `src/features/terminal/components/LeftSidebar.tsx:184` | `LeftSidebar` via `useWebSocketSubscription` | `wallet.balance.updated` → `setWalletData` (+ logs); other types mostly log |
| 3 | `src/features/terminal/hooks/useTerminalOrderRejectToast.ts:25` | `useTerminalOrderRejectToast` | `order_update` / aliases only |
| 4 | `src/features/terminal/components/RightTradingPanel.tsx:1024` | `RightTradingPanel` | Admin order event types + `requestOpenPositionsRefresh` |
| 5 | `src/shared/ws/wsHooks.ts:20` | `useWebSocketSubscription` (wrapper) | Delegates to caller |
| 6 | `src/features/aiReports/providers/AiReportsWsProvider.tsx:14` | `AiReportsWsProvider` (root `Providers`) | `ai.report.delta` only |
| 7 | `src/features/call/UserCallProvider.tsx:114` | `UserCallProvider` (non-admin, `AuthGuard`) | Call / WebRTC event types |
| 8 | `src/features/terminal/components/AiChatTab.tsx:193` | `AiChatTab` when `active` | `ai.chat.delta` → UI + `invalidateQueries` / `fetchQuery` (see Step 4) |
| 9 | `src/features/terminal/components/SupportChatTab.tsx:64` | `SupportChatTab` when `active` | Chat-shaped payloads → `setMessages` |
| 10 | `src/features/userPanel/pages/UserSupportPage.tsx:80` | `UserSupportPage` | Support WS handling |
| 11 | `src/features/support/pages/SupportPage.tsx:135` | `SupportPage` | Support WS handling |
| 12 | `src/features/adminCalls/pages/AdminCallUserPage.tsx:138` | `AdminCallUserPage` | Admin call WS |
| 13 | `src/features/adminTrading/hooks/useAdminWebSocket.ts:62` | `useAdminWebSocket` | Admin trading events |
| 14–17 | `src/features/adminUsers/modals/UserDetailsModal.tsx` | `UserDetailsModal` (four `useEffect` subscribers at ~697, ~769, ~978, ~1311) | Includes **`wallet.balance.updated` → `invalidateQueries(accountSummary)`** and summary → `invalidateQueries(positions)` |
| 18 | `src/features/aiReports/modals/BulkReportProgressDrawer.tsx:66` | `BulkReportProgressDrawer` | AI report progress |

### Representative subscribe blocks

**`useAccountSummary.ts` (canonical account summary → React Query):**

```106:116:src/features/wallet/hooks/useAccountSummary.ts
  // Update cache from WebSocket so UI stays real-time without refetch
  useEffect(() => {
    if (!user?.id) return
    const currentUserId = String(user.id).trim()
    const unsubscribe = wsClient.subscribe((event: WsInboundEvent) => {
      if (event.type === 'account.summary.updated') {
        const raw = (event as { type: 'account.summary.updated'; payload: Record<string, unknown> }).payload
        applyAccountSummaryWsToQueryCache(queryClient, currentUserId, raw)
      }
    })
    return unsubscribe
  }, [user?.id, queryClient])
```

**`LeftSidebar.tsx` (wallet push → Zustand `walletStore`):**

```183:257:src/features/terminal/components/LeftSidebar.tsx
  useWebSocketSubscription(
    useCallback(
      (event: WsInboundEvent) => {
        console.log('📨 [LeftSidebar] Received WebSocket event:', event.type)
        
        if (event.type === 'wallet.balance.updated') {
          const payload = (event as { payload?: unknown }).payload
          // ... userId match ...
          if (eventUserId && currentUserId && eventUserId === currentUserId) {
            // ...
            setWalletData({
              balance: newBalance,
              currency: (pl.currency as string) ?? 'USD',
              available: Number(pl.available ?? pl.balance ?? 0),
              locked: Number(pl.locked ?? 0),
              equity: Number(pl.equity ?? pl.balance ?? 0),
              margin_used: Number(pl.margin_used ?? pl.marginUsed ?? 0),
              free_margin: Number(pl.free_margin ?? pl.freeMargin ?? 0),
            })
            // ... optional toast ...
          }
        } else {
          if (event.type === 'auth_success' || event.type === 'auth_error') {
            console.log('🔐 [LeftSidebar] Auth event:', event.type, event)
          }
        }
      },
      [user?.id, setWalletData, setLoading, wsState]
    )
  )
```

**`useGlobalWalletBalance.ts` (app shell only — see Step 5):**

```17:71:src/shared/hooks/useGlobalWalletBalance.ts
  useWebSocketSubscription(
    useCallback(
      (event: WsInboundEvent) => {
        if (event.type === 'wallet.balance.updated') {
          // ... userId match ...
            setWalletData({
              balance: newBalance,
              // ...
            })
```

---

## Step 2 — Categorize handlers

| File:line | Typical events | What it does | Cost class |
|-----------|----------------|--------------|------------|
| `useAccountSummary.ts:110` | `account.summary.updated` | `setQueryData(['accountSummary'], …)` | **Cheap** |
| `LeftSidebar.tsx:184` | All (filters inside) | On wallet match: `setWalletData`, `setLoading`, optional `toast` | **Medium** (Zustand + toast; sync) |
| `useTerminalOrderRejectToast.ts:25` | `order_update` | Early return otherwise; toast branch | **Cheap** for balance/summary events |
| `RightTradingPanel.tsx:1024` | Admin order types | Early return for normal users | **Cheap** |
| `AiReportsWsProvider.tsx:14` | `ai.report.delta` | Zustand store update | **Cheap** |
| `UserCallProvider.tsx:114` | Call events | Early return; WebRTC work only on call events | **Cheap** for wallet/summary |
| `AiChatTab.tsx:193` | `ai.chat.delta` | `setMessages`, `invalidateQueries`, `fetchQuery` when AI tab active | **Expensive** when hit (see Step 4) |
| `SupportChatTab.tsx:64` | Chat payloads | `setMessages` | **Medium** |
| `UserDetailsModal.tsx:697+` | Admin impersonation / user detail | `setQueryData` + **`invalidateQueries(positions)`** on summary; **`invalidateQueries(accountSummary)`** on wallet | **Expensive** when modal open (admin) |

**Important:** For **terminal route `/`**, `useGlobalWalletBalance` is **not** mounted (it lives in `AppShell`, but `TerminalPage` uses `AppShellTerminal` only — see Step 5). So one duplicate wallet subscriber from that hook is absent on the root terminal.

---

## Step 3 — LeftSidebar deep dive

**Log strings:** `src/features/terminal/components/LeftSidebar.tsx` lines 187, 196, 213, 246, 251 (see block in Step 1).

### 1) Event filter

- **`wallet.balance.updated`:** Full handling (userId match, then `setWalletData`).
- **Other types:** Only extra logging for `auth_success` / `auth_error`. **`account.summary.updated` is not handled here** (no mutation on that type in this handler).

### 2) After `match: true` — does it invalidate / refetch?

- **No `invalidateQueries`** in this WebSocket handler.
- **No `setQueryData`** for React Query here.
- **No direct `fetch(...)`** in the WS path.
- **Yes:** `setWalletData(...)` (Zustand `walletStore`) and `setLoading(false)`; optional `toast.success`.

### 3) Separate paths that *do* invalidate account summary

**Visibility (not WS):**

```137:145:src/features/terminal/components/LeftSidebar.tsx
  useEffect(() => {
    if (!user?.id) return
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') queryClient.invalidateQueries({ queryKey: accountSummaryQueryKey })
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [user?.id, queryClient])
```

This **does** trigger `GET /api/account/summary` via React Query refetch when the user returns to the tab — **variable HTTP RTT** — but it is **not** tied to each WS message.

**REST fallback (not WS):**

```147:181:src/features/terminal/components/LeftSidebar.tsx
  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    const delayMs = 800
    const timer = setTimeout(() => {
      fetchBalance()
        .then((res) => {
          if (cancelled) return
          // ... maps API → setWalletData(...)
        })
```

Runs **once ~800ms after mount** (when `user.id` is set), calls **`fetchBalance()`** HTTP. Can race with WS and overwrite wallet store; not a per-event 4–5s loop.

**Conclusion for H1 (LeftSidebar invalidates on WS):** **Not supported** for the terminal `LeftSidebar` wallet handler. The **visibility** `invalidateQueries` is a separate, plausible source of **occasional** lag when switching tabs.

---

## Step 4 — `invalidateQueries` in WS-related paths

Broader grep was run on `invalidateQueries` under `src/`. Relevant WS-adjacent hits:

| File:line | Trigger | Query key | Effect |
|-----------|---------|-----------|--------|
| `UserDetailsModal.tsx:760` | `account.summary.updated` (admin, target user match) | `positionsQueryKey` | Refetch positions |
| `UserDetailsModal.tsx:774` | `wallet.balance.updated` (admin, target user) | `accountSummaryQueryKey` | **Refetch admin account summary** |
| `AiChatTab.tsx:219–255` | `ai.chat.delta` when AI tab **active** | `['ai', 'usage']`, `['ai', 'conversation']` | **invalidateQueries**; also `fetchQuery` / scheduled syncs |

**Terminal trader (non-admin, chat closed / AI tab inactive):** `UserDetailsModal` handlers are **not** mounted. **`AiChatTab`** handlers register only when the Chat panel is open **and** the AI sub-tab is `active`.

**Smoking gun for “WS handler → invalidate → HTTP” on the main terminal:** **Weak** unless the user keeps **Admin → User details** or **AI chat** open while measuring.

---

## Step 5 — What LeftSidebar displays (duplicate data sources)

**Balance / equity / margin in JSX:**

```393:404:src/features/terminal/components/LeftSidebar.tsx
      {/* Balance from WebSocket/wallet store (realtime); Equity & Margin from account summary */}
      ...
            const displayBalance = balance ?? 0
            const displayEquity = accountSummary?.equity ?? equity ?? 0
            // Margin used is for open positions only; when margin level is "inf" there is no margin in use
            const displayMargin =
              accountSummary?.marginLevel === 'inf'
                ? 0
                : (accountSummary?.marginUsed ?? margin_used ?? 0)
```

| UI field | Primary source | Secondary |
|----------|------------------|-----------|
| **Balance** (large number) | `useWalletStore().balance` | — |
| **Equity** (small delta vs balance) | `useAccountSummary().accountSummary?.equity` | then `walletStore.equity` |
| **Margin** | `accountSummary.marginUsed` (unless `marginLevel === 'inf'`) | `walletStore.margin_used` |

So **`wallet.balance.updated`** can update **balance** immediately via Zustand, while **equity** prefers **`accountSummary`** from React Query, which updates on **`account.summary.updated`** via `useAccountSummary`. If those two events are **seconds apart** (server publish ordering / throttling), the UI can show **fresh balance** and **stale equity** until the summary event lands — **perceived “lag”** without a slow handler.

**`useGlobalWalletBalance`:** Mounted from `src/app/layout/AppShell/AppShell.tsx`. **`/` terminal** uses `TerminalPage` → `AppShellTerminal` **without** `AppShell` wrapper (`AppRouter.tsx` comment: terminal does not get `AppShell`). So on **root terminal**, **only** `LeftSidebar` (and any other explicit subscribers) update `walletStore` from WS — not the global hook.

---

## Step 6 — Footer / BottomDock source

`BottomDock.tsx` uses **`useAccountSummary()`** for Balance, Equity, Margin, Free Margin, etc. (grep hits ~lines 854–858, 1561+). It also opens a **second** `WebSocket` (not `wsClient`) for positions/orders and calls `applyAccountSummaryWsToQueryCache` when `account.summary.updated` arrives on **that** socket — same React Query key as `useAccountSummary`.

**Comparison:** Footer is **React Query–centric** for summary metrics. LeftSidebar **balance** is **Zustand-first**. They can diverge briefly if wallet WS updates store before summary updates query cache.

---

## Step 7 — Handler order and blocking (`wsClient.ts`)

Dispatch loop:

```148:157:src/shared/ws/wsClient.ts
          console.log(`📨 [wsClient] Dispatching to ${this.handlers.size} handler(s) for event type: ${data.type}`)
          Array.from(this.handlers).forEach((handler, index) => {
            try {
              console.log(`📨 [wsClient] Calling handler ${index + 1}/${this.handlers.size} for ${data.type}`)
              handler(data)
              console.log(`✅ [wsClient] Handler ${index + 1} completed for ${data.type}`)
            } catch (error) {
              console.error(`❌ [wsClient] Error in handler ${index + 1} for ${data.type}:`, error)
            }
          })
```

- Handlers are typed as `(event: WsInboundEvent) => void` — **not `async`** in the subscription API.
- Invocation is **synchronous** `handler(data)` inside `forEach` — **no `await`**.
- Any **async work** started inside a handler (e.g. `void queryClient.invalidateQueries(...)`) is **fire-and-forget** from the perspective of the **next** handler in the list — it does **not** block handler 2..N from running in the same tick.

**H3 (sequential await blocks all handlers):** **Not supported** by this dispatch implementation. Heavy **synchronous** CPU in one handler could still delay the next handler within the same macrotask.

---

## Step 8 — Backend / production log sanity

Command attempted (per user spec, adjusted for compose service name **`auth`**):

```bash
ssh root@ptf.interwarepvt.com
cd /opt/newpt
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production logs auth --tail 150
```

**Sample (2026-05-23 UTC):** Logs show **`price_tick_summary_handler`** driving **`Published account summary to Redis (1 subscribers)`** in quick succession (~milliseconds between users), plus **`Throttle skip user … (100ms)`** lines. **No** `place_order` duration lines appeared in this short tail.

**Interpretation:** This slice supports **frequent tick-driven summary publishes** (sub-second clustering), not multi-second `place_order` stalls. **Longer-window grep** for `place_order` / HTTP timing would still be useful for order-click specifically.

---

## Step 9 — Verdict

| Hypothesis | Supported? | Notes |
|------------|------------|--------|
| **H1** LeftSidebar WS path invalidates account summary | **No** | WS branch uses `setWalletData` only. **Visibility** invalidates `accountSummary` (HTTP refetch) — different trigger. |
| **H2** Duplicate balance queries | **Partial** | LeftSidebar uses **walletStore + accountSummary** intentionally split; not two HTTP queries for the same field on every WS. |
| **H3** Sequential WS await blocking 11 handlers | **No** | `handler(data)` sync; no await in loop. |
| **H4** Backend `place_order` multi-second | **Unproven** in this sample | Need targeted logs around order POST. |
| **H5** Combination | **Yes** | (a) **Multiple `useAccountSummary` mounts** → duplicate **cheap** `setQueryData` on each summary event. (b) **Split sources**: balance from **Zustand** (wallet WS), equity/margin from **React Query** (summary WS) → **visible desync** until both paths update. (c) **Server-side** summary publish can be **throttled / batched** (`AccountSummaryCoordinator` + tick handler); wallet publish may arrive **earlier**. (d) **Optional** expensive handlers when **AI chat** or **admin user modal** is open. |

### Strongest hypothesis (evidence-backed)

**Primary:** The UI **does not read a single merged “account state”** in the sidebar: **balance** tracks **`walletStore`** (updated by `wallet.balance.updated`), while **equity / margin** prefer **`useAccountSummary`** (updated by `account.summary.updated`). If the **server emits wallet updates materially before** the **account summary** message the user cares about (or summary publish is skipped/throttled while wallet still fires), the user sees **variable delay** in “account summary” **as a whole** even though WS handlers all return instantly — **and** console still shows both event types “arriving.”

**Secondary:** **`visibilitychange` → `invalidateQueries(['accountSummary'])`** causes **HTTP refetch** with **variable network latency**; easy to confuse with WS lag if testing involves tab focus changes.

**Admin-only tertiary:** `UserDetailsModal` **`invalidateQueries` on `wallet.balance.updated`** is a clear **WS → HTTP refetch** pattern when that modal is open.

### Minimal change to test the primary hypothesis (not implemented here — diagnostic only)

**Single file focus:** `src/features/terminal/components/LeftSidebar.tsx` — on `account.summary.updated` (same user guard as `applyAccountSummaryWsToQueryCache`), also **`setWalletData`** from payload (or call a small helper shared with wallet WS) so **balance/equity/margin** in the sidebar move together from **one** event, **or** drive the large balance display from **`accountSummary.balance`** when present so **one** cache is authoritative for the header strip.

---

## Appendix — `useAccountSummary` duplicate subscriptions

Every component that calls `useAccountSummary()` registers **its own** `wsClient.subscribe` in a `useEffect`. On a typical **desktop terminal** layout, **at least** these mount together:

- `AppShellTerminal.tsx`
- `LeftSidebar.tsx`
- `RightTradingPanel.tsx`
- `BottomDock.tsx` (via `CenterWorkspace`)

Additional views (`TerminalAccountView`, `TerminalHistoryView`, `TerminalPositionsView`, `ChartTradingStrip`, mobile tabs) add more when mounted. Each duplicate handler runs **`setQueryData`** on the same key — **redundant but still O(1)** per handler unless React Query work becomes measurable at very high event rates.
