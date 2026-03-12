import { useState } from 'react'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import { useModalStore } from '@/app/store'
import { useAuthStore } from '@/shared/store/auth.store'
import { toast } from '@/shared/components/common'
import type { Lead } from '../types/leads'
import type { ActivityType } from '../types/leads'

interface AddActivityModalProps {
  lead: Lead
  onSuccess: () => void
  modalKey: string
}

const ACTIVITY_TYPES: { value: ActivityType; label: string }[] = [
  { value: 'note', label: 'Note' },
  { value: 'call', label: 'Call' },
  { value: 'email', label: 'Email' },
]

export function AddActivityModal({ lead, onSuccess, modalKey }: AddActivityModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const user = useAuthStore((s) => s.user)
  const createdBy = user?.email ?? 'Current user'
  const [type, setType] = useState<ActivityType>('note')
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = content.trim()
    if (!trimmed) {
      toast.error('Content is required.')
      return
    }
    setSubmitting(true)
    try {
      const { addLeadActivity } = await import('../api/leads.api')
      await addLeadActivity(lead.id, type, trimmed, createdBy)
      toast.success('Activity added.')
      closeModal(modalKey)
      onSuccess()
    } catch (err) {
      toast.error((err as Error)?.message ?? 'Failed to add activity')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">Lead: <strong className="text-text">{lead.name || lead.email}</strong></p>
      <div>
        <Label>Type</Label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as ActivityType)}
          className="mt-1 h-10 w-full rounded-lg border border-border bg-surface-1 px-3 text-sm text-text"
        >
          {ACTIVITY_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>
      <div>
        <Label>Content *</Label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={4}
          required
          className="mt-1 w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent"
          placeholder="Note, call summary, or email details..."
        />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={() => closeModal(modalKey)}>Cancel</Button>
        <Button type="submit" disabled={submitting}>{submitting ? 'Saving...' : 'Add activity'}</Button>
      </div>
    </form>
  )
}
