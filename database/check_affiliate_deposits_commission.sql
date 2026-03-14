-- Deep check: parent@mailinator.com (affiliate REF9706ea16)
-- 1) Referred users and their deposits (deposit_requests + transactions)
-- 2) Whether parent has an affiliates row and any commission records

\echo '=== 1) AFFILIATE USER (parent@mailinator.com) ==='
SELECT id AS affiliate_user_id, email, referral_code, referred_by_user_id
FROM users
WHERE LOWER(email) = LOWER('parent@mailinator.com') AND (deleted_at IS NULL OR deleted_at IS NOT DISTINCT FROM NULL);

\echo ''
\echo '=== 2) REFERRED USERS (signed up via parent ref link) ==='
SELECT u.id AS referred_user_id, u.email AS referred_email, u.created_at AS referred_since
FROM users u
WHERE u.referred_by_user_id = (SELECT id FROM users WHERE LOWER(email) = LOWER('parent@mailinator.com') AND (deleted_at IS NULL OR deleted_at IS NOT DISTINCT FROM NULL) LIMIT 1)
  AND (u.deleted_at IS NULL OR u.deleted_at IS NOT DISTINCT FROM NULL);

\echo ''
\echo '=== 3) DEPOSITS BY REFERRED USERS (deposit_requests) ==='
SELECT dr.id AS request_id, dr.user_id, u.email, dr.amount, dr.currency, dr.status, dr.created_at, dr.approved_at
FROM deposit_requests dr
JOIN users u ON u.id = dr.user_id
WHERE dr.user_id IN (
  SELECT u2.id FROM users u2
  WHERE u2.referred_by_user_id = (SELECT id FROM users WHERE LOWER(email) = LOWER('parent@mailinator.com') AND (deleted_at IS NULL OR deleted_at IS NOT DISTINCT FROM NULL) LIMIT 1)
    AND (u2.deleted_at IS NULL OR u2.deleted_at IS NOT DISTINCT FROM NULL)
)
ORDER BY dr.created_at DESC;

\echo ''
\echo '=== 4) DEPOSITS BY REFERRED USERS (transactions type=deposit) ==='
SELECT t.id, t.user_id, u.email, t.amount, t.net_amount, t.currency, t.status, t.type, t.created_at
FROM transactions t
JOIN users u ON u.id = t.user_id
WHERE t.user_id IN (
  SELECT u2.id FROM users u2
  WHERE u2.referred_by_user_id = (SELECT id FROM users WHERE LOWER(email) = LOWER('parent@mailinator.com') AND (deleted_at IS NULL OR deleted_at IS NOT DISTINCT FROM NULL) LIMIT 1)
    AND (u2.deleted_at IS NULL OR u2.deleted_at IS NOT DISTINCT FROM NULL)
)
AND t.type = 'deposit'
ORDER BY t.created_at DESC;

\echo ''
\echo '=== 5) PARENT IN AFFILIATES TABLE? (affiliate_id used for commission) ==='
SELECT a.id AS affiliate_id, a.user_id, a.code, a.commission_type, a.commission_value, a.status
FROM affiliates a
WHERE a.user_id = (SELECT id FROM users WHERE LOWER(email) = LOWER('parent@mailinator.com') AND (deleted_at IS NULL OR deleted_at IS NOT DISTINCT FROM NULL) LIMIT 1)
   OR a.code = 'REF9706ea16';

\echo ''
\echo '=== 6) COMMISSIONS FOR PARENT (affiliate_commissions by affiliate_id or by referrer) ==='
-- By affiliates.id if parent has an affiliates row
SELECT ac.id, ac.affiliate_id, ac.user_id AS referred_user_id, u.email AS referred_email,
       ac.amount, ac.currency, ac.commission_type, ac.commission_value, ac.status, ac.created_at, ac.paid_at
FROM affiliate_commissions ac
JOIN users u ON u.id = ac.user_id
WHERE ac.affiliate_id IN (
  SELECT a.id FROM affiliates a
  WHERE a.user_id = (SELECT id FROM users WHERE LOWER(email) = LOWER('parent@mailinator.com') AND (deleted_at IS NULL OR deleted_at IS NOT DISTINCT FROM NULL) LIMIT 1)
     OR a.code = 'REF9706ea16'
)
ORDER BY ac.created_at DESC;

\echo ''
\echo '=== 7) ANY COMMISSION ROWS WHERE user_id IS A REFERRED USER (in case affiliate_id points to same user) ==='
SELECT ac.id, ac.affiliate_id, aff.user_id AS affiliate_user_id, ac.user_id AS referred_user_id,
       u.email AS referred_email, ac.amount, ac.currency, ac.status, ac.created_at
FROM affiliate_commissions ac
JOIN affiliates aff ON aff.id = ac.affiliate_id
JOIN users u ON u.id = ac.user_id
WHERE ac.user_id IN (
  SELECT u2.id FROM users u2
  WHERE u2.referred_by_user_id = (SELECT id FROM users WHERE LOWER(email) = LOWER('parent@mailinator.com') AND (deleted_at IS NULL OR deleted_at IS NOT DISTINCT FROM NULL) LIMIT 1)
)
ORDER BY ac.created_at DESC;

\echo ''
\echo '=== 8) SUMMARY: Total approved deposit amount by referred users ==='
WITH referred AS (
  SELECT u2.id FROM users u2
  WHERE u2.referred_by_user_id = (SELECT id FROM users WHERE LOWER(email) = LOWER('parent@mailinator.com') AND (deleted_at IS NULL OR deleted_at IS NOT DISTINCT FROM NULL) LIMIT 1)
)
SELECT
  (SELECT COUNT(*) FROM deposit_requests dr WHERE dr.user_id IN (SELECT id FROM referred) AND dr.status = 'APPROVED') AS approved_deposit_requests,
  (SELECT COALESCE(SUM(dr.amount), 0) FROM deposit_requests dr WHERE dr.user_id IN (SELECT id FROM referred) AND dr.status = 'APPROVED') AS total_approved_deposit_amount,
  (SELECT COUNT(*) FROM transactions t WHERE t.user_id IN (SELECT id FROM referred) AND t.type = 'deposit') AS deposit_transactions_count,
  (SELECT COALESCE(SUM(t.net_amount), 0) FROM transactions t WHERE t.user_id IN (SELECT id FROM referred) AND t.type = 'deposit' AND t.status IN ('completed','approved')) AS total_deposit_net_transactions;
