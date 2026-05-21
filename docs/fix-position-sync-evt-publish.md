# Fix: emit `evt.position.updated` so Postgres `positions` stays in sync with Redis

**Problem:** Open positions exist in Redis (`pos:by_id:{uuid}`) but never appear in Postgres because **auth-service** only persists positions when it receives **`evt.position.updated`** (see `docs/position-redis-postgres-sync-diagnostic-442fde7b.md`). The order engine was publishing **`evt.order.updated`** in cases where **`evt.position.updated`** was missing (notably duplicate-fill / idempotent Lua paths and SL/TP closes).

**Out of scope:** Backfilling historical Redis-only positions; changing Lua; changing auth consumer code.

---

## Step 1 — Position-mutating paths and NATS publish coverage

| File | Location / action | Publishes `evt.order.updated`? | Publishes `evt.position.updated`? | Gap? |
|------|-------------------|-------------------------------|-----------------------------------|------|
| `tick_handler.rs` | `execute_fill` success path (normal Lua fill) | Yes | Yes (`publish_position_updated`) | **No** |
| `tick_handler.rs` | `execute_fill` when Lua returns `{"error":"order_not_pending","status":"FILLED"}` (duplicate concurrent fill) | **Was missing**; now via `sync_duplicate_fill_to_db` | **Was missing**; now **Yes** | **YES → fixed** |
| `tick_handler.rs` | `process_tick` `Err` after `execute_fill` | Previously republished order only for some errors | N/A | **Superseded**: duplicate fill now returns `Ok` from `execute_fill`, so this branch only logs generic errors |
| `order_handler.rs` | Immediate market fill: `Ok(result)` with `result.error` (e.g. `order_not_pending` + `FILLED`) | **Was missing** | **Was missing** | **YES → fixed** (`sync_duplicate_fill_to_db` + cache update) |
| `order_handler.rs` | Immediate market fill success (`Ok`, no Lua `error`) | Yes | Yes (`publish_position_updated` at ~554) | **No** |
| `order_handler.rs` | Netting close branch | N/A | Yes (closed + open) | **No** |
| `position_handler.rs` | Reopen / reopen_with_params / update_params / close-all | Mixed (`event.position.*`) | Yes on paths that already called `publish_position_updated` | **No change** |
| `sltp_handler.rs` | `trigger_closure` after `atomic_close_position` | `event.position.closed` | **Was missing** | **YES → fixed** (`publish_position_updated(..., Some(Closed))`) |
| `position_events.rs` | `publish_position_updated` helper | N/A | Yes (subject `evt.position.updated`) | **N/A** |
| `execution.rs` | Legacy `publish_event("evt.position.updated", …)` | — | — | **Not wired** in current binary (`main` does not `mod execution`); left unchanged |

---

## Step 2 — Design

1. **`sync_duplicate_fill_to_db` (`position_events.rs`)**  
   - After `evt.order.updated`, resolve **`pos:{user_id}` → newest OPEN `pos:by_id:*`** for the order’s symbol (`find_latest_open_position_id_for_user_symbol`).  
   - Call existing **`publish_position_updated(nats, conn, position_id, None)`** (warn on `Err`; NATS publish failure inside helper is already logged).  
   - **Order:** publish **`evt.order.updated` first**, then **`evt.position.updated`** (matches prior recovery branch).  
   - **Failure policy:** warn-and-continue; never roll back Redis order state.

2. **`execute_fill` (`tick_handler.rs`)**  
   - Treat **`order_not_pending` + `FILLED`** as **idempotent success**: run `sync_duplicate_fill_to_db`, update in-memory cache, `return Ok(())` instead of `Err`.

3. **`order_handler.rs` immediate fill**  
   - Same Lua JSON shape as tick path: on **`order_not_pending` + `FILLED`**, call **`sync_duplicate_fill_to_db`** and mark cache Filled (same as successful immediate fill tail).

4. **`sltp_handler.rs`**  
   - After **`event.position.closed`**, call **`publish_position_updated(..., Some(Closed))`** so auth DB sees closed rows.

---

## Step 3 — Code changes (summary)

### `apps/order-engine/src/engine/position_events.rs`

- Added **`find_latest_open_position_id_for_user_symbol`** (SMEMBERS + HGETALL, pick max `opened_at` among OPEN rows for normalized symbol).  
- Added **`sync_duplicate_fill_to_db`** with comment referencing `docs/position-redis-postgres-sync-diagnostic-442fde7b.md`.

### `apps/order-engine/src/engine/tick_handler.rs`

- In **`execute_fill`**, branch on Lua `error` + `status` **before** returning `Err`.

### `apps/order-engine/src/engine/order_handler.rs`

- In immediate **`Ok(result)`** branch when `result.error` is set, special-case **`order_not_pending` / `FILLED`** → **`sync_duplicate_fill_to_db`** + cache Filled.

### `apps/order-engine/src/engine/sltp_handler.rs`

- Import **`PositionStatus`** and **`position_events`**.  
- After successful **`EVENT_POSITION_CLOSED`** publish, **`publish_position_updated(..., Some(Closed))`** with warn on failure.

---

## Step 4 — WARN vs Redis `FILLED` (immediate fill) — follow-up

**Finding (no code change in this pass):**

- `LuaScripts::atomic_fill_order` (`lua.rs`) attaches context **`"Failed to execute atomic_fill_order Lua script"`** only when **`invoke_async`** fails (Redis / script transport), **not** when Lua returns a JSON body with an `error` field (that path returns **`Ok(Value)`**).
- Therefore a log line **`WARN … Failed to execute atomic_fill_order Lua script`** implies the **Redis `EVAL` path failed**, while a later tick (or another handler) may still have completed the fill — **or** logs/order of events interleaved. This deserves a **separate** investigation (connection pooling, double-submit, Lua `EVALSHA` reload, etc.).

**When Lua returns JSON `error` without throwing:** `order_handler` receives **`Ok(result)`**; that is what we now handle with **`order_not_pending` + `FILLED`**.

---

## Step 5 — Build verification

```bash
cd apps/order-engine && cargo check   # OK
cd backend/auth-service && cargo check # OK (unchanged API surface)
```

---

## Smoke test (manual — not fully automated here)

**Baseline (this workspace, pre-restart of binaries):**

```sql
SELECT COUNT(*) FROM positions WHERE opened_at > NOW() - INTERVAL '24 hours';
-- 0
```

```bash
redis-cli --scan --pattern 'pos:by_id:*' | wc -l
# 84
```

**After deploying rebuilt order-engine + auth-service:**

1. Place a small **market** order on a USD-quoted symbol (e.g. BTCUSDT).  
2. Wait ~10s.  
3. Confirm **`HGETALL pos:by_id:{id}`** in Redis **and** **`SELECT * FROM positions WHERE id = '{id}'`** in Postgres.  
4. Auth logs: **`position_event_handler`** should show payload handling (e.g. “Received position update” / “Creating new position” depending on log level).  
5. Re-run fee diagnostic SQL from `docs/trading-costs-position-fee-diagnostic-442fde7b.md` — **Step 1** should return a row for the new position id.

*Automated smoke after restart was not executed in the agent session.*

---

## References

- `docs/position-redis-postgres-sync-diagnostic-442fde7b.md` — original read-only diagnosis (filename differs from older draft `position-redis-vs-postgres-sync-442fde7b.md`).
