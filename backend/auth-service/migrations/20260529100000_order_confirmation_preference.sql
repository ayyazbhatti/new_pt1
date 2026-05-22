BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS confirm_orders_before_placement BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN users.confirm_orders_before_placement IS
  'When true, the order ticket shows a confirmation dialog before submitting orders. Default true for safety; users can disable for fast trading.';

COMMIT;
