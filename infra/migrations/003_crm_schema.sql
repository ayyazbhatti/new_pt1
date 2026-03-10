-- CRM schema (email templates, idempotency). Leads module removed.
-- Database: newpt

CREATE SCHEMA IF NOT EXISTS crm;

-- 1) Email templates
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

-- 2) Idempotency keys (send-email etc.)
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
