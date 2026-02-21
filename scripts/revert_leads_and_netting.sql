-- Revert: Remove leads (CRM) schema and netting (account_type) from database.
-- Run this before or after restoring code from GitHub so DB matches code without leads/netting.

-- 1) Remove CRM/Leads schema and all its objects
DROP SCHEMA IF EXISTS crm CASCADE;

-- 2) Remove account_type (netting mode) from users
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_account_type_check;
ALTER TABLE users DROP COLUMN IF EXISTS account_type;
