-- Add created_by_id to leads so admins can be scoped to leads they created or are assigned to.

ALTER TABLE leads
ADD COLUMN IF NOT EXISTS created_by_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_created_by_id ON leads(created_by_id);

COMMENT ON COLUMN leads.created_by_id IS 'User who created the lead; used for admin scope (admin sees only own or assigned leads).';

-- Backfill: existing leads with no created_by_id remain visible to their owner
UPDATE leads SET created_by_id = owner_id WHERE created_by_id IS NULL AND owner_id IS NOT NULL;
