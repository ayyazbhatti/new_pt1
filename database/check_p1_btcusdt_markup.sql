-- Check if "p1" price stream has any markup for BTCUSDT
-- "p1" can be: (1) a price_stream_profile name, or (2) a user_group name that has a default_price_profile

-- 1) Profile named 'p1': profile-level defaults + per-symbol overrides for BTCUSDT
SELECT
  'profile_p1' AS source,
  psp.id AS profile_id,
  psp.name AS profile_name,
  psp.bid_markup AS profile_bid_markup,
  psp.ask_markup AS profile_ask_markup,
  s.code AS symbol_code,
  smo.bid_markup AS symbol_bid_markup,
  smo.ask_markup AS symbol_ask_markup,
  CASE
    WHEN smo.profile_id IS NOT NULL THEN 'override (symbol-level)'
    ELSE 'profile default only'
  END AS markup_source
FROM price_stream_profiles psp
LEFT JOIN symbol_markup_overrides smo ON smo.profile_id = psp.id
LEFT JOIN symbols s ON s.id = smo.symbol_id AND s.code = 'BTCUSDT'
WHERE psp.name = 'p1';

-- If no row: no profile named 'p1'. Try group named 'p1' and its profile's markup for BTCUSDT.
SELECT
  'group_p1' AS source,
  ug.id AS group_id,
  ug.name AS group_name,
  psp.id AS profile_id,
  psp.name AS profile_name,
  psp.bid_markup AS profile_bid_markup,
  psp.ask_markup AS profile_ask_markup,
  s.code AS symbol_code,
  smo.bid_markup AS symbol_bid_markup,
  smo.ask_markup AS symbol_ask_markup,
  CASE
    WHEN smo.profile_id IS NOT NULL THEN 'override (symbol-level)'
    WHEN psp.id IS NOT NULL THEN 'profile default only'
    ELSE 'no profile'
  END AS markup_source
FROM user_groups ug
LEFT JOIN price_stream_profiles psp ON psp.id = ug.default_price_profile_id
LEFT JOIN symbol_markup_overrides smo ON smo.profile_id = psp.id
LEFT JOIN symbols s ON s.id = smo.symbol_id AND s.code = 'BTCUSDT'
WHERE ug.name = 'p1';

-- List all profiles and groups (to see what exists, e.g. "p1" vs "P1" vs "Default")
SELECT 'profiles' AS kind, id::text, name FROM price_stream_profiles
UNION ALL
SELECT 'groups' AS kind, id::text, name FROM user_groups;
