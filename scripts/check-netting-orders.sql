-- Netting diagnostic: check account_type for users who placed the given orders/position.
-- Run against your app DB (e.g. newpt). Replace the IDs with full UUIDs if you have them.
--
-- Orders you mentioned: 3cb1916c... and f1792480...
-- Position: 46b6d281-4199-4293-9717-c5e3f755c9bf

-- 1) Find orders by partial ID and show user + account_type
SELECT o.id AS order_id, o.user_id, u.email, u.account_type, o.side, o.type AS order_type, o.status, o.size, o.created_at
FROM orders o
JOIN users u ON u.id = o.user_id
WHERE o.id::text LIKE '3cb1916c%' OR o.id::text LIKE 'f1792480%'
ORDER BY o.created_at;

-- 2) Position 46b6d281-4199-4293-9717-c5e3f755c9bf: user and account_type
SELECT p.id AS position_id, p.user_id, u.email, u.account_type, p.side, p.size, p.status, p.opened_at
FROM positions p
JOIN users u ON u.id = p.user_id
WHERE p.id = '46b6d281-4199-4293-9717-c5e3f755c9bf';

-- 3) If account_type is 'hedging', netting will not run. Set to netting for this user:
-- UPDATE users SET account_type = 'netting', updated_at = NOW() WHERE id = '<user_id from above>';
-- Then restart auth-service (and order-engine if you want to clear in-memory state). New orders will use netting.
