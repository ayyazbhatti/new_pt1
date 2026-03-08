import { useState } from 'react'
import { Button } from '@/shared/ui/button'
import { useModalStore } from '@/app/store'
import type { PromotionSlide } from '../types/promotions'

interface DeletePromoSlideModalProps {
  slide: PromotionSlide
  onConfirm: () => void | Promise<void>
}

export function DeletePromoSlideModal({ slide, onConfirm }: DeletePromoSlideModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const [isDeleting, setIsDeleting] = useState(false)

  const handleConfirm = async () => {
    setIsDeleting(true)
    try {
      await onConfirm()
      closeModal(`delete-promo-${slide.id}`)
    } catch {
      // Error handled by parent
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text">
        Delete slide &quot;{slide.title}&quot;? This cannot be undone.
      </p>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => closeModal(`delete-promo-${slide.id}`)}
        >
          Cancel
        </Button>
        <Button variant="danger" onClick={handleConfirm} disabled={isDeleting}>
          {isDeleting ? 'Deleting...' : 'Delete'}
        </Button>
      </div>
    </div>
  )
}
