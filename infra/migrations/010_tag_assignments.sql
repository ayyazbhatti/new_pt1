-- Tag assignments: many-to-many between tags and entities (user, manager, etc.).

CREATE TABLE IF NOT EXISTS tag_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tag_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_tag_assignments_tag_id ON tag_assignments(tag_id);
CREATE INDEX IF NOT EXISTS idx_tag_assignments_entity ON tag_assignments(entity_type, entity_id);

COMMENT ON TABLE tag_assignments IS 'Assignments of tags to users, managers, or other entity types.';
