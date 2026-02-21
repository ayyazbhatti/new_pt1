import { Button } from '@/shared/ui/button'
import { useModalStore } from '@/app/store'
import type { Manager } from '../types/manager'

interface DeleteManagerModalProps {
  manager: Manager
  onConfirm: () => void
}

export function DeleteManagerModal({ manager, onConfirm }: DeleteManagerModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const modalKey = `delete-manager-${manager.id}`

  const handleDelete = () => {
    onConfirm()
    closeModal(modalKey)
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-text">
        Are you sure you want to remove <strong>{manager.userName}</strong> as a manager? They will lose admin access
        but remain a user in the system.
      </p>
      <p className="text-xs text-text-muted">This action can be reverted by creating them as a manager again.</p>
      <div className="flex justify-end gap-2 pt-4">
        <Button variant="outline" onClick={() => closeModal(modalKey)}>
          Cancel
        </Button>
        <Button variant="danger" onClick={handleDelete}>
          Remove manager
        </Button>
      </div>
    </div>
  )
}
