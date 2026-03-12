import { useState } from 'react'
import { Button } from '@/shared/ui/button'
import { useModalStore } from '@/app/store'
import { useNavigate } from 'react-router-dom'
import { toast } from '@/shared/components/common'
import type { Lead } from '../types/leads'

interface DeleteLeadModalProps {
  lead: Lead
  onSuccess: () => void
  modalKey: string
}

export function DeleteLeadModal({ lead, onSuccess, modalKey }: DeleteLeadModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const navigate = useNavigate()
  const [deleting, setDeleting] = useState(false)

  const handleConfirm = async () => {
    setDeleting(true)
    try {
      const { deleteLead } = await import('../api/leads.api')
      await deleteLead(lead.id)
      toast.success('Lead deleted.')
      closeModal(modalKey)
      navigate('/admin/leads')
      onSuccess()
    } catch (err) {
      toast.error((err as Error)?.message ?? 'Failed to delete')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text">
        Delete lead &quot;{lead.name || lead.email}&quot;? This action cannot be undone.
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => closeModal(modalKey)}>Cancel</Button>
        <Button type="button" variant="danger" onClick={handleConfirm} disabled={deleting}>
          {deleting ? 'Deleting...' : 'Delete'}
        </Button>
      </div>
    </div>
  )
}
