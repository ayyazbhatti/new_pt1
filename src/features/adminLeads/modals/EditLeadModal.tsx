import { useState, useEffect } from 'react'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import { useModalStore } from '@/app/store'
import { toast } from '@/shared/components/common'
import type { Lead, LeadSource, LeadStatus, UpdateLeadPayload } from '../types/leads'
import { LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS } from '../types/leads'

const SOURCES: LeadSource[] = ['website', 'landing_page', 'demo_request', 'chat', 'google_ad', 'meta_ad', 'referral', 'event', 'other']
const STATUSES: LeadStatus[] = ['new', 'contacted', 'qualified', 'proposal_sent', 'negotiation', 'converted', 'lost']

interface EditLeadModalProps {
  lead: Lead
  onSuccess: () => void
  modalKey: string
}

export function EditLeadModal({ lead, onSuccess, modalKey }: EditLeadModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const [name, setName] = useState(lead.name)
  const [email, setEmail] = useState(lead.email)
  const [phone, setPhone] = useState(lead.phone ?? '')
  const [company, setCompany] = useState(lead.company ?? '')
  const [source, setSource] = useState<LeadSource>(lead.source)
  const [campaign, setCampaign] = useState(lead.campaign ?? '')
  const [status, setStatus] = useState<LeadStatus>(lead.status)
  const [score, setScore] = useState(lead.score?.toString() ?? '')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setName(lead.name)
    setEmail(lead.email)
    setPhone(lead.phone ?? '')
    setCompany(lead.company ?? '')
    setSource(lead.source)
    setCampaign(lead.campaign ?? '')
    setStatus(lead.status)
    setScore(lead.score?.toString() ?? '')
  }, [lead])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      toast.error('Email is required.')
      return
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(trimmedEmail)) {
      toast.error('Enter a valid email address.')
      return
    }
    setSubmitting(true)
    try {
      const { updateLead } = await import('../api/leads.api')
      const payload: UpdateLeadPayload = {
        name: name.trim() || '—',
        email: trimmedEmail,
        phone: phone.trim() || undefined,
        company: company.trim() || undefined,
        source,
        campaign: campaign.trim() || undefined,
        status,
        score: score.trim() ? parseInt(score, 10) : undefined,
      }
      await updateLead(lead.id, payload)
      toast.success('Lead updated.')
      closeModal(modalKey)
      onSuccess()
    } catch (err) {
      toast.error((err as Error)?.message ?? 'Failed to update lead')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <Label htmlFor="edit-name">Name</Label>
        <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
      </div>
      <div>
        <Label htmlFor="edit-email">Email *</Label>
        <Input id="edit-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1" required />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="edit-phone">Phone</Label>
          <Input id="edit-phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1" />
        </div>
        <div>
          <Label htmlFor="edit-company">Company</Label>
          <Input id="edit-company" value={company} onChange={(e) => setCompany(e.target.value)} className="mt-1" />
        </div>
      </div>
      <div>
        <Label htmlFor="edit-source">Source</Label>
        <select
          id="edit-source"
          value={source}
          onChange={(e) => setSource(e.target.value as LeadSource)}
          className="mt-1 h-10 w-full rounded-lg border border-border bg-surface-1 px-3 text-sm text-text"
        >
          {SOURCES.map((s) => (
            <option key={s} value={s}>{LEAD_SOURCE_LABELS[s]}</option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="edit-campaign">Campaign</Label>
        <Input id="edit-campaign" value={campaign} onChange={(e) => setCampaign(e.target.value)} className="mt-1" />
      </div>
      <div>
        <Label htmlFor="edit-status">Status</Label>
        <select
          id="edit-status"
          value={status}
          onChange={(e) => setStatus(e.target.value as LeadStatus)}
          className="mt-1 h-10 w-full rounded-lg border border-border bg-surface-1 px-3 text-sm text-text"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="edit-score">Score (0–100)</Label>
        <Input id="edit-score" type="number" min={0} max={100} value={score} onChange={(e) => setScore(e.target.value)} className="mt-1" />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={() => closeModal(modalKey)}>Cancel</Button>
        <Button type="submit" disabled={submitting}>{submitting ? 'Saving...' : 'Save'}</Button>
      </div>
    </form>
  )
}
