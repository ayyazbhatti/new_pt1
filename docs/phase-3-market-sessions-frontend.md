# Phase 3 — Market sessions (terminal frontend)

Frontend-only wiring for **Trading Hours / Market Sessions** visibility in the terminal: session API client, React Query hooks, symbol list styling, order ticket gating, status badge, and place-order error toasts.

## API module

| File | Purpose |
|------|---------|
| `src/features/terminal/api/sessions.api.ts` | `fetchSessionStatus(symbol)`, `fetchSessionStatusBatch(codes[])` → `GET /api/sessions/status` and `GET /api/sessions/status/batch` via shared `http()`. |

`SessionStatus` matches auth-service JSON (`camelCase`, including `is24_7`, `nextOpenAt` / `nextCloseAt` as ISO strings or `null`).

Barrel: `src/features/terminal/api/index.ts` re-exports the module.

## Hooks

| File | Purpose |
|------|---------|
| `src/features/terminal/hooks/useSessionStatus.ts` | `useSessionStatus(symbolCode)`, `useSessionStatusBatch(symbolCodes)`, `useSessionCountdownTick()` (local UI tick only), `useInvalidateSessionStatusOnVisibility()`. |

**Refresh policy (no HTTP polling):** Per `.cursor/rules/no-polling.mdc`, session queries do **not** use `refetchInterval`. They use `staleTime: 30_000`, `refetchOnWindowFocus: true`, and `useInvalidateSessionStatusOnVisibility()` mounted once from `AppShellTerminal` so returning to the tab refetches session data. Countdown copy updates from cached `nextOpenAt` / `nextCloseAt` via `useSessionCountdownTick` (30s) or the existing 1s `clockNow` in `RightTradingPanel`.

Barrel: `src/features/terminal/hooks/index.ts` exports the hook symbols.

## Countdown utility

| File | Purpose |
|------|---------|
| `src/features/terminal/utils/sessionCountdown.ts` | `formatTimeUntil(iso, timezone, nowMs)`, `formatOpensInLabel(...)`, `formatClosesInLabel(...)` for hints and badges. |

## Place-order error toasts

| File | Purpose |
|------|---------|
| `src/features/terminal/utils/placeOrderErrorToast.ts` | `tryToastPlaceOrderForbiddenError(err, toast, nowMs?)` — handles `MARKET_CLOSED`, `TRADING_DISABLED`, `CLOSE_ONLY`, `NEW_ORDERS_DISABLED` on the nested `response.data.error` object; returns `true` if handled. |

Used in:

- `src/features/terminal/components/RightTradingPanel.tsx` — main order ticket `catch` (before generic margin/403 handling).
- `src/features/terminal/components/ChartTradingStrip.tsx` — chart strip `catch`.

## TypeScript — orders API

`src/features/terminal/api/orders.api.ts` adds `PlaceOrderErrorCode` and `PlaceOrderErrorBody` for documented forbidden codes (non-breaking; still allows other codes via `string`).

## Wire-up locations

| UI | File | Behaviour |
|----|------|-----------|
| Desktop symbol list | `src/features/terminal/components/LeftSidebar.tsx` | `useSessionStatusBatch` over filtered `symbols`; rows with `opacity-50` when session closed or `!symbol.enabled`; amber **Closed** / **Off** chip; row `title` with opens countdown when session-closed. |
| Mobile quotes list | `src/features/terminal/components/TerminalSymbolsPage.tsx` | Same batch + dimming + chip + `title`. |
| Symbol dropdown | `src/features/terminal/components/RightTradingPanel.tsx` | When dropdown open, batch-fetch codes in the filtered list; dim rows + **Closed**/**Off** labels. |
| Live quote header | `src/features/terminal/components/RightTradingPanel.tsx` | For `session && !session.is24_7`, emerald/amber badge: **Closes in …** when open, **Opens in …** or **Market closed** when closed (uses `clockNow`). |
| Buy / Sell | `src/features/terminal/components/RightTradingPanel.tsx` | `sessionBlocksOrders = isSessionClosed \|\| isSymbolTradingOff`; extra `title` tooltips; hint under buttons for market closed / symbol off. |
| Chart strip Buy/Sell | `src/features/terminal/components/ChartTradingStrip.tsx` | Same gating + hint + shared toast helper. |
| Tab visibility | `src/features/terminal/pages/AppShellTerminal.tsx` | `useInvalidateSessionStatusOnVisibility()` once per shell. |

## Toast copy (summary)

- **MARKET_CLOSED** — `Market is closed.` + opens countdown or “No upcoming session.”
- **TRADING_DISABLED** — Support-oriented disabled message.
- **CLOSE_ONLY** — Close-only explanation.
- **NEW_ORDERS_DISABLED** — New positions disabled; closes still allowed.

## Smoke test results

Automated checks run in dev:

- `npx tsc --noEmit` — see command output in the PR / local run (should pass after wiring).

Manual checks (recommended):

1. **24/7 crypto** — e.g. BTCUSDT: no session badge when `is24_7`; Buy/Sell follow `symbol.enabled` and margin/WS only.
2. **Session hours symbol** — e.g. equity index / NYSE-linked: outside template hours → list dimmed, ticket disabled, amber badge + hint; inside hours → green “Closes in …” when `nextCloseAt` present.
3. **Forced order** — With UI disabled, devtools replay of `POST /v1/orders` should still surface the four toasts via `tryToastPlaceOrderForbiddenError`.
4. **Network** — After tab focus or visibility return, expect refetch of `/api/sessions/status` / `batch` (not a fixed 60s timer).

## Notes

- Batch map keys use each row’s `symbol.code`; backend batch map keys should match the same casing as the request CSV.
- `is24_7` symbols intentionally hide the session badge (always effectively open from a sessions perspective).
