-- Admin notes on a user (Notes & Timeline in user details drawer)
CREATE TABLE user_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_notes_user_id ON user_notes(user_id);
CREATE INDEX idx_user_notes_created_at ON user_notes(created_at DESC);

COMMENT ON TABLE user_notes IS 'Admin notes about a user (Notes & Timeline tab in user details).';
