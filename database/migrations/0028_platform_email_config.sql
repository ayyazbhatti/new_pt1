-- Platform email (SMTP) configuration for admin settings.
-- Single row: one config per environment.
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

-- Insert default row if none exists
INSERT INTO platform_email_config (id, smtp_host, smtp_port, smtp_encryption, smtp_username, smtp_password, from_email, from_name)
SELECT uuid_generate_v4(), 'smtp.example.com', 587, 'tls', '', NULL, 'noreply@example.com', 'Platform'
WHERE NOT EXISTS (SELECT 1 FROM platform_email_config LIMIT 1);
