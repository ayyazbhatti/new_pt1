-- Check account summary for user by email
-- Usage: psql $DATABASE_URL -f scripts/check-account-summary.sql

WITH u AS (
  SELECT id, email, first_name, last_name, status, group_id
  FROM users
  WHERE email = 'duxuqivagu@mailinator.com'
),
-- Same logic as compute_account_summary_inner in auth-service
deposits AS (
  SELECT COALESCE(SUM(t.net_amount), 0) AS total
  FROM transactions t, u
  WHERE t.user_id = u.id AND t.type = 'deposit'::transaction_type
    AND t.status = 'completed'::transaction_status AND t.currency = 'USD'
),
withdrawals AS (
  SELECT COALESCE(SUM(t.net_amount), 0) AS total
  FROM transactions t, u
  WHERE t.user_id = u.id AND t.type = 'withdrawal'::transaction_type
    AND t.status = 'completed'::transaction_status AND t.currency = 'USD'
),
realized AS (
  SELECT COALESCE(SUM(p.pnl), 0) AS total
  FROM positions p, u
  WHERE p.user_id = u.id AND p.status = 'closed'::position_status
),
unrealized AS (
  SELECT COALESCE(SUM(p.pnl), 0) AS total
  FROM positions p, u
  WHERE p.user_id = u.id AND p.status = 'open'::position_status
),
margin_used AS (
  SELECT COALESCE(SUM(p.margin_used), 0) AS total
  FROM positions p, u
  WHERE p.user_id = u.id AND p.status = 'open'::position_status
)
SELECT
  u.id AS user_id,
  u.email,
  u.first_name,
  u.last_name,
  u.status,
  (SELECT total FROM deposits) AS deposits,
  (SELECT total FROM withdrawals) AS withdrawals,
  (SELECT total FROM realized) AS realized_pnl,
  (SELECT total FROM unrealized) AS unrealized_pnl,
  (SELECT total FROM margin_used) AS margin_used,
  ((SELECT total FROM deposits) - (SELECT total FROM withdrawals) + (SELECT total FROM realized)) AS balance,
  ((SELECT total FROM deposits) - (SELECT total FROM withdrawals) + (SELECT total FROM realized) + (SELECT total FROM unrealized)) AS equity
FROM u;
