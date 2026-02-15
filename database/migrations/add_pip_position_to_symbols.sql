-- Migration: Add pip position fields to symbols table
-- Date: 2024

ALTER TABLE symbols
ADD COLUMN IF NOT EXISTS default_pip_position NUMERIC(20, 8),
ADD COLUMN IF NOT EXISTS pip_position_min NUMERIC(20, 8),
ADD COLUMN IF NOT EXISTS pip_position_max NUMERIC(20, 8);

COMMENT ON COLUMN symbols.default_pip_position IS 'Default pip position value suggested for this symbol (USD per pip)';
COMMENT ON COLUMN symbols.pip_position_min IS 'Minimum allowed pip position for this symbol (USD per pip)';
COMMENT ON COLUMN symbols.pip_position_max IS 'Maximum allowed pip position for this symbol (USD per pip)';

