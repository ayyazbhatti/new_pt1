-- Admin UI: market data provider integrations (Binance, mock FX, future venues).
-- Single row; JSON shape matches contracts::DataProvidersConfig (camelCase in API).

CREATE TABLE IF NOT EXISTS platform_data_provider_integrations (
    singleton_id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (singleton_id = 1),
    config_json JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO platform_data_provider_integrations (singleton_id, config_json)
VALUES (
    1,
    '{"version":1,"providers":[{"id":"binance","type":"binance","enabled":true,"displayName":"Binance Spot","wsUrl":null,"symbols":[]}]}'::jsonb
)
ON CONFLICT (singleton_id) DO NOTHING;
