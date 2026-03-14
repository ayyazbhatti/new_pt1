-- Add is_default to leverage_profiles. Only one profile should be default at a time (enforced in app).
ALTER TABLE leverage_profiles
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_leverage_profiles_single_default
  ON leverage_profiles ((true)) WHERE is_default = true;

COMMENT ON COLUMN leverage_profiles.is_default IS 'When true, this profile is the system default (only one row should be true).';
