import { useState } from 'react'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import { useModalStore } from '@/app/store'
import { toast } from '@/shared/components/common'
import type { Lead } from '../types/leads'

interface ConvertLeadModalProps {
  lead: Lead
  onSuccess: () => void
  modalKey: string
}

export function ConvertLeadModal({ lead, onSuccess, modalKey }: ConvertLeadModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const [option, setOption] = useState<'new' | 'link'>('new')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      const { convertLead } = await import('../api/leads.api')
      await convertLead(lead.id, option === 'link' ? 'user-placeholder-id' : undefined)
      toast.success('Lead converted to customer.')
      closeModal(modalKey)
      onSuccess()
    } catch (err) {
      toast.error((err as Error)?.message ?? 'Failed to convert')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">
        This will mark the lead as <strong className="text-text">Converted</strong> and optionally link to a user account.
      </p>
      <div className="rounded-lg border border-border bg-surface-2/40 p-3">
        <p className="text-sm font-medium text-text">{lead.name || '—'}</p>
        <p className="text-xs text-text-muted">{lead.email}</p>
      </div>
      <div className="space-y-2">
        <label className="flex items-center gap-2">
          <input type="radio" name="convert-option" checked={option === 'new'} onChange={() => setOption('new')} className="rounded border-border" />
          <span className="text-sm">Create new user and convert</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="convert-option" checked={option === 'link'} onChange={() => setOption('link')} className="rounded border-border" />
          <span className="text-sm">Link to existing user</span>
        </label>
      </div>
      {option === 'link' && (
        <div>
          <Label>User (placeholder)</Label>
          <p className="text-xs text-text-muted mt-1">User search/link will be wired when user API is connected.</p>
        </div>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={() => closeModal(modalKey)}>Cancel</Button>
        <Button type="submit" disabled={submitting}>{submitting ? 'Converting...' : 'Convert'}</Button>
      </div>
    </form>
  )
}
