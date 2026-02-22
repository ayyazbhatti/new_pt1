import { Button } from '@/shared/ui/button'
import { useModalStore } from '@/app/store'
import type { Tag } from '../types/tag'

interface DeleteTagModalProps {
  tag: Tag
  onConfirm: () => void
}

export function DeleteTagModal({ tag, onConfirm }: DeleteTagModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const modalKey = `delete-tag-${tag.id}`
  const assignedCount = (tag.userCount ?? 0) + (tag.managerCount ?? 0)

  const handleDelete = () => {
    onConfirm()
    closeModal(modalKey)
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-text">
        Are you sure you want to delete the tag{' '}
        <strong>
          <span
            className="inline-block h-2.5 w-2.5 rounded-full align-middle mr-1"
            style={{ backgroundColor: tag.color }}
          />
          {tag.name}
        </strong>{' '}
        (<span className="font-mono text-text-muted">{tag.slug}</span>)?
      </p>
      {assignedCount > 0 && (
        <p className="text-sm text-warning">
          This tag is assigned to {tag.userCount ?? 0} user(s) and {tag.managerCount ?? 0} manager(s).
          Deleting it will remove these assignments.
        </p>
      )}
      <p className="text-xs text-text-muted">This action cannot be undone.</p>
      <div className="flex justify-end gap-2 pt-4">
        <Button variant="outline" onClick={() => closeModal(modalKey)}>
          Cancel
        </Button>
        <Button variant="danger" onClick={handleDelete}>
          Delete tag
        </Button>
      </div>
    </div>
  )
}
