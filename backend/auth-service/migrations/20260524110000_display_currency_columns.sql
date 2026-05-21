BEGIN;

-- 1. Add display_currency column to user_groups
ALTER TABLE user_groups
  ADD COLUMN display_currency TEXT;

COMMENT ON COLUMN user_groups.display_currency IS
  'Optional ISO 4217 currency code (e.g. ''EUR'', ''PKR''). When set, members of this group default to this display currency unless their user-level display_currency is set.';

-- 2. Add display_currency column to users
ALTER TABLE users
  ADD COLUMN display_currency TEXT;

COMMENT ON COLUMN users.display_currency IS
  'Optional ISO 4217 display currency override. Highest priority in resolution chain. NULL means fall through to group, then platform default, then USD.';

-- 3. platform_general_settings.currency already exists (from migration 060).
--    Phase 4 just wires it into the resolution chain — no schema change here.

COMMIT;
