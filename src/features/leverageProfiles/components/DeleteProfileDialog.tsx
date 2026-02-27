import { LeverageProfile } from '../types/leverageProfile'
import { useDeleteLeverageProfile } from '../hooks/useLeverageProfiles'
import { AdminConfirmModal } from '@/shared/components/common'
import { AlertTriangle } from 'lucide-react'

interface DeleteProfileDialogProps {
  profile: LeverageProfile
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DeleteProfileDialog({ profile, open, onOpenChange }: DeleteProfileDialogProps) {
  const deleteProfile = useDeleteLeverageProfile()
  const hasSymbols = (profile.symbolsCount ?? 0) > 0

  const handleDelete = async () => {
    try {
      await deleteProfile.mutateAsync(profile.id)
      onOpenChange(false)
    } catch {
      // Error is handled by the mutation hook
    }
  }

  return (
    <AdminConfirmModal
      isOpen={open}
      onClose={() => onOpenChange(false)}
      onConfirm={handleDelete}
      title="Delete Leverage Profile"
      message={`Are you sure you want to delete "${profile.name}"? This action cannot be undone and will delete all associated tiers.`}
      confirmText="Delete Profile"
      cancelText="Cancel"
      type="danger"
      isLoading={deleteProfile.isPending}
      loadingLabel="Deleting..."
      confirmDisabled={hasSymbols}
    >
      {hasSymbols && (
        <div className="mt-4 flex items-start gap-3 p-3 rounded-lg bg-yellow-900/20 border border-yellow-500/30">
          <AlertTriangle className="h-5 w-5 text-yellow-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-yellow-400">Profile has assigned symbols</p>
            <p className="text-sm text-slate-400 mt-1">
              Remove symbols from this profile before deleting.
            </p>
          </div>
        </div>
      )}
    </AdminConfirmModal>
  )
}
