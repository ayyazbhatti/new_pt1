-- Seed 5 swap rules (profiles). Uses first available group_id from user_groups.
INSERT INTO swap_rules (
    group_id,
    symbol,
    market,
    calc_mode,
    unit,
    long_rate,
    short_rate,
    rollover_time_utc,
    weekend_rule,
    status,
    notes,
    updated_by
)
SELECT
    (SELECT id FROM user_groups LIMIT 1),
    v.symbol,
    v.market,
    v.calc_mode,
    v.unit,
    v.long_rate,
    v.short_rate,
    v.rollover_time_utc,
    v.weekend_rule,
    v.status,
    v.notes,
    'seed-script'
FROM (
    VALUES
        ('EURUSD', 'forex', 'daily', 'percent', 0.02, -0.05, '00:00', 'fri_triple', 'active', 'Standard forex swap'),
        ('BTCUSDT', 'crypto', 'hourly', 'percent', 0.001, -0.001, '00:00', 'none', 'active', NULL),
        ('XAUUSD', 'commodities', 'daily', 'fixed', 2.5, -1.5, '23:59', 'triple_day', 'active', NULL),
        ('US30', 'indices', 'funding_8h', 'percent', 0.005, -0.005, '00:00', 'none', 'active', NULL),
        ('GBPUSD', 'forex', 'daily', 'percent', 0.03, -0.06, '00:00', 'fri_triple', 'active', 'Sterling forex swap')
) AS v(symbol, market, calc_mode, unit, long_rate, short_rate, rollover_time_utc, weekend_rule, status, notes)
ON CONFLICT (group_id, symbol) DO NOTHING;
