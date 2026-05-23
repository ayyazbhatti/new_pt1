# ws-gateway: account summary forwarding fix

## Context

Per **`docs/ws-gateway-account-summary-forwarding-diagnostic.md`**, when the per-connection outbound queue (`mpsc`, cap **`WS_CONN_CHANNEL_CAP`** = 4096) is full of **ticks**, `try_dispatch_conn` used **`try_send`**. **Order** and **position** updates were retried with **`tokio::spawn` + `send().await`**, but **`AccountSummaryUpdated`** fell through to a **`debug!`** and was **dropped**. Users could see **order/position** updates while **equity / margin / free margin** lagged until a later summary publish (often reported as **~4–5 seconds**).

Production Redis/auth timing was already fast (`docs/account-summary-redis-cache-diagnostic.md`); this fix targets **ws-gateway delivery** only.

## Scope

- **Modified file:** `backend/ws-gateway/src/stream/broadcaster.rs` only.
- **Not changed:** `WS_CONN_CHANNEL_CAP`, auth-service publish path, frontend, channel architecture.

## Code changes

### 1. `try_dispatch_conn` — queue-full handling (`TrySendError::Full`)

**Before (conceptual):**

- Ticks: silent drop.
- `OrderUpdate` | `PositionUpdate`: `tokio::spawn` + `send` retry.
- Everything else (including **`AccountSummaryUpdated`**): `debug!("… dropping non-tick")` and drop.

**After:** Documented **three tiers** in comments; **`AccountSummaryUpdated`** is included in the same **`matches!`** arm as order/position and uses the same **`tokio::spawn` + `send`** retry. Remaining message kinds still drop, but at **`warn!`** with **`std::mem::discriminant(&m)`** for variant visibility without requiring `Debug` on payloads.

Current implementation (reference):

```27:53:backend/ws-gateway/src/stream/broadcaster.rs
        Err(TrySendError::Full(m)) => {
            // Outbound queue saturation tiers (see docs/ws-gateway-account-summary-forwarding-diagnostic.md):
            // 1) Ticks — safe to drop (high rate, UI interpolates).
            // 2) Order / position / account summary — user-visible trading & balance state; must not be lost
            //    behind tick bursts → async send retry.
            // 3) Everything else — drop with warn for ops visibility (non-critical under tick pressure).
            if matches!(m, ServerMessage::Tick { .. }) {
                // expected under high tick rate
            } else if matches!(
                &m,
                ServerMessage::OrderUpdate { .. }
                    | ServerMessage::PositionUpdate { .. }
                    | ServerMessage::AccountSummaryUpdated { .. }
            ) {
                // Avoid dropping fills, position opens, and account state updates when the queue is full of ticks.
                // These are user-visible financial state changes that must be delivered even under tick pressure.
                let sender2 = sender.clone();
                tokio::spawn(async move {
                    let _ = sender2.send(m).await;
                });
            } else {
                warn!(
                    conn_id = %conn_id,
                    kind = ?std::mem::discriminant(&m),
                    "outbound queue full; dropping non-critical message"
                );
            }
        }
```

### 2. `broadcast_account_summary` — empty connection set (C1 visibility)

When **`get_user_connections(user_id)`** returns **no** connection IDs, log at **`warn!`** so ops can detect registry/auth mismatches or “user not on WS” without silent no-ops.

```636:646:backend/ws-gateway/src/stream/broadcaster.rs
        let connections = registry.get_user_connections(user_id);
        if connections.is_empty() {
            warn!(
                user_id = %user_id,
                "Account summary update received but no WebSocket connections registered for user"
            );
        } else {
            for conn_id in connections {
                try_dispatch_conn(registry, connection_txs, conn_id, message.clone());
            }
        }
```

## New / upgraded logs (ops)

| Log | When | Purpose |
|-----|------|--------|
| `Account summary update received but no WebSocket connections registered for user` | Redis summary for `userId` but **zero** WS sessions | **C1** — registry miss / user offline / auth not completed |
| `outbound queue full; dropping non-critical message` + `kind` discriminant | Queue full, message is **not** tick / order / position / account summary | **C2** visibility at **WARN** (was DEBUG for non-tick drops) |

Account summary under saturation should **no longer** hit the drop path; it uses the **retry** path like orders/positions.

## Build verification

```bash
cd backend/ws-gateway && cargo check   # OK
cd .. && cd .. && cargo check --workspace   # OK (from repo root)
cd backend/ws-gateway && cargo test    # OK — 0 tests in crate (bin-only)
```

There are **no** `ws-gateway` unit tests under `broadcaster` today (`running 0 tests`).

## Smoke test (production)

1. Deploy **`ws-gateway`** with this change.
2. Have **`cokykod@mailinator.com`** (or any active terminal user) **place an order** while subscribed to symbols (tick load).
3. Expect **equity / margin / free margin** to update in **~sub-second** range alongside order feedback, assuming Redis publish remains fast.

**Monitor:**

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production logs ws-gateway --tail 0 --follow 2>&1 \
  | grep -E "queue full|no WebSocket connections registered"
```

- **Success:** Fewer or no `dropping non-critical` lines for account-summary traffic; UI updates track Redis quickly.
- **Still slow + “no WebSocket connections”:** Investigate **auth / registry** (not queue drop).
- **Frequent `dropping non-critical`:** Other message types still contending; consider future prioritization (out of scope for this change).

## Summary

**Account summary WebSocket messages are now retried on full outbound queues like order and position updates**, with **WARN-level** visibility for **empty fan-out** and for **drops of non-critical** messages under saturation — addressing the **post-order ~4–5s balance UI lag** tied to **dropped** `AccountSummaryUpdated` behind tick bursts.
