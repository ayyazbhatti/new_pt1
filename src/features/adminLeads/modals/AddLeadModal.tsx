import { useState } from 'react'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import { useModalStore } from '@/app/store'
import { toast } from '@/shared/components/common'
import type { CreateLeadPayload, LeadSource } from '../types/leads'
import { LEAD_SOURCE_LABELS } from '../types/leads'

const SOURCES: LeadSource[] = ['website', 'landing_page', 'demo_request', 'chat', 'google_ad', 'meta_ad', 'referral', 'event', 'other']

interface AddLeadModalProps {
  onSuccess: (id: string) => void
  modalKey: string
}

export function AddLeadModal({ onSuccess, modalKey }: AddLeadModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [company, setCompany] = useState('')
  const [source, setSource] = useState<LeadSource>('website')
  const [campaign, setCampaign] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedEmail = email.trim()
    const trimmedName = name.trim()
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
      const { createLead } = await import('../api/leads.api')
      const lead = await createLead({
        name: trimmedName || '—',
        email: trimmedEmail,
        phone: phone.trim() || undefined,
        company: company.trim() || undefined,
        source,
        campaign: campaign.trim() || undefined,
        status: 'new',
        notes: notes.trim() || undefined,
      })
      toast.success('Lead created.')
      closeModal(modalKey)
      onSuccess(lead.id)
    } catch (err) {
      toast.error((err as Error)?.message ?? 'Failed to create lead')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <Label htmlFor="add-name">Name</Label>
        <Input id="add-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="John Smith" className="mt-1" />
      </div>
      <div>
        <Label htmlFor="add-email">Email *</Label>
        <Input id="add-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="john@example.com" className="mt-1" required />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="add-phone">Phone</Label>
          <Input id="add-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 0100" className="mt-1" />
        </div>
        <div>
          <Label htmlFor="add-company">Company</Label>
          <Input id="add-company" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme Corp" className="mt-1" />
        </div>
      </div>
      <div>
        <Label htmlFor="add-source">Source</Label>
        <select
          id="add-source"
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
        <Label htmlFor="add-campaign">Campaign</Label>
        <Input id="add-campaign" value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="Q1 2026" className="mt-1" />
      </div>
      <div>
        <Label htmlFor="add-notes">Notes</Label>
        <textarea
          id="add-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent"
          placeholder="Optional note..."
        />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={() => closeModal(modalKey)}>Cancel</Button>
        <Button type="submit" disabled={submitting}>{submitting ? 'Creating...' : 'Create lead'}</Button>
      </div>
    </form>
  )
}
