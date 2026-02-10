import { ModalShell } from '@/shared/ui/modal'
import { Button } from '@/shared/ui/button'
import { UserGroup } from '../types/group'
import { useDeleteGroup, useGroupUsage } from '../hooks/useGroups'
import { Spinner } from '@/shared/ui/loading'
import { AlertTriangle } from 'lucide-react'

interface DeleteGroupDialogProps {
  group: UserGroup | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DeleteGroupDialog({ group, open, onOpenChange }: DeleteGroupDialogProps) {
  const deleteGroup = useDeleteGroup()
  const { data: usage } = useGroupUsage(group?.id || null)

  const handleDelete = async () => {
    if (!group) return

    try {
      await deleteGroup.mutateAsync(group.id)
      onOpenChange(false)
    } catch (error) {
      // Error is handled by the mutation hook
    }
  }

  const isLoading = deleteGroup.isPending
  const hasUsers = usage && usage.users_count > 0

  if (!group) return null

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      title="Delete Group"
      description="This action cannot be undone"
      size="md"
    >
      <div className="space-y-4">
        {hasUsers && (
          <div className="flex items-start gap-3 p-3 rounded-lg bg-warning/10 border border-warning/20">
            <AlertTriangle className="h-5 w-5 text-warning mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-warning">Group has assigned users</p>
              <p className="text-sm text-text-muted mt-1">
                This group has {usage.users_count} user{usage.users_count !== 1 ? 's' : ''} assigned. 
                Remove users from this group before deleting it.
              </p>
            </div>
          </div>
        )}

        <div className="text-sm text-text">
          Are you sure you want to delete <span className="font-semibold">{group.name}</span>?
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-border">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={handleDelete}
            disabled={isLoading || hasUsers}
          >
            {isLoading ? (
              <>
                <Spinner className="mr-2 h-4 w-4" />
                Deleting...
              </>
            ) : (
              'Delete'
            )}
          </Button>
        </div>
      </div>
    </ModalShell>
  )
}

