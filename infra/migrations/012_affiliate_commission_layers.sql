-- Affiliate commission layers: per-level commission % for multi-level affiliate program.
-- Admin manages layers via /api/admin/affiliate; commission job uses these for payouts.

CREATE TABLE IF NOT EXISTS affiliate_commission_layers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  commission_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_level_positive CHECK (level >= 1),
  CONSTRAINT chk_commission_range CHECK (commission_percent >= 0 AND commission_percent <= 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_affiliate_commission_layers_level ON affiliate_commission_layers(level);
CREATE INDEX IF NOT EXISTS idx_affiliate_commission_layers_created_at ON affiliate_commission_layers(created_at DESC);

COMMENT ON TABLE affiliate_commission_layers IS 'Commission % per affiliate level (1=direct referral, 2=second level, etc.).';
