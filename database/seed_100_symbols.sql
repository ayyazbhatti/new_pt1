-- Seed 100 Binance USDT symbols so the terminal and API show them.
-- Run with: psql -h localhost -U postgres -d newpt -f database/seed_100_symbols.sql
-- Requires: symbols table with code, provider_symbol, asset_class, base_currency, quote_currency,
--           price_precision, volume_precision, contract_size (and optionally tick_size, lot_min, lot_max).

-- Ensure asset_class type exists (from 0005_symbols_schema or similar)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'asset_class') THEN
    CREATE TYPE asset_class AS ENUM (
      'Forex',
      'Cryptocurrencies',
      'Metals',
      'Indices',
      'Stocks',
      'Shares',
      'ETFs',
      'Energies',
      'Commodities'
    );
  END IF;
END $$;

-- Add code column if table has old "symbol" column (001 schema)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'symbols')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'symbols' AND column_name = 'symbol')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'symbols' AND column_name = 'code') THEN
    ALTER TABLE symbols RENAME COLUMN symbol TO code;
  END IF;
END $$;

-- Add provider_symbol if missing
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'symbols')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'symbols' AND column_name = 'provider_symbol') THEN
    ALTER TABLE symbols ADD COLUMN provider_symbol VARCHAR(50);
    UPDATE symbols SET provider_symbol = LOWER(code) WHERE provider_symbol IS NULL;
    ALTER TABLE symbols ALTER COLUMN provider_symbol SET NOT NULL;
  END IF;
END $$;

-- Add asset_class if missing
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'symbols')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'symbols' AND column_name = 'asset_class') THEN
    ALTER TABLE symbols ADD COLUMN asset_class asset_class DEFAULT 'Cryptocurrencies';
    UPDATE symbols SET asset_class = 'Cryptocurrencies' WHERE asset_class IS NULL;
    ALTER TABLE symbols ALTER COLUMN asset_class SET NOT NULL;
  END IF;
END $$;

-- Add base_currency/quote_currency if missing (might be base/quote in old schema)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'symbols')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'symbols' AND column_name = 'base_currency')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'symbols' AND column_name = 'base') THEN
    ALTER TABLE symbols RENAME COLUMN base TO base_currency;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'symbols')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'symbols' AND column_name = 'quote_currency')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'symbols' AND column_name = 'quote') THEN
    ALTER TABLE symbols RENAME COLUMN quote TO quote_currency;
  END IF;
END $$;

-- Ensure market_type enum exists (schema.sql)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'market_type') THEN
    CREATE TYPE market_type AS ENUM ('crypto', 'forex', 'commodities', 'indices', 'stocks');
  END IF;
END $$;

-- Add market column if missing (required by schema.sql symbols table)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'symbols')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'symbols' AND column_name = 'market') THEN
    ALTER TABLE symbols ADD COLUMN market market_type NOT NULL DEFAULT 'crypto';
  END IF;
END $$;

-- Insert 100 symbols (ON CONFLICT skip existing so we don't overwrite your 9)
-- Include market if column exists (schema.sql); otherwise rely on minimal columns
INSERT INTO symbols (code, provider_symbol, asset_class, base_currency, quote_currency, price_precision, volume_precision, contract_size, is_enabled, trading_enabled, market)
VALUES
  ('BTCUSDT',  'btcusdt',  'Cryptocurrencies', 'BTC',  'USDT', 2, 6, 1, true, true, 'crypto'),
  ('ETHUSDT',  'ethusdt',  'Cryptocurrencies', 'ETH',  'USDT', 2, 5, 1, true, true, 'crypto'),
  ('BNBUSDT',  'bnbusdt',  'Cryptocurrencies', 'BNB',  'USDT', 2, 4, 1, true, true, 'crypto'),
  ('DOGEUSDT', 'dogeusdt', 'Cryptocurrencies', 'DOGE', 'USDT', 6, 0, 1, true, true, 'crypto'),
  ('SHIBUSDT', 'shibusdt', 'Cryptocurrencies', 'SHIB', 'USDT', 8, 0, 1, true, true, 'crypto'),
  ('TONUSDT',  'tonusdt',  'Cryptocurrencies', 'TON',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('XRPUSDT',  'xrpusdt',  'Cryptocurrencies', 'XRP',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('ADAUSDT',  'adausdt',  'Cryptocurrencies', 'ADA',  'USDT', 6, 0, 1, true, true, 'crypto'),
  ('SOLUSDT',  'solusdt',  'Cryptocurrencies', 'SOL',  'USDT', 3, 2, 1, true, true, 'crypto'),
  ('XMRUSDT',  'xmrusdt',  'Cryptocurrencies', 'XMR',  'USDT', 2, 5, 1, true, true, 'crypto'),
  ('EOSUSDT',  'eosusdt',  'Cryptocurrencies', 'EOS',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('KASUSDT',  'kasusdt',  'Cryptocurrencies', 'KAS',  'USDT', 6, 0, 1, true, true, 'crypto'),
  ('TRXUSDT',  'trxusdt',  'Cryptocurrencies', 'TRX',  'USDT', 6, 0, 1, true, true, 'crypto'),
  ('AVAXUSDT', 'avaxusdt','Cryptocurrencies', 'AVAX', 'USDT', 3, 2, 1, true, true, 'crypto'),
  ('DOTUSDT',  'dotusdt',  'Cryptocurrencies', 'DOT',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('MATICUSDT','maticusdt','Cryptocurrencies','MATIC','USDT', 5, 0, 1, true, true, 'crypto'),
  ('LINKUSDT', 'linkusdt', 'Cryptocurrencies', 'LINK', 'USDT', 4, 2, 1, true, true, 'crypto'),
  ('UNIUSDT',  'uniusdt',  'Cryptocurrencies', 'UNI',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('ATOMUSDT', 'atomusdt', 'Cryptocurrencies', 'ATOM', 'USDT', 4, 2, 1, true, true, 'crypto'),
  ('LTCUSDT',  'ltcusdt',  'Cryptocurrencies', 'LTC',  'USDT', 2, 5, 1, true, true, 'crypto'),
  ('ETCUSDT',  'etcusdt',  'Cryptocurrencies', 'ETC',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('XLMUSDT',  'xlmusdt',  'Cryptocurrencies', 'XLM',  'USDT', 6, 0, 1, true, true, 'crypto'),
  ('BCHUSDT',  'bchusdt',  'Cryptocurrencies', 'BCH',  'USDT', 2, 5, 1, true, true, 'crypto'),
  ('NEARUSDT', 'nearusdt', 'Cryptocurrencies', 'NEAR', 'USDT', 4, 2, 1, true, true, 'crypto'),
  ('APTUSDT',  'aptusdt',  'Cryptocurrencies', 'APT',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('FILUSDT',  'filusdt',  'Cryptocurrencies', 'FIL',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('INJUSDT',  'injusdt',  'Cryptocurrencies', 'INJ',  'USDT', 3, 2, 1, true, true, 'crypto'),
  ('OPUSDT',   'opusdt',   'Cryptocurrencies', 'OP',   'USDT', 4, 2, 1, true, true, 'crypto'),
  ('ARBUSDT',  'arbusdt',  'Cryptocurrencies', 'ARB',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('IMXUSDT',  'imxusdt',  'Cryptocurrencies', 'IMX',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('SUIUSDT',  'suiusdt',  'Cryptocurrencies', 'SUI',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('SEIUSDT',  'seiusdt',  'Cryptocurrencies', 'SEI',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('RENDERUSDT','renderusdt','Cryptocurrencies','RENDER','USDT',4,2,1,true,true,'crypto'),
  ('PEPEUSDT', 'pepeusdt', 'Cryptocurrencies', 'PEPE', 'USDT', 8, 0, 1, true, true, 'crypto'),
  ('WIFUSDT',  'wifusdt',  'Cryptocurrencies', 'WIF',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('FLOKIUSDT','flokiusdt','Cryptocurrencies','FLOKI','USDT', 8, 0, 1, true, true, 'crypto'),
  ('BONKUSDT', 'bonkusdt', 'Cryptocurrencies', 'BONK', 'USDT', 8, 0, 1, true, true, 'crypto'),
  ('FETUSDT',  'fetusdt',  'Cryptocurrencies', 'FET',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('RUNEUSDT', 'runeusdt', 'Cryptocurrencies', 'RUNE', 'USDT', 4, 2, 1, true, true, 'crypto'),
  ('GRTUSDT',  'grtusdt',  'Cryptocurrencies', 'GRT',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('AAVEUSDT', 'aaveusdt', 'Cryptocurrencies', 'AAVE', 'USDT', 2, 4, 1, true, true, 'crypto'),
  ('ALGOUSDT', 'algousdt', 'Cryptocurrencies', 'ALGO', 'USDT', 5, 0, 1, true, true, 'crypto'),
  ('AXSUSDT',  'axsusdt',  'Cryptocurrencies', 'AXS',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('CRVUSDT',  'crvusdt',  'Cryptocurrencies', 'CRV',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('ENSUSDT',  'ensusdt',  'Cryptocurrencies', 'ENS',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('GMTUSDT',  'gmtusdt',  'Cryptocurrencies', 'GMT',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('MANAUSDT', 'manausdt', 'Cryptocurrencies', 'MANA', 'USDT', 5, 0, 1, true, true, 'crypto'),
  ('SANDUSDT', 'sandusdt', 'Cryptocurrencies', 'SAND', 'USDT', 5, 0, 1, true, true, 'crypto'),
  ('APEUSDT',  'apeusdt',  'Cryptocurrencies', 'APE',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('LDOUSDT',  'ldousdt',  'Cryptocurrencies', 'LDO',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('MKRUSDT',  'mkrusdt',  'Cryptocurrencies', 'MKR',  'USDT', 2, 6, 1, true, true, 'crypto'),
  ('SNXUSDT',  'snxusdt',  'Cryptocurrencies', 'SNX',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('STXUSDT',  'stxusdt',  'Cryptocurrencies', 'STX',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('THETAUSDT','thetausdt','Cryptocurrencies','THETA','USDT', 5, 0, 1, true, true, 'crypto'),
  ('VETUSDT',  'vetusdt',  'Cryptocurrencies', 'VET',  'USDT', 6, 0, 1, true, true, 'crypto'),
  ('BLURUSDT', 'blurusdt', 'Cryptocurrencies', 'BLUR', 'USDT', 5, 0, 1, true, true, 'crypto'),
  ('COMPUSDT', 'compusdt', 'Cryptocurrencies', 'COMP', 'USDT', 2, 4, 1, true, true, 'crypto'),
  ('DYDXUSDT', 'dydxusdt', 'Cryptocurrencies', 'DYDX', 'USDT', 4, 2, 1, true, true, 'crypto'),
  ('GALAUSDT', 'galausdt', 'Cryptocurrencies', 'GALA', 'USDT', 6, 0, 1, true, true, 'crypto'),
  ('HBARUSDT', 'hbarusdt', 'Cryptocurrencies', 'HBAR', 'USDT', 5, 0, 1, true, true, 'crypto'),
  ('ICPUSDT',  'icpusdt',  'Cryptocurrencies', 'ICP',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('JASMYUSDT','jasmyusdt','Cryptocurrencies','JASMY','USDT', 6, 0, 1, true, true, 'crypto'),
  ('KAVAUSDT', 'kavausdt', 'Cryptocurrencies', 'KAVA', 'USDT', 5, 0, 1, true, true, 'crypto'),
  ('KSMUSDT',  'ksmusdt',  'Cryptocurrencies', 'KSM',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('MANTAUSDT','mantausdt','Cryptocurrencies','MANTA','USDT', 5, 0, 1, true, true, 'crypto'),
  ('ORDIUSDT', 'ordiusdt', 'Cryptocurrencies', 'ORDI', 'USDT', 4, 2, 1, true, true, 'crypto'),
  ('PENDLEUSDT','pendleusdt','Cryptocurrencies','PENDLE','USDT',4,2,1,true,true,'crypto'),
  ('PYTHUSDT', 'pythusdt', 'Cryptocurrencies', 'PYTH', 'USDT', 5, 0, 1, true, true, 'crypto'),
  ('QNTUSDT',  'qntusdt',  'Cryptocurrencies', 'QNT',  'USDT', 2, 4, 1, true, true, 'crypto'),
  ('RDNTUSDT', 'rdntusdt', 'Cryptocurrencies', 'RDNT', 'USDT', 5, 0, 1, true, true, 'crypto'),
  ('RPLUSDT',  'rplusdt',  'Cryptocurrencies', 'RPL',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('STRKUSDT', 'strkusdt', 'Cryptocurrencies', 'STRK', 'USDT', 5, 0, 1, true, true, 'crypto'),
  ('WLDUSDT',  'wldusdt',  'Cryptocurrencies', 'WLD',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('ZECUSDT',  'zecusdt',  'Cryptocurrencies', 'ZEC',  'USDT', 2, 5, 1, true, true, 'crypto'),
  ('1INCHUSDT','1inchusdt','Cryptocurrencies','1INCH','USDT', 5, 0, 1, true, true, 'crypto'),
  ('1000PEPEUSDT','1000pepeusdt','Cryptocurrencies','1000PEPE','USDT', 8, 0, 1, true, true, 'crypto'),
  ('1000SATSUSDT','1000satsusdt','Cryptocurrencies','1000SATS','USDT', 8, 0, 1, true, true, 'crypto'),
  ('AGIXUSDT', 'agixusdt', 'Cryptocurrencies', 'AGIX', 'USDT', 5, 0, 1, true, true, 'crypto'),
  ('ARKMUSDT', 'arkmusdt', 'Cryptocurrencies', 'ARKM', 'USDT', 5, 0, 1, true, true, 'crypto'),
  ('ASTRUSDT', 'astrusdt', 'Cryptocurrencies', 'ASTR', 'USDT', 6, 0, 1, true, true, 'crypto'),
  ('BATUSDT',  'batusdt',  'Cryptocurrencies', 'BAT',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('CELOUSDT', 'celousdt', 'Cryptocurrencies', 'CELO', 'USDT', 5, 0, 1, true, true, 'crypto'),
  ('CFXUSDT',  'cfxusdt',  'Cryptocurrencies', 'CFX',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('CHZUSDT',  'chzusdt',  'Cryptocurrencies', 'CHZ',  'USDT', 6, 0, 1, true, true, 'crypto'),
  ('COTIUSDT', 'cotiusdt', 'Cryptocurrencies', 'COTI', 'USDT', 6, 0, 1, true, true, 'crypto'),
  ('DASHUSDT', 'dashusdt', 'Cryptocurrencies', 'DASH', 'USDT', 2, 5, 1, true, true, 'crypto'),
  ('ENJUSDT',  'enjusdt',  'Cryptocurrencies', 'ENJ',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('FLOWUSDT', 'flowusdt', 'Cryptocurrencies', 'FLOW', 'USDT', 4, 2, 1, true, true, 'crypto'),
  ('FTMUSDT',  'ftmusdt',  'Cryptocurrencies', 'FTM',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('GASUSDT',  'gasusdt',  'Cryptocurrencies', 'GAS',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('HOTUSDT',  'hotusdt',  'Cryptocurrencies', 'HOT',  'USDT', 6, 0, 1, true, true, 'crypto'),
  ('ICXUSDT',  'icxusdt',  'Cryptocurrencies', 'ICX',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('KEYUSDT',  'keyusdt',  'Cryptocurrencies', 'KEY',  'USDT', 6, 0, 1, true, true, 'crypto'),
  ('KNCUSDT',  'kncusdt',  'Cryptocurrencies', 'KNC',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('LQTYUSDT', 'lqtyusdt', 'Cryptocurrencies', 'LQTY', 'USDT', 4, 2, 1, true, true, 'crypto'),
  ('MAGICUSDT','magicusdt','Cryptocurrencies','MAGIC','USDT', 5, 0, 1, true, true, 'crypto'),
  ('MINAUSDT', 'minausdt', 'Cryptocurrencies', 'MINA', 'USDT', 5, 0, 1, true, true, 'crypto'),
  ('NMRUSDT',  'nmrusdt',  'Cryptocurrencies', 'NMR',  'USDT', 2, 4, 1, true, true, 'crypto'),
  ('OCEANUSDT','oceanusdt','Cryptocurrencies','OCEAN','USDT', 6, 0, 1, true, true, 'crypto'),
  ('OMGUSDT',  'omgusdt',  'Cryptocurrencies', 'OMG',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('ONEUSDT',  'oneusdt',  'Cryptocurrencies', 'ONE',  'USDT', 6, 0, 1, true, true, 'crypto'),
  ('PHBUSDT',  'phbusdt',  'Cryptocurrencies', 'PHB',  'USDT', 6, 0, 1, true, true, 'crypto'),
  ('POLUSDT',  'polusdt',  'Cryptocurrencies', 'POL',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('POWRUSDT', 'powrusdt', 'Cryptocurrencies', 'POWR', 'USDT', 6, 0, 1, true, true, 'crypto'),
  ('QTUMUSDT', 'qtumusdt', 'Cryptocurrencies', 'QTUM', 'USDT', 4, 2, 1, true, true, 'crypto'),
  ('RSRUSDT',  'rsrusdt',  'Cryptocurrencies', 'RSR',  'USDT', 6, 0, 1, true, true, 'crypto'),
  ('SKLUSDT',  'sklusdt',  'Cryptocurrencies', 'SKL',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('SSVUSDT',  'ssvusdt',  'Cryptocurrencies', 'SSV',  'USDT', 2, 4, 1, true, true, 'crypto'),
  ('STORJUSDT','storjusdt','Cryptocurrencies','STORJ','USDT', 5, 0, 1, true, true, 'crypto'),
  ('TIAUSDT',  'tiausdt',  'Cryptocurrencies', 'TIA',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('TLMUSDT',  'tlmusdt',  'Cryptocurrencies', 'TLM',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('WOOUSDT',  'woousdt',  'Cryptocurrencies', 'WOO',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('XAIUSDT',  'xaiusdt',  'Cryptocurrencies', 'XAI',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('YFIUSDT',  'yfiusdt',  'Cryptocurrencies', 'YFI',  'USDT', 2, 6, 1, true, true, 'crypto'),
  ('ZILUSDT',  'zilusdt',  'Cryptocurrencies', 'ZIL',  'USDT', 6, 0, 1, true, true, 'crypto'),
  ('EGLDUSDT', 'egldusdt', 'Cryptocurrencies', 'EGLD', 'USDT', 4, 2, 1, true, true, 'crypto'),
  ('ZRXUSDT',  'zrxusdt',  'Cryptocurrencies', 'ZRX',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('SXPUSDT',  'sxpusdt',  'Cryptocurrencies', 'SXP',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('C98USDT',  'c98usdt',  'Cryptocurrencies', 'C98',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('ZROUSDT',  'zrousdt',  'Cryptocurrencies', 'ZRO',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('PORTALUSDT','portalusdt','Cryptocurrencies','PORTAL','USDT', 5, 0, 1, true, true, 'crypto'),
  ('DENTUSDT', 'dentusdt', 'Cryptocurrencies', 'DENT', 'USDT', 6, 0, 1, true, true, 'crypto'),
  ('CVCUSDT',  'cvcusdt',  'Cryptocurrencies', 'CVC',  'USDT', 5, 0, 1, true, true, 'crypto')
ON CONFLICT (code) DO NOTHING;
