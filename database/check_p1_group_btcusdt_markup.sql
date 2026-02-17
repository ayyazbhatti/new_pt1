-- Check: do users in "p1" group (or groups using p1 profile) have markup for BTCUSDT?
-- p1 can be a profile name; "p1 group" = group whose default_price_profile_id = p1 profile.

-- 1) Profile named 'p1' and its BTCUSDT override
SELECT
  'profile_p1_btcusdt' AS check_type,
  psp.id AS profile_id,
  psp.name AS profile_name,
  s.code AS symbol_code,
  smo.bid_markup,
  smo.ask_markup
FROM price_stream_profiles psp
LEFT JOIN symbol_markup_overrides smo ON smo.profile_id = psp.id
LEFT JOIN symbols s ON s.id = smo.symbol_id AND s.code = 'BTCUSDT'
WHERE psp.name = 'p1';

-- 2) Groups that use profile p1 (so their users get p1's markup, including BTCUSDT)
SELECT
  'groups_using_p1' AS check_type,
  ug.id AS group_id,
  ug.name AS group_name,
  psp.id AS profile_id,
  psp.name AS profile_name
FROM user_groups ug
JOIN price_stream_profiles psp ON psp.id = ug.default_price_profile_id AND psp.name = 'p1';

-- 3) Users in those groups (sample)
SELECT
  'users_in_p1_profile_groups' AS check_type,
  u.id AS user_id,
  u.email,
  ug.name AS group_name,
  psp.name AS price_profile
FROM users u
JOIN user_groups ug ON ug.id = u.group_id
JOIN price_stream_profiles psp ON psp.id = ug.default_price_profile_id AND psp.name = 'p1'
WHERE u.deleted_at IS NULL
LIMIT 10;
