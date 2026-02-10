-- Migration: Add auth fields to users table and create auth-related tables
-- This migration modifies the existing users table and adds missing auth tables

-- Add role field to users (if not exists)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'role'
    ) THEN
        ALTER TABLE users ADD COLUMN role VARCHAR(50) NOT NULL DEFAULT 'user';
    END IF;
END $$;

-- Add referral_code to users (if not exists)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'referral_code'
    ) THEN
        ALTER TABLE users ADD COLUMN referral_code VARCHAR(50) UNIQUE;
    END IF;
END $$;

-- Add referred_by_user_id to users (if not exists)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'referred_by_user_id'
    ) THEN
        ALTER TABLE users ADD COLUMN referred_by_user_id UUID REFERENCES users(id);
    END IF;
END $$;

-- Add email_verified to users (if not exists)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'email_verified'
    ) THEN
        ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT false;
    END IF;
END $$;

-- Rename last_login to last_login_at if needed
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'last_login'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'last_login_at'
    ) THEN
        ALTER TABLE users RENAME COLUMN last_login TO last_login_at;
    END IF;
END $$;

-- Make group_id nullable (for initial registration)
DO $$ 
BEGIN
    ALTER TABLE users ALTER COLUMN group_id DROP NOT NULL;
EXCEPTION
    WHEN OTHERS THEN NULL;
END $$;

-- Update users table: lowercase email constraint
CREATE OR REPLACE FUNCTION lowercase_email() RETURNS TRIGGER AS $$
BEGIN
    NEW.email = LOWER(NEW.email);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_email_lowercase ON users;
CREATE TRIGGER users_email_lowercase
    BEFORE INSERT OR UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION lowercase_email();

-- Update user_sessions table to match requirements
DO $$ 
BEGIN
    -- Add refresh_token_hash if token_hash doesn't exist or rename it
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'user_sessions' AND column_name = 'token_hash'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'user_sessions' AND column_name = 'refresh_token_hash'
    ) THEN
        ALTER TABLE user_sessions RENAME COLUMN token_hash TO refresh_token_hash;
    END IF;
    
    -- Add is_revoked if not exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'user_sessions' AND column_name = 'is_revoked'
    ) THEN
        ALTER TABLE user_sessions ADD COLUMN is_revoked BOOLEAN NOT NULL DEFAULT false;
    END IF;
    
    -- Rename ip_address to ip if needed
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'user_sessions' AND column_name = 'ip_address'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'user_sessions' AND column_name = 'ip'
    ) THEN
        ALTER TABLE user_sessions RENAME COLUMN ip_address TO ip;
    END IF;
END $$;

-- Create password_reset_tokens table
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_user_id UUID REFERENCES users(id),
    action TEXT NOT NULL,
    meta JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_user_sessions_refresh_token_hash ON user_sessions(refresh_token_hash);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token_hash ON password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_user_id ON audit_logs(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

