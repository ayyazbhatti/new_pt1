BEGIN;

-- 1. Add timezone column to user_groups (group-level default)
ALTER TABLE user_groups
  ADD COLUMN timezone TEXT;

COMMENT ON COLUMN user_groups.timezone IS
  'Optional IANA timezone (e.g. ''Europe/London''). When set, members of this group default to this timezone unless their user-level timezone is set.';

-- 2. Add timezone column to users (per-user override)
ALTER TABLE users
  ADD COLUMN timezone TEXT;

COMMENT ON COLUMN users.timezone IS
  'Optional IANA timezone override. Highest priority in resolution chain. NULL means fall through to group, then platform default.';

-- 3. Platform default already exists at platform_general_settings.timezone (TEXT, default 'UTC')
--    No schema change needed — Phase 2 wires it into the resolution chain.

COMMIT;
