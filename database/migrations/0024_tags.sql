-- Tags: labels assignable to users, managers, and other entities.

CREATE TABLE IF NOT EXISTS tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  color VARCHAR(7) NOT NULL DEFAULT '#8b5cf6',
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_slug_lower ON tags(LOWER(slug));
CREATE INDEX IF NOT EXISTS idx_tags_created_at ON tags(created_at DESC);

COMMENT ON TABLE tags IS 'Tags assignable to users, managers, and other entities.';
