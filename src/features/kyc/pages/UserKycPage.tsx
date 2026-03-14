import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ContentShell, PageHeader } from '@/shared/layout'
import { Card } from '@/shared/ui/card'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'
import {
  FileCheck,
  ShieldCheck,
  Upload,
  CreditCard,
  Home,
  CheckCircle,
  Clock,
  AlertCircle,
  ChevronRight,
  ChevronLeft,
  Loader2,
  Lock,
  FileText,
} from 'lucide-react'
import { cn } from '@/shared/utils'
import { toast } from '@/shared/components/common'
import { getApiErrorMessage } from '@/shared/api/http'
import { getMyKyc, getMyKycDocumentBlob, uploadKycDocument, submitKyc } from '../api/kyc.api'
import type { KycStatusResponse, KycDocument } from '../types/kyc'

const STEPS = [
  { id: 1, title: 'Identity document', short: 'Identity', icon: CreditCard },
  { id: 2, title: 'Proof of address', short: 'Address', icon: Home },
  { id: 3, title: 'Review & submit', short: 'Review', icon: FileCheck },
] as const

const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10 MB
const ALLOWED_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

/** Locked = user cannot edit (pending, under_review, approved). Unlock only when rejected or not yet submitted. */
function isKycEditable(status: DisplayStatus): boolean {
  return status === 'not_started' || status === 'draft' || status === 'rejected'
}

type StepId = (typeof STEPS)[number]['id']

type DisplayStatus = 'not_started' | 'draft' | 'pending' | 'under_review' | 'approved' | 'rejected'

const STATUS_CONFIG: Record<
  DisplayStatus,
  { label: string; description: string; icon: typeof ShieldCheck; className: string; iconClassName: string }
> = {
  not_started: {
    label: 'Not started',
    description: 'Complete the steps below to verify your identity.',
    icon: ShieldCheck,
    className: 'bg-surface-2 border-border text-text-muted',
    iconClassName: 'text-text-muted',
  },
  draft: {
    label: 'In progress',
    description: 'Upload your documents and submit when ready.',
    icon: Upload,
    className: 'bg-surface-2 border-border text-text-muted',
    iconClassName: 'text-text-muted',
  },
  pending: {
    label: 'Pending review',
    description: 'Your documents have been submitted and are under review.',
    icon: Clock,
    className: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
    iconClassName: 'text-amber-500',
  },
  under_review: {
    label: 'Under review',
    description: 'Our team is verifying your documents. This usually takes 1–2 business days.',
    icon: FileCheck,
    className: 'bg-blue-500/10 border-blue-500/30 text-blue-400',
    iconClassName: 'text-blue-500',
  },
  approved: {
    label: 'Verified',
    description: 'Your identity has been verified. You have full access to your account.',
    icon: CheckCircle,
    className: 'bg-success/10 border-success/30 text-success',
    iconClassName: 'text-success',
  },
  rejected: {
    label: 'Rejected',
    description: "We couldn't verify your documents. Please resubmit with clearer copies or correct details.",
    icon: AlertCircle,
    className: 'bg-danger/10 border-danger/30 text-danger',
    iconClassName: 'text-danger',
  },
}

function toDisplayStatus(submission: KycStatusResponse | null): DisplayStatus {
  if (!submission) return 'not_started'
  if (submission.status === 'draft') return 'draft'
  return submission.status as DisplayStatus
}

/** Fetches and shows a preview of an uploaded KYC document (image or PDF). */
function KycDocumentPreview({
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
    queryKey: ['kyc', 'document', submissionId, doc.id],
    queryFn: () => getMyKycDocumentBlob(submissionId, doc.id),
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
      <div className={cn('flex items-center justify-center rounded-lg border border-border bg-surface-1/50 py-8', className)}>
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    )
  }

  const isImage =
    doc.contentType?.startsWith('image/') || blob?.type?.startsWith('image/')

  if (isImage) {
    return (
      <div className={cn('rounded-lg border border-border bg-surface-1/50 overflow-hidden', className)}>
        <img
          src={objectUrl}
          alt={doc.fileName}
          className="max-h-48 w-full object-contain object-center"
        />
        <p className="truncate px-2 py-1.5 text-xs text-text-muted">{doc.fileName}</p>
      </div>
    )
  }

  return (
    <div className={cn('rounded-lg border border-border bg-surface-1/50 overflow-hidden', className)}>
      <embed
        src={objectUrl}
        type="application/pdf"
        className="h-48 w-full object-contain"
        title={doc.fileName}
      />
      <p className="truncate px-2 py-1.5 text-xs text-text-muted flex items-center gap-1">
        <FileText className="h-3.5 w-3.5 shrink-0" />
        {doc.fileName}
      </p>
    </div>
  )
}

export function UserKycPage() {
  const queryClient = useQueryClient()
  const [currentStep, setCurrentStep] = useState<StepId>(1)
  const [idDocType, setIdDocType] = useState('')
  const [addressDocType, setAddressDocType] = useState('')
  const identityInputRef = useRef<HTMLInputElement>(null)
  const addressInputRef = useRef<HTMLInputElement>(null)

  const { data: submission, isLoading: loadingKyc } = useQuery({
    queryKey: ['kyc', 'my'],
    queryFn: getMyKyc,
  })

  // Pre-fill doc types from existing submission when editable (draft or rejected)
  useEffect(() => {
    if (!submission) return
    const s = toDisplayStatus(submission)
    if (s === 'draft' || s === 'rejected') {
      if (submission.identityDocType) setIdDocType(submission.identityDocType)
      if (submission.addressDocType) setAddressDocType(submission.addressDocType)
    }
  }, [submission?.id, submission?.status, submission?.identityDocType, submission?.addressDocType])

  const submitMutation = useMutation({
    mutationFn: (payload: { identity_doc_type: string; address_doc_type: string }) => submitKyc(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kyc', 'my'] })
      toast.success('Submitted for verification')
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err))
    },
  })

  const status = toDisplayStatus(submission ?? null)
  const statusConfig = STATUS_CONFIG[status]
  const StatusIcon = statusConfig.icon
  const editable = isKycEditable(status)

  const identityDoc = submission?.documents?.find(
    (d) => d.documentType === 'identity_front' || d.documentType === 'identity_back'
  )
  const addressDoc = submission?.documents?.find((d) => d.documentType === 'proof_of_address')
  const hasIdentity = Boolean(identityDoc)
  const hasAddress = Boolean(addressDoc)

  const canGoNext =
    (currentStep === 1 && idDocType !== '' && hasIdentity) ||
    (currentStep === 2 && addressDocType !== '' && hasAddress) ||
    currentStep === 3

  const handleNext = () => {
    if (currentStep < 3) setCurrentStep((s) => (s + 1) as StepId)
  }

  const handleBack = () => {
    if (currentStep > 1) setCurrentStep((s) => (s - 1) as StepId)
  }

  const validateFile = (file: File): boolean => {
    if (file.size > MAX_FILE_BYTES) {
      toast.error('File must be 10 MB or smaller')
      return false
    }
    const type = file.type?.toLowerCase()
    if (!type || !ALLOWED_FILE_TYPES.includes(type)) {
      toast.error('Allowed formats: PDF, JPG, PNG, WebP')
      return false
    }
    return true
  }

  const handleIdentityFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!validateFile(file)) {
      e.target.value = ''
      return
    }
    const formData = new FormData()
    if (submission?.id) formData.append('submission_id', submission.id)
    formData.append('document_type', 'identity_front')
    formData.append('file', file)
    try {
      await uploadKycDocument(formData)
      queryClient.invalidateQueries({ queryKey: ['kyc', 'my'] })
      toast.success('Identity document uploaded')
    } catch (err) {
      toast.error(getApiErrorMessage(err))
    }
    e.target.value = ''
  }

  const handleAddressFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!validateFile(file)) {
      e.target.value = ''
      return
    }
    const formData = new FormData()
    if (submission?.id) formData.append('submission_id', submission.id)
    formData.append('document_type', 'proof_of_address')
    formData.append('file', file)
    try {
      await uploadKycDocument(formData)
      queryClient.invalidateQueries({ queryKey: ['kyc', 'my'] })
      toast.success('Proof of address uploaded')
    } catch (err) {
      toast.error(getApiErrorMessage(err))
    }
    e.target.value = ''
  }

  const submitValidationErrors: string[] = []
  if (!idDocType) submitValidationErrors.push('Select identity document type')
  if (!addressDocType) submitValidationErrors.push('Select proof of address type')
  if (!hasIdentity) submitValidationErrors.push('Upload identity document')
  if (!hasAddress) submitValidationErrors.push('Upload proof of address')

  const handleSubmit = () => {
    if (submitValidationErrors.length > 0) {
      toast.error(submitValidationErrors[0])
      return
    }
    submitMutation.mutate({
      identity_doc_type: idDocType,
      address_doc_type: addressDocType,
    })
  }

  const idDocLabel =
    { passport: 'Passport', national_id: 'National ID', driving_licence: 'Driving licence' }[
      idDocType
    ] || idDocType
  const addressDocLabel =
    {
      utility: 'Utility bill',
      bank_statement: 'Bank statement',
      tax: 'Tax document',
      other: 'Other',
    }[addressDocType] || addressDocType

  if (loadingKyc) {
    return (
      <ContentShell>
        <PageHeader title="Identity verification (KYC)" description="Loading…" />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
        </div>
      </ContentShell>
    )
  }

  return (
    <ContentShell>
      <PageHeader
        title="Identity verification (KYC)"
        description="Verify your identity to unlock full account access and higher limits."
      />

      {/* Status card */}
      <Card
        className={cn(
          'mb-8 flex items-start gap-4 rounded-lg border p-4 sm:p-5',
          statusConfig.className
        )}
      >
        <div
          className={cn(
            'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl',
            status === 'approved' ? 'bg-success/20' : status === 'rejected' ? 'bg-danger/20' : 'bg-surface-2'
          )}
        >
          <StatusIcon className={cn('h-6 w-6', statusConfig.iconClassName)} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">{statusConfig.label}</h2>
          <p className="mt-1 text-sm opacity-90">{statusConfig.description}</p>
        </div>
      </Card>

      {status === 'rejected' && submission?.rejectionReason && (
        <Card className="mb-8 rounded-lg border border-danger/30 bg-danger/5 p-4">
          <p className="text-sm text-text">
            <span className="font-medium text-danger">Reason: </span>
            {submission.rejectionReason}
          </p>
        </Card>
      )}

      {/* Locked: submitted for review – no editing until rejected or approved */}
      {!editable && status !== 'approved' && submission && (
        <Card className="mb-8 rounded-lg border border-amber-500/30 bg-amber-500/5 p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-amber-500">
              <Lock className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-text">Submission locked</h3>
              <p className="mt-1 text-sm text-text-muted">
                Your KYC has been submitted for verification. You cannot edit or re-upload documents until we have
                completed the review. If your submission is rejected, this section will unlock so you can resubmit.
              </p>
              <div className="mt-4 rounded-lg border border-border bg-surface-1/50 p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-text-muted">Identity document</span>
                  <span className="text-text">
                    {submission.identityDocType
                      ? { passport: 'Passport', national_id: 'National ID', driving_licence: 'Driving licence' }[
                          submission.identityDocType
                        ] ?? submission.identityDocType
                      : '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Proof of address</span>
                  <span className="text-text">
                    {submission.addressDocType
                      ? {
                          utility: 'Utility bill',
                          bank_statement: 'Bank statement',
                          tax: 'Tax document',
                          other: 'Other',
                        }[submission.addressDocType] ?? submission.addressDocType
                      : '—'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </Card>
      )}

      {editable && (
        <>
          {/* Stepper */}
          <div className="mb-8">
            <div className="flex items-center justify-between gap-2">
              {STEPS.map((step, index) => {
                const isActive = currentStep === step.id
                const isPast = currentStep > step.id
                return (
                  <div key={step.id} className="flex flex-1 items-center">
                    <button
                      type="button"
                      onClick={() => setCurrentStep(step.id)}
                      className={cn(
                        'flex flex-1 flex-col items-center gap-2 sm:flex-row sm:justify-center',
                        'rounded-lg py-3 px-2 transition-colors',
                        isActive && 'bg-accent/10 text-accent',
                        isPast && 'text-success',
                        !isActive && !isPast && 'text-text-muted hover:text-text'
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold',
                          isActive && 'border-accent bg-accent/20',
                          isPast && 'border-success bg-success/20',
                          !isActive && !isPast && 'border-border bg-surface-2'
                        )}
                      >
                        {isPast ? <CheckCircle className="h-5 w-5" /> : step.id}
                      </span>
                      <span className="text-center text-sm font-medium sm:text-left">{step.short}</span>
                    </button>
                    {index < STEPS.length - 1 && (
                      <ChevronRight className="h-5 w-5 shrink-0 text-text-muted" />
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Step content */}
          <Card className="mb-8 rounded-lg border border-border bg-surface-2/40 p-4 sm:p-6">
            {currentStep === 1 && (
              <>
                <div className="mb-6 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    <CreditCard className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-text">Identity document</h3>
                    <p className="text-sm text-text-muted">
                      Passport, national ID, or driver's licence
                    </p>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label className="text-text-muted">Document type</Label>
                    <Select value={idDocType} onValueChange={setIdDocType}>
                      <SelectTrigger className="mt-1.5">
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="passport">Passport</SelectItem>
                        <SelectItem value="national_id">National ID</SelectItem>
                        <SelectItem value="driving_licence">Driving licence</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-text-muted">Upload document</Label>
                    <input
                      ref={identityInputRef}
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={handleIdentityFile}
                    />
                    <div className="mt-1.5 flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface-1/50 py-8 px-4">
                      {hasIdentity && identityDoc && submission ? (
                        <>
                          <p className="text-xs text-success mb-3">Identity document uploaded</p>
                          <KycDocumentPreview
                            submissionId={submission.id}
                            doc={identityDoc}
                            className="w-full max-w-sm mb-3"
                          />
                        </>
                      ) : (
                        <>
                          <Upload className="h-10 w-10 text-text-muted mb-2" />
                          <p className="text-sm text-text-muted text-center">
                            Drag and drop or click to upload
                          </p>
                          <p className="mt-1 text-xs text-text-muted">PNG, JPG or PDF, max 10 MB</p>
                        </>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3"
                        onClick={() => identityInputRef.current?.click()}
                      >
                        {hasIdentity ? 'Replace file' : 'Choose file'}
                      </Button>
                    </div>
                  </div>
                </div>
              </>
            )}

            {currentStep === 2 && (
              <>
                <div className="mb-6 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    <Home className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-text">Proof of address</h3>
                    <p className="text-sm text-text-muted">
                      Utility bill, bank statement, or similar (within last 3 months)
                    </p>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label className="text-text-muted">Document type</Label>
                    <Select value={addressDocType} onValueChange={setAddressDocType}>
                      <SelectTrigger className="mt-1.5">
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="utility">Utility bill</SelectItem>
                        <SelectItem value="bank_statement">Bank statement</SelectItem>
                        <SelectItem value="tax">Tax document</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-text-muted">Upload document</Label>
                    <input
                      ref={addressInputRef}
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={handleAddressFile}
                    />
                    <div className="mt-1.5 flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface-1/50 py-8 px-4">
                      {hasAddress && addressDoc && submission ? (
                        <>
                          <p className="text-xs text-success mb-3">Proof of address uploaded</p>
                          <KycDocumentPreview
                            submissionId={submission.id}
                            doc={addressDoc}
                            className="w-full max-w-sm mb-3"
                          />
                        </>
                      ) : (
                        <>
                          <Upload className="h-10 w-10 text-text-muted mb-2" />
                          <p className="text-sm text-text-muted text-center">
                            Drag and drop or click to upload
                          </p>
                          <p className="mt-1 text-xs text-text-muted">PNG, JPG or PDF, max 10 MB</p>
                        </>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3"
                        onClick={() => addressInputRef.current?.click()}
                      >
                        {hasAddress ? 'Replace file' : 'Choose file'}
                      </Button>
                    </div>
                  </div>
                </div>
              </>
            )}

            {currentStep === 3 && (
              <>
                <div className="mb-6 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    <FileCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-text">Review & submit</h3>
                    <p className="text-sm text-text-muted">
                      Check your details and submit for verification
                    </p>
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-surface-1/50 p-4 space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-text-muted">Identity document</span>
                    <span className="text-text">{idDocType ? idDocLabel : '—'}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-text-muted">Proof of address</span>
                    <span className="text-text">{addressDocType ? addressDocLabel : '—'}</span>
                  </div>
                </div>
                {submitValidationErrors.length > 0 && (
                  <p className="mt-4 text-sm text-danger">
                    Complete the following: {submitValidationErrors.join(', ')}
                  </p>
                )}
                <p className="mt-4 text-sm text-text-muted">
                  By submitting, you confirm that the documents are genuine and belong to you.
                </p>
              </>
            )}
          </Card>

          {/* Navigation */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              {currentStep > 1 && (
                <Button variant="outline" onClick={handleBack}>
                  <ChevronLeft className="h-4 w-4 mr-1.5" />
                  Back
                </Button>
              )}
            </div>
            <div className="flex items-center gap-3">
              {currentStep < 3 ? (
                <Button onClick={handleNext} disabled={!canGoNext}>
                  Next
                  <ChevronRight className="h-4 w-4 ml-1.5" />
                </Button>
              ) : (
                <Button
                  onClick={handleSubmit}
                  disabled={
                    !idDocType ||
                    !addressDocType ||
                    !hasIdentity ||
                    !hasAddress ||
                    submitMutation.isPending
                  }
                >
                  {submitMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : null}
                  Submit for verification
                </Button>
              )}
            </div>
          </div>
        </>
      )}

      {status === 'approved' && (
        <Card className="rounded-lg border border-border bg-surface-2/40 p-6 text-center">
          <CheckCircle className="mx-auto h-12 w-12 text-success mb-3" />
          <p className="text-text-muted">Your account is fully verified. No further action needed.</p>
        </Card>
      )}
    </ContentShell>
  )
}
