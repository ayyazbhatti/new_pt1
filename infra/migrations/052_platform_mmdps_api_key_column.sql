-- Admin-managed MMDPS API key (Settings → Integrations). Mirrored to Redis for data-provider.

ALTER TABLE platform_data_provider_integrations
ADD COLUMN IF NOT EXISTS mmdps_api_key TEXT;
