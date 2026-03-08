-- Terminal promotion slides: admin-controlled carousel in the trading terminal right panel.

CREATE TABLE IF NOT EXISTS terminal_promotion_slides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sort_order INT NOT NULL DEFAULT 0,
    image_url TEXT NOT NULL,
    title VARCHAR(255) NOT NULL,
    subtitle VARCHAR(500),
    link_url TEXT,
    link_label VARCHAR(100),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_terminal_promotion_slides_active_order
    ON terminal_promotion_slides (is_active, sort_order);

-- Seed permissions for admin UI (Configuration category; look up by name for compatibility)
INSERT INTO permissions (permission_key, label, category_id, sort_order)
SELECT 'promotions:view', 'View terminal promotions', id, 9 FROM permission_categories WHERE LOWER(name) = 'configuration' LIMIT 1
ON CONFLICT (permission_key) DO NOTHING;
INSERT INTO permissions (permission_key, label, category_id, sort_order)
SELECT 'promotions:edit', 'Edit terminal promotions', id, 10 FROM permission_categories WHERE LOWER(name) = 'configuration' LIMIT 1
ON CONFLICT (permission_key) DO NOTHING;
