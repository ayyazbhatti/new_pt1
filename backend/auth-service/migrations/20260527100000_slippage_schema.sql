BEGIN;

-- 1. Platform-wide default slippage tolerance (in basis points)
ALTER TABLE platform_general_settings
  ADD COLUMN IF NOT EXISTS default_slippage_bps INTEGER NOT NULL DEFAULT 50
    CHECK (default_slippage_bps >= 0);

COMMENT ON COLUMN platform_general_settings.default_slippage_bps IS
  'Default max slippage in basis points for market orders. 50 = 0.5%. Used when group and order have no override.';

-- 2. Per-group default (nullable — null means use platform default)
ALTER TABLE user_groups
  ADD COLUMN IF NOT EXISTS default_slippage_bps INTEGER
    CHECK (default_slippage_bps IS NULL OR default_slippage_bps >= 0);

COMMENT ON COLUMN user_groups.default_slippage_bps IS
  'Group-level default max slippage in basis points. NULL falls back to platform default. Can exceed platform cap.';

-- 3. Per-order columns — snapshot + actual tolerance applied
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS requested_bid NUMERIC(20, 8),
  ADD COLUMN IF NOT EXISTS requested_ask NUMERIC(20, 8),
  ADD COLUMN IF NOT EXISTS max_slippage_bps INTEGER;

COMMENT ON COLUMN orders.requested_bid IS
  'Bid price snapshot from auth-service at submission. Used by engine Phase 2 to compute slippage on market fills.';
COMMENT ON COLUMN orders.requested_ask IS
  'Ask price snapshot from auth-service at submission.';
COMMENT ON COLUMN orders.max_slippage_bps IS
  'Resolved slippage tolerance applied to this specific order. Stored for audit and engine enforcement.';

CREATE INDEX IF NOT EXISTS idx_orders_max_slippage_bps ON orders(max_slippage_bps) WHERE max_slippage_bps IS NOT NULL;

COMMIT;
