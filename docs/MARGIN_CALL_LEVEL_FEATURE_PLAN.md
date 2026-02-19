# Margin Call Level Feature – Implementation Plan

## 1. Overview

When a user’s **margin level** (already computed and shown in the bottom dock) falls **below** a configurable **margin call level** (e.g. 50%), the app will:

- Show a **toast** notification.
- Open a **popup (modal)** with margin details and a **Deposit** button.

The **margin call level** is stored **per group** in the **database** and **cached in Redis** for fast reads when serving account summary and for real-time checks.

---

## 1.1 Plan validation and performance

- **Correctness:** The plan uses existing patterns: account summary already comes from Redis/DB; we add one optional field and one cached group setting. JWT already has `group_id` for the request path; the background summary path will do one lightweight DB lookup (user’s `group_id` by PK) so the WebSocket payload can include the threshold. No change to margin level calculation or existing cache keys.
- **Performance:**  
  - **REST `GET /api/account/summary` (cache hit):** One extra Redis read: `HGET group:{group_id} margin_call_level`. If we store `margin_call_level_threshold` in the account summary hash when we write (recommended), cache-hit path needs no extra Redis call—just one more field in the same HGET batch.  
  - **REST (cache miss):** Unchanged summary computation; then one `SELECT group_id FROM users WHERE id = $1` (PK lookup) and `get_margin_call_level_for_group` (Redis then DB on miss).  
  - **Background (order/position/tick → recompute summary):** One `group_id` lookup and one threshold lookup (Redis-first); then write summary + threshold to Redis and publish. No extra round-trips for the frontend.  
- **Reliability:** Threshold is read from Redis (or DB on cold cache). Admin updates overwrite Redis so the next request or publish sees the new value. Default (e.g. 50%) when threshold is null keeps behavior defined.

---

## 2. What We Already Have

| Area | Current State |
|------|----------------|
| **Margin level (current)** | Computed in backend `compute_account_summary_inner` as `(equity / margin_used) * 100` or `"inf"`. Cached in Redis at `pos:summary:{user_id}` (hash field `margin_level`). Served by `GET /api/account/summary` and pushed via WebSocket `account.summary.updated`. |
| **Frontend account summary** | `useAccountSummary()` in `src/features/wallet/hooks/useAccountSummary.ts` – single source; used by BottomDock, LeftSidebar, RightTradingPanel. `AccountSummaryResponse` has `marginLevel: string` (e.g. `"45.23"` or `"inf"`). |
| **Bottom dock** | `BottomDock.tsx` displays Balance, Equity, Margin, Free Margin, Margin Level, PnL from `accountSummary` – **no extra calculation**. |
| **Group / user** | Users have `group_id` (FK to `user_groups`). JWT `Claims` include `group_id`. `user_groups` has group-level settings (e.g. leverage, trading_enabled); no `margin_call_level` yet. |
| **Redis** | Account summary under `Keys::account_summary(user_id)` (= `pos:summary:{user_id}`). No Redis key yet for group-level settings (e.g. margin call level). |
| **Deposit flow** | `DepositModal` in `src/features/wallet/components/DepositModal.tsx`; used in LeftSidebar. Can be opened programmatically (e.g. from margin call popup). |

---

## 3. What We Need to Do

### 3.1 Storage (DB + Redis)

- **Database**
  - Add **margin_call_level** to **user_groups** (e.g. `NUMERIC(5,2) NULL` for percentage; `NULL` = use platform default, e.g. 50).
  - Migration: new migration file in `database/migrations/`.

- **Redis**
  - Cache the group’s **margin_call_level** for fast reads (no DB hit on every account summary request).
  - Use a key per group, e.g. **`group:{group_id}`** with a field **`margin_call_level`** (string).
  - **Read path:** when building account summary or when checking threshold, resolve `user_id` → `group_id` (from JWT), then get `margin_call_level` from Redis; on cache miss, load from DB and set in Redis.
  - **Invalidation:** when admin updates a group’s margin call level, update DB and overwrite/delete the Redis key for that group so next read gets the new value.

### 3.2 Backend

- **Account summary API** (`get_account_summary` in `deposits.rs`)
  - **Cache-hit path:** Read `margin_call_level_threshold` from the same Redis hash (`pos:summary:{user_id}`) if we store it when writing (recommended). Otherwise resolve **group_id** from JWT `claims.group_id`, then **HGET `group:{group_id}` `margin_call_level`** and add to response.
  - **Cache-miss path:** After `compute_account_summary_inner`, get **group_id** (e.g. `SELECT group_id FROM users WHERE id = $1`), call **get_margin_call_level_for_group**, add **margin_call_level_threshold** to **AccountSummary** and return.
  - Add **margin_call_level_threshold** to the **AccountSummary** struct (e.g. `Option<f64>`; frontend uses 50 when null).
- **Publish path (WebSocket)**  
  - In **compute_and_cache_account_summary_with_prices**: after `compute_account_summary_inner`, get user’s **group_id** (one PK query: `SELECT group_id FROM users WHERE id = $1`), then **get_margin_call_level_for_group(redis, pool, group_id)**. Build summary with **margin_call_level_threshold**, write all fields (including threshold) to `pos:summary:{user_id}`, then **publish** the same summary JSON so the WebSocket payload includes the threshold. Frontend then works with both REST and WebSocket without an extra fetch.

- **Admin groups**
  - **Router must have Redis:** Today `create_admin_groups_router(pool)` only has `PgPool`. Main must pass Redis (e.g. `create_admin_groups_router(pool, redis)`) so that on group update we can **HSET `group:{group_id}` `margin_call_level`** with the new value. That way the next account summary (REST or WebSocket) sees the new threshold without a DB hit.
  - **Update group:** extend request body and DB update to include **margin_call_level** (optional number; `null` = use default).
  - **List/Get group:** include **margin_call_level** in response. **UserGroup** model and list SELECT must include the new column.
  - On group update: after DB update, **HSET** Redis `group:{group_id}` `margin_call_level` (or DEL key if using “no threshold”).

- **Rust**
  - Add **margin_call_level** to **UserGroup** model (or to the struct used for list/get/update).
  - **redis-model:** add `Keys::group(group_id)` → `format!("group:{}", group_id)`.
  - Helper (e.g. in deposits or a small group_cache module): `get_margin_call_level_for_group(redis, pool, group_id) -> Option<f64>` with Redis-first, then DB, then cache set.

### 3.3 Frontend

- **Types**
  - **AccountSummaryResponse** (`src/features/wallet/api.ts`): add **marginCallLevelThreshold** (e.g. `number | null`). If `null`, use default (e.g. 50) for comparison.

- **Margin call logic**
  - One place that has access to **account summary** (e.g. a provider, or a component that uses `useAccountSummary()` and is mounted when the user is on the terminal).
  - On every relevant update (account summary from API or WebSocket):
    - Parse **marginLevel** (ignore if `"inf"`).
    - Compare to **marginCallLevelThreshold ?? 50**.
    - If **current &lt; threshold**: set “margin call active” and optionally track “last shown” to avoid spamming (e.g. show toast + modal once per “crossing below” or with a short cooldown).
  - When margin call is active: show **toast** and open **MarginCallModal**.

- **MarginCallModal**
  - New component (e.g. under `src/features/wallet/components/` or `src/features/terminal/components/`).
  - Content:
    - Title: e.g. “Margin call”
    - Short message: margin level is below the set level (e.g. 50%).
    - **Details:** current margin level %, threshold %, equity, margin used, free margin (all from `accountSummary`).
    - Optional: “Add at least $X to bring margin level above threshold” (if we can compute it).
    - **Deposit** button: opens existing **DepositModal** (e.g. by lifting state or a callback from a parent that renders both modals).
  - Close button; optionally “Don’t show again for X minutes” (local state or localStorage).

- **Deposit**
  - Reuse **DepositModal**; from MarginCallModal, trigger opening it (e.g. callback `onDepositClick` that parent uses to set `depositModalOpen = true`).

### 3.4 Admin UI (Groups)

- **Groups list / edit**
  - Add **Margin call level (%)** to the group form (create + update).
  - Show in list/detail if useful (e.g. column or in expandable row).
  - Send **margin_call_level** in create/update payload; backend persists and invalidates Redis as above.

---

## 4. Implementation Steps (Ordered)

| # | Step | Details |
|---|------|--------|
| 1 | **DB migration** | Add `margin_call_level NUMERIC(5,2) NULL` to `user_groups`. Default `NULL` = use platform default (50) in app logic. Then add **margin_call_level: Option<f64>** (or map from NUMERIC) to **UserGroup** in `models/user_group.rs` so `RETURNING *` and list SELECTs work. |
| 2 | **Redis key** | In `crates/redis-model/src/keys.rs`, add `Keys::group(group_id)` → `group:{group_id}`. Use a hash so we can add more group settings later (e.g. `HSET group:{id} margin_call_level 50`). |
| 3 | **Backend: get threshold** | Implement `get_margin_call_level_for_group(redis, pool, group_id)` – Redis hash get `margin_call_level`; on miss query DB, then HSET. Return `Option<f64>`. |
| 4 | **Backend: account summary** | Extend `AccountSummary` with `margin_call_level_threshold: Option<f64>`. **Cache hit:** read threshold from `pos:summary` hash (if stored there) or from `group:{group_id}`; add to response. **Cache miss:** after compute, get user’s `group_id` (one query), call `get_margin_call_level_for_group`, add threshold to response. |
| 4b | **Backend: publish path** | In `compute_and_cache_account_summary_with_prices`: after `compute_account_summary_inner`, get user’s `group_id` (SELECT by user id), get threshold via `get_margin_call_level_for_group`, build summary with threshold, **HSET** all fields including `margin_call_level_threshold` into `pos:summary:{user_id}`, then **publish** the same JSON so WebSocket payload includes threshold. |
| 5 | **Backend: admin groups** | **Main.rs:** pass Redis into `create_admin_groups_router(pool, redis)`. Extend `UpdateGroupRequest` and create/update handlers to accept `margin_call_level`. In list/get, include `margin_call_level` (add to **UserGroup** model and to list SELECT). On update: after DB update, **HSET** Redis `group:{group_id}` `margin_call_level` with new value. |
| 6 | **Frontend: types** | Add `marginCallLevelThreshold?: number | null` to `AccountSummaryResponse` in `src/features/wallet/api.ts`. |
| 7 | **Frontend: margin call logic** | Add a small hook or component (e.g. `useMarginCall` or `MarginCallGuard`) that uses `useAccountSummary()`, compares `marginLevel` to `marginCallLevelThreshold ?? 50`, sets “below threshold” state and “last shown” for cooldown. Trigger toast + open modal when below. |
| 8 | **Frontend: MarginCallModal** | New modal: title, message, margin details (level, threshold, equity, margin used, free margin), Deposit button. Deposit button triggers parent to open `DepositModal`. |
| 9 | **Frontend: wire modal + toast** | Where terminal layout is rendered (e.g. layout that has BottomDock / account summary), render `MarginCallModal` and connect “open deposit” to existing `DepositModal`. Ensure toast is shown (e.g. `react-hot-toast`) when margin call triggers. |
| 10 | **Admin: groups UI** | Add “Margin call level (%)” field to group create/edit form; add to list/detail as needed; use existing list/update API with new field. |

---

## 5. Why this will work (no impact on speed)

- **Single source of truth:** Margin level stays as today (computed once, Redis + WebSocket). We only add a **read** of a cached group setting and one optional field on the response.
- **No extra frontend work:** Threshold comes with the same account summary the UI already uses; no extra API call or recalculation.
- **Cache-first:** Threshold is always read from Redis when possible; DB is used only on cold cache or after admin change, then Redis is updated.
- **Admin path:** One extra Redis write on group update; no ongoing cost.
- **Background path:** One PK lookup (`users.id` → `group_id`) and one threshold lookup per summary recompute; summary is already recomputed on events, so this is additive only.

---

## 6. Edge Cases & Notes

- **No group / group_id null:** Treat as no threshold or use platform default (e.g. 50%). Backend can return `margin_call_level_threshold: null`; frontend uses 50.
- **margin_level = "inf":** Do not trigger margin call (user has no margin used).
- **Cooldown:** To avoid spamming, consider: show toast + modal once when crossing below threshold; do not show again until margin level is above threshold and then crosses below again, or use a time-based cooldown (e.g. 2 minutes).
- **WebSocket:** Account summary updates via `account.summary.updated` already push new balance, equity, margin_level, etc. Include **margin_call_level_threshold** in that payload if the backend publishes the same shape as the REST response; then frontend margin-call logic works on WebSocket updates without extra fetch.
- **Redis key TTL (optional):** If you want cache to expire, set a TTL on `group:{group_id}`; otherwise no TTL is fine and invalidation on update is enough.

---

## 7. File / Location Summary

| Layer | Files / locations |
|-------|--------------------|
| **DB** | New migration in `database/migrations/` (e.g. `0017_user_groups_margin_call_level.sql`). |
| **Redis keys** | `crates/redis-model/src/keys.rs` – add `group(group_id)`. |
| **Backend** | `backend/auth-service/src/routes/deposits.rs` (account summary + helper), `backend/auth-service/src/routes/admin_groups.rs` (update/list/get group), `backend/auth-service/src/services/admin_groups_service.rs` (DB + Redis invalidation), `backend/auth-service/src/models/user_group.rs` (add field if using FromRow). |
| **Frontend** | `src/features/wallet/api.ts` (type), `src/features/wallet/hooks/useAccountSummary.ts` (no change; response already used), new hook/component for margin call check, new `MarginCallModal`, terminal layout to mount modal + Deposit. |
| **Admin UI** | Groups form and list (e.g. under `src/features/groups/` or admin groups page). |

---

## 8. Success Criteria

- Margin call level is stored **per group** in **DB** and **Redis**.
- **GET /api/account/summary** (and WebSocket payload if aligned) returns **marginCallLevelThreshold**.
- When user’s margin level goes **below** that threshold (or below 50% if threshold is null), user sees a **toast** and **popup** with margin details and a **Deposit** button that opens the existing deposit flow.
- Admin can set/edit **margin call level** for a group; changes are reflected after cache invalidation.

---

## 9. Pre-implementation checklist

Before starting, confirm in the codebase:

- [ ] JWT `Claims` has `group_id` (used in `get_account_summary` and elsewhere).
- [ ] `GET /api/account/summary` is served by `get_account_summary` with `Extension(claims)` and `Extension(deposits_state)` (Redis + pool).
- [ ] Account summary is published to `account:summary:updated` with the same struct we will extend.
- [ ] `DepositModal` exists and can be opened from a parent (e.g. `open` / `onOpenChange` or callback).
- [ ] `create_admin_groups_router` is called with `pool` only in `main.rs`; we will add `redis` as second argument.

---

*Once this plan is validated, implementation can start from step 1 and proceed in order.*
