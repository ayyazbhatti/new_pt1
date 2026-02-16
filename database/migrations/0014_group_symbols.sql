-- Per-group, per-symbol settings: leverage profile override and enabled flag.
-- If no row exists for (group_id, symbol_id), group default leverage and symbol default enabled apply.

CREATE TABLE IF NOT EXISTS group_symbols (
    group_id UUID NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
    symbol_id UUID NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
    leverage_profile_id UUID NULL REFERENCES leverage_profiles(id) ON DELETE SET NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, symbol_id)
);

CREATE INDEX IF NOT EXISTS idx_group_symbols_group_id ON group_symbols(group_id);
CREATE INDEX IF NOT EXISTS idx_group_symbols_symbol_id ON group_symbols(symbol_id);

CREATE OR REPLACE FUNCTION update_group_symbols_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_group_symbols_updated_at ON group_symbols;
CREATE TRIGGER update_group_symbols_updated_at
BEFORE UPDATE ON group_symbols
FOR EACH ROW
EXECUTE PROCEDURE update_group_symbols_updated_at();
