-- Rename legacy asset_class enum values to exact business labels.
-- Safe to run on databases that already use new values.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'asset_class') THEN
        IF EXISTS (
            SELECT 1
            FROM pg_enum e
            JOIN pg_type t ON t.oid = e.enumtypid
            WHERE t.typname = 'asset_class' AND e.enumlabel = 'FX'
        ) THEN
            ALTER TYPE asset_class RENAME VALUE 'FX' TO 'Forex';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM pg_enum e
            JOIN pg_type t ON t.oid = e.enumtypid
            WHERE t.typname = 'asset_class' AND e.enumlabel = 'Crypto'
        ) THEN
            ALTER TYPE asset_class RENAME VALUE 'Crypto' TO 'Cryptocurrencies';
        END IF;
    END IF;
END $$;

