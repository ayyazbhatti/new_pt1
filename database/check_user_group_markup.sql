-- Check for user pinycugumi@mailinator.com: group, price stream profile, and symbols with markup
-- 1) User and group
SELECT
  'user_and_group' AS section,
  u.id AS user_id,
  u.email,
  u.group_id,
  ug.name AS group_name,
  ug.default_price_profile_id AS price_profile_id
FROM users u
LEFT JOIN user_groups ug ON ug.id = u.group_id
WHERE LOWER(u.email) = LOWER('pinycugumi@mailinator.com')
  AND (u.deleted_at IS NULL OR u.deleted_at IS NOT DISTINCT FROM NULL);

-- 2) Price stream profile (name) for that group
SELECT
  'price_stream_profile' AS section,
  psp.id AS profile_id,
  psp.name AS profile_name,
  psp.description,
  psp.bid_markup AS profile_default_bid,
  psp.ask_markup AS profile_default_ask
FROM users u
JOIN user_groups ug ON ug.id = u.group_id
LEFT JOIN price_stream_profiles psp ON psp.id = ug.default_price_profile_id
WHERE LOWER(u.email) = LOWER('pinycugumi@mailinator.com')
  AND (u.deleted_at IS NULL OR u.deleted_at IS NOT DISTINCT FROM NULL);

-- 3) Symbols that have markup for this user's group profile (symbol-level overrides)
SELECT
  'symbol_markups' AS section,
  s.code AS symbol_code,
  COALESCE(s.provider_symbol, s.code) AS provider_symbol,
  smo.bid_markup,
  smo.ask_markup
FROM users u
JOIN user_groups ug ON ug.id = u.group_id
JOIN price_stream_profiles psp ON psp.id = ug.default_price_profile_id
JOIN symbol_markup_overrides smo ON smo.profile_id = psp.id
JOIN symbols s ON s.id = smo.symbol_id
WHERE LOWER(u.email) = LOWER('pinycugumi@mailinator.com')
  AND (u.deleted_at IS NULL OR u.deleted_at IS NOT DISTINCT FROM NULL)
  AND (smo.bid_markup <> 0 OR smo.ask_markup <> 0)
ORDER BY s.code;
