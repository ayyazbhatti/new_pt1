import { http, getApiBaseUrl } from '@/shared/api/http'
import { useAuthStore } from '@/shared/store/auth.store'
import type {
  KycStatusResponse,
  KycSubmissionDetail,
  KycSubmissionRow,
  ListKycResponse,
  ListKycParams,
  UploadKycResponse,
} from '../types/kyc'

const REQUEST_TIMEOUT_MS = 60_000

function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const token = useAuthStore.getState().accessToken
  const headers: Record<string, string> = { ...(options.headers as Record<string, string>) }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return fetch(url, { ...options, signal: controller.signal, headers }).finally(() =>
    clearTimeout(timeoutId)
  )
}

function mapDoc(r: { id: string; document_type: string; file_name: string; content_type?: string | null }) {
  return {
    id: r.id,
    documentType: r.document_type,
    fileName: r.file_name,
    contentType: r.content_type ?? null,
  }
}

function mapStatusResponse(r: {
  id: string
  status: string
  identity_doc_type?: string | null
  address_doc_type?: string | null
  rejection_reason?: string | null
  submitted_at: string
  reviewed_at?: string | null
  documents: Array<{ id: string; document_type: string; file_name: string; content_type?: string | null }>
}): KycStatusResponse {
  return {
    id: r.id,
    status: r.status as KycStatusResponse['status'],
    identityDocType: r.identity_doc_type ?? null,
    addressDocType: r.address_doc_type ?? null,
    rejectionReason: r.rejection_reason ?? null,
    submittedAt: r.submitted_at,
    reviewedAt: r.reviewed_at ?? null,
    documents: (r.documents ?? []).map(mapDoc),
  }
}

function mapSubmissionRow(r: {
  id: string
  user_id: string
  user_name: string
  user_email: string
  status: string
  identity_doc_type?: string | null
  address_doc_type?: string | null
  submitted_at: string
  reviewed_at?: string | null
}): KycSubmissionRow {
  return {
    id: r.id,
    userId: r.user_id,
    userName: r.user_name,
    userEmail: r.user_email,
    status: r.status as KycSubmissionRow['status'],
    identityDocType: r.identity_doc_type ?? null,
    addressDocType: r.address_doc_type ?? null,
    submittedAt: r.submitted_at,
    reviewedAt: r.reviewed_at ?? null,
  }
}

function mapSubmissionDetail(r: {
  id: string
  user_id: string
  user_name: string
  user_email: string
  status: string
  identity_doc_type?: string | null
  address_doc_type?: string | null
  rejection_reason?: string | null
  submitted_at: string
  reviewed_at?: string | null
  documents: Array<{ id: string; document_type: string; file_name: string; content_type?: string | null }>
}): KycSubmissionDetail {
  return {
    id: r.id,
    userId: r.user_id,
    userName: r.user_name,
    userEmail: r.user_email,
    status: r.status as KycSubmissionDetail['status'],
    identityDocType: r.identity_doc_type ?? null,
    addressDocType: r.address_doc_type ?? null,
    rejectionReason: r.rejection_reason ?? null,
    submittedAt: r.submitted_at,
    reviewedAt: r.reviewed_at ?? null,
    documents: (r.documents ?? []).map(mapDoc),
  }
}

// ─── User KYC ─────────────────────────────────────────────────────────────

/** GET /api/user/kyc – current user's latest submission or null */
export async function getMyKyc(): Promise<KycStatusResponse | null> {
  const raw = await http<typeof raw extends null ? null : {
    id: string
    status: string
    identity_doc_type?: string | null
    address_doc_type?: string | null
    rejection_reason?: string | null
    submitted_at: string
    reviewed_at?: string | null
    documents: Array<{ id: string; document_type: string; file_name: string; content_type?: string | null }>
  }>('/api/user/kyc', { method: 'GET' })
  if (raw == null) return null
  return mapStatusResponse(raw as any)
}

/** POST /api/user/kyc/upload – multipart: submission_id (optional), document_type, file */
export async function uploadKycDocument(formData: FormData): Promise<UploadKycResponse> {
  return http<UploadKycResponse>('/api/user/kyc/upload', {
    method: 'POST',
    body: formData,
  })
}

/** POST /api/user/kyc/submit – set doc types and mark pending */
export async function submitKyc(payload: { identity_doc_type: string; address_doc_type: string }): Promise<KycStatusResponse> {
  const raw = await http<any>('/api/user/kyc/submit', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return mapStatusResponse(raw)
}

/** GET /api/user/kyc/submissions/:submissionId/documents/:docId – returns blob */
export async function getMyKycDocumentBlob(submissionId: string, docId: string): Promise<Blob> {
  const base = getApiBaseUrl()
  const url = `${base}/api/user/kyc/submissions/${submissionId}/documents/${docId}`
  const res = await fetchWithAuth(url, { method: 'GET' })
  if (!res.ok) {
    const text = await res.text()
    let message = `HTTP ${res.status}`
    try {
      const j = JSON.parse(text)
      if (j?.error?.message) message = j.error.message
    } catch {}
    throw new Error(message)
  }
  return res.blob()
}

// ─── Admin KYC ─────────────────────────────────────────────────────────────

/** GET /api/admin/kyc/ – list submissions */
export async function listKycSubmissions(params?: ListKycParams): Promise<ListKycResponse> {
  const q = new URLSearchParams()
  if (params?.page != null) q.set('page', params.page.toString())
  if (params?.page_size != null) q.set('page_size', params.page_size.toString())
  if (params?.status && params.status !== 'all') q.set('status', params.status)
  if (params?.search?.trim()) q.set('search', params.search.trim())
  const query = q.toString()
  const raw = await http<{ items: any[]; total: number }>(
    `/api/admin/kyc${query ? `?${query}` : ''}`,
    { method: 'GET' }
  )
  return {
    items: (raw.items ?? []).map(mapSubmissionRow),
    total: raw.total ?? 0,
  }
}

/** GET /api/admin/kyc/:id – submission detail */
export async function getKycSubmission(id: string): Promise<KycSubmissionDetail> {
  const raw = await http<any>(`/api/admin/kyc/${id}`, { method: 'GET' })
  return mapSubmissionDetail(raw)
}

/** GET /api/admin/kyc/:submissionId/documents/:docId – returns blob */
export async function getAdminKycDocumentBlob(submissionId: string, docId: string): Promise<Blob> {
  const base = getApiBaseUrl()
  const url = `${base}/api/admin/kyc/${submissionId}/documents/${docId}`
  const res = await fetchWithAuth(url, { method: 'GET' })
  if (!res.ok) {
    const text = await res.text()
    let message = `HTTP ${res.status}`
    try {
      const j = JSON.parse(text)
      if (j?.error?.message) message = j.error.message
    } catch {}
    throw new Error(message)
  }
  return res.blob()
}

/** POST /api/admin/kyc/:id/approve – 204 No Content */
export async function approveKyc(id: string): Promise<void> {
  await http(`/api/admin/kyc/${id}/approve`, { method: 'POST' })
}

/** POST /api/admin/kyc/:id/reject – body: { rejection_reason } – 204 No Content */
export async function rejectKyc(id: string, rejectionReason: string): Promise<void> {
  await http(`/api/admin/kyc/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ rejection_reason: rejectionReason }),
  })
}
