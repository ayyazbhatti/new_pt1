-- Mirror of infra/migrations/068_transaction_audit_completeness.sql

ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'margin_lock';
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'margin_unlock';
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'affiliate_commission';

BEGIN;

CREATE INDEX IF NOT EXISTS idx_transactions_audit_margin_types
  ON transactions (user_id, created_at DESC)
  WHERE type IN (
    'margin_lock'::transaction_type,
    'margin_unlock'::transaction_type,
    'bonus_margin_lock'::transaction_type,
    'bonus_margin_release'::transaction_type
  );

COMMIT;
