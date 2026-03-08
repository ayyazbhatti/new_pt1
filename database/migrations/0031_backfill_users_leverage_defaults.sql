-- Backfill default min/max leverage for users who have none (so terminal shows "Your min – max 1 – 500×").
-- New signups get these from auth_service.register() INSERT; this fixes existing rows created before that change.
UPDATE users
SET min_leverage = 1, max_leverage = 500, updated_at = NOW()
WHERE min_leverage IS NULL AND max_leverage IS NULL;
