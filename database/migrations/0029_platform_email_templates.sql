-- Email templates for transactional emails (welcome, password_reset, etc.).
-- template_id is the key (e.g. 'welcome', 'password_reset').
CREATE TABLE IF NOT EXISTS platform_email_templates (
    template_id VARCHAR(64) PRIMARY KEY,
    subject TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default templates (optional; app can merge with defaults if row missing)
INSERT INTO platform_email_templates (template_id, subject, body)
VALUES
  ('welcome', 'Welcome to {{site_name}}', 'Hi {{user_name}},\n\nWelcome! Your account has been created. Log in to get started.\n\nBest,\n{{site_name}} Team'),
  ('password_reset', 'Reset your password', 'Hi {{user_name}},\n\nUse the link below to reset your password. It expires in 24 hours.\n\n{{reset_link}}\n\nIf you did not request this, ignore this email.\n\n{{site_name}}'),
  ('email_verification', 'Verify your email address', 'Hi {{user_name}},\n\nPlease verify your email by clicking the link below:\n\n{{verification_link}}\n\n{{site_name}}'),
  ('deposit_confirmation', 'Deposit received – {{site_name}}', 'Hi {{user_name}},\n\nWe have received your deposit of {{amount}} {{currency}}.\n\nReference: {{reference}}\n\n{{site_name}}'),
  ('withdrawal_confirmation', 'Withdrawal request received – {{site_name}}', 'Hi {{user_name}},\n\nYour withdrawal request for {{amount}} {{currency}} has been received and is being processed.\n\nReference: {{reference}}\n\n{{site_name}}')
ON CONFLICT (template_id) DO NOTHING;
