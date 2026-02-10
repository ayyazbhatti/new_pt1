-- Migration: Ensure symbols table has all required fields for data provider integration

-- Create asset_class enum if not exists
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'asset_class') THEN
        CREATE TYPE asset_class AS ENUM ('FX', 'Crypto', 'Metals', 'Indices', 'Stocks', 'Commodities');
    END IF;
END $$;

-- Update symbols table if it exists, otherwise create it
DO $$ 
BEGIN
    -- Add missing columns if table exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'symbols') THEN
        -- Add provider_symbol if not exists
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'symbols' AND column_name = 'provider_symbol'
        ) THEN
            ALTER TABLE symbols ADD COLUMN provider_symbol VARCHAR(50) NULL;
        END IF;

        -- Add asset_class if not exists
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'symbols' AND column_name = 'asset_class'
        ) THEN
            ALTER TABLE symbols ADD COLUMN asset_class asset_class NULL;
        END IF;

        -- Add volume_precision if not exists
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'symbols' AND column_name = 'volume_precision'
        ) THEN
            ALTER TABLE symbols ADD COLUMN volume_precision INTEGER NOT NULL DEFAULT 2;
        END IF;

        -- Add is_enabled if not exists
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'symbols' AND column_name = 'is_enabled'
        ) THEN
            ALTER TABLE symbols ADD COLUMN is_enabled BOOLEAN NOT NULL DEFAULT true;
        END IF;

        -- Add trading_enabled if not exists
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'symbols' AND column_name = 'trading_enabled'
        ) THEN
            ALTER TABLE symbols ADD COLUMN trading_enabled BOOLEAN NOT NULL DEFAULT true;
        END IF;

        -- Add leverage_profile_id if not exists
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'symbols' AND column_name = 'leverage_profile_id'
        ) THEN
            ALTER TABLE symbols ADD COLUMN leverage_profile_id UUID NULL 
                REFERENCES leverage_profiles(id) ON DELETE SET NULL;
        END IF;

        -- Update provider_symbol from code if null (using existing 'code' column)
        UPDATE symbols SET provider_symbol = LOWER(code) WHERE provider_symbol IS NULL;

        -- Update asset_class from market if null
        UPDATE symbols SET asset_class = 
            CASE 
                WHEN market::text = 'forex' THEN 'FX'::asset_class
                WHEN market::text = 'crypto' THEN 'Crypto'::asset_class
                WHEN market::text = 'metals' THEN 'Metals'::asset_class
                WHEN market::text = 'indices' THEN 'Indices'::asset_class
                WHEN market::text = 'stocks' THEN 'Stocks'::asset_class
                ELSE 'FX'::asset_class
            END
        WHERE asset_class IS NULL;

        -- Set is_enabled based on trading_enabled if not set
        UPDATE symbols SET is_enabled = trading_enabled WHERE is_enabled IS NULL;
    ELSE
        -- Create new symbols table (if it doesn't exist)
        CREATE TABLE symbols (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            code VARCHAR(50) NOT NULL UNIQUE,
            provider_symbol VARCHAR(50) NOT NULL,
            asset_class asset_class NOT NULL,
            base_currency VARCHAR(10) NOT NULL,
            quote_currency VARCHAR(10) NOT NULL,
            price_precision INTEGER NOT NULL DEFAULT 2,
            volume_precision INTEGER NOT NULL DEFAULT 2,
            contract_size NUMERIC(20, 8) NOT NULL DEFAULT 1,
            is_enabled BOOLEAN NOT NULL DEFAULT true,
            trading_enabled BOOLEAN NOT NULL DEFAULT true,
            leverage_profile_id UUID NULL REFERENCES leverage_profiles(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    END IF;
END $$;

-- Create indexes (using 'code' column which exists)
CREATE INDEX IF NOT EXISTS idx_symbols_code ON symbols(code);
CREATE INDEX IF NOT EXISTS idx_symbols_provider_symbol ON symbols(provider_symbol);
CREATE INDEX IF NOT EXISTS idx_symbols_asset_class ON symbols(asset_class);
CREATE INDEX IF NOT EXISTS idx_symbols_is_enabled ON symbols(is_enabled);
CREATE INDEX IF NOT EXISTS idx_symbols_leverage_profile_id ON symbols(leverage_profile_id);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_symbols_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_symbols_updated_at ON symbols;
CREATE TRIGGER update_symbols_updated_at
BEFORE UPDATE ON symbols
FOR EACH ROW
EXECUTE FUNCTION update_symbols_updated_at();

