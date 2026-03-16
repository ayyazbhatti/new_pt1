-- auth-service User model expects status as user_status enum.
CREATE TYPE user_status AS ENUM ('active', 'disabled', 'suspended');
ALTER TABLE users ALTER COLUMN status DROP DEFAULT;
ALTER TABLE users ALTER COLUMN status TYPE user_status USING status::user_status;
ALTER TABLE users ALTER COLUMN status SET DEFAULT 'active'::user_status;
