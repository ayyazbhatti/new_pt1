-- Check if user parent@mailinator.com has an affiliate (referral) link.
-- Affiliate link format: /register?ref=<referral_code>
-- referral_code is stored on users table (e.g. REF9706ea16).

SELECT
  u.id AS user_id,
  u.email,
  u.referral_code,
  CASE
    WHEN u.referral_code IS NOT NULL AND u.referral_code <> '' THEN true
    ELSE false
  END AS has_affiliate_link,
  (SELECT COUNT(*) FROM users r WHERE r.referred_by_user_id = u.id AND (r.deleted_at IS NULL)) AS referred_count
FROM users u
WHERE LOWER(u.email) = LOWER('parent@mailinator.com')
  AND (u.deleted_at IS NULL OR u.deleted_at IS NOT DISTINCT FROM NULL);
