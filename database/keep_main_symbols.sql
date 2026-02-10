-- Keep only 10 main symbols and delete the rest
-- Main symbols to keep: BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT, XRPUSDT, ADAUSDT, DOGEUSDT, DOTUSDT, AVAXUSDT, MATICUSDT

-- Get the IDs of symbols to keep
WITH symbols_to_keep AS (
    SELECT id FROM symbols 
    WHERE code IN ('BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'DOTUSDT', 'AVAXUSDT', 'MATICUSDT')
)
-- Delete related records first (most have CASCADE, but being explicit is safer)
DELETE FROM symbol_price_overrides 
WHERE symbol_id NOT IN (SELECT id FROM symbols_to_keep);

DELETE FROM symbol_markup_overrides 
WHERE symbol_id NOT IN (SELECT id FROM symbols WHERE code IN ('BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'DOTUSDT', 'AVAXUSDT', 'MATICUSDT'));

DELETE FROM symbol_leverage_profile_assignments 
WHERE symbol_id NOT IN (SELECT id FROM symbols WHERE code IN ('BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'DOTUSDT', 'AVAXUSDT', 'MATICUSDT'));

-- Delete all symbols except the 10 main ones
-- Note: Other tables (orders, positions, swap_rules, price_snapshots) have ON DELETE CASCADE
DELETE FROM symbols 
WHERE code NOT IN (
    'BTCUSDT', 
    'ETHUSDT', 
    'BNBUSDT', 
    'SOLUSDT', 
    'XRPUSDT', 
    'ADAUSDT', 
    'DOGEUSDT', 
    'DOTUSDT', 
    'AVAXUSDT', 
    'MATICUSDT'
);

-- Verify the result
SELECT code, name, base_currency, quote_currency, is_enabled, trading_enabled 
FROM symbols 
ORDER BY code;

