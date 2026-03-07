-- Grant tags:view to all permission profiles that have users:view, so existing access to Tags is preserved.
INSERT INTO permission_profile_grants (profile_id, permission_key)
SELECT profile_id, 'tags:view'
FROM permission_profile_grants
WHERE permission_key = 'users:view'
ON CONFLICT (profile_id, permission_key) DO NOTHING;
