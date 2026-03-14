-- Speed up affiliate users list: referred_count is computed via JOIN to aggregated counts.
-- Without this index, the aggregation and joins on referred_by_user_id are slow on large users table.
CREATE INDEX IF NOT EXISTS idx_users_referred_by_user_id ON users(referred_by_user_id);
