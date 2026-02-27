import { LeverageProfile } from '../types/leverageProfile'
import { useUpdateLeverageProfile } from '../hooks/useLeverageProfiles'
import { AdminConfirmModal } from '@/shared/components/common'

interface ArchiveConfirmModalProps {
  profile: LeverageProfile
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ArchiveConfirmModal({ profile, open, onOpenChange }: ArchiveConfirmModalProps) {
  const updateProfile = useUpdateLeverageProfile()
  const isArchived = profile.status === 'disabled'
  const action = isArchived ? 'Unarchive' : 'Archive'

  const handleConfirm = async () => {
    try {
      await updateProfile.mutateAsync({
        id: profile.id,
        payload: {
          name: profile.name,
          description: profile.description,
          status: isArchived ? 'active' : 'disabled',
        },
      })
      onOpenChange(false)
    } catch {
      // toast from mutation
    }
  }

  return (
    <AdminConfirmModal
      isOpen={open}
      onClose={() => onOpenChange(false)}
      onConfirm={handleConfirm}
      title={`${action} Profile`}
      message={`Are you sure you want to ${action.toLowerCase()} "${profile.name}"?`}
      confirmText="Confirm"
      cancelText="Cancel"
      type="warning"
      isLoading={updateProfile.isPending}
      loadingLabel={updateProfile.isPending ? 'Please wait...' : 'Confirm'}
    />
  )
}
