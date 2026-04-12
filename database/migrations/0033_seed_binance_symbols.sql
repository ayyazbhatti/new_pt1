-- Seed Binance symbols via migration (idempotent).
-- This keeps symbol data versioned with schema migrations.

-- Ensure asset_class type exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'asset_class') THEN
    CREATE TYPE asset_class AS ENUM ('FX', 'Crypto', 'Metals', 'Indices', 'Stocks', 'Commodities');
  END IF;
END $$;

-- Add market column if this database schema variant does not have it yet
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'symbols')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'symbols' AND column_name = 'market') THEN
    ALTER TABLE symbols ADD COLUMN market market_type NOT NULL DEFAULT 'crypto';
  END IF;
END $$;

INSERT INTO symbols (
  code, provider_symbol, asset_class, base_currency, quote_currency,
  price_precision, volume_precision, contract_size, is_enabled, trading_enabled, market
)
VALUES
  ('BTCUSDT',  'btcusdt',  'Crypto', 'BTC',  'USDT', 2, 6, 1, true, true, 'crypto'),
  ('ETHUSDT',  'ethusdt',  'Crypto', 'ETH',  'USDT', 2, 5, 1, true, true, 'crypto'),
  ('BNBUSDT',  'bnbusdt',  'Crypto', 'BNB',  'USDT', 2, 4, 1, true, true, 'crypto'),
  ('DOGEUSDT', 'dogeusdt', 'Crypto', 'DOGE', 'USDT', 6, 0, 1, true, true, 'crypto'),
  ('SHIBUSDT', 'shibusdt', 'Crypto', 'SHIB', 'USDT', 8, 0, 1, true, true, 'crypto'),
  ('TONUSDT',  'tonusdt',  'Crypto', 'TON',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('XRPUSDT',  'xrpusdt',  'Crypto', 'XRP',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('ADAUSDT',  'adausdt',  'Crypto', 'ADA',  'USDT', 6, 0, 1, true, true, 'crypto'),
  ('SOLUSDT',  'solusdt',  'Crypto', 'SOL',  'USDT', 3, 2, 1, true, true, 'crypto'),
  ('XMRUSDT',  'xmrusdt',  'Crypto', 'XMR',  'USDT', 2, 5, 1, true, true, 'crypto'),
  ('EOSUSDT',  'eosusdt',  'Crypto', 'EOS',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('KASUSDT',  'kasusdt',  'Crypto', 'KAS',  'USDT', 6, 0, 1, true, true, 'crypto'),
  ('TRXUSDT',  'trxusdt',  'Crypto', 'TRX',  'USDT', 6, 0, 1, true, true, 'crypto'),
  ('AVAXUSDT', 'avaxusdt', 'Crypto', 'AVAX', 'USDT', 3, 2, 1, true, true, 'crypto'),
  ('DOTUSDT',  'dotusdt',  'Crypto', 'DOT',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('MATICUSDT','maticusdt','Crypto','MATIC','USDT', 5, 0, 1, true, true, 'crypto'),
  ('LINKUSDT', 'linkusdt', 'Crypto', 'LINK', 'USDT', 4, 2, 1, true, true, 'crypto'),
  ('UNIUSDT',  'uniusdt',  'Crypto', 'UNI',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('ATOMUSDT', 'atomusdt', 'Crypto', 'ATOM', 'USDT', 4, 2, 1, true, true, 'crypto'),
  ('LTCUSDT',  'ltcusdt',  'Crypto', 'LTC',  'USDT', 2, 5, 1, true, true, 'crypto'),
  ('ETCUSDT',  'etcusdt',  'Crypto', 'ETC',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('XLMUSDT',  'xlmusdt',  'Crypto', 'XLM',  'USDT', 6, 0, 1, true, true, 'crypto'),
  ('BCHUSDT',  'bchusdt',  'Crypto', 'BCH',  'USDT', 2, 5, 1, true, true, 'crypto'),
  ('NEARUSDT', 'nearusdt', 'Crypto', 'NEAR', 'USDT', 4, 2, 1, true, true, 'crypto'),
  ('APTUSDT',  'aptusdt',  'Crypto', 'APT',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('FILUSDT',  'filusdt',  'Crypto', 'FIL',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('INJUSDT',  'injusdt',  'Crypto', 'INJ',  'USDT', 3, 2, 1, true, true, 'crypto'),
  ('OPUSDT',   'opusdt',   'Crypto', 'OP',   'USDT', 4, 2, 1, true, true, 'crypto'),
  ('ARBUSDT',  'arbusdt',  'Crypto', 'ARB',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('IMXUSDT',  'imxusdt',  'Crypto', 'IMX',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('SUIUSDT',  'suiusdt',  'Crypto', 'SUI',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('SEIUSDT',  'seiusdt',  'Crypto', 'SEI',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('RENDERUSDT','renderusdt','Crypto','RENDER','USDT',4,2,1,true,true,'crypto'),
  ('PEPEUSDT', 'pepeusdt', 'Crypto', 'PEPE', 'USDT', 8, 0, 1, true, true, 'crypto'),
  ('WIFUSDT',  'wifusdt',  'Crypto', 'WIF',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('FLOKIUSDT','flokiusdt','Crypto','FLOKI','USDT', 8, 0, 1, true, true, 'crypto'),
  ('BONKUSDT', 'bonkusdt', 'Crypto', 'BONK',  'USDT', 8, 0, 1, true, true, 'crypto'),
  ('FETUSDT',  'fetusdt',  'Crypto', 'FET',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('RUNEUSDT', 'runeusdt', 'Crypto', 'RUNE', 'USDT', 4, 2, 1, true, true, 'crypto'),
  ('GRTUSDT',  'grtusdt',  'Crypto', 'GRT',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('AAVEUSDT', 'aaveusdt', 'Crypto', 'AAVE', 'USDT', 2, 4, 1, true, true, 'crypto'),
  ('ALGOUSDT', 'algousdt', 'Crypto', 'ALGO', 'USDT', 5, 0, 1, true, true, 'crypto'),
  ('AXSUSDT',  'axsusdt',  'Crypto', 'AXS',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('CRVUSDT',  'crvusdt',  'Crypto', 'CRV',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('ENSUSDT',  'ensusdt',  'Crypto', 'ENS',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('GMTUSDT',  'gmtusdt',  'Crypto', 'GMT',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('MANAUSDT', 'manausdt', 'Crypto', 'MANA', 'USDT', 5, 0, 1, true, true, 'crypto'),
  ('SANDUSDT', 'sandusdt', 'Crypto', 'SAND', 'USDT', 5, 0, 1, true, true, 'crypto'),
  ('APEUSDT',  'apeusdt',  'Crypto', 'APE',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('LDOUSDT',  'ldousdt',  'Crypto', 'LDO',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('MKRUSDT',  'mkrusdt',  'Crypto', 'MKR',  'USDT', 2, 6, 1, true, true, 'crypto'),
  ('SNXUSDT',  'snxusdt',  'Crypto', 'SNX',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('STXUSDT',  'stxusdt',  'Crypto', 'STX',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('THETAUSDT','thetausdt','Crypto','THETA','USDT', 5, 0, 1, true, true, 'crypto'),
  ('VETUSDT',  'vetusdt',  'Crypto', 'VET',  'USDT', 6, 0, 1, true, true, 'crypto'),
  ('BLURUSDT', 'blurusdt', 'Crypto', 'BLUR', 'USDT', 5, 0, 1, true, true, 'crypto'),
  ('COMPUSDT', 'compusdt', 'Crypto', 'COMP', 'USDT', 2, 4, 1, true, true, 'crypto'),
  ('DYDXUSDT', 'dydxusdt', 'Crypto', 'DYDX', 'USDT', 4, 2, 1, true, true, 'crypto'),
  ('GALAUSDT', 'galausdt', 'Crypto', 'GALA', 'USDT', 6, 0, 1, true, true, 'crypto'),
  ('HBARUSDT', 'hbarusdt', 'Crypto', 'HBAR', 'USDT', 5, 0, 1, true, true, 'crypto'),
  ('ICPUSDT',  'icpusdt',  'Crypto', 'ICP',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('JASMYUSDT','jasmyusdt','Crypto','JASMY','USDT', 6, 0, 1, true, true, 'crypto'),
  ('KAVAUSDT', 'kavausdt', 'Crypto', 'KAVA', 'USDT', 5, 0, 1, true, true, 'crypto'),
  ('KSMUSDT',  'ksmusdt',  'Crypto', 'KSM',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('MANTAUSDT','mantausdt','Crypto','MANTA','USDT', 5, 0, 1, true, true, 'crypto'),
  ('ORDIUSDT', 'ordiusdt', 'Crypto', 'ORDI',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('PENDLEUSDT','pendleusdt','Crypto','PENDLE','USDT',4,2,1,true,true,'crypto'),
  ('PYTHUSDT', 'pythusdt', 'Crypto', 'PYTH',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('QNTUSDT',  'qntusdt',  'Crypto', 'QNT',   'USDT', 2, 4, 1, true, true, 'crypto'),
  ('RDNTUSDT', 'rdntusdt', 'Crypto', 'RDNT',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('RPLUSDT',  'rplusdt',  'Crypto', 'RPL',   'USDT', 4, 2, 1, true, true, 'crypto'),
  ('STRKUSDT', 'strkusdt', 'Crypto', 'STRK',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('WLDUSDT',  'wldusdt',  'Crypto', 'WLD',   'USDT', 4, 2, 1, true, true, 'crypto'),
  ('ZECUSDT',  'zecusdt',  'Crypto', 'ZEC',   'USDT', 2, 5, 1, true, true, 'crypto'),
  ('1INCHUSDT','1inchusdt','Crypto','1INCH',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('1000PEPEUSDT','1000pepeusdt','Crypto','1000PEPE','USDT', 8, 0, 1, true, true, 'crypto'),
  ('1000SATSUSDT','1000satsusdt','Crypto','1000SATS','USDT', 8, 0, 1, true, true, 'crypto'),
  ('AGIXUSDT', 'agixusdt', 'Crypto', 'AGIX',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('ARKMUSDT', 'arkmusdt', 'Crypto', 'ARKM',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('ASTRUSDT', 'astrusdt', 'Crypto', 'ASTR',  'USDT', 6, 0, 1, true, true, 'crypto'),
  ('BATUSDT',  'batusdt',  'Crypto', 'BAT',   'USDT', 5, 0, 1, true, true, 'crypto'),
  ('CELOUSDT', 'celousdt', 'Crypto', 'CELO',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('CFXUSDT',  'cfxusdt',  'Crypto', 'CFX',   'USDT', 5, 0, 1, true, true, 'crypto'),
  ('CHZUSDT',  'chzusdt',  'Crypto', 'CHZ',   'USDT', 6, 0, 1, true, true, 'crypto'),
  ('COTIUSDT', 'cotiusdt', 'Crypto', 'COTI',  'USDT', 6, 0, 1, true, true, 'crypto'),
  ('DASHUSDT', 'dashusdt', 'Crypto', 'DASH',  'USDT', 2, 5, 1, true, true, 'crypto'),
  ('ENJUSDT',  'enjusdt',  'Crypto', 'ENJ',   'USDT', 5, 0, 1, true, true, 'crypto'),
  ('FLOWUSDT', 'flowusdt', 'Crypto', 'FLOW',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('FTMUSDT',  'ftmusdt',  'Crypto', 'FTM',   'USDT', 5, 0, 1, true, true, 'crypto'),
  ('GASUSDT',  'gasusdt',  'Crypto', 'GAS',   'USDT', 4, 2, 1, true, true, 'crypto'),
  ('HOTUSDT',  'hotusdt',  'Crypto', 'HOT',   'USDT', 6, 0, 1, true, true, 'crypto'),
  ('ICXUSDT',  'icxusdt',  'Crypto', 'ICX',   'USDT', 5, 0, 1, true, true, 'crypto'),
  ('KEYUSDT',  'keyusdt',  'Crypto', 'KEY',   'USDT', 6, 0, 1, true, true, 'crypto'),
  ('KNCUSDT',  'kncusdt',  'Crypto', 'KNC',   'USDT', 5, 0, 1, true, true, 'crypto'),
  ('LQTYUSDT', 'lqtyusdt', 'Crypto', 'LQTY',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('MAGICUSDT','magicusdt','Crypto','MAGIC',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('MINAUSDT', 'minausdt', 'Crypto', 'MINA',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('NMRUSDT',  'nmrusdt',  'Crypto', 'NMR',   'USDT', 2, 4, 1, true, true, 'crypto'),
  ('OCEANUSDT','oceanusdt','Crypto','OCEAN',  'USDT', 6, 0, 1, true, true, 'crypto'),
  ('OMGUSDT',  'omgusdt',  'Crypto', 'OMG',   'USDT', 4, 2, 1, true, true, 'crypto'),
  ('ONEUSDT',  'oneusdt',  'Crypto', 'ONE',   'USDT', 6, 0, 1, true, true, 'crypto'),
  ('PHBUSDT',  'phbusdt',  'Crypto', 'PHB',   'USDT', 6, 0, 1, true, true, 'crypto'),
  ('POLUSDT',  'polusdt',  'Crypto', 'POL',   'USDT', 5, 0, 1, true, true, 'crypto'),
  ('POWRUSDT', 'powrusdt', 'Crypto', 'POWR',  'USDT', 6, 0, 1, true, true, 'crypto'),
  ('QTUMUSDT', 'qtumusdt', 'Crypto', 'QTUM',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('RSRUSDT',  'rsrusdt',  'Crypto', 'RSR',   'USDT', 6, 0, 1, true, true, 'crypto'),
  ('SKLUSDT',  'sklusdt',  'Crypto', 'SKL',   'USDT', 5, 0, 1, true, true, 'crypto'),
  ('SSVUSDT',  'ssvusdt',  'Crypto', 'SSV',   'USDT', 2, 4, 1, true, true, 'crypto'),
  ('STORJUSDT','storjusdt','Crypto','STORJ',  'USDT', 5, 0, 1, true, true, 'crypto'),
  ('TIAUSDT',  'tiausdt',  'Crypto', 'TIA',   'USDT', 4, 2, 1, true, true, 'crypto'),
  ('TLMUSDT',  'tlmusdt',  'Crypto', 'TLM',   'USDT', 5, 0, 1, true, true, 'crypto'),
  ('WOOUSDT',  'woousdt',  'Crypto', 'WOO',   'USDT', 5, 0, 1, true, true, 'crypto'),
  ('XAIUSDT',  'xaiusdt',  'Crypto', 'XAI',   'USDT', 4, 2, 1, true, true, 'crypto'),
  ('YFIUSDT',  'yfiusdt',  'Crypto', 'YFI',   'USDT', 2, 6, 1, true, true, 'crypto'),
  ('ZILUSDT',  'zilusdt',  'Crypto', 'ZIL',   'USDT', 6, 0, 1, true, true, 'crypto'),
  ('EGLDUSDT', 'egldusdt', 'Crypto', 'EGLD',  'USDT', 4, 2, 1, true, true, 'crypto'),
  ('ZRXUSDT',  'zrxusdt',  'Crypto', 'ZRX',   'USDT', 5, 0, 1, true, true, 'crypto'),
  ('SXPUSDT',  'sxpusdt',  'Crypto', 'SXP',   'USDT', 5, 0, 1, true, true, 'crypto'),
  ('C98USDT',  'c98usdt',  'Crypto', 'C98',   'USDT', 5, 0, 1, true, true, 'crypto'),
  ('ZROUSDT',  'zrousdt',  'Crypto', 'ZRO',   'USDT', 4, 2, 1, true, true, 'crypto'),
  ('PORTALUSDT','portalusdt','Crypto','PORTAL','USDT', 5, 0, 1, true, true, 'crypto'),
  ('DENTUSDT', 'dentusdt', 'Crypto', 'DENT',  'USDT', 6, 0, 1, true, true, 'crypto'),
  ('CVCUSDT',  'cvcusdt',  'Crypto', 'CVC',   'USDT', 5, 0, 1, true, true, 'crypto')
ON CONFLICT (code) DO NOTHING;

-- Keep provider marker normalized for this seed set
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'symbols' AND column_name = 'data_provider') THEN
    UPDATE symbols
    SET data_provider = 'Binance'
    WHERE code IN (
      'BTCUSDT','ETHUSDT','BNBUSDT','DOGEUSDT','SHIBUSDT','TONUSDT','XRPUSDT','ADAUSDT','SOLUSDT','XMRUSDT',
      'EOSUSDT','KASUSDT','TRXUSDT','AVAXUSDT','DOTUSDT','MATICUSDT','LINKUSDT','UNIUSDT','ATOMUSDT','LTCUSDT',
      'ETCUSDT','XLMUSDT','BCHUSDT','NEARUSDT','APTUSDT','FILUSDT','INJUSDT','OPUSDT','ARBUSDT','IMXUSDT',
      'SUIUSDT','SEIUSDT','RENDERUSDT','PEPEUSDT','WIFUSDT','FLOKIUSDT','BONKUSDT','FETUSDT','RUNEUSDT','GRTUSDT',
      'AAVEUSDT','ALGOUSDT','AXSUSDT','CRVUSDT','ENSUSDT','GMTUSDT','MANAUSDT','SANDUSDT','APEUSDT','LDOUSDT',
      'MKRUSDT','SNXUSDT','STXUSDT','THETAUSDT','VETUSDT','BLURUSDT','COMPUSDT','DYDXUSDT','GALAUSDT','HBARUSDT',
      'ICPUSDT','JASMYUSDT','KAVAUSDT','KSMUSDT','MANTAUSDT','ORDIUSDT','PENDLEUSDT','PYTHUSDT','QNTUSDT','RDNTUSDT',
      'RPLUSDT','STRKUSDT','WLDUSDT','ZECUSDT','1INCHUSDT','1000PEPEUSDT','1000SATSUSDT','AGIXUSDT','ARKMUSDT','ASTRUSDT',
      'BATUSDT','CELOUSDT','CFXUSDT','CHZUSDT','COTIUSDT','DASHUSDT','ENJUSDT','FLOWUSDT','FTMUSDT','GASUSDT',
      'HOTUSDT','ICXUSDT','KEYUSDT','KNCUSDT','LQTYUSDT','MAGICUSDT','MINAUSDT','NMRUSDT','OCEANUSDT','OMGUSDT',
      'ONEUSDT','PHBUSDT','POLUSDT','POWRUSDT','QTUMUSDT','RSRUSDT','SKLUSDT','SSVUSDT','STORJUSDT','TIAUSDT',
      'TLMUSDT','WOOUSDT','XAIUSDT','YFIUSDT','ZILUSDT','EGLDUSDT','ZRXUSDT','SXPUSDT','C98USDT','ZROUSDT',
      'PORTALUSDT','DENTUSDT','CVCUSDT'
    );
  END IF;
END $$;
