import { useState } from 'react'
import { Button } from '@/shared/ui/button'
import { useModalStore } from '@/app/store'

export interface FundedPackage {
  id: string
  name: string
  accountSize: number
  fee: number
  tier: string
  notes: string
  active: boolean
}

interface DeletePackageModalProps {
  pkg: FundedPackage
  onConfirm: () => void | Promise<void>
  modalKey: string
}

export function DeletePackageModal({ pkg, onConfirm, modalKey }: DeletePackageModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const [isDeleting, setIsDeleting] = useState(false)

  const handleConfirm = async () => {
    setIsDeleting(true)
    try {
      await onConfirm()
      closeModal(modalKey)
    } catch {
      // handled by parent
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text">
        Delete package &quot;{pkg.name}&quot; (${pkg.accountSize.toLocaleString()} / ${pkg.fee})? This cannot be undone.
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => closeModal(modalKey)}>
          Cancel
        </Button>
        <Button variant="danger" onClick={handleConfirm} disabled={isDeleting}>
          {isDeleting ? 'Deleting...' : 'Delete'}
        </Button>
      </div>
    </div>
  )
}
