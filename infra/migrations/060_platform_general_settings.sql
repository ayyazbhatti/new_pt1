-- Admin Settings → General (site name, timezone, default currency).
-- Singleton row pattern (same as platform_voiso_config).

CREATE TABLE IF NOT EXISTS platform_general_settings (
    singleton_id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (singleton_id = 1),
    site_name TEXT NOT NULL DEFAULT 'Trading Platform',
    timezone TEXT NOT NULL DEFAULT 'UTC',
    currency TEXT NOT NULL DEFAULT 'USD',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO platform_general_settings (singleton_id)
VALUES (1)
ON CONFLICT (singleton_id) DO NOTHING;

COMMENT ON TABLE platform_general_settings IS 'Admin General settings tab: site identity defaults (singleton row).';
