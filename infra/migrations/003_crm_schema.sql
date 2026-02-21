-- CRM Leads module schema
-- Database: newpt

CREATE SCHEMA IF NOT EXISTS crm;

-- 1) Lead stages
CREATE TABLE crm.lead_stages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL,
    name TEXT NOT NULL,
    position INT NOT NULL,
    color_token TEXT NOT NULL DEFAULT 'accent',
    sla_minutes INT NOT NULL DEFAULT 0,
    require_email BOOLEAN NOT NULL DEFAULT false,
    require_phone BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(team_id, position),
    UNIQUE(team_id, name)
);

CREATE INDEX idx_lead_stages_team ON crm.lead_stages(team_id);

-- 2) Leads (soft delete)
CREATE TABLE crm.leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL,
    owner_user_id UUID NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT NULL,
    phone TEXT NULL,
    country TEXT NULL,
    city TEXT NULL,
    language TEXT NULL,
    timezone TEXT NULL,
    status TEXT NOT NULL CHECK (status IN ('open', 'converted', 'lost', 'junk')),
    stage_id UUID NOT NULL REFERENCES crm.lead_stages(id),
    source TEXT NULL,
    campaign TEXT NULL,
    utm_source TEXT NULL,
    utm_medium TEXT NULL,
    utm_campaign TEXT NULL,
    tags TEXT[] NOT NULL DEFAULT '{}',
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'vip')),
    score INT NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
    last_contact_at TIMESTAMPTZ NULL,
    next_followup_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ NULL
);

CREATE INDEX idx_leads_team_owner ON crm.leads(team_id, owner_user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_leads_team_stage ON crm.leads(team_id, stage_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_leads_team_status ON crm.leads(team_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_leads_team_next_followup ON crm.leads(team_id, next_followup_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_leads_team_created ON crm.leads(team_id, created_at) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION crm.leads_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_leads_updated_at
    BEFORE UPDATE ON crm.leads
    FOR EACH ROW EXECUTE PROCEDURE crm.leads_updated_at();

-- 3) Lead tasks (status: pending/completed/cancelled to match UI)
CREATE TABLE crm.lead_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL,
    lead_id UUID NOT NULL REFERENCES crm.leads(id),
    assigned_to_user_id UUID NOT NULL,
    task_type TEXT NOT NULL CHECK (task_type IN ('call', 'email', 'whatsapp', 'meeting', 'doc')),
    due_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'vip')),
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lead_tasks_team_assignee_status ON crm.lead_tasks(team_id, assigned_to_user_id, status);
CREATE INDEX idx_lead_tasks_team_due ON crm.lead_tasks(team_id, due_at);

-- 4) Lead activities
CREATE TABLE crm.lead_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL,
    lead_id UUID NOT NULL REFERENCES crm.leads(id),
    actor_user_id UUID NOT NULL,
    activity_type TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lead_activities_team_lead_created ON crm.lead_activities(team_id, lead_id, created_at);

-- 5) Lead messages (email/note)
CREATE TABLE crm.lead_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL,
    lead_id UUID NOT NULL REFERENCES crm.leads(id),
    actor_user_id UUID NOT NULL,
    message_type TEXT NOT NULL CHECK (message_type IN ('email', 'note')),
    to_email TEXT NULL,
    cc TEXT[] NOT NULL DEFAULT '{}',
    bcc TEXT[] NOT NULL DEFAULT '{}',
    subject TEXT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'failed')),
    provider TEXT NULL,
    provider_message_id TEXT NULL,
    error TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lead_messages_team_lead_created ON crm.lead_messages(team_id, lead_id, created_at);
CREATE INDEX idx_lead_messages_team_status ON crm.lead_messages(team_id, status);

CREATE OR REPLACE FUNCTION crm.lead_messages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_lead_messages_updated_at
    BEFORE UPDATE ON crm.lead_messages
    FOR EACH ROW EXECUTE PROCEDURE crm.lead_messages_updated_at();

-- 6) Email templates
CREATE TABLE crm.email_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    tags TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(team_id, name)
);

CREATE INDEX idx_email_templates_team ON crm.email_templates(team_id);

-- 7) Idempotency keys (send-email etc.)
CREATE TABLE crm.idempotency_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL,
    user_id UUID NOT NULL,
    key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    response JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(team_id, user_id, key)
);

CREATE INDEX idx_idempotency_keys_team_user_key ON crm.idempotency_keys(team_id, user_id, key);

-- 8) Leads settings (assignment)
CREATE TABLE crm.leads_settings (
    team_id UUID PRIMARY KEY,
    auto_assign_enabled BOOLEAN NOT NULL DEFAULT false,
    strategy TEXT NOT NULL DEFAULT 'manual' CHECK (strategy IN ('round_robin', 'manual')),
    rr_agent_ids UUID[] NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9) Outbox events (transactional outbox pattern)
CREATE TABLE crm.outbox_events (
    id BIGSERIAL PRIMARY KEY,
    aggregate_type TEXT NOT NULL,
    aggregate_id UUID NOT NULL,
    team_id UUID NOT NULL,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ NULL,
    publish_attempts INT NOT NULL DEFAULT 0,
    last_error TEXT NULL
);

CREATE INDEX idx_outbox_events_published ON crm.outbox_events(published_at) WHERE published_at IS NULL;
CREATE INDEX idx_outbox_events_team_created ON crm.outbox_events(team_id, created_at);
