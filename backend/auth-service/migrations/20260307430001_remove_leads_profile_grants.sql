-- Remove leads:* grants from permission profiles (permissions table no longer has these keys).
-- Fixes "Unknown permission key: leads:assign" when saving a profile that had leads grants.

DELETE FROM permission_profile_grants WHERE permission_key LIKE 'leads:%';
