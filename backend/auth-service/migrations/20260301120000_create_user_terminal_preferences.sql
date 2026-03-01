-- Per-user trading terminal UI preferences (chart options, etc.)
CREATE TABLE user_terminal_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  preferences JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE user_terminal_preferences IS 'Per-user trading terminal UI preferences (chart options, etc.).';
