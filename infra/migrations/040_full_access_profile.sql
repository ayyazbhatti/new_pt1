-- Ensure "Full Access" permission profile exists and has all permissions.
-- Used for super admin; permissions cannot be changed via the UI or API.
-- Safe to run multiple times.

INSERT INTO permission_profiles (id, name, description, created_at, updated_at, created_by_user_id)
SELECT gen_random_uuid(), 'Full Access', 'Super admin access. All permissions; this profile cannot be modified.', NOW(), NOW(), NULL
WHERE NOT EXISTS (SELECT 1 FROM permission_profiles WHERE LOWER(name) = 'full access');

-- Grant every permission to the Full Access profile
INSERT INTO permission_profile_grants (profile_id, permission_key)
SELECT pp.id, p.permission_key
FROM permission_profiles pp
CROSS JOIN permissions p
WHERE LOWER(pp.name) = 'full access'
ON CONFLICT (profile_id, permission_key) DO NOTHING;
