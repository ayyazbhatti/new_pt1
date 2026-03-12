-- Integrate appointments with leads: allow scheduling meetings for leads.
-- Appointments can be for a user (user_id) and/or a lead (lead_id).
-- At least one of user_id or lead_id must be set. Existing rows keep user_id set.

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id) ON DELETE CASCADE;

ALTER TABLE appointments
  ALTER COLUMN user_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_lead_id ON appointments(lead_id);

ALTER TABLE appointments
  ADD CONSTRAINT chk_appointments_user_or_lead
  CHECK (user_id IS NOT NULL OR lead_id IS NOT NULL);

COMMENT ON COLUMN appointments.lead_id IS 'Optional: when set, appointment is for this lead (meeting with lead). Visibility follows lead scope.';
