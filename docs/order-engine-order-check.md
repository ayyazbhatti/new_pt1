# Order a291fdaa – why it stayed pending

## Summary

- **Order created:** Yes (auth-service wrote it to the DB and published to NATS).
- **Order-engine processed it:** No (never stored in Redis, so it was never accepted/filled).
- **Cause:** The order-engine’s `cmd.order.place` subscription is **not active** (`subscription_active: false`, `handler_task_alive: false`), so it is not receiving or processing new order commands.

## Evidence

1. **Auth-service (OK)**  
   - Order `a291fdaa-5301-48b5-8b0d-73fc3c4c47d4` is in the DB: BUY 0.003457 BTCUSDT, market, status `pending`, created 2026-02-15 20:29:53 UTC.  
   - Logs show: `Publishing order command to NATS: cmd.order.place, order_id=a291fdaa-...`

2. **Redis (no trace of this order)**  
   - `order:a291fdaa-5301-48b5-8b0d-73fc3c4c47d4` → missing.  
   - Idempotency key for this order → missing.  
   So the order-engine never stored this order (it never ran the handler successfully for it).

3. **Order-engine health**  
   - `subscription_active: false`  
   - `handler_task_alive: false`  
   - `last_message_age_seconds: 8769` (~2.4 hours since last message)  
   - `handler_entries: 0` (in this process, the place-order handler was never entered)  
   So the subscription loop has exited and the handler task is no longer running.

## Conclusion

The order was created and published to NATS, but the order-engine is not consuming from `cmd.order.place` because the subscription stream has ended (e.g. NATS disconnect or stream closed). Orders will stay pending until the order-engine is restarted and successfully re-subscribes to NATS.

## What to do

1. **Restart the order-engine** so it reconnects to NATS and re-subscribes to `cmd.order.place`.
2. **Keep NATS running** (e.g. `infra/docker-compose` or your NATS process) so the subscription does not drop.
3. After restart, place a new order and check:
   - Order-engine health: `subscription_active: true`, `handler_task_alive: true`, and `messages_received` / `handler_entries` increase.
   - Redis: `order:<order_id>` exists after placing the order.
