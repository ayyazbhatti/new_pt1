-- Leads and lead_activities tables; re-add leads permission category and keys.

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  phone TEXT,
  company TEXT,
  source TEXT NOT NULL DEFAULT 'other',
  campaign TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  score INT,
  converted_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  converted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at TIMESTAMPTZ
);

CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_source ON leads(source);
CREATE INDEX idx_leads_owner_id ON leads(owner_id);
CREATE INDEX idx_leads_created_at ON leads(created_at DESC);
CREATE INDEX idx_leads_email ON leads(email);

CREATE TABLE IF NOT EXISTS lead_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  meta JSONB DEFAULT '{}'
);

CREATE INDEX idx_lead_activities_lead_id ON lead_activities(lead_id);
CREATE INDEX idx_lead_activities_created_at ON lead_activities(lead_id, created_at DESC);

-- Leads permission category (use a0000015; a0000013 is used by Settings)
INSERT INTO permission_categories (id, name, sort_order) VALUES
  ('a0000015-0000-0000-0000-000000000015', 'Leads', 20)
ON CONFLICT (id) DO NOTHING;

INSERT INTO permissions (permission_key, label, category_id, sort_order) VALUES
  ('leads:view', 'View leads', 'a0000015-0000-0000-0000-000000000015', 1),
  ('leads:create', 'Create leads', 'a0000015-0000-0000-0000-000000000015', 2),
  ('leads:edit', 'Edit leads', 'a0000015-0000-0000-0000-000000000015', 3),
  ('leads:convert', 'Convert leads', 'a0000015-0000-0000-0000-000000000015', 4),
  ('leads:assign', 'Assign owner', 'a0000015-0000-0000-0000-000000000015', 5),
  ('leads:delete', 'Delete leads', 'a0000015-0000-0000-0000-000000000015', 6),
  ('leads:export', 'Export leads', 'a0000015-0000-0000-0000-000000000015', 7)
ON CONFLICT (permission_key) DO NOTHING;
