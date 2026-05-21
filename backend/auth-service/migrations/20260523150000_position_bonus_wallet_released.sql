-- Idempotent wallet PnL on position close (avoid double margin release if NATS replays).
BEGIN;

ALTER TABLE positions
  ADD COLUMN IF NOT EXISTS bonus_wallet_released BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE positions
SET bonus_wallet_released = TRUE
WHERE status IN ('closed'::position_status, 'liquidated'::position_status);

COMMIT;
