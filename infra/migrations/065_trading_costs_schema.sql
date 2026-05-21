-- Trading costs Phase 1: group toggles, fee rules, charge audit tables, position accumulators, transaction_type 'swap'.
-- Enum values must precede the main transaction (see 061_bonus_system.sql).

ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'swap';

BEGIN;

-- 1. Per-group enable toggles
ALTER TABLE user_groups
  ADD COLUMN swap_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN fees_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN user_groups.swap_enabled IS
  'When true, positions in this group are charged swap at rollover time per swap_rules.';
COMMENT ON COLUMN user_groups.fees_enabled IS
  'When true, orders placed by members of this group are charged a fee at placement time per fee_rules.';

-- 2. Accumulated cost tracking on positions
ALTER TABLE positions
  ADD COLUMN accumulated_swap_usd NUMERIC(20, 8) NOT NULL DEFAULT 0,
  ADD COLUMN accumulated_fees_usd NUMERIC(20, 8) NOT NULL DEFAULT 0;

COMMENT ON COLUMN positions.accumulated_swap_usd IS
  'Running total of swap charges applied to this position (positive = debited from user).';
COMMENT ON COLUMN positions.accumulated_fees_usd IS
  'Running total of fees charged on fills that built this position.';

-- 3. Fee rules table
CREATE TABLE fee_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
    symbol VARCHAR(64),
    market VARCHAR(32) CHECK (market IS NULL OR market IN ('crypto', 'forex', 'commodities', 'indices', 'stocks')),
    fee_percent NUMERIC(10, 6) NOT NULL CHECK (fee_percent >= 0),
    min_fee NUMERIC(20, 8) NOT NULL DEFAULT 0 CHECK (min_fee >= 0),
    max_fee NUMERIC(20, 8) CHECK (max_fee IS NULL OR max_fee >= min_fee),
    status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by VARCHAR(255),
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_fee_rules_group_id ON fee_rules(group_id);
CREATE INDEX idx_fee_rules_symbol ON fee_rules(symbol);
CREATE INDEX idx_fee_rules_status ON fee_rules(status);
CREATE UNIQUE INDEX idx_fee_rules_group_symbol_market
    ON fee_rules(group_id, COALESCE(symbol, ''), COALESCE(market, ''));

COMMENT ON COLUMN fee_rules.symbol IS
  'NULL means rule applies to all symbols in group (default). Specific code wins over default.';
COMMENT ON COLUMN fee_rules.fee_percent IS
  'Fee as fraction of notional. 0.0005 = 5 bps = 0.05%';

-- 4. Swap charge audit log
CREATE TABLE swap_charge_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    position_id UUID NOT NULL REFERENCES positions(id),
    swap_rule_id UUID REFERENCES swap_rules(id) ON DELETE SET NULL,
    transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
    charged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    amount_usd NUMERIC(20, 8) NOT NULL,
    days_count INT NOT NULL DEFAULT 1,
    position_size NUMERIC(20, 8) NOT NULL,
    mark_price NUMERIC(20, 8) NOT NULL,
    rate_applied NUMERIC(20, 8) NOT NULL,
    side VARCHAR(8) NOT NULL
);

CREATE INDEX idx_swap_charge_log_user_id ON swap_charge_log(user_id);
CREATE INDEX idx_swap_charge_log_position_id ON swap_charge_log(position_id);
CREATE INDEX idx_swap_charge_log_charged_at ON swap_charge_log(charged_at);
CREATE UNIQUE INDEX idx_swap_charge_log_position_day
    ON swap_charge_log(position_id, ((charged_at AT TIME ZONE 'UTC')::date));

COMMENT ON INDEX idx_swap_charge_log_position_day IS
  'Idempotency: a single position cannot be charged swap more than once per UTC day.';

-- 5. Fee charge audit log
CREATE TABLE fee_charge_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    position_id UUID REFERENCES positions(id) ON DELETE SET NULL,
    fee_rule_id UUID REFERENCES fee_rules(id) ON DELETE SET NULL,
    transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
    charged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notional_usd NUMERIC(20, 8) NOT NULL,
    fee_percent_applied NUMERIC(10, 6) NOT NULL,
    fee_amount_usd NUMERIC(20, 8) NOT NULL,
    refunded BOOLEAN NOT NULL DEFAULT false,
    refunded_at TIMESTAMPTZ,
    refund_transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL
);

CREATE INDEX idx_fee_charge_log_user_id ON fee_charge_log(user_id);
CREATE INDEX idx_fee_charge_log_order_id ON fee_charge_log(order_id);
CREATE UNIQUE INDEX idx_fee_charge_log_order_unique ON fee_charge_log(order_id);

COMMENT ON INDEX idx_fee_charge_log_order_unique IS
  'Idempotency: a single order cannot be fee-charged more than once.';
COMMENT ON COLUMN fee_charge_log.refunded IS
  'True if the order was rejected post-placement and the fee was returned to the user.';

COMMIT;

-- Permissions (separate statements; not in transaction above)
INSERT INTO permissions (permission_key, label, category_id, sort_order)
SELECT 'fees:view', 'View trading fee configuration', (SELECT id FROM permission_categories WHERE LOWER(name) = 'swap' LIMIT 1), 52
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO permissions (permission_key, label, category_id, sort_order)
SELECT 'fees:edit', 'Create, update, and delete fee rules', (SELECT id FROM permission_categories WHERE LOWER(name) = 'swap' LIMIT 1), 53
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO permission_profile_grants (profile_id, permission_key)
SELECT pp.id, p.permission_key
FROM permission_profiles pp
CROSS JOIN permissions p
WHERE LOWER(pp.name) IN ('full access', 'v2')
  AND p.permission_key IN ('fees:view', 'fees:edit')
ON CONFLICT (profile_id, permission_key) DO NOTHING;
