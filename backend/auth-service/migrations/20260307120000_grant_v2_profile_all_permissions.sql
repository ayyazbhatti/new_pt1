-- Grant all permissions to the permission profile named "V2" (used by accessrighttest@gmail.com).
-- Safe to run multiple times: ON CONFLICT DO NOTHING.

INSERT INTO permission_profile_grants (profile_id, permission_key)
SELECT pp.id, p.permission_key
FROM permission_profiles pp
CROSS JOIN permissions p
WHERE LOWER(pp.name) = 'v2'
ON CONFLICT (profile_id, permission_key) DO NOTHING;
