-- Migration: Update leverage_profiles and leverage_profile_tiers to match requirements
-- Also creates symbol_leverage_profile_assignments table

-- Update leverage_profiles table
DO $$ 
BEGIN
    -- Add status column if not exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'leverage_profiles' AND column_name = 'status'
    ) THEN
        ALTER TABLE leverage_profiles ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
    END IF;

    -- Add description column if not exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'leverage_profiles' AND column_name = 'description'
    ) THEN
        ALTER TABLE leverage_profiles ADD COLUMN description TEXT NULL;
    END IF;
END $$;

-- Create leverage_profile_tiers table (rename from leverage_tiers if exists)
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'leverage_tiers') THEN
        -- Rename existing table
        ALTER TABLE leverage_tiers RENAME TO leverage_profile_tiers;
        
        -- Update column names if needed
        IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'leverage_profile_tiers' AND column_name = 'leverage'
        ) THEN
            ALTER TABLE leverage_profile_tiers RENAME COLUMN leverage TO max_leverage;
        END IF;
        
        -- Add missing columns
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'leverage_profile_tiers' AND column_name = 'tier_index'
        ) THEN
            ALTER TABLE leverage_profile_tiers ADD COLUMN tier_index INTEGER NOT NULL DEFAULT 1;
        END IF;
        
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'leverage_profile_tiers' AND column_name = 'notional_from'
        ) THEN
            ALTER TABLE leverage_profile_tiers ADD COLUMN notional_from NUMERIC(20,8) NOT NULL DEFAULT 0;
        END IF;
        
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'leverage_profile_tiers' AND column_name = 'notional_to'
        ) THEN
            ALTER TABLE leverage_profile_tiers ADD COLUMN notional_to NUMERIC(20,8) NULL;
        END IF;
        
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'leverage_profile_tiers' AND column_name = 'initial_margin_percent'
        ) THEN
            ALTER TABLE leverage_profile_tiers ADD COLUMN initial_margin_percent NUMERIC(10,4) NOT NULL DEFAULT 0;
        END IF;
        
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'leverage_profile_tiers' AND column_name = 'maintenance_margin_percent'
        ) THEN
            ALTER TABLE leverage_profile_tiers ADD COLUMN maintenance_margin_percent NUMERIC(10,4) NOT NULL DEFAULT 0;
        END IF;
    ELSE
        -- Create new table
        CREATE TABLE leverage_profile_tiers (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            profile_id UUID NOT NULL REFERENCES leverage_profiles(id) ON DELETE CASCADE,
            tier_index INTEGER NOT NULL,
            notional_from NUMERIC(20,8) NOT NULL,
            notional_to NUMERIC(20,8) NULL,
            max_leverage INTEGER NOT NULL,
            initial_margin_percent NUMERIC(10,4) NOT NULL DEFAULT 0,
            maintenance_margin_percent NUMERIC(10,4) NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT tier_index_check CHECK (tier_index >= 1),
            CONSTRAINT max_leverage_check CHECK (max_leverage >= 1),
            CONSTRAINT notional_from_check CHECK (notional_from >= 0),
            CONSTRAINT notional_to_check CHECK (notional_to IS NULL OR notional_to > notional_from),
            UNIQUE(profile_id, tier_index)
        );
    END IF;
END $$;

-- Create symbol_leverage_profile_assignments table
CREATE TABLE IF NOT EXISTS symbol_leverage_profile_assignments (
    symbol_id UUID NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL REFERENCES leverage_profiles(id) ON DELETE RESTRICT,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (symbol_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_leverage_profiles_status ON leverage_profiles(status);
CREATE INDEX IF NOT EXISTS idx_leverage_profile_tiers_profile_id ON leverage_profile_tiers(profile_id);
CREATE INDEX IF NOT EXISTS idx_symbol_leverage_profile_assignments_profile_id ON symbol_leverage_profile_assignments(profile_id);

-- Add updated_at trigger for leverage_profile_tiers if not exists
CREATE OR REPLACE FUNCTION update_leverage_profile_tiers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_leverage_profile_tiers_updated_at ON leverage_profile_tiers;
CREATE TRIGGER update_leverage_profile_tiers_updated_at
BEFORE UPDATE ON leverage_profile_tiers
FOR EACH ROW
EXECUTE FUNCTION update_leverage_profile_tiers_updated_at();

