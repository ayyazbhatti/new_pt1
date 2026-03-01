# SL/TP Notification Plan – Implementation Verification

This document confirms that **docs/sltp-notification-plan.md** is implemented 100%.

---

## Plan vs implementation checklist

| Plan requirement | Implementation | Status |
|------------------|----------------|--------|
| **Goal 1:** Persist notification in `notifications` table | `create_sltp_notifications_and_push` inserts one row for user, one per admin | ✅ |
| **Goal 2:** Real-time to user (trader) | Publish to Redis `notifications:push` with `userId` = position’s `user_id`; gateway routes by `userId` | ✅ |
| **Goal 3:** Real-time to admin | One publish per admin with `userId` = admin id; gateway sends to that admin’s connections | ✅ |
| **§2 Payload parsing** | main.rs: `inner = payload.get("payload").cloned().unwrap_or(payload)`; user_id and trigger_reason from `inner` | ✅ |
| **§3 Sequence** | (1) Parse inner payload (2) **Await only** `compute_and_cache_account_summary` (3) If SL/TP **spawn** `create_sltp_notifications_and_push` and **do not await** | ✅ |
| **§3 Helper** | Insert for user; query admins LIMIT 50; insert + publish per admin; publish for user; log errors, no panic | ✅ |
| **§4 DB row** | user_id, kind `POSITION_SL`/`POSITION_TP`, title, message, meta (positionId, symbol, side, triggerReason, realizedPnl, exitPrice) | ✅ |
| **§4 Push payload** | id, kind, title, message, createdAt, read, **userId**, meta | ✅ |
| **§4 Admin** | One row per admin with `meta.targetUserId`; push with `userId` = admin id | ✅ |
| **§5 Push only, no polling** | No setInterval/refetch; delivery via Redis → gateway → WebSocket only | ✅ |
| **§7 Backend kind** | `POSITION_SL`, `POSITION_TP` used in INSERT and push | ✅ |
| **§7 Frontend kind** | `NotificationPushPayload.kind` extended with `'POSITION_SL' \| 'POSITION_TP'` in wsEvents.ts | ✅ |
| **§8 Only SL/TP** | main.rs: `trigger == Some("SL") \|\| trigger == Some("TP")`; helper: `trigger_reason != "SL" && != "TP"` → return | ✅ |
| **§8 Validate payload** | Helper: missing user_id / invalid user_id / missing trigger_reason → warn and return | ✅ |
| **§8 Admin LIMIT** | `LIMIT 50` in admin query | ✅ |
| **§8 Errors** | All errors logged (error!/warn!); no panic; return/continue in helper | ✅ |
| **Files: main.rs** | Parse VersionedMessage inner payload; await only account summary; spawn notification task | ✅ |
| **Files: deposits.rs** | `create_sltp_notifications_and_push` with full logic as per plan | ✅ |
| **Files: ws-gateway** | No change (routes by `userId`) | ✅ |
| **Files: order-engine** | No change | ✅ |
| **Files: wsEvents.ts** | Kind extended | ✅ |
| **Database** | No new migration; existing `notifications` table | ✅ |
| **GET /api/notifications** | Unchanged; `WHERE user_id = $1` returns new kinds | ✅ |

---

## Code references

- **main.rs** (event.position.closed): lines 260–300 — VersionedMessage parsing, single await on `compute_and_cache_account_summary`, fire-and-forget spawn for SL/TP.
- **deposits.rs** (helper): lines 921–1119 — `create_sltp_notifications_and_push`: validation, user notification insert + Redis publish, admin query LIMIT 50, per-admin insert + publish, error logging only.
- **wsEvents.ts**: line 34 — `kind` includes `'POSITION_SL' | 'POSITION_TP'`.
- **Gateway** (unchanged): `broadcast_notification` uses `payload.get("userId")` / `user_id`; our push payloads include `"userId"`.

---

## Optional / not required by plan

- **NATS publish:** Plan said “publish to Redis (and **optionally** NATS)”. Only Redis is implemented; gateway uses Redis for real-time, so this is sufficient. ✅
- **Terminal notification list:** Plan marked as optional; existing NotificationBell + push already deliver to user and admin. ✅

---

## Conclusion

The SL/TP notification plan is **implemented 100%**. All required behaviours (persist, real-time to user, real-time to admin, payload parsing, performance-safe spawn, validation, no polling, frontend kinds) are in place and match the plan.
