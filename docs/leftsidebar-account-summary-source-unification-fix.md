# LeftSidebar: unify balance with account summary display

**Date:** 2026-05-23  
**File changed:** `src/features/terminal/components/LeftSidebar.tsx` only.

## Problem (from handler diagnostic)

`LeftSidebar` mixed **two update paths** for the metrics strip:

- **Balance** used `useWalletStore().balance`, updated promptly by **`wallet.balance.updated`**.
- **Equity / margin** preferred **`useAccountSummary()`** (React Query), updated by **`account.summary.updated`**.

Those events are published on **separate backend paths** and can arrive **seconds apart**. The UI then showed balance jumping first and equity/margin catching up later — perceived as “account summary lag” even when each WS message was fast. See `docs/handler-proliferation-and-timing-diagnostic.md` (split sources / H5).

## Change (before → after)

**Before:**

```ts
const displayBalance = balance ?? 0
```

**After:**

```ts
const displayBalance = accountSummary?.balance ?? balance ?? 0
```

`displayEquity` and `displayMargin` logic were **unchanged** (they already preferred `accountSummary`).

## Why this fixes the perception

All three displayed values now follow the **same primary source** (`accountSummary`) as soon as the shared query has data. When **`account.summary.updated`** runs, `useAccountSummary`’s subscriber updates React Query once → **balance, equity, and margin** in the strip update **together**. Early render still uses **`walletStore`** (`balance`, etc.) until `accountSummary` exists (`fetchAccountSummary` / first WS merge).

The existing **`wallet.balance.updated`** handler in `LeftSidebar` is **unchanged** so other code that relies on **`walletStore`** still receives updates.

## What this does **not** fix

- **End-to-end delay** until **`account.summary.updated`** (or HTTP summary) arrives is unchanged. If that event is 4–5s after an action, **all three** numbers will move together after that delay — no more **staggered** balance vs equity.
- **Backend** throttling, **`wallet.balance.updated`** timing vs summary, and **visibility** `invalidateQueries` behavior are out of scope for this one-line display fix.

## Smoke test (local / staging)

1. Log in; open terminal **LeftSidebar** metrics strip.
2. Place an order (or any action that updates account state).
3. **Expect:** Balance, Equity, and Margin **change in the same paint** (no balance-only jump ahead of equity).
4. Repeat several times; staggered balance-first updates should be gone.
5. If **all three** still lag together by several seconds, treat as **separate** server/publish timing work — not this desync bug.

## Acceptance checklist

| # | Criterion |
|---|-----------|
| 1 | `displayBalance` uses `accountSummary?.balance` then `balance` fallback |
| 2 | `displayEquity` / `displayMargin` semantics unchanged |
| 3 | `walletStore`, `useAccountSummary`, `fetchBalance` path, WS subscribers in `LeftSidebar` unchanged |
