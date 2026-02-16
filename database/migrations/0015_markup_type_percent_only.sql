-- Restrict bid/ask markup to percent only: remove 'points' and 'pips'.
-- Convert existing point/pips profiles to percent with 0 bid/ask so they don't apply wrong values.

-- 1) Set all profiles to percent; zero out bid/ask where type was points/pips (values were in points/pips, not %)
UPDATE price_stream_profiles
SET markup_type = 'percent', bid_markup = 0, ask_markup = 0
WHERE markup_type IN ('points', 'pips');

UPDATE price_stream_profiles SET markup_type = 'percent' WHERE markup_type != 'percent';

-- 2) Replace enum with percent-only type (drop default so type change can run)
ALTER TABLE price_stream_profiles ALTER COLUMN markup_type DROP DEFAULT;

-- Create new enum if not already created (e.g. from a previous partial run)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'markup_type_new') THEN
    CREATE TYPE markup_type_new AS ENUM ('percent');
  END IF;
END $$;

ALTER TABLE price_stream_profiles
  ALTER COLUMN markup_type TYPE markup_type_new USING markup_type::text::markup_type_new;

DROP TYPE markup_type;
ALTER TYPE markup_type_new RENAME TO markup_type;

ALTER TABLE price_stream_profiles ALTER COLUMN markup_type SET DEFAULT 'percent'::markup_type;
