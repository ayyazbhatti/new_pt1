import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useModalStore } from '@/app/store'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { Label } from '@/shared/ui/label'
import { Textarea } from '@/shared/ui/textarea'
import {
  FileCheck,
  CreditCard,
  Home,
  CheckCircle,
  XCircle,
  Clock,
  Download,
  Image as ImageIcon,
  Loader2,
  FileText,
} from 'lucide-react'
import type { KycDocument } from '../types/kyc'
import { cn } from '@/shared/utils'
import { useCanAccess } from '@/shared/utils/permissions'
import { toast } from '@/shared/components/common'
import { getApiErrorMessage } from '@/shared/api/http'
import {
  getKycSubmission,
  getAdminKycDocumentBlob,
  approveKyc,
  rejectKyc,
} from '../api/kyc.api'
import type { KycSubmissionDetail, KycStatus } from '../types/kyc'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const STATUS_CONFIG: Record<
  KycStatus,
  { label: string; className: string; icon: typeof Clock }
> = {
  draft: { label: 'Draft', className: 'bg-surface-2 text-text-muted', icon: FileText },
  pending: { label: 'Pending', className: 'bg-amber-500/20 text-amber-400', icon: Clock },
  under_review: { label: 'Under review', className: 'bg-blue-500/20 text-blue-400', icon: FileCheck },
  approved: { label: 'Approved', className: 'bg-success/20 text-success', icon: CheckCircle },
  rejected: { label: 'Rejected', className: 'bg-danger/20 text-danger', icon: XCircle },
}

function StatusBadge({ status }: { status: KycStatus }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending
  const Icon = config.icon
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        config.className
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {config.label}
    </span>
  )
}

/** Fetches and shows a preview of a KYC document (image or PDF) in the admin modal. */
function AdminDocumentPreview({
  submissionId,
  doc,
  className,
}: {
  submissionId: string
  doc: KycDocument
  className?: string
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const { data: blob, isLoading } = useQuery({
    queryKey: ['kyc', 'admin-document', submissionId, doc.id],
    queryFn: () => getAdminKycDocumentBlob(submissionId, doc.id),
    enabled: Boolean(submissionId && doc.id),
  })

  useEffect(() => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    setObjectUrl(url)
    return () => {
      URL.revokeObjectURL(url)
      setObjectUrl(null)
    }
  }, [blob])

  if (isLoading || !objectUrl) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-lg border border-border bg-surface-1/50 py-6',
          className
        )}
      >
        <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
      </div>
    )
  }

  const isImage =
    doc.contentType?.startsWith('image/') || blob?.type?.startsWith('image/')

  if (isImage) {
    return (
      <div
        className={cn(
          'rounded-lg border border-border bg-surface-1/50 overflow-hidden',
          className
        )}
      >
        <img
          src={objectUrl}
          alt={doc.fileName}
          className="max-h-40 w-full object-contain object-center"
        />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-surface-1/50 overflow-hidden',
        className
      )}
    >
      <embed
        src={objectUrl}
        type="application/pdf"
        className="h-40 w-full object-contain"
        title={doc.fileName}
      />
    </div>
  )
}

interface KycSubmissionDetailModalProps {
  submissionId: string
  modalKey: string
  onSuccess?: () => void
}

export function KycSubmissionDetailModal({
  submissionId,
  modalKey,
  onSuccess,
}: KycSubmissionDetailModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const queryClient = useQueryClient()
  const [rejectReason, setRejectReason] = useState('')
  const [showRejectInput, setShowRejectInput] = useState(false)
  const [loadingDoc, setLoadingDoc] = useState<string | null>(null)

  const { data: submission, isLoading } = useQuery({
    queryKey: ['kyc', 'submission', submissionId],
    queryFn: () => getKycSubmission(submissionId),
  })

  const approveMutation = useMutation({
    mutationFn: () => approveKyc(submissionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kyc', 'submission', submissionId] })
      queryClient.invalidateQueries({ queryKey: ['kyc', 'admin-list'] })
      onSuccess?.()
      closeModal(modalKey)
      toast.success('KYC approved')
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  })

  const rejectMutation = useMutation({
    mutationFn: () => rejectKyc(submissionId, rejectReason.trim()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kyc', 'submission', submissionId] })
      queryClient.invalidateQueries({ queryKey: ['kyc', 'admin-list'] })
      onSuccess?.()
      closeModal(modalKey)
      toast.success('KYC rejected')
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  })

  const handleApprove = () => approveMutation.mutate()
  const handleReject = () => {
    if (!showRejectInput) {
      setShowRejectInput(true)
      return
    }
    if (!rejectReason.trim()) return
    rejectMutation.mutate()
  }

  const handleViewDoc = async (docId: string) => {
    setLoadingDoc(docId)
    try {
      const blob = await getAdminKycDocumentBlob(submissionId, docId)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener')
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (err) {
      toast.error(getApiErrorMessage(err))
    } finally {
      setLoadingDoc(null)
    }
  }

  const handleDownloadDoc = async (docId: string, fileName: string) => {
    setLoadingDoc(docId)
    try {
      const blob = await getAdminKycDocumentBlob(submissionId, docId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName || 'document'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error(getApiErrorMessage(err))
    } finally {
      setLoadingDoc(null)
    }
  }

  const canReview = submission && (submission.status === 'pending' || submission.status === 'under_review')
  const canApproveReject = useCanAccess('kyc:approve')
  const showReviewActions = canReview && canApproveReject
  const actionLoading = approveMutation.isPending || rejectMutation.isPending

  const identityLabel =
    submission?.identityDocType === 'passport'
      ? 'Passport'
      : submission?.identityDocType === 'national_id'
        ? 'National ID'
        : submission?.identityDocType === 'driving_licence'
          ? 'Driving licence'
          : submission?.identityDocType ?? 'Identity document'
  const addressLabel =
    submission?.addressDocType === 'utility'
      ? 'Utility bill'
      : submission?.addressDocType === 'bank_statement'
        ? 'Bank statement'
        : submission?.addressDocType === 'tax'
          ? 'Tax document'
          : submission?.addressDocType ?? 'Proof of address'

  if (isLoading || !submission) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
        <p className="mt-2 text-sm text-text-muted">Loading submission…</p>
      </div>
    )
  }

  const identityDocs = submission.documents.filter(
    (d) => d.documentType === 'identity_front' || d.documentType === 'identity_back'
  )
  const addressDocs = submission.documents.filter((d) => d.documentType === 'proof_of_address')

  return (
    <div className="flex flex-col gap-6 max-h-[85vh] overflow-y-auto">
      {/* User info */}
      <div>
        <h3 className="text-sm font-medium text-text-muted mb-2">Applicant</h3>
        <div className="rounded-lg border border-border bg-surface-2/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-text">{submission.userName}</p>
              <p className="text-sm text-text-muted">{submission.userEmail}</p>
            </div>
            <StatusBadge status={submission.status} />
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-text-muted">
            <span>Submitted: {formatDate(submission.submittedAt)}</span>
            {submission.reviewedAt && (
              <span>Reviewed: {formatDate(submission.reviewedAt)}</span>
            )}
          </div>
        </div>
      </div>

      {/* Documents */}
      <div>
        <h3 className="text-sm font-medium text-text-muted mb-2">Documents</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="overflow-hidden border border-border bg-surface-2/40">
            <div className="flex items-center gap-2 border-b border-border bg-surface-1/50 px-3 py-2">
              <CreditCard className="h-4 w-4 text-accent" />
              <span className="text-sm font-medium text-text">{identityLabel}</span>
            </div>
            <div className="flex flex-col gap-3 p-4">
              {identityDocs.length === 0 ? (
                <p className="text-sm text-text-muted py-4 text-center">No identity document</p>
              ) : (
                identityDocs.map((doc) => (
                  <div
                    key={doc.id}
                    className="rounded-lg border border-border bg-surface-1/50 p-3 space-y-3"
                  >
                    <AdminDocumentPreview submissionId={submissionId} doc={doc} className="w-full" />
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <ImageIcon className="h-8 w-8 shrink-0 text-text-muted" />
                        <span className="text-sm truncate">{doc.fileName}</span>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={loadingDoc !== null}
                          onClick={() => handleViewDoc(doc.id)}
                        >
                          {loadingDoc === doc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'View'}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={loadingDoc !== null}
                          onClick={() => handleDownloadDoc(doc.id, doc.fileName)}
                        >
                          <Download className="h-3.5 w-3.5 mr-1" />
                          Download
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
          <Card className="overflow-hidden border border-border bg-surface-2/40">
            <div className="flex items-center gap-2 border-b border-border bg-surface-1/50 px-3 py-2">
              <Home className="h-4 w-4 text-accent" />
              <span className="text-sm font-medium text-text">{addressLabel}</span>
            </div>
            <div className="flex flex-col gap-3 p-4">
              {addressDocs.length === 0 ? (
                <p className="text-sm text-text-muted py-4 text-center">No proof of address</p>
              ) : (
                addressDocs.map((doc) => (
                  <div
                    key={doc.id}
                    className="rounded-lg border border-border bg-surface-1/50 p-3 space-y-3"
                  >
                    <AdminDocumentPreview submissionId={submissionId} doc={doc} className="w-full" />
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <ImageIcon className="h-8 w-8 shrink-0 text-text-muted" />
                        <span className="text-sm truncate">{doc.fileName}</span>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={loadingDoc !== null}
                          onClick={() => handleViewDoc(doc.id)}
                        >
                          {loadingDoc === doc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'View'}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={loadingDoc !== null}
                          onClick={() => handleDownloadDoc(doc.id, doc.fileName)}
                        >
                          <Download className="h-3.5 w-3.5 mr-1" />
                          Download
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>

      {submission.status === 'rejected' && submission.rejectionReason && (
        <div className="rounded-lg border border-danger/30 bg-danger/5 p-3">
          <p className="text-sm text-text">
            <span className="font-medium text-danger">Rejection reason: </span>
            {submission.rejectionReason}
          </p>
        </div>
      )}

      {showReviewActions && showRejectInput && (
        <div>
          <Label className="text-text-muted">Rejection reason (required)</Label>
          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="e.g. ID document is blurry. Please upload a clearer copy."
            className="mt-1.5 min-h-[80px]"
            rows={3}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-4">
        <Button variant="outline" onClick={() => closeModal(modalKey)}>
          Close
        </Button>
        {showReviewActions && (
          <>
            {showRejectInput ? (
              <Button
                variant="outline"
                className="text-danger hover:bg-danger/10 hover:text-danger"
                onClick={handleReject}
                disabled={!rejectReason.trim() || actionLoading}
              >
                <XCircle className="h-4 w-4 mr-1.5" />
                Confirm reject
              </Button>
            ) : (
              <Button
                variant="outline"
                className="text-danger hover:bg-danger/10 hover:text-danger"
                onClick={() => setShowRejectInput(true)}
              >
                <XCircle className="h-4 w-4 mr-1.5" />
                Reject
              </Button>
            )}
            <Button onClick={handleApprove} disabled={actionLoading}>
              <CheckCircle className="h-4 w-4 mr-1.5" />
              Approve
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
