-- Align with database/migrations/0035_symbols_mmdps_metadata.sql for deployments that only run auth-service migrations.
ALTER TABLE symbols ADD COLUMN IF NOT EXISTS mmdps_category VARCHAR(64);
ALTER TABLE symbols ADD COLUMN IF NOT EXISTS provider_description TEXT;
