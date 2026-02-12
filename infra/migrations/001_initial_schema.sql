-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    group_id UUID,
    leverage_profile_id UUID,
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Symbols table
CREATE TABLE IF NOT EXISTS symbols (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol VARCHAR(50) UNIQUE NOT NULL,
    base VARCHAR(10) NOT NULL,
    quote VARCHAR(10) NOT NULL,
    enabled BOOLEAN DEFAULT true,
    min_size DECIMAL(20, 8) NOT NULL,
    step_size DECIMAL(20, 8) NOT NULL,
    price_tick DECIMAL(20, 8) NOT NULL,
    leverage_profile_id UUID,
    swap_profile_id UUID,
    price_stream_profile_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Orders table
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    symbol VARCHAR(50) NOT NULL,
    side VARCHAR(10) NOT NULL,
    order_type VARCHAR(10) NOT NULL,
    limit_price DECIMAL(20, 8),
    size DECIMAL(20, 8) NOT NULL,
    status VARCHAR(20) NOT NULL,
    tif VARCHAR(10) NOT NULL,
    sl DECIMAL(20, 8),
    tp DECIMAL(20, 8),
    filled_size DECIMAL(20, 8) DEFAULT 0,
    avg_fill_price DECIMAL(20, 8),
    reason TEXT,
    client_order_id VARCHAR(255),
    idempotency_key VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

-- Positions table
CREATE TABLE IF NOT EXISTS positions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    symbol VARCHAR(50) NOT NULL,
    side VARCHAR(10) NOT NULL,
    size DECIMAL(20, 8) NOT NULL,
    entry_price DECIMAL(20, 8) NOT NULL,
    avg_price DECIMAL(20, 8) NOT NULL,
    sl DECIMAL(20, 8),
    tp DECIMAL(20, 8),
    leverage DECIMAL(10, 2) NOT NULL,
    margin DECIMAL(20, 8) NOT NULL,
    unrealized_pnl DECIMAL(20, 8) DEFAULT 0,
    realized_pnl DECIMAL(20, 8) DEFAULT 0,
    status VARCHAR(20) NOT NULL,
    opened_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

-- Balances table
CREATE TABLE IF NOT EXISTS balances (
    user_id UUID NOT NULL REFERENCES users(id),
    currency VARCHAR(10) NOT NULL,
    available DECIMAL(20, 8) NOT NULL DEFAULT 0,
    locked DECIMAL(20, 8) NOT NULL DEFAULT 0,
    equity DECIMAL(20, 8) NOT NULL DEFAULT 0,
    margin_used DECIMAL(20, 8) NOT NULL DEFAULT 0,
    free_margin DECIMAL(20, 8) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (user_id, currency)
);

-- Audit events table
CREATE TABLE IF NOT EXISTS audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(100) NOT NULL,
    user_id UUID REFERENCES users(id),
    order_id UUID REFERENCES orders(id),
    position_id UUID REFERENCES positions(id),
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_positions_user_id ON positions(user_id);
CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
CREATE INDEX IF NOT EXISTS idx_audit_user_id ON audit_events(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_events(created_at);

