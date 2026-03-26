-- Extend asset_class enum with additional classes.
-- Safe to run multiple times.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'asset_class') THEN
        ALTER TYPE asset_class ADD VALUE IF NOT EXISTS 'ETFs';
        ALTER TYPE asset_class ADD VALUE IF NOT EXISTS 'Energies';
        ALTER TYPE asset_class ADD VALUE IF NOT EXISTS 'Shares';
    END IF;
END $$;

