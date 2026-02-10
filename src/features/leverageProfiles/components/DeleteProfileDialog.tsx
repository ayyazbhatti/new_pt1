import { ModalShell } from '@/shared/ui/modal'
import { Button } from '@/shared/ui/button'
import { LeverageProfile } from '../types/leverageProfile'
import { useDeleteLeverageProfile } from '../hooks/useLeverageProfiles'
import { Spinner } from '@/shared/ui/loading'
import { AlertTriangle } from 'lucide-react'

interface DeleteProfileDialogProps {
  profile: LeverageProfile
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DeleteProfileDialog({ profile, open, onOpenChange }: DeleteProfileDialogProps) {
  const deleteProfile = useDeleteLeverageProfile()

  const handleDelete = async () => {
    try {
      await deleteProfile.mutateAsync(profile.id)
      onOpenChange(false)
    } catch (error) {
      // Error is handled by the mutation hook
    }
  }

  const isLoading = deleteProfile.isPending
  const hasSymbols = profile.symbolsCount > 0

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      title="Delete Leverage Profile"
      description="This action cannot be undone"
      size="md"
    >
      <div className="space-y-4">
        {hasSymbols && (
          <div className="flex items-start gap-3 p-3 rounded-lg bg-warning/10 border border-warning/20">
            <AlertTriangle className="h-5 w-5 text-warning mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-warning">Profile has assigned symbols</p>
              <p className="text-sm text-text-muted mt-1">
                This profile has {profile.symbolsCount} symbol{profile.symbolsCount !== 1 ? 's' : ''} assigned. 
                Remove symbols from this profile before deleting it.
              </p>
            </div>
          </div>
        )}

        <div className="text-sm text-text">
          Are you sure you want to delete <span className="font-semibold">{profile.name}</span>?
          {profile.tiersCount > 0 && (
            <span className="block mt-2 text-text-muted">
              This will also delete {profile.tiersCount} tier{profile.tiersCount !== 1 ? 's' : ''} associated with this profile.
            </span>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-border">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={handleDelete}
            disabled={isLoading || hasSymbols}
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

