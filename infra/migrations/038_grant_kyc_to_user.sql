-- Grant KYC permissions (kyc:view, kyc:approve) to user mabhattiltd5@gmail.com
-- Idempotent: safe to run multiple times.
-- - If the user has a permission profile: add kyc:view and kyc:approve to that profile.
-- - If the user has no profile: create "KYC Reviewer" with those permissions and assign it.

DO $$
DECLARE
  v_user_id UUID;
  v_profile_id UUID;
BEGIN
  SELECT id INTO v_user_id FROM users WHERE LOWER(email) = LOWER('mabhattiltd5@gmail.com') LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE NOTICE 'User mabhattiltd5@gmail.com not found. Run this migration after the user exists.';
    RETURN;
  END IF;

  SELECT permission_profile_id INTO v_profile_id FROM users WHERE id = v_user_id;

  IF v_profile_id IS NOT NULL THEN
    -- User has a profile: add KYC permissions to it
    INSERT INTO permission_profile_grants (profile_id, permission_key)
    VALUES (v_profile_id, 'kyc:view')
    ON CONFLICT (profile_id, permission_key) DO NOTHING;
    INSERT INTO permission_profile_grants (profile_id, permission_key)
    VALUES (v_profile_id, 'kyc:approve')
    ON CONFLICT (profile_id, permission_key) DO NOTHING;
    -- Ensure user can access admin area (role must be manager/admin/agent for AdminGuard)
    UPDATE users SET role = 'manager', updated_at = NOW() WHERE id = v_user_id AND LOWER(COALESCE(role, '')) NOT IN ('admin', 'super_admin', 'manager', 'agent');
    RAISE NOTICE 'Added kyc:view and kyc:approve to existing permission profile for mabhattiltd5@gmail.com';
  ELSE
    -- No profile: create "KYC Reviewer" and assign to user
    INSERT INTO permission_profiles (id, name, description, created_at, updated_at)
    SELECT gen_random_uuid(), 'KYC Reviewer', 'View and approve/reject KYC submissions', NOW(), NOW()
    WHERE NOT EXISTS (SELECT 1 FROM permission_profiles WHERE LOWER(name) = 'kyc reviewer');
    -- Get the profile id (new or existing)
    SELECT id INTO v_profile_id FROM permission_profiles WHERE LOWER(name) = 'kyc reviewer' LIMIT 1;
    INSERT INTO permission_profile_grants (profile_id, permission_key)
    VALUES (v_profile_id, 'kyc:view')
    ON CONFLICT (profile_id, permission_key) DO NOTHING;
    INSERT INTO permission_profile_grants (profile_id, permission_key)
    VALUES (v_profile_id, 'kyc:approve')
    ON CONFLICT (profile_id, permission_key) DO NOTHING;
    -- Assign profile and set role to manager so user can access admin area
    UPDATE users SET permission_profile_id = v_profile_id, role = 'manager', updated_at = NOW() WHERE id = v_user_id;
    RAISE NOTICE 'Created KYC Reviewer profile and assigned to mabhattiltd5@gmail.com (role set to manager)';
  END IF;
END $$;
