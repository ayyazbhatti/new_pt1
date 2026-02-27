-- ============================================================
-- NEWPT - Professional CFD/Margin Trading Platform
-- PostgreSQL Database Schema
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE user_status AS ENUM ('active', 'disabled', 'suspended');
CREATE TYPE kyc_status AS ENUM ('none', 'pending', 'verified', 'rejected');
CREATE TYPE risk_flag AS ENUM ('normal', 'high', 'review');
CREATE TYPE wallet_type AS ENUM ('spot', 'margin', 'funding');
CREATE TYPE transaction_type AS ENUM ('deposit', 'withdrawal', 'adjustment', 'fee', 'rebate');
CREATE TYPE transaction_status AS ENUM ('pending', 'completed', 'rejected', 'failed');
CREATE TYPE transaction_method AS ENUM ('card', 'bank', 'crypto', 'manual');
CREATE TYPE order_side AS ENUM ('buy', 'sell');
CREATE TYPE order_type AS ENUM ('market', 'limit', 'stop', 'stop_limit');
CREATE TYPE order_status AS ENUM ('pending', 'filled', 'cancelled', 'rejected', 'partially_filled');
CREATE TYPE position_side AS ENUM ('long', 'short');
CREATE TYPE position_status AS ENUM ('open', 'closed', 'liquidated');
CREATE TYPE market_type AS ENUM ('crypto', 'forex', 'commodities', 'indices', 'stocks');
CREATE TYPE markup_type AS ENUM ('percent');
CREATE TYPE rounding_mode AS ENUM ('none', 'symbol', 'custom');
CREATE TYPE swap_calc_mode AS ENUM ('daily', 'hourly', 'funding_8h');
CREATE TYPE swap_unit AS ENUM ('percent', 'fixed');
CREATE TYPE weekend_rule AS ENUM ('none', 'triple_day', 'fri_triple', 'custom');
CREATE TYPE margin_event_type AS ENUM ('margin_call', 'liquidation');
CREATE TYPE event_severity AS ENUM ('low', 'medium', 'high');
CREATE TYPE commission_type AS ENUM ('percentage', 'fixed', 'tiered');
CREATE TYPE admin_action_type AS ENUM ('create', 'update', 'delete', 'approve', 'reject', 'restrict', 'adjust');

-- ============================================================
-- 1. USERS & AUTH
-- ============================================================

CREATE TABLE user_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    default_price_profile_id UUID,
    max_leverage_min INTEGER NOT NULL DEFAULT 1,
    max_leverage_max INTEGER NOT NULL DEFAULT 500,
    trading_enabled BOOLEAN NOT NULL DEFAULT true,
    withdraw_enabled BOOLEAN NOT NULL DEFAULT true,
    close_only BOOLEAN NOT NULL DEFAULT false,
    max_open_positions_per_user INTEGER,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE price_stream_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    group_id UUID REFERENCES user_groups(id) ON DELETE SET NULL,
    markup_type markup_type NOT NULL DEFAULT 'percent',
    bid_markup NUMERIC(20, 8) NOT NULL DEFAULT 0,
    ask_markup NUMERIC(20, 8) NOT NULL DEFAULT 0,
    rounding_mode rounding_mode NOT NULL DEFAULT 'symbol',
    custom_rounding INTEGER,
    allow_negative BOOLEAN NOT NULL DEFAULT false,
    status user_status NOT NULL DEFAULT 'active',
    created_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE leverage_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    status user_status NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE leverage_tiers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id UUID NOT NULL REFERENCES leverage_profiles(id) ON DELETE CASCADE,
    margin_from NUMERIC(20, 2) NOT NULL DEFAULT 0,
    margin_to NUMERIC(20, 2) NOT NULL,
    leverage INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT margin_range_check CHECK (margin_to > margin_from),
    CONSTRAINT leverage_check CHECK (leverage > 0 AND leverage <= 1000)
);

CREATE TABLE affiliates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID,
    code VARCHAR(50) NOT NULL UNIQUE,
    commission_type commission_type NOT NULL DEFAULT 'percentage',
    commission_value NUMERIC(10, 4) NOT NULL DEFAULT 0,
    status user_status NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    phone VARCHAR(50),
    country VARCHAR(10),
    group_id UUID NOT NULL REFERENCES user_groups(id),
    price_profile_id UUID REFERENCES price_stream_profiles(id),
    leverage_profile_id UUID REFERENCES leverage_profiles(id),
    affiliate_id UUID REFERENCES affiliates(id),
    status user_status NOT NULL DEFAULT 'active',
    kyc_status kyc_status NOT NULL DEFAULT 'none',
    risk_flag risk_flag NOT NULL DEFAULT 'normal',
    trading_enabled BOOLEAN NOT NULL DEFAULT true,
    close_only_mode BOOLEAN NOT NULL DEFAULT false,
    withdrawals_enabled BOOLEAN NOT NULL DEFAULT true,
    deposits_enabled BOOLEAN NOT NULL DEFAULT true,
    max_leverage_cap INTEGER,
    max_position_size NUMERIC(20, 2),
    max_daily_loss NUMERIC(20, 2),
    last_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    ip_address VARCHAR(45),
    user_agent TEXT,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE admin_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    role VARCHAR(50) NOT NULL DEFAULT 'admin',
    permissions JSONB,
    status user_status NOT NULL DEFAULT 'active',
    last_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 2. SYMBOLS & MARKETS
-- ============================================================

CREATE TABLE symbols (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255),
    market market_type NOT NULL,
    base_currency VARCHAR(10) NOT NULL,
    quote_currency VARCHAR(10) NOT NULL,
    digits INTEGER NOT NULL DEFAULT 2,
    tick_size NUMERIC(20, 8) NOT NULL DEFAULT 0.01,
    contract_size NUMERIC(20, 8) NOT NULL DEFAULT 1,
    price_precision INTEGER NOT NULL DEFAULT 2,
    lot_min NUMERIC(20, 8) NOT NULL DEFAULT 0.01,
    lot_max NUMERIC(20, 8),
    leverage_profile_id UUID REFERENCES leverage_profiles(id),
    trading_enabled BOOLEAN NOT NULL DEFAULT true,
    close_only BOOLEAN NOT NULL DEFAULT false,
    allow_new_orders BOOLEAN NOT NULL DEFAULT true,
    max_leverage_cap INTEGER,
    max_order_size NUMERIC(20, 2),
    max_position_size NUMERIC(20, 2),
    data_provider VARCHAR(100) DEFAULT 'Binance',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE symbol_price_overrides (
    symbol_id UUID NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
    profile_id UUID REFERENCES price_stream_profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (symbol_id)
);

-- ============================================================
-- 3. WALLETS & FINANCE
-- ============================================================

CREATE TABLE wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wallet_type wallet_type NOT NULL,
    currency VARCHAR(10) NOT NULL,
    available_balance NUMERIC(20, 8) NOT NULL DEFAULT 0,
    locked_balance NUMERIC(20, 8) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, wallet_type, currency)
);

CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type transaction_type NOT NULL,
    amount NUMERIC(20, 8) NOT NULL,
    currency VARCHAR(10) NOT NULL,
    fee NUMERIC(20, 8) NOT NULL DEFAULT 0,
    net_amount NUMERIC(20, 8) NOT NULL,
    method transaction_method NOT NULL,
    status transaction_status NOT NULL DEFAULT 'pending',
    reference VARCHAR(255) NOT NULL UNIQUE,
    method_details JSONB,
    admin_notes TEXT,
    rejection_reason TEXT,
    created_by UUID REFERENCES admin_users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    cancelled_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE ledger_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    type transaction_type NOT NULL,
    delta NUMERIC(20, 8) NOT NULL,
    balance_after NUMERIC(20, 8) NOT NULL,
    ref VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 4. ORDERS & POSITIONS (CORE ENGINE)
-- ============================================================

CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol_id UUID NOT NULL REFERENCES symbols(id),
    side order_side NOT NULL,
    type order_type NOT NULL,
    size NUMERIC(20, 8) NOT NULL,
    price NUMERIC(20, 8),
    stop_price NUMERIC(20, 8),
    filled_size NUMERIC(20, 8) NOT NULL DEFAULT 0,
    average_price NUMERIC(20, 8),
    leverage_used INTEGER,
    margin_used NUMERIC(20, 8),
    status order_status NOT NULL DEFAULT 'pending',
    reference VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    filled_at TIMESTAMP WITH TIME ZONE,
    cancelled_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol_id UUID NOT NULL REFERENCES symbols(id),
    side position_side NOT NULL,
    size NUMERIC(20, 8) NOT NULL,
    entry_price NUMERIC(20, 8) NOT NULL,
    mark_price NUMERIC(20, 8) NOT NULL,
    leverage INTEGER NOT NULL,
    margin_used NUMERIC(20, 8) NOT NULL,
    liquidation_price NUMERIC(20, 8) NOT NULL,
    pnl NUMERIC(20, 8) NOT NULL DEFAULT 0,
    pnl_percent NUMERIC(10, 4) NOT NULL DEFAULT 0,
    status position_status NOT NULL DEFAULT 'open',
    opened_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 5. RISK & LIQUIDATION
-- ============================================================

CREATE TABLE risk_limits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID REFERENCES user_groups(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    symbol_id UUID REFERENCES symbols(id) ON DELETE CASCADE,
    max_position_size NUMERIC(20, 2),
    max_daily_loss NUMERIC(20, 2),
    margin_call_level NUMERIC(10, 4) NOT NULL DEFAULT 100.0,
    liquidation_level NUMERIC(10, 4) NOT NULL DEFAULT 50.0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT risk_limits_scope_check CHECK (
        (group_id IS NOT NULL AND user_id IS NULL AND symbol_id IS NULL) OR
        (group_id IS NULL AND user_id IS NOT NULL AND symbol_id IS NULL) OR
        (group_id IS NULL AND user_id IS NULL AND symbol_id IS NOT NULL) OR
        (group_id IS NULL AND user_id IS NOT NULL AND symbol_id IS NOT NULL)
    )
);

CREATE TABLE margin_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    position_id UUID REFERENCES positions(id) ON DELETE SET NULL,
    type margin_event_type NOT NULL,
    severity event_severity NOT NULL,
    equity NUMERIC(20, 8) NOT NULL,
    margin NUMERIC(20, 8) NOT NULL,
    free_margin NUMERIC(20, 8) NOT NULL,
    maintenance_margin NUMERIC(20, 8) NOT NULL,
    message TEXT,
    acknowledged BOOLEAN NOT NULL DEFAULT false,
    acknowledged_by UUID REFERENCES admin_users(id),
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 6. SWAP / FUNDING FEES
-- ============================================================

CREATE TABLE swap_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
    symbol_id UUID NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
    calc_mode swap_calc_mode NOT NULL DEFAULT 'daily',
    unit swap_unit NOT NULL DEFAULT 'percent',
    long_rate NUMERIC(20, 8) NOT NULL,
    short_rate NUMERIC(20, 8) NOT NULL,
    rollover_time_utc TIME NOT NULL DEFAULT '00:00:00',
    triple_day VARCHAR(10),
    weekend_rule weekend_rule NOT NULL DEFAULT 'none',
    min_charge NUMERIC(20, 8),
    max_charge NUMERIC(20, 8),
    status user_status NOT NULL DEFAULT 'active',
    notes TEXT,
    created_by UUID REFERENCES admin_users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(group_id, symbol_id)
);

-- ============================================================
-- 7. AFFILIATE SYSTEM
-- ============================================================

CREATE TABLE affiliate_commissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    trade_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    position_id UUID REFERENCES positions(id) ON DELETE SET NULL,
    amount NUMERIC(20, 8) NOT NULL,
    currency VARCHAR(10) NOT NULL,
    commission_type commission_type NOT NULL,
    commission_value NUMERIC(10, 4) NOT NULL,
    status transaction_status NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    paid_at TIMESTAMP WITH TIME ZONE
);

-- ============================================================
-- 8. ADMIN LOGS & AUDIT
-- ============================================================

CREATE TABLE admin_actions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    action admin_action_type NOT NULL,
    target_type VARCHAR(50) NOT NULL,
    target_id UUID,
    details JSONB,
    ip_address VARCHAR(45),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE kyc_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    reviewed_by UUID REFERENCES admin_users(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    rejection_reason TEXT,
    uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE activity_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    admin_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    details TEXT,
    ip_address VARCHAR(45),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 9. PRICE DATA (for real-time pricing)
-- ============================================================

CREATE TABLE price_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol_id UUID NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
    provider_bid NUMERIC(20, 8) NOT NULL,
    provider_ask NUMERIC(20, 8) NOT NULL,
    final_bid NUMERIC(20, 8) NOT NULL,
    final_ask NUMERIC(20, 8) NOT NULL,
    spread NUMERIC(20, 8) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Platform email (SMTP) configuration for admin settings (single row per env)
CREATE TABLE IF NOT EXISTS platform_email_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    smtp_host VARCHAR(255) NOT NULL DEFAULT 'smtp.example.com',
    smtp_port INTEGER NOT NULL DEFAULT 587,
    smtp_encryption VARCHAR(20) NOT NULL DEFAULT 'tls',
    smtp_username VARCHAR(255) NOT NULL DEFAULT '',
    smtp_password TEXT,
    from_email VARCHAR(255) NOT NULL DEFAULT 'noreply@example.com',
    from_name VARCHAR(255) NOT NULL DEFAULT 'Platform',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Platform email templates (welcome, password_reset, etc.)
CREATE TABLE IF NOT EXISTS platform_email_templates (
    template_id VARCHAR(64) PRIMARY KEY,
    subject TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================

-- Users
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_group_id ON users(group_id);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_kyc_status ON users(kyc_status);
CREATE INDEX idx_users_affiliate_id ON users(affiliate_id);
CREATE INDEX idx_users_deleted_at ON users(deleted_at) WHERE deleted_at IS NULL;

-- User Sessions
CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_token_hash ON user_sessions(token_hash);
CREATE INDEX idx_user_sessions_expires_at ON user_sessions(expires_at);

-- Wallets
CREATE INDEX idx_wallets_user_id ON wallets(user_id);
CREATE INDEX idx_wallets_user_type_currency ON wallets(user_id, wallet_type, currency);

-- Transactions
CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transactions_type ON transactions(type);
CREATE INDEX idx_transactions_reference ON transactions(reference);
CREATE INDEX idx_transactions_created_at ON transactions(created_at);

-- Ledger Entries
CREATE INDEX idx_ledger_entries_wallet_id ON ledger_entries(wallet_id);
CREATE INDEX idx_ledger_entries_created_at ON ledger_entries(created_at);
CREATE INDEX idx_ledger_entries_ref ON ledger_entries(ref);

-- Orders
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_symbol_id ON orders(symbol_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created_at ON orders(created_at);
CREATE INDEX idx_orders_user_symbol_status ON orders(user_id, symbol_id, status);

-- Positions
CREATE INDEX idx_positions_user_id ON positions(user_id);
CREATE INDEX idx_positions_symbol_id ON positions(symbol_id);
CREATE INDEX idx_positions_status ON positions(status);
CREATE INDEX idx_positions_user_status ON positions(user_id, status);

-- Margin Events
CREATE INDEX idx_margin_events_user_id ON margin_events(user_id);
CREATE INDEX idx_margin_events_position_id ON margin_events(position_id);
CREATE INDEX idx_margin_events_type ON margin_events(type);
CREATE INDEX idx_margin_events_acknowledged ON margin_events(acknowledged);
CREATE INDEX idx_margin_events_created_at ON margin_events(created_at);

-- Swap Rules
CREATE INDEX idx_swap_rules_group_id ON swap_rules(group_id);
CREATE INDEX idx_swap_rules_symbol_id ON swap_rules(symbol_id);
CREATE INDEX idx_swap_rules_status ON swap_rules(status);

-- Symbols
CREATE INDEX idx_symbols_code ON symbols(code);
CREATE INDEX idx_symbols_market ON symbols(market);
CREATE INDEX idx_symbols_trading_enabled ON symbols(trading_enabled);

-- Affiliate Commissions
CREATE INDEX idx_affiliate_commissions_affiliate_id ON affiliate_commissions(affiliate_id);
CREATE INDEX idx_affiliate_commissions_user_id ON affiliate_commissions(user_id);
CREATE INDEX idx_affiliate_commissions_status ON affiliate_commissions(status);

-- Admin Actions
CREATE INDEX idx_admin_actions_admin_id ON admin_actions(admin_id);
CREATE INDEX idx_admin_actions_target ON admin_actions(target_type, target_id);
CREATE INDEX idx_admin_actions_created_at ON admin_actions(created_at);

-- KYC Documents
CREATE INDEX idx_kyc_documents_user_id ON kyc_documents(user_id);
CREATE INDEX idx_kyc_documents_status ON kyc_documents(status);

-- Activity Logs
CREATE INDEX idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX idx_activity_logs_admin_id ON activity_logs(admin_id);
CREATE INDEX idx_activity_logs_created_at ON activity_logs(created_at);

-- Price Snapshots
CREATE INDEX idx_price_snapshots_symbol_id ON price_snapshots(symbol_id);
CREATE INDEX idx_price_snapshots_timestamp ON price_snapshots(timestamp DESC);

-- ============================================================
-- TRIGGERS FOR UPDATED_AT
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_user_groups_updated_at BEFORE UPDATE ON user_groups
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_price_stream_profiles_updated_at BEFORE UPDATE ON price_stream_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_leverage_profiles_updated_at BEFORE UPDATE ON leverage_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_leverage_tiers_updated_at BEFORE UPDATE ON leverage_tiers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_affiliates_updated_at BEFORE UPDATE ON affiliates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_admin_users_updated_at BEFORE UPDATE ON admin_users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_symbols_updated_at BEFORE UPDATE ON symbols
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_symbol_price_overrides_updated_at BEFORE UPDATE ON symbol_price_overrides
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_wallets_updated_at BEFORE UPDATE ON wallets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_transactions_updated_at BEFORE UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_positions_updated_at BEFORE UPDATE ON positions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_risk_limits_updated_at BEFORE UPDATE ON risk_limits
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_swap_rules_updated_at BEFORE UPDATE ON swap_rules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================

COMMENT ON TABLE users IS 'Main user accounts for trading platform';
COMMENT ON TABLE user_groups IS 'User groups with default pricing and leverage settings';
COMMENT ON TABLE price_stream_profiles IS 'Bid/Ask markup profiles for price distribution';
COMMENT ON TABLE leverage_profiles IS 'Leverage profiles with margin tiers';
COMMENT ON TABLE wallets IS 'User wallets (spot, margin, funding) by currency';
COMMENT ON TABLE transactions IS 'Financial transactions (deposits, withdrawals, adjustments)';
COMMENT ON TABLE orders IS 'Trading orders (market, limit, stop)';
COMMENT ON TABLE positions IS 'Open and closed trading positions';
COMMENT ON TABLE margin_events IS 'Margin calls and liquidations';
COMMENT ON TABLE swap_rules IS 'Overnight funding/swap fee rules per group and symbol';
COMMENT ON TABLE symbols IS 'Tradable instruments (crypto, forex, etc.)';

