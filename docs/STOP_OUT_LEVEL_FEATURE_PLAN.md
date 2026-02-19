# Stop Out Level Feature – Implementation Plan

## 1. Overview

When a user’s **margin level** falls **below** a configurable **stop out level** (e.g. 20%), the system will **close all of that user’s open positions** automatically (stop out / liquidation). The **stop out level** is stored **per group** in the **database** and **cached in Redis** (same pattern as margin call level) for fast execution.

Additionally, the **Close All Positions** button in the **bottom dock toolbar** (Positions tab) allows users to manually close all positions at any time. When stop out triggers, the same “close all” action is executed automatically by the backend.

**Plan validation:** This plan has been checked against the current codebase. It reuses existing patterns (margin call level, NATS close flow, Redis group hash, order-engine position close). Performance is preserved by batching threshold reads and using a cooldown so the critical path has no extra round-trips. Section 7 (Performance), Section 8 (NATS wiring), and Section 11 (Risks & Mitigations) ensure the design is valid and will work as intended.

---

## 2. Relationship to Margin Call Level

| Feature            | Margin call level | Stop out level      |
|--------------------|-------------------|----------------------|
| **Purpose**        | Warning + deposit | Liquidation          |
| **Typical value**  | e.g. 50%          | e.g. 20% (stricter) |
| **When breached** | Toast + modal     | Close all positions  |
| **Storage**        | DB + Redis        | DB + Redis (same)    |

Stop out level should be **lower** than margin call level (e.g. margin call 50%, stop out 20%). Both are optional per-group settings.

---

## 3. What We Already Have

| Area | Current State |
|------|----------------|
| **Margin level** | Computed in auth-service `compute_account_summary_inner`; cached in Redis `pos:summary:{user_id}`; served by `GET /api/account/summary` and WebSocket `account.summary.updated`. |
| **Group settings in Redis** | `Keys::group(group_id)` → hash `group:{group_id}` with field `margin_call_level`. Same hash can hold `stop_out_level`. |
| **Group settings in DB** | `user_groups` has `margin_call_level NUMERIC(5,2) NULL`. Same table will get `stop_out_level`. |
| **Threshold in summary** | `AccountSummary` has `margin_call_level_threshold`; read via `get_margin_call_level_for_group(redis, pool, group_id)` (Redis-first, then DB). Same pattern for stop out. |
| **Close single position** | Auth-service: `POST /:user_id/positions/:position_id/close` → publishes NATS `cmd.position.close` → order-engine `handle_close_position` processes it. |
| **Close All UI** | BottomDock (Positions tab) has a **Close All** button and dialog that loops over open positions and calls `closePosition(pos.id)` for each. Works but is sequential; optional later: single “close all” API for speed. |
| **Order-engine** | Subscribes to `cmd.position.close`; has `atomic_close_position` Lua; has `Keys::positions_set(user_id)` = `pos:{user_id}` (set of position IDs). |

---

## 4. What We Need to Do

### 4.1 Storage (DB + Redis)

- **Database**
  - Add **stop_out_level** to **user_groups** (e.g. `NUMERIC(5,2) NULL`). `NULL` = no automatic stop out (or use platform default if desired).
  - New migration in `database/migrations/` (e.g. `0018_user_groups_stop_out_level.sql`).

- **Redis**
  - Use the **existing** group hash **`group:{group_id}`**. Add field **`stop_out_level`** (string, e.g. `"20"`).
  - **Read path:** When building account summary or when checking stop out, get `stop_out_level` from Redis; on miss, load from DB and set in Redis (same as `get_margin_call_level_for_group`).
  - **Invalidation:** When admin updates a group’s stop out level, update DB and **HSET** `group:{group_id}` `stop_out_level` (or **HDEL** if clearing).

### 4.2 Backend – Auth-Service

- **UserGroup model**  
  Add **stop_out_level: Option&lt;Decimal&gt;** in `backend/auth-service/src/models/user_group.rs`.

- **Helper: get stop out level for group**  
  In `deposits.rs` (or shared module), add **get_stop_out_level_for_group(redis, pool, group_id) -> Option&lt;f64&gt;** with Redis-first, then DB, then cache set—mirror **get_margin_call_level_for_group**.

- **Account summary**  
  - Extend **AccountSummary** with **stop_out_level_threshold: Option&lt;f64&gt;**.
  - In **cache-hit path:** Read `stop_out_level_threshold` from `pos:summary:{user_id}` hash (stored when writing summary).
  - In **cache-miss path:** After compute, get user’s **group_id**, call **get_stop_out_level_for_group**, add to summary.
  - In **compute_and_cache_account_summary_with_prices:** Get **group_id** and **stop_out_level** (same as margin call threshold); write **stop_out_level_threshold** into `pos:summary:{user_id}` and include in published JSON.

- **Stop out trigger (automatic close all)**  
  When we have just computed the account summary and written it to Redis:
  - Parse **margin_level** (ignore if `"inf"`).
  - Get **stop_out_level_threshold** for the user’s group (already fetched above).
  - If threshold is set and **margin_level &lt; threshold**: trigger “close all positions” for this user.
  - **Avoid repeated triggers:** Use a Redis key e.g. **pos:stop_out:triggered:{user_id}** with **TTL 60** (seconds). Before publishing close_all, **SET key 1 EX 60 NX**; only if NX succeeds, publish **cmd.position.close_all** to NATS. So we only send close_all once per stop-out event per user within 60s.

- **NATS**  
  Auth-service already publishes to NATS (`cmd.position.close`). Add publish to **cmd.position.close_all** with payload **{ user_id, correlation_id, ts }** when stop out condition is met (and cooldown allows).

- **Admin groups**  
  - **Create/Update group:** Accept **stop_out_level** (optional number; `null` = clear).
  - **List/Get group:** Include **stop_out_level** in response.
  - On update: after DB update, **HSET** Redis `group:{group_id}` **stop_out_level** (or HDEL if null).

### 4.3 Backend – Order-Engine

- **New NATS subject:** Add **CMD_POSITION_CLOSE_ALL** (e.g. `"cmd.position.close_all"`) in **apps/order-engine/src/subjects.rs**; subscribe in **main.rs** alongside **CMD_POSITION_CLOSE**.
- **New handler:** **handle_close_all_positions** (e.g. in **engine/position_handler.rs** or a small dedicated module).
  - Payload: **{ user_id, correlation_id?, ts? }**.
  - **SMEMBERS pos:{user_id}** (Keys::positions_set) returns all position IDs (open + closed). For each **position_id**, **HGET pos:by_id:{position_id} status**. If status is **OPEN**, call existing close logic: get **symbol** and **group_id** from the same hash, get last tick from **OrderCache** (same as **handle_close_position**), compute exit price (bid for LONG, ask for SHORT), then **atomic_close_position**. Optionally extract **close_position_by_id(user_id, position_id)** used by both **handle_close_position** and **handle_close_all_positions** to avoid duplication.
  - Process closes **sequentially** so balance and positions stay consistent. Reuse the same tick cache and Lua script as single-position close.
  - **Idempotency:** Each position close is already idempotent (Lua returns error if not OPEN); duplicate close_all messages for the same user within 60s are acceptable (second run will see no OPEN positions).

### 4.4 Optional: Single “Close All” API

- **Auth-service:** New endpoint e.g. **POST /:user_id/positions/close-all** that publishes **cmd.position.close_all** to NATS (same payload as above). This gives one round-trip for the UI instead of N round-trips when user clicks “Close All.”
- **Frontend:** “Close All” dialog confirm can call this single endpoint instead of looping **closePosition(pos.id)**. Existing loop remains valid; single API is an optimization.

### 4.5 Frontend

- **Types**  
  In **AccountSummaryResponse** (`src/features/wallet/api.ts`): add **stopOutLevelThreshold?: number | null**.

- **Button dock (BottomDock)**  
  The **Close All** button and dialog already exist in the Positions tab toolbar. No change required for manual close; optional: switch to single “close all” API when available.

- **Stop out feedback (optional)**  
  When account summary shows margin level below stop out threshold, optionally show a toast: “Stop out triggered – closing all positions.” Backend already performs the close; this is UX only. Can be done in the same place as margin call checks (e.g. a small hook that compares marginLevel to stopOutLevelThreshold and shows a one-time toast when below).

### 4.6 Admin UI (Groups)

- **Group form (create/edit)**  
  Add **Stop out level (%)** field (optional number; same UX as Margin call level).
- **Groups list**  
  Add column or display **Stop out level** where appropriate.
- **API**  
  Groups API already supports extra fields; add **stop_out_level** to request/response and backend as above.

---

## 5. Implementation Steps (Ordered)

| # | Step | Details |
|---|------|---------|
| 1 | **DB migration** | Add `stop_out_level NUMERIC(5,2) NULL` to `user_groups`. Add **stop_out_level** to **UserGroup** in `models/user_group.rs`. |
| 2 | **Redis** | No new key. Use existing **group:{group_id}** hash; add field **stop_out_level**. (Already have Keys::group.) |
| 3 | **Backend: get stop out level** | Implement **get_stop_out_level_for_group(redis, pool, group_id)** – Redis HGET, then DB, then HSET. Return Option&lt;f64&gt;. Optional: **get_group_thresholds(redis, pool, group_id)** returning (margin_call, stop_out) with one HGETALL for both to avoid extra round-trips. |
| 4 | **Backend: account summary** | Add **stop_out_level_threshold** to **AccountSummary**. Cache-hit: read **stop_out_level_threshold** from pos:summary hash (same batch as existing fields). Cache-miss and publish path: get group_id, get stop_out_level (or get_group_thresholds), include in summary and in Redis hash + published JSON. |
| 5 | **Backend: stop out trigger** | In auth-service **main**: call **deposits::register_stop_out_nats(nats)** so summary path can publish. In **compute_and_cache_account_summary_with_prices** (after writing summary): if margin_level &lt; stop_out_level_threshold (and threshold is set), SET pos:stop_out:triggered:{user_id} 1 EX 60 NX; if NX ok, publish NATS **cmd.position.close_all** with { user_id, correlation_id, ts }. |
| 6 | **Order-engine: close_all handler** | Add **CMD_POSITION_CLOSE_ALL** subject; subscribe in main. Handler: parse user_id; SMEMBERS pos:{user_id}; for each id HGET pos:by_id:{id} status; if OPEN, call existing close logic (atomic_close_position or equivalent). Process sequentially. |
| 7 | **Backend: admin groups** | Extend create/update/list to include **stop_out_level**. On update, HSET/HDEL Redis group hash. |
| 8 | **Frontend: types** | Add **stopOutLevelThreshold** to **AccountSummaryResponse**. |
| 9 | **Frontend: Close All (optional)** | If “close all” API is added: new API function **closeAllPositions()**; in BottomDock dialog confirm, call it instead of looping closePosition. |
| 10 | **Frontend: stop out toast (optional)** | Hook that compares marginLevel to stopOutLevelThreshold; when below, show toast “Stop out triggered – closing all positions” (e.g. once per crossing). |
| 11 | **Admin: groups UI** | Add “Stop out level (%)” to group form and list. |

---

## 6. File / Location Summary

| Layer | Files / locations |
|-------|--------------------|
| **DB** | New migration `database/migrations/0018_user_groups_stop_out_level.sql`. |
| **Redis** | Existing **group:{group_id}** hash; new field **stop_out_level**. Optional: **pos:stop_out:triggered:{user_id}** (TTL 60) for cooldown. |
| **Auth-service** | `routes/deposits.rs` (summary, get_stop_out_level_for_group, stop-out trigger publish), `routes/admin_groups.rs`, `services/admin_groups_service.rs`, `models/user_group.rs`. |
| **Order-engine** | New handler for **cmd.position.close_all** (e.g. in `engine/position_handler.rs` or new module); subscribe in main. |
| **Frontend** | `src/features/wallet/api.ts` (type), optional close-all API call in `src/features/terminal/api/positions.api.ts`, BottomDock (optional use of close-all API), optional toast in terminal layout. |
| **Admin UI** | Groups form and table (e.g. `GroupFormDialog.tsx`, `GroupsTable.tsx`, groups API types). |

---

## 7. Performance & Optimization (No Negative Impact)

- **Cache-hit path (REST / WebSocket):**  
  Stop out level is stored in the **same** Redis hash as margin call level (`pos:summary:{user_id}`). When we write the summary we add one extra field `stop_out_level_threshold`; when we read, we add one **HGET** in the same batch we already do for the summary (or we already use **HGETALL**/multi-get). **No extra round-trip** on cache hit.

- **Cache-miss / publish path:**  
  We already fetch **group_id** and **get_margin_call_level_for_group** (one Redis HGET + optional DB). For stop out we add **get_stop_out_level_for_group**. To avoid **two** separate HGETs on `group:{group_id}`, we can add a single helper **get_group_thresholds(redis, pool, group_id) -> (Option&lt;f64&gt;, Option&lt;f64&gt;)** that does **one HGETALL group:{group_id}** and returns (margin_call_level, stop_out_level). Then we have **zero extra Redis round-trips** compared to today (one hash read for both thresholds).

- **Stop out trigger:**  
  Runs only **after** we have already computed and written the summary (same code path). One **SET pos:stop_out:triggered:{user_id} 1 EX 60 NX** (cooldown), one **NATS publish** when NX succeeds. No extra DB or Redis reads; no blocking of the summary path.

- **Order-engine close_all:**  
  One **SMEMBERS pos:{user_id}**, then per position one **HGET pos:by_id:{id} status**. Only OPEN positions are closed. Closes reuse existing **atomic_close_position** logic. No new hot path; execution is proportional to number of open positions.

- **Admin update:**  
  One extra **HSET** (or HDEL) on `group:{group_id}` when stop_out_level is updated—same as margin_call_level. No ongoing cost.

**Conclusion:** The feature does not add extra round-trips on the critical path if we batch threshold reads (e.g. get_group_thresholds). Summary response size increases by one optional number; WebSocket payload stays minimal.

---

## 8. Implementation Notes (NATS and Call Sites)

- **Where stop out is triggered:**  
  Inside **compute_and_cache_account_summary_with_prices** (auth-service), after we have written the summary to Redis and have `margin_level` and `stop_out_level_threshold`. We need to **publish** `cmd.position.close_all` to NATS from this function. Today this function does **not** receive NATS.

- **Recommended approach (minimal change):**  
  In auth-service, register NATS for stop-out at startup so the summary path does not need a new parameter threaded through all callers. For example:
  - In **deposits.rs**: add a `OnceCell<Arc<async_nats::Client>>` (or similar) set once from **main** after NATS is connected.
  - In **compute_and_cache_account_summary_with_prices**, after writing the summary: if margin level &lt; stop out threshold, call a small helper that gets the NATS client from the OnceCell and publishes `cmd.position.close_all` (with cooldown key). If NATS is not set (e.g. tests), skip the publish.
  - **main.rs**: after creating `nats_client`, call e.g. `deposits::register_stop_out_nats(Arc::new(nats_client))`.
  - No changes to **PriceTickSummaryHandler**, **OrderEventHandler**, **PositionEventHandler**, or other callers of `compute_and_cache_account_summary*`.

- **Alternative:** Thread `Option<&Arc<async_nats::Client>>` through `compute_and_cache_account_summary_with_prices` and `compute_and_cache_account_summary` and pass it from every caller. Works but touches more files.

---

## 9. Edge Cases & Notes

- **margin_level = "inf":** Do not trigger stop out (no margin used).
- **stop_out_level null:** No automatic close; only manual “Close All” applies.
- **Cooldown:** Use **pos:stop_out:triggered:{user_id}** with TTL 60 so we don’t spam **cmd.position.close_all** on every tick while margin stays below threshold.
- **Order of thresholds:** Admin UI can warn if stop_out_level &gt; margin_call_level (e.g. “Stop out should be lower than margin call”).
- **Close all idempotency:** Order-engine’s close_all handler should only close positions that are still OPEN; duplicate close commands for the same position are already handled by existing close logic.
- **pos:{user_id} contains open and closed:** Redis set `pos:{user_id}` keeps **all** position IDs (open and closed) so the API can return history. The close_all handler must **HGET pos:by_id:{position_id} status** for each id and only close when status is **OPEN**.

---

## 10. Success Criteria

- Stop out level is stored **per group** in **DB** and **Redis** (same pattern as margin call level).
- **GET /api/account/summary** and WebSocket payload include **stopOutLevelThreshold**.
- When user’s margin level drops **below** stop out level, backend triggers **close all positions** (once per cooldown); order-engine closes all open positions for that user.
- **Close All** button in bottom dock continues to work (manual close all); optional: single “close all” API for faster execution.
- Admin can set **stop out level** for a group; changes reflected after Redis invalidation.

---

## 11. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Stop out fires repeatedly on every tick while margin stays below threshold | Redis cooldown key **pos:stop_out:triggered:{user_id}** with TTL 60s; only publish close_all when **SET key 1 EX 60 NX** succeeds. |
| NATS not available in summary computation path | Use OnceCell in deposits.rs set from main; if unset, skip publish (no crash). |
| close_all closes already-closed positions | Filter by **HGET pos:by_id:{id} status**; only call close for status **OPEN**. Lua **atomic_close_position** also returns error if status ≠ OPEN. |
| Two Redis calls for two thresholds (margin_call + stop_out) | Use **get_group_thresholds(redis, pool, group_id)** with one **HGETALL group:{group_id}** and return both; no extra round-trip. |
| Order-engine overwhelmed by many positions | Close positions **sequentially**; optional small delay between closes. No new threads or unbounded parallelism. |

---

## 12. Pre-implementation Checklist

- [x] **group:{group_id}** Redis hash exists and stores **margin_call_level**; same hash will store **stop_out_level**.
- [x] **get_margin_call_level_for_group** exists in deposits; **get_stop_out_level_for_group** (or **get_group_thresholds**) will mirror / extend it.
- [x] Auth-service has NATS and publishes **cmd.position.close**; can publish **cmd.position.close_all** via OnceCell from summary path.
- [x] Order-engine has **Keys::positions_set(user_id)** and **Keys::position_by_id**; **pos:{user_id}** includes open and closed—filter by status.
- [x] BottomDock already has “Close All” button and dialog (sequential close); optional optimization is single API.

---

*Once this plan is validated, implementation can start from step 1 and proceed in order.*
