-- Optional metadata from MMDPS /feed/symbols sync (auth-service admin sync).
ALTER TABLE symbols ADD COLUMN IF NOT EXISTS mmdps_category VARCHAR(64);
ALTER TABLE symbols ADD COLUMN IF NOT EXISTS provider_description TEXT;
