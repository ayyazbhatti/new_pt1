# Fix: server-side “mark notification read” persistence

## Summary

Notifications already had a boolean `read` column; `read_at` was added for audit. New REST endpoints persist read state; the Zustand store calls them before updating local UI state.

## Files touched

| Area | Path |
|------|------|
| Migration | `infra/migrations/059_notifications_read_at.sql` |
| Backend | `backend/auth-service/src/routes/deposits.rs` (handlers + `create_notifications_router` + `patch` import) |
| Frontend API | `src/shared/api/notifications.api.ts` |
| Frontend store | `src/shared/store/notificationsStore.ts` |
| Docs | `docs/fix-notifications-mark-read.md` (this file) |

UI files `NotificationBell.tsx` and `NotificationsPanel.tsx` were **not** changed: they already call `markRead` / `markAllRead` without `await`; the store methods are async and safe to fire-and-forget.

## SQL migration applied

**Prefix:** `059` — `infra/migrations/059_notifications_read_at.sql`

The `notifications` table (from `002_deposits_and_notifications.sql`) already had:

- `read BOOLEAN DEFAULT false`

Added:

```sql
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
```

(`read` was not re-added; it already exists.)

## API endpoints added

Mounted under **`/api/notifications`** (see `backend/auth-service/src/lib.rs`: `.nest("/api/notifications", routes::deposits::create_notifications_router(...))`).

| Method | Path | Behavior |
|--------|------|------------|
| `PATCH` | `/api/notifications/:id/read` | Sets `read = TRUE`, `read_at = NOW()` where `id` and `user_id =` JWT subject and `read = FALSE`. Returns **204 No Content** always when successful (including idempotent no-op / not found / wrong owner). |
| `POST` | `/api/notifications/read-all` | Marks all unread rows for the current user. Returns JSON `{ "markedCount": number }`. |

Both require auth (`auth_middleware` on the notifications router).

## Manual test steps

1. Apply migrations (e.g. run your usual `infra/migrations` container or `psql` apply `059_notifications_read_at.sql`).
2. Start auth-service and frontend; log in as a user with notifications.
3. Open the notification bell or terminal notifications panel; click an unread item (or “Mark all read”).
4. **Reload the page** (hard refresh): the same notification(s) should remain **read** (no unread dot / count matches DB).

## Verification

- `cargo check` in `backend/auth-service`: passes.
- `npx tsc --noEmit` at repo root: passes.
