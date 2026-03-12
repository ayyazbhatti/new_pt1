import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import { useModalStore } from '@/app/store'
import { toast } from '@/shared/components/common'
import { listLeadOwners } from '../api/leads.api'
import type { Lead } from '../types/leads'

interface AssignOwnerModalProps {
  lead: Lead
  onSuccess: () => void
  modalKey: string
}

export function AssignOwnerModal({ lead, onSuccess, modalKey }: AssignOwnerModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const [ownerId, setOwnerId] = useState(lead.ownerId ?? '')
  const [submitting, setSubmitting] = useState(false)

  const { data: owners = [], isLoading: loadingOwners } = useQuery({
    queryKey: ['leads', 'owners'],
    queryFn: listLeadOwners,
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      const { updateLead } = await import('../api/leads.api')
      const owner = owners.find((o) => o.id === ownerId)
      await updateLead(lead.id, { ownerId: ownerId || undefined, ownerName: owner?.name })
      toast.success('Owner updated.')
      closeModal(modalKey)
      onSuccess()
    } catch (err) {
      toast.error((err as Error)?.message ?? 'Failed to assign')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <Label>Assign owner</Label>
        <select
          value={ownerId}
          onChange={(e) => setOwnerId(e.target.value)}
          disabled={loadingOwners}
          className="mt-1 h-10 w-full rounded-lg border border-border bg-surface-1 px-3 text-sm text-text disabled:opacity-50"
        >
          <option value="">Unassigned</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name || o.email}
            </option>
          ))}
        </select>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={() => closeModal(modalKey)}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting || loadingOwners}>
          {submitting ? 'Saving...' : 'Assign'}
        </Button>
      </div>
    </form>
  )
}
