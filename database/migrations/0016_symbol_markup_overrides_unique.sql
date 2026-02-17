-- Add unique constraint on (profile_id, symbol_id) for ON CONFLICT upsert.
-- Required for: INSERT ... ON CONFLICT (profile_id, symbol_id) DO UPDATE.

-- Remove duplicates first (keep one per profile_id, symbol_id)
DELETE FROM symbol_markup_overrides a
USING symbol_markup_overrides b
WHERE a.profile_id = b.profile_id
  AND a.symbol_id = b.symbol_id
  AND a.id > b.id;

-- Add unique constraint (ignore if already exists, e.g. from migration 0006)
DO $$
BEGIN
    ALTER TABLE symbol_markup_overrides
    ADD CONSTRAINT symbol_markup_overrides_profile_symbol_key UNIQUE (profile_id, symbol_id);
EXCEPTION
    WHEN duplicate_object THEN NULL; -- constraint already exists
END $$;
