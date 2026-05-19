-- Add report config columns to platform_ai_config
ALTER TABLE platform_ai_config
  ADD COLUMN IF NOT EXISTS reports_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS report_model TEXT NOT NULL DEFAULT 'claude-opus-4-7',
  ADD COLUMN IF NOT EXISTS report_max_tokens INT NOT NULL DEFAULT 4096,
  ADD COLUMN IF NOT EXISTS report_daily_cap_per_admin INT NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS report_rate_limit_per_minute INT NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS report_bulk_max_users INT NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS report_bulk_concurrency INT NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS report_system_prompt TEXT;

-- Main reports table
CREATE TABLE IF NOT EXISTS ai_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  generated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  sections JSONB NOT NULL,
  focus_prompt TEXT,
  content TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL,
  tokens_in INT,
  tokens_out INT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','streaming','completed','failed')),
  error TEXT,
  bulk_batch_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ai_reports_subject ON ai_reports(subject_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_reports_batch ON ai_reports(bulk_batch_id) WHERE bulk_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_reports_generator ON ai_reports(generated_by_user_id, created_at DESC);

-- Daily usage for admin report quota
CREATE TABLE IF NOT EXISTS ai_report_usage_daily (
  admin_user_id UUID NOT NULL,
  date DATE NOT NULL,
  reports_generated INT NOT NULL DEFAULT 0,
  tokens_in INT NOT NULL DEFAULT 0,
  tokens_out INT NOT NULL DEFAULT 0,
  PRIMARY KEY (admin_user_id, date)
);

-- Permissions
INSERT INTO permissions (permission_key, label, category_id, sort_order) VALUES
  ('ai_reports:view', 'View AI reports', (SELECT id FROM permission_categories WHERE name = 'Configuration'), 210),
  ('ai_reports:generate', 'Generate AI report', (SELECT id FROM permission_categories WHERE name = 'Configuration'), 211),
  ('ai_reports:bulk_generate', 'Bulk generate AI reports', (SELECT id FROM permission_categories WHERE name = 'Configuration'), 212),
  ('ai_reports:delete', 'Delete AI reports', (SELECT id FROM permission_categories WHERE name = 'Configuration'), 213)
ON CONFLICT (permission_key) DO NOTHING;

-- Grant all to Full Access
INSERT INTO permission_profile_grants (profile_id, permission_key)
SELECT p.id, k
FROM permission_profiles p
CROSS JOIN (VALUES ('ai_reports:view'), ('ai_reports:generate'), ('ai_reports:bulk_generate'), ('ai_reports:delete')) AS keys(k)
WHERE p.name = 'Full Access'
ON CONFLICT DO NOTHING;
