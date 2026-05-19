-- Admin-managed Voiso integration settings (Settings -> Voiso).
-- Secrets are stored server-side and are never returned by the API.

CREATE TABLE IF NOT EXISTS platform_voiso_config (
    singleton_id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (singleton_id = 1),
    api_key TEXT,
    click2call_url TEXT NOT NULL DEFAULT 'https://cc-ams03.voiso.com/api/v1',
    panel_url TEXT NOT NULL DEFAULT 'https://cc-ams03.voiso.com/omnichannel/embedded',
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO platform_voiso_config (singleton_id)
VALUES (1)
ON CONFLICT (singleton_id) DO NOTHING;
