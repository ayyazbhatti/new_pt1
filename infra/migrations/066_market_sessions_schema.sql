-- Phase 1: Market session templates, weekly windows, holidays placeholder, symbol link.
-- No enforcement in order path (Phase 2).

BEGIN;

-- 1. Session templates
CREATE TABLE IF NOT EXISTS market_session_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(64) NOT NULL UNIQUE,
    timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
    description TEXT,
    is_24_7 BOOLEAN NOT NULL DEFAULT false,
    is_default_for_market market_type,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by VARCHAR(255)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_market_session_default_per_market
    ON market_session_templates (is_default_for_market)
    WHERE is_default_for_market IS NOT NULL;

COMMENT ON COLUMN market_session_templates.timezone IS
  'IANA timezone string. Windows below are interpreted in this timezone.';
COMMENT ON COLUMN market_session_templates.is_24_7 IS
  'When true, market is always open (crypto). Windows table not consulted.';
COMMENT ON COLUMN market_session_templates.is_default_for_market IS
  'If set, this template is used by symbols whose market matches and that have no explicit session_template_id.';

-- 2. Weekly windows
CREATE TABLE IF NOT EXISTS session_template_windows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES market_session_templates(id) ON DELETE CASCADE,
    day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    open_time TIME NOT NULL,
    close_time TIME NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (open_time < close_time)
);

CREATE INDEX IF NOT EXISTS idx_session_template_windows_template ON session_template_windows(template_id);
CREATE INDEX IF NOT EXISTS idx_session_template_windows_dow ON session_template_windows(template_id, day_of_week);

COMMENT ON COLUMN session_template_windows.day_of_week IS
  '0=Sunday, 1=Monday, ..., 6=Saturday — matches Postgres EXTRACT(DOW FROM timestamptz) in template timezone.';
COMMENT ON COLUMN session_template_windows.open_time IS
  'Open time in the parent template timezone.';
COMMENT ON TABLE session_template_windows IS
  'Windows that cross midnight must be split into two rows (one per calendar day).';

-- 3. Holidays (empty until Phase 4 CRUD)
CREATE TABLE IF NOT EXISTS market_holidays (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES market_session_templates(id) ON DELETE CASCADE,
    holiday_date DATE NOT NULL,
    name VARCHAR(128) NOT NULL,
    "type" VARCHAR(16) NOT NULL DEFAULT 'closed',
    half_day_close_time TIME,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (template_id, holiday_date),
    CONSTRAINT market_holidays_type_chk CHECK ("type" IN ('closed', 'half_day')),
    CONSTRAINT market_holidays_half_day_time_chk CHECK ("type" <> 'half_day' OR half_day_close_time IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_market_holidays_date ON market_holidays(holiday_date);

COMMENT ON TABLE market_holidays IS
  'Holidays per template. Phase 4 ships admin CRUD; Phase 1 leaves empty.';

-- 4. Symbol → template (nullable)
ALTER TABLE symbols
    ADD COLUMN IF NOT EXISTS session_template_id UUID REFERENCES market_session_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_symbols_session_template ON symbols(session_template_id);

COMMENT ON COLUMN symbols.session_template_id IS
  'If NULL, symbol uses the default template for its market. If set, this template wins.';

-- updated_at trigger for templates
CREATE OR REPLACE FUNCTION update_market_session_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_market_session_templates_updated_at ON market_session_templates;
CREATE TRIGGER trg_market_session_templates_updated_at
    BEFORE UPDATE ON market_session_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_market_session_templates_updated_at();

-- 5. Seed default templates (stable names for lookups)
INSERT INTO market_session_templates (name, timezone, description, is_24_7, is_default_for_market)
VALUES
  ('Crypto 24/7', 'UTC', 'Always open. Standard for cryptocurrency markets.', true, 'crypto'),
  ('Forex 24/5', 'America/New_York', 'Sunday 17:00 ET to Friday 17:00 ET. Standard interbank forex.', false, 'forex'),
  ('NYSE / NASDAQ', 'America/New_York', 'Mon-Fri 09:30-16:00 ET. Pre/post market not included.', false, 'stocks'),
  ('CME Commodities', 'America/Chicago', 'Sun-Fri globex-style hours (simplified; split windows per day).', false, 'commodities')
ON CONFLICT (name) DO NOTHING;

-- 6. Windows: Forex 24/5
INSERT INTO session_template_windows (template_id, day_of_week, open_time, close_time)
SELECT t.id, v.dow, v.open_time::TIME, v.close_time::TIME
FROM market_session_templates t
CROSS JOIN (VALUES
    (0, '17:00', '23:59:59'),
    (1, '00:00', '23:59:59'),
    (2, '00:00', '23:59:59'),
    (3, '00:00', '23:59:59'),
    (4, '00:00', '23:59:59'),
    (5, '00:00', '17:00')
) AS v(dow, open_time, close_time)
WHERE t.name = 'Forex 24/5'
  AND NOT EXISTS (
    SELECT 1 FROM session_template_windows w WHERE w.template_id = t.id
  );

-- NYSE Mon–Fri
INSERT INTO session_template_windows (template_id, day_of_week, open_time, close_time)
SELECT t.id, g.dow::SMALLINT, TIME '09:30', TIME '16:00'
FROM market_session_templates t
CROSS JOIN generate_series(1, 5) AS g(dow)
WHERE t.name = 'NYSE / NASDAQ'
  AND NOT EXISTS (
    SELECT 1 FROM session_template_windows w WHERE w.template_id = t.id
  );

-- CME simplified multi-window
INSERT INTO session_template_windows (template_id, day_of_week, open_time, close_time)
SELECT t.id, v.dow, v.open_time::TIME, v.close_time::TIME
FROM market_session_templates t
CROSS JOIN (VALUES
    (0, '17:00', '23:59:59'),
    (1, '00:00', '16:00'),
    (1, '17:00', '23:59:59'),
    (2, '00:00', '16:00'),
    (2, '17:00', '23:59:59'),
    (3, '00:00', '16:00'),
    (3, '17:00', '23:59:59'),
    (4, '00:00', '16:00'),
    (4, '17:00', '23:59:59'),
    (5, '00:00', '16:00')
) AS v(dow, open_time, close_time)
WHERE t.name = 'CME Commodities'
  AND NOT EXISTS (
    SELECT 1 FROM session_template_windows w WHERE w.template_id = t.id
  );

COMMIT;

-- Permissions (outside transaction block; matches 065 pattern)
INSERT INTO permissions (permission_key, label, category_id, sort_order)
SELECT 'sessions:view', 'View market session templates', (SELECT id FROM permission_categories WHERE LOWER(name) = 'swap' LIMIT 1), 54
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO permissions (permission_key, label, category_id, sort_order)
SELECT 'sessions:edit', 'Create, update, and delete market session templates', (SELECT id FROM permission_categories WHERE LOWER(name) = 'swap' LIMIT 1), 55
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO permission_profile_grants (profile_id, permission_key)
SELECT pp.id, p.permission_key
FROM permission_profiles pp
CROSS JOIN permissions p
WHERE LOWER(pp.name) IN ('full access', 'v2')
  AND p.permission_key IN ('sessions:view', 'sessions:edit')
ON CONFLICT (profile_id, permission_key) DO NOTHING;
