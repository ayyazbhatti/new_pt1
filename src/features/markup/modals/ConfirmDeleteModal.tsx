import { Button } from '@/shared/ui/button'
import { MarkupRule } from '../types/markup'
import { useModalStore } from '@/app/store'
import { toast } from 'react-hot-toast'

interface ConfirmDeleteModalProps {
  rule: MarkupRule
}

export function ConfirmDeleteModal({ rule }: ConfirmDeleteModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)

  const handleDelete = () => {
    toast.success(`Markup rule for ${rule.symbol} deleted`)
    closeModal(`delete-${rule.id}`)
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-text">
        Are you sure you want to delete the markup rule for{' '}
        <strong className="font-mono">{rule.symbol}</strong> in{' '}
        <strong>{rule.groupName}</strong>?
      </div>
      <div className="text-xs text-text-muted">
        This action cannot be undone.
      </div>
      <div className="flex justify-end gap-2 pt-4">
        <Button variant="outline" onClick={() => closeModal(`delete-${rule.id}`)}>
          Cancel
        </Button>
        <Button variant="danger" onClick={handleDelete}>
          Delete
        </Button>
      </div>
    </div>
  )
}

