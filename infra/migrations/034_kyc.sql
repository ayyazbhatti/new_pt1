-- KYC (Know Your Customer): submissions and documents tables + permissions.
-- Idempotent: CREATE IF NOT EXISTS, INSERT ON CONFLICT DO NOTHING.

-- 1. Tables
CREATE TABLE IF NOT EXISTS kyc_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  identity_doc_type TEXT,
  address_doc_type TEXT,
  rejection_reason TEXT,
  reviewed_at TIMESTAMPTZ,
  reviewed_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT kyc_status_check CHECK (status IN ('pending', 'under_review', 'approved', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_kyc_submissions_user_id ON kyc_submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_submissions_status ON kyc_submissions(status);
CREATE INDEX IF NOT EXISTS idx_kyc_submissions_submitted_at ON kyc_submissions(submitted_at DESC);

CREATE TABLE IF NOT EXISTS kyc_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES kyc_submissions(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size_bytes BIGINT,
  content_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kyc_documents_submission_id ON kyc_documents(submission_id);

-- 2. KYC permission category and permissions
INSERT INTO permission_categories (id, name, sort_order) VALUES
  ('a0000025-0000-0000-0000-000000000025', 'KYC', 21)
ON CONFLICT (id) DO NOTHING;

INSERT INTO permissions (permission_key, label, category_id, sort_order) VALUES
  ('kyc:view', 'View KYC submissions', 'a0000025-0000-0000-0000-000000000025', 1),
  ('kyc:approve', 'Approve or reject KYC', 'a0000025-0000-0000-0000-000000000025', 2)
ON CONFLICT (permission_key) DO NOTHING;
