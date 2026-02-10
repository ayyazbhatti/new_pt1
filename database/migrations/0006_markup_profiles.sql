-- Migration: Add group_id to price_stream_profiles and create symbol markup overrides

-- Add group_id to price_stream_profiles if not exists
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'price_stream_profiles' AND column_name = 'group_id'
    ) THEN
        ALTER TABLE price_stream_profiles ADD COLUMN group_id UUID NULL 
            REFERENCES user_groups(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Create symbol_markup_overrides table for per-symbol bid/ask markup
CREATE TABLE IF NOT EXISTS symbol_markup_overrides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id UUID NOT NULL REFERENCES price_stream_profiles(id) ON DELETE CASCADE,
    symbol_id UUID NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
    bid_markup NUMERIC(20, 8) NOT NULL DEFAULT 0,
    ask_markup NUMERIC(20, 8) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(profile_id, symbol_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_symbol_markup_overrides_profile_id ON symbol_markup_overrides(profile_id);
CREATE INDEX IF NOT EXISTS idx_symbol_markup_overrides_symbol_id ON symbol_markup_overrides(symbol_id);
CREATE INDEX IF NOT EXISTS idx_price_stream_profiles_group_id ON price_stream_profiles(group_id);

-- Add updated_at trigger for symbol_markup_overrides
CREATE OR REPLACE FUNCTION update_symbol_markup_overrides_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_symbol_markup_overrides_updated_at ON symbol_markup_overrides;
CREATE TRIGGER update_symbol_markup_overrides_updated_at
BEFORE UPDATE ON symbol_markup_overrides
FOR EACH ROW
EXECUTE FUNCTION update_symbol_markup_overrides_updated_at();

