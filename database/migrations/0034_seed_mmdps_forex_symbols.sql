-- Seed MMDPS forex pairs for the symbols catalog.
-- Uses existing market enum value 'forex' (no new category/type).
-- Idempotent: safe to re-run; upserts core fields so manual rows get corrected.

INSERT INTO symbols (
  code, provider_symbol, asset_class, base_currency, quote_currency,
  price_precision, volume_precision, contract_size, is_enabled, trading_enabled, market
) VALUES
  ('EURUSD', 'eurusd', 'FX', 'EUR', 'USD', 5, 2, 100000, true, true, 'forex'),
  ('GBPUSD', 'gbpusd', 'FX', 'GBP', 'USD', 5, 2, 100000, true, true, 'forex')
ON CONFLICT (code) DO UPDATE SET
  provider_symbol = EXCLUDED.provider_symbol,
  asset_class = EXCLUDED.asset_class,
  base_currency = EXCLUDED.base_currency,
  quote_currency = EXCLUDED.quote_currency,
  price_precision = EXCLUDED.price_precision,
  volume_precision = EXCLUDED.volume_precision,
  contract_size = EXCLUDED.contract_size,
  is_enabled = EXCLUDED.is_enabled,
  trading_enabled = EXCLUDED.trading_enabled,
  market = EXCLUDED.market,
  updated_at = NOW();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'symbols' AND column_name = 'data_provider'
  ) THEN
    UPDATE symbols
    SET data_provider = 'MMDPS', updated_at = NOW()
    WHERE code IN ('EURUSD', 'GBPUSD');
  END IF;
END $$;
