-- Per-user min and max leverage (each user can have their own leverage range)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS min_leverage INTEGER,
  ADD COLUMN IF NOT EXISTS max_leverage INTEGER;

-- Sensible defaults for existing rows (optional; NULL means use platform/group default elsewhere)
-- UPDATE users SET min_leverage = 1, max_leverage = 500 WHERE min_leverage IS NULL AND max_leverage IS NULL;
