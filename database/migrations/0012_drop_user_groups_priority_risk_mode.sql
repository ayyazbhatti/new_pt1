-- Remove priority and risk_mode from user_groups (no longer used by groups feature)
ALTER TABLE user_groups
  DROP COLUMN IF EXISTS priority,
  DROP COLUMN IF EXISTS risk_mode;
