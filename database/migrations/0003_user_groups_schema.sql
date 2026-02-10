-- Migration: Update user_groups table to match admin requirements
-- Adds missing fields: priority, min_leverage, max_open_positions, max_open_orders, risk_mode

-- Add priority column if not exists
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'user_groups' AND column_name = 'priority'
    ) THEN
        ALTER TABLE user_groups ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
    END IF;
END $$;

-- Add min_leverage column if not exists (rename max_leverage_min if it exists)
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'user_groups' AND column_name = 'max_leverage_min'
    ) THEN
        -- Rename existing column
        ALTER TABLE user_groups RENAME COLUMN max_leverage_min TO min_leverage;
    ELSIF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'user_groups' AND column_name = 'min_leverage'
    ) THEN
        ALTER TABLE user_groups ADD COLUMN min_leverage INTEGER NOT NULL DEFAULT 1;
    END IF;
END $$;

-- Rename max_leverage_max to max_leverage if needed
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'user_groups' AND column_name = 'max_leverage_max'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'user_groups' AND column_name = 'max_leverage'
    ) THEN
        ALTER TABLE user_groups RENAME COLUMN max_leverage_max TO max_leverage;
    ELSIF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'user_groups' AND column_name = 'max_leverage'
    ) THEN
        ALTER TABLE user_groups ADD COLUMN max_leverage INTEGER NOT NULL DEFAULT 100;
    END IF;
END $$;

-- Add max_open_positions column (rename max_open_positions_per_user if exists)
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'user_groups' AND column_name = 'max_open_positions_per_user'
    ) THEN
        ALTER TABLE user_groups RENAME COLUMN max_open_positions_per_user TO max_open_positions;
    ELSIF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'user_groups' AND column_name = 'max_open_positions'
    ) THEN
        ALTER TABLE user_groups ADD COLUMN max_open_positions INTEGER NOT NULL DEFAULT 50;
    END IF;
END $$;

-- Add max_open_orders column if not exists
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'user_groups' AND column_name = 'max_open_orders'
    ) THEN
        ALTER TABLE user_groups ADD COLUMN max_open_orders INTEGER NOT NULL DEFAULT 200;
    END IF;
END $$;

-- Add risk_mode column if not exists
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'user_groups' AND column_name = 'risk_mode'
    ) THEN
        ALTER TABLE user_groups ADD COLUMN risk_mode TEXT NOT NULL DEFAULT 'standard';
    END IF;
END $$;

-- Add status column if not exists
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'user_groups' AND column_name = 'status'
    ) THEN
        ALTER TABLE user_groups ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
    END IF;
END $$;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_user_groups_status ON user_groups(status);
CREATE INDEX IF NOT EXISTS idx_user_groups_priority ON user_groups(priority);

-- Add updated_at trigger if not exists
CREATE OR REPLACE FUNCTION update_user_groups_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_user_groups_updated_at ON user_groups;
CREATE TRIGGER update_user_groups_updated_at
BEFORE UPDATE ON user_groups
FOR EACH ROW
EXECUTE FUNCTION update_user_groups_updated_at();

