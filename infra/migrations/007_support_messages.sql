-- Support chat: one conversation per user (user_id), messages from user or support.
CREATE TABLE IF NOT EXISTS support_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_type VARCHAR(20) NOT NULL CHECK (sender_type IN ('user', 'support')),
    sender_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_messages_user_id ON support_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_support_messages_created_at ON support_messages(created_at);

COMMENT ON TABLE support_messages IS 'Chat messages between users and support; one thread per user_id.';
COMMENT ON COLUMN support_messages.sender_type IS 'user = message from the end-user; support = from an agent/admin.';
COMMENT ON COLUMN support_messages.sender_id IS 'For support messages: the admin user id; NULL for user messages.';
