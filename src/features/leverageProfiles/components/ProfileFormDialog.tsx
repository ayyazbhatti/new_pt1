import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { ModalShell } from '@/shared/ui/modal'
import { LeverageProfile, CreateLeverageProfilePayload, UpdateLeverageProfilePayload } from '../types/leverageProfile'
import { useCreateLeverageProfile, useUpdateLeverageProfile } from '../hooks/useLeverageProfiles'
import { Spinner } from '@/shared/ui/loading'
import { Label } from '@/shared/ui/label'

const profileSchema = z.object({
  name: z.string().min(3, 'Profile name must be at least 3 characters').max(60, 'Name must be at most 60 characters'),
  description: z.string().optional().nullable(),
  status: z.enum(['active', 'disabled']),
})

type ProfileFormData = z.infer<typeof profileSchema>

interface ProfileFormDialogProps {
  mode: 'create' | 'edit' | 'view'
  initial?: LeverageProfile
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ProfileFormDialog({ mode, initial, open, onOpenChange }: ProfileFormDialogProps) {
  const createProfile = useCreateLeverageProfile()
  const updateProfile = useUpdateLeverageProfile()

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: initial
      ? {
          name: initial.name,
          description: initial.description || '',
          status: initial.status,
        }
      : {
          name: '',
          description: '',
          status: 'active',
        },
  })

  const onSubmit = async (data: ProfileFormData) => {
    if (mode === 'view') {
      onOpenChange(false)
      return
    }

    try {
      const payload: CreateLeverageProfilePayload | UpdateLeverageProfilePayload = {
        name: data.name,
        description: data.description || null,
        status: data.status,
      }

      if (mode === 'create') {
        await createProfile.mutateAsync(payload as CreateLeverageProfilePayload)
      } else if (initial) {
        await updateProfile.mutateAsync({ id: initial.id, payload })
      }

      onOpenChange(false)
      reset()
    } catch (error) {
      // Error is handled by the mutation hook
    }
  }

  const isLoading = isSubmitting || createProfile.isPending || updateProfile.isPending
  const isReadOnly = mode === 'view'

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      title={mode === 'create' ? 'Create Leverage Profile' : mode === 'edit' ? 'Edit Leverage Profile' : 'View Leverage Profile'}
      description={
        mode === 'create'
          ? 'Create a new leverage profile with tiered margin limits'
          : mode === 'edit'
          ? 'Update leverage profile settings'
          : 'View leverage profile details'
      }
      size="md"
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name" className="text-slate-300">Profile Name *</Label>
          <Input
            id="name"
            {...register('name')}
            placeholder="e.g., Default FX Profile"
            disabled={isLoading || isReadOnly}
            className="border-slate-600 bg-slate-700 text-white placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500"
          />
          {errors.name && <p className="text-sm text-red-400">{errors.name.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="description" className="text-slate-300">Notes</Label>
          <textarea
            id="description"
            {...register('description')}
            placeholder="Optional notes"
            className="flex h-20 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
            disabled={isLoading || isReadOnly}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="status" className="text-slate-300">Status *</Label>
          <Select
            value={watch('status')}
            onValueChange={(value) => setValue('status', value as 'active' | 'disabled')}
            disabled={isLoading || isReadOnly}
          >
            <SelectTrigger id="status" className="border-slate-600 bg-slate-700 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="disabled">Archived</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-slate-700">
          <Button type="button" variant="outline" className="border-slate-600 bg-slate-700 text-slate-300 hover:bg-slate-600" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancel
          </Button>
          {mode !== 'view' && (
            <Button type="submit" disabled={isLoading} className="bg-blue-600 hover:bg-blue-700">
              {isLoading ? (
                <>
                  <Spinner className="mr-2 h-4 w-4" />
                  {mode === 'create' ? 'Creating...' : 'Updating...'}
                </>
              ) : (
                mode === 'create' ? 'Create Profile' : 'Update Profile'
              )}
            </Button>
          )}
        </div>
      </form>
    </ModalShell>
  )
}

