-- Remove Leads category and all leads:* permissions (leads module removed).

DELETE FROM permissions WHERE permission_key LIKE 'leads:%';
DELETE FROM permission_categories WHERE name = 'Leads';
