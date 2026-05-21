-- Bonus system: wallet bonus pools, position margin source, cash PnL adjustment via bonus_loss_absorbed,
-- extended transaction_type enum, order margin snapshot for cancel unlock.

-- Enum values (PG 9.1+; IF NOT EXISTS PG 15+)
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'bonus_grant';
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'bonus_revoke';
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'bonus_loss_absorb';
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'bonus_margin_lock';
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'bonus_margin_release';
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'pnl_credit';
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'pnl_debit';

BEGIN;

-- 1. Wallets: bonus tracking (spot USD wallet; aligns with withdrawal checks on available_balance)
ALTER TABLE wallets
  ADD COLUMN IF NOT EXISTS bonus_balance NUMERIC(20, 8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bonus_locked NUMERIC(20, 8) NOT NULL DEFAULT 0;

ALTER TABLE wallets DROP CONSTRAINT IF EXISTS wallets_bonus_balance_nonneg;
ALTER TABLE wallets ADD CONSTRAINT wallets_bonus_balance_nonneg CHECK (bonus_balance >= 0);

ALTER TABLE wallets DROP CONSTRAINT IF EXISTS wallets_bonus_locked_nonneg;
ALTER TABLE wallets ADD CONSTRAINT wallets_bonus_locked_nonneg CHECK (bonus_locked >= 0);

ALTER TABLE wallets DROP CONSTRAINT IF EXISTS wallets_bonus_locked_lte_balance;
ALTER TABLE wallets ADD CONSTRAINT wallets_bonus_locked_lte_balance CHECK (bonus_locked <= bonus_balance);

-- 2. Positions: margin source + cash-side PnL adjustment when loss absorbed by bonus
ALTER TABLE positions
  ADD COLUMN IF NOT EXISTS margin_from_cash NUMERIC(20, 8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS margin_from_bonus NUMERIC(20, 8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bonus_loss_absorbed NUMERIC(20, 8) NOT NULL DEFAULT 0;

-- 3. Backfill open positions: legacy margin was all cash-funded
UPDATE positions
SET margin_from_cash = COALESCE(margin_used, 0),
    margin_from_bonus = 0
WHERE status = 'open'::position_status;

-- 4. Orders: snapshot of margin lock at placement (for unlock on cancel/reject)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS margin_from_cash NUMERIC(20, 8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS margin_from_bonus NUMERIC(20, 8) NOT NULL DEFAULT 0;

COMMIT;
