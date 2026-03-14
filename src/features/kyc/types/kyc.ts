/** KYC status values from backend */
export type KycStatus = 'draft' | 'pending' | 'under_review' | 'approved' | 'rejected'

export interface KycDocument {
  id: string
  documentType: string
  fileName: string
  contentType?: string | null
}

/** User's own KYC status (GET /api/user/kyc) */
export interface KycStatusResponse {
  id: string
  status: KycStatus
  identityDocType?: string | null
  addressDocType?: string | null
  rejectionReason?: string | null
  submittedAt: string
  reviewedAt?: string | null
  documents: KycDocument[]
}

export interface SubmitKycPayload {
  identity_doc_type: string
  address_doc_type: string
}

export interface UploadKycResponse {
  submission_id: string
  document_id: string
  document_type: string
  is_new_submission: boolean
}

/** Admin list item */
export interface KycSubmissionRow {
  id: string
  userId: string
  userName: string
  userEmail: string
  status: KycStatus
  identityDocType?: string | null
  addressDocType?: string | null
  submittedAt: string
  reviewedAt?: string | null
}

/** Admin submission detail (for modal) */
export interface KycSubmissionDetail {
  id: string
  userId: string
  userName: string
  userEmail: string
  status: KycStatus
  identityDocType?: string | null
  addressDocType?: string | null
  rejectionReason?: string | null
  submittedAt: string
  reviewedAt?: string | null
  documents: KycDocument[]
}

export interface ListKycParams {
  page?: number
  page_size?: number
  status?: string
  search?: string
}

export interface ListKycResponse {
  items: KycSubmissionRow[]
  total: number
}
