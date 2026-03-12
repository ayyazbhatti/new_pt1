-- Separate Leads from Settings/Symbols: ensure a dedicated Leads category (a0000015) and move leads:* permissions into it.
-- The original create_leads migration used a0000013, which is already used by Settings, so leads permissions
-- ended up under the wrong category. This migration ensures Leads is always its own section.

INSERT INTO permission_categories (id, name, sort_order) VALUES
  ('a0000015-0000-0000-0000-000000000015', 'Leads', 20)
ON CONFLICT (id) DO UPDATE SET name = 'Leads', sort_order = 20;

-- Shift Permissions category so it appears after Leads
UPDATE permission_categories SET sort_order = 21 WHERE id = 'a0000014-0000-0000-0000-000000000014';

-- Move all leads:* permissions to the Leads category (in case they were under Settings or any other category)
UPDATE permissions
SET category_id = 'a0000015-0000-0000-0000-000000000015'
WHERE permission_key LIKE 'leads:%';
