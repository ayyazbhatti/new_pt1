-- platform_ai_config: singleton row, mirrors platform_voiso_config style
CREATE TABLE IF NOT EXISTS platform_ai_config (
  singleton_id SMALLINT PRIMARY KEY CHECK (singleton_id = 1),
  provider TEXT NOT NULL DEFAULT 'anthropic',
  model TEXT NOT NULL DEFAULT 'claude-sonnet-4-5',
  api_key TEXT,
  system_prompt TEXT,
  enabled BOOLEAN NOT NULL DEFAULT false,
  max_tokens_per_message INT NOT NULL DEFAULT 1024,
  daily_token_cap_per_user INT NOT NULL DEFAULT 50000,
  rate_limit_per_minute INT NOT NULL DEFAULT 10,
  include_user_context BOOLEAN NOT NULL DEFAULT true,
  topic_guard_enabled BOOLEAN NOT NULL DEFAULT true,
  classifier_model TEXT NOT NULL DEFAULT 'claude-haiku-4-5',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO platform_ai_config (singleton_id) VALUES (1) ON CONFLICT DO NOTHING;

-- per-group toggle
ALTER TABLE user_groups
  ADD COLUMN IF NOT EXISTS ai_chat_enabled BOOLEAN NOT NULL DEFAULT true;

-- conversations
CREATE TABLE IF NOT EXISTS ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_conv_user ON ai_conversations(user_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_conv_user_single ON ai_conversations(user_id);

-- messages
CREATE TABLE IF NOT EXISTS ai_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  tokens_in INT,
  tokens_out INT,
  blocked_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_msg_conv ON ai_messages(conversation_id, created_at);

-- daily usage tracking
CREATE TABLE IF NOT EXISTS ai_usage_daily (
  user_id UUID NOT NULL,
  date DATE NOT NULL,
  tokens_in INT NOT NULL DEFAULT 0,
  tokens_out INT NOT NULL DEFAULT 0,
  messages INT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);

-- permissions
INSERT INTO permissions (permission_key, label, category_id, sort_order) VALUES
  ('ai_chat:use', 'Use AI Chat', (SELECT id FROM permission_categories WHERE name = 'Configuration'), 200),
  ('ai_settings:view', 'View AI settings', (SELECT id FROM permission_categories WHERE name = 'Configuration'), 201),
  ('ai_settings:edit', 'Edit AI settings', (SELECT id FROM permission_categories WHERE name = 'Configuration'), 202)
ON CONFLICT (permission_key) DO NOTHING;

-- grant all three to Full Access profile
INSERT INTO permission_profile_grants (profile_id, permission_key)
SELECT p.id, k
FROM permission_profiles p
CROSS JOIN (VALUES ('ai_chat:use'), ('ai_settings:view'), ('ai_settings:edit')) AS keys(k)
WHERE p.name = 'Full Access'
ON CONFLICT DO NOTHING;
