# Phase 3 — Slippage protection (terminal frontend)

## Summary

- **Advanced max slippage** UI in the trading panel Cost Breakdown (market orders only): collapsible row, percent input, clamp 0–500 bps (0–5%), reset to server default.
- **`/me` mapping:** `effectiveSlippageBps` and `effectiveSlippageSource` on `MeResponse` / `UserResponse` in `src/shared/api/auth.api.ts`.
- **Place order:** optional `slippage_bps` on `PlaceOrderRequest` when the user overrides the default (otherwise omitted so the server resolves the same default as `/me`).
- **Async rejection toasts:** `useTerminalOrderRejectToast` (mounted from `AppShellTerminal`) listens for WebSocket `order_update` / `order.update` / `order_updated` and toasts rejections for orders registered via `useTerminalStore.registerRecentSubmittedOrder` within the last **30 seconds** (avoids toasting unrelated rejects).

## `SlippageInput` component

- **File:** `src/features/terminal/components/SlippageInput.tsx`
- **Imports:** `SlippageSource` from `@/shared/api/auth.api` (re-exported type only in component file via prop typing from parent).

## Wire-up: `RightTradingPanel.tsx`

- **Location:** Inside the **Cost Breakdown** card, after **Est. Liquidation**, only when `orderType === 'market'`.
- **State:** `slippageBps`, `slippageOverridden`; defaults from `meData.effectiveSlippageBps` / `effectiveSlippageSource`; `useEffect` resets `slippageBps` when the server default changes if the user has not overridden.
- **Payload:** `...(orderType === 'market' && slippageOverridden ? { slippage_bps: slippageBps } : {})`.
- After successful place: `registerRecentSubmittedOrder(orderId)` (in addition to existing `pendingOrders` for admin WS paths).

## `ChartTradingStrip.tsx`

- **No slippage UI** (one-click strip).
- **Change:** After a successful `placeOrder`, registers `orderId` with `registerRecentSubmittedOrder` so the same async rejection toast path applies.
- **`slippage_bps`:** intentionally **omitted** — server uses the same resolution chain as `/me`.

## WebSocket handler & types

- **Hook:** `src/features/terminal/hooks/useTerminalOrderRejectToast.ts`
- **Mount:** `src/features/terminal/pages/AppShellTerminal.tsx` calls `useTerminalOrderRejectToast()` once per terminal shell.
- **Terminal store:** `recentOrderSubmitAtById`, `registerRecentSubmittedOrder`, `forgetRecentSubmittedOrder`, `pruneStaleRecentSubmittedOrders` in `src/features/terminal/store/terminalStore.ts`.
- **Types:** `OrderUpdateInboundPayload` and `order_update` variants added to `WsInboundEvent` in `src/shared/ws/wsEvents.ts`.
- **`PlaceOrderErrorCode`:** includes `SLIPPAGE_EXCEEDED` for typing consistency (engine path is async; HTTP may not return this code).

### `SLIPPAGE_EXCEEDED` toast copy

- If `reason === 'SLIPPAGE_EXCEEDED'` and `details` includes `slippageBps` / `maxBps` (snake or camel), show the detailed bps message.
- Otherwise show a short slippage-specific fallback.

### Pipeline note (reason on wire)

- **ws-gateway** `ServerMessage::OrderUpdate` currently forwards a **fixed** set of fields (no `reason` / `details`).
- **auth-service** `publish_order_update_to_redis` today does **not** include `reason` on the Redis `orders:updates` payload.
- Until those include `reason` (and the gateway forwards it), the client may see **`REJECTED` without `reason`** and will show the **generic** rejection toast for recent orders. The hook still clears the registration and avoids spam. A small follow-up outside “frontend-only” scope is to thread `reason` from `OrderUpdatedEvent` through Redis → ws-gateway → browser.

## TypeScript

- `MeResponse`, `UserResponse`, `mapUserResponseToMe`: slippage fields + `SlippageSource` union.
- `PlaceOrderRequest.slippage_bps?: number`

## Smoke tests

| # | Description | Result |
|---|-------------|--------|
| 1–10 | Visual / live stack (market vs limit, override, 1 bp reject, WS toast) | **Not run** (no live session in this change) |

## `useMe` hook

- The codebase uses **`useQuery({ queryKey: ['auth', 'me'], queryFn: me })`** in terminal components rather than a dedicated `useMe` hook.
