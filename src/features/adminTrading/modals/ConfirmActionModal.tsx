import { Button } from '@/shared/ui/button'
import { useModalStore } from '@/app/store'

interface ConfirmActionModalProps {
  title: string
  message: string
  onConfirm: () => void
  modalKey?: string
}

export function ConfirmActionModal({ title, message, onConfirm, modalKey }: ConfirmActionModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)

  const handleConfirm = () => {
    onConfirm()
    if (modalKey) {
      closeModal(modalKey)
    }
  }

  const handleCancel = () => {
    if (modalKey) {
      closeModal(modalKey)
    }
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-text">{message}</div>
      <div className="flex justify-end gap-2 pt-4">
        <Button variant="outline" onClick={handleCancel}>
          Cancel
        </Button>
        <Button variant="danger" onClick={handleConfirm}>
          Confirm
        </Button>
      </div>
    </div>
  )
}

