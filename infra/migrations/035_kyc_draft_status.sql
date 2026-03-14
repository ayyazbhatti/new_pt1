-- Allow 'draft' status for KYC submissions (created on first upload, before user submits).
ALTER TABLE kyc_submissions DROP CONSTRAINT IF EXISTS kyc_status_check;
ALTER TABLE kyc_submissions ADD CONSTRAINT kyc_status_check
  CHECK (status IN ('draft', 'pending', 'under_review', 'approved', 'rejected'));
