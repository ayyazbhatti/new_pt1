-- Seed one default price stream profile so Admin Groups dropdown has at least one option
INSERT INTO price_stream_profiles (id, name, description, markup_type, bid_markup, ask_markup)
SELECT
    uuid_generate_v4(),
    'Default',
    'Default price stream profile',
    'pips',
    0,
    0
WHERE NOT EXISTS (SELECT 1 FROM price_stream_profiles LIMIT 1);
