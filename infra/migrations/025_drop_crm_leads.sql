-- Remove CRM leads module (no longer used).
-- 1. Drop CRM tables (reverse dependency order).
-- 2. Remove leads permissions and Leads category from permission_categories/permissions (if present).

DROP TABLE IF EXISTS crm.lead_messages CASCADE;
DROP TABLE IF EXISTS crm.lead_activities CASCADE;
DROP TABLE IF EXISTS crm.lead_tasks CASCADE;
DROP TABLE IF EXISTS crm.leads_settings CASCADE;
DROP TABLE IF EXISTS crm.leads CASCADE;
DROP TABLE IF EXISTS crm.lead_stages CASCADE;
DROP TABLE IF EXISTS crm.outbox_events CASCADE;

DELETE FROM permissions WHERE permission_key LIKE 'leads:%';
DELETE FROM permission_categories WHERE name = 'Leads';
