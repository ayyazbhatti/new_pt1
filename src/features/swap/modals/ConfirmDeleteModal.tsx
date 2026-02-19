import { Button } from '@/shared/ui/button'
import { SwapRule } from '../types/swap'
import { useModalStore } from '@/app/store'
import { useDeleteSwapRule } from '../hooks/useSwapRules'

interface ConfirmDeleteModalProps {
  rule: SwapRule
}

export function ConfirmDeleteModal({ rule }: ConfirmDeleteModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const deleteRule = useDeleteSwapRule()

  const handleDelete = () => {
    deleteRule.mutate(rule.id, {
      onSuccess: () => closeModal(`delete-swap-${rule.id}`),
    })
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-text">
        Are you sure you want to delete the swap rule for{' '}
        <strong className="font-mono">{rule.symbol}</strong> in{' '}
        <strong>{rule.groupName}</strong>?
      </div>
      <div className="text-xs text-text-muted">
        This action cannot be undone.
      </div>
      <div className="flex justify-end gap-2 pt-4">
        <Button variant="outline" onClick={() => closeModal(`delete-swap-${rule.id}`)}>
          Cancel
        </Button>
        <Button variant="danger" onClick={handleDelete}>
          Delete
        </Button>
      </div>
    </div>
  )
}

