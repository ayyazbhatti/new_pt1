# Order ticket confirmation dialog

## Purpose

After the incident documented in `docs/order-485250f3-size-anomaly-diagnostic.md`, the platform adds an explicit **review step** before submitting **market** and **limit** orders from the **order ticket** (`RightTradingPanel`). Traders see typed size, resolved lots, base units, notionals (quote + USD), prices, margin, fee, SL/TP, and slippage—without warning banners—so they can cancel or correct before commit.

## Database

- **Column:** `users.confirm_orders_before_placement` — `BOOLEAN NOT NULL DEFAULT TRUE`.
- **Migrations:**
  - `infra/migrations/069_order_confirmation_preference.sql`
  - `backend/auth-service/migrations/20260529100000_order_confirmation_preference.sql`

Existing rows get `TRUE` (safe default). New users default to confirmation on.

## Backend (auth-service)

- `User` / `USERS_ROW_SQL` include `confirm_orders_before_placement`.
- `UserResponse` (JSON) exposes `confirmOrdersBeforePlacement` via serde rename.
- `PATCH /api/auth/me` accepts optional `confirmOrdersBeforePlacement` in `UpdateMeRequest`. At least one of `first_name`, `last_name`, or `confirmOrdersBeforePlacement` must be present (validation in `update_me`).

## Frontend types

- `src/shared/api/auth.api.ts`: `UserResponse`, `MeResponse`, `mapUserResponseToMe`, and `UpdateProfilePayload` include `confirmOrdersBeforePlacement` (missing/falsey from API is treated as **true** for safety).

## `OrderConfirmationDialog`

- **File:** `src/features/terminal/components/OrderConfirmationDialog.tsx`
- Radix `Dialog`, styling aligned with other terminal modals (overlay + `bg-surface` content).
- **Size:** “You entered” label, lots (`formatLotSize`), units (`formatUnits`), notional in **quote** and **USD** (`convertAmount` + `formatAmount`).
- **Price:** limit price vs bid/ask + slippage bps when present on payload.
- **Risk:** SL/TP when set.
- **Cost:** estimated margin and fee formatted via `useFormatFromUsd` (USD-denominated estimates shown in the user’s effective display currency).

## Wire-up: `RightTradingPanel`

- **File:** `src/features/terminal/components/RightTradingPanel.tsx`
- After validation and `PlaceOrderRequest` construction, if `meData?.confirmOrdersBeforePlacement ?? true`, the panel stores pending payload + display metadata and opens `OrderConfirmationDialog`; otherwise it calls the same submit path as today.
- The dialog must use the **same** symbol object as `getSymbolForCalculations()` (admin row or terminal fallback). Gating the dialog on `adminSymbol` alone caused a silent no-op when the selected symbol was missing from the paginated admin list (`useSymbolsList` `page_size: 100`): place-order logic still had a fallback, but the dialog never mounted.
- **Confirm** runs `executePlaceOrderRequest` (existing success toasts and market reset behavior).
- **Cancel** or overlay close clears pending state (blocked while `isSubmitting`).

## Settings / profile toggle

- **File:** `src/features/userPanel/pages/UserProfilePage.tsx` — section **“Trading preferences”** with a checkbox bound to `updateProfile({ confirmOrdersBeforePlacement })`.
- `queryClient.setQueryData(['auth', 'me'], data)` and `setQueryData(profileQueryKey, data)` keep the terminal and profile caches in sync without a full reload.
- `useUpdateProfile` (`src/features/userPanel/hooks/useProfile.ts`) also updates `['auth', 'me']` on success for any caller using that mutation.

## Chart trading strip

**Intentionally unchanged:** `ChartTradingStrip` remains one-click; it does not read `confirmOrdersBeforePlacement` and is out of scope for this feature.

## Smoke test (manual)

Automated smoke was not run in this pass; recommended checks:

1. AUDCAD, units + non-base currency input → dialog shows “You entered”, lots, base units, quote + USD notionals.
2. Confirm → order submits; Cancel → no request.
3. Profile: toggle off → ticket Buy/Sell submits immediately; toggle on → dialog returns.
4. Chart strip: still one-click with preference on.
5. Limit order: limit price row visible; SL/TP rows when set.

## Build verification

Run locally:

```bash
cd backend/auth-service && cargo check
cd ../.. && cargo check --workspace
npx tsc --noEmit
```
