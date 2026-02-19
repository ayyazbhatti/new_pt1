-- Swap rules (rollover/overnight fees) per group and symbol
DROP TABLE IF EXISTS swap_rules CASCADE;

CREATE TABLE swap_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
    symbol VARCHAR(64) NOT NULL,
    market VARCHAR(32) NOT NULL CHECK (market IN ('crypto', 'forex', 'commodities', 'indices', 'stocks')),
    calc_mode VARCHAR(32) NOT NULL CHECK (calc_mode IN ('daily', 'hourly', 'funding_8h')),
    unit VARCHAR(16) NOT NULL CHECK (unit IN ('percent', 'fixed')),
    long_rate NUMERIC(20, 8) NOT NULL,
    short_rate NUMERIC(20, 8) NOT NULL,
    rollover_time_utc VARCHAR(8) NOT NULL,
    triple_day VARCHAR(4) CHECK (triple_day IN ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')),
    weekend_rule VARCHAR(32) NOT NULL CHECK (weekend_rule IN ('none', 'triple_day', 'fri_triple', 'custom')),
    min_charge NUMERIC(20, 8),
    max_charge NUMERIC(20, 8),
    status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_swap_rules_group_id ON swap_rules(group_id);
CREATE INDEX IF NOT EXISTS idx_swap_rules_symbol ON swap_rules(symbol);
CREATE INDEX IF NOT EXISTS idx_swap_rules_status ON swap_rules(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_swap_rules_group_symbol ON swap_rules(group_id, symbol);
