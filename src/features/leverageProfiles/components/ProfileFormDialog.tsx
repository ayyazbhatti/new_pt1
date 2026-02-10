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
  name: z.string().min(2, 'Name must be at least 2 characters').max(60, 'Name must be at most 60 characters'),
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
          <Label htmlFor="name">Name *</Label>
          <Input
            id="name"
            {...register('name')}
            placeholder="e.g., Default FX Profile"
            disabled={isLoading || isReadOnly}
          />
          {errors.name && <p className="text-sm text-danger">{errors.name.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <textarea
            id="description"
            {...register('description')}
            placeholder="Optional description"
            className="flex h-20 w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50 resize-none"
            disabled={isLoading || isReadOnly}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="status">Status *</Label>
          <Select
            value={watch('status')}
            onValueChange={(value) => setValue('status', value as 'active' | 'disabled')}
            disabled={isLoading || isReadOnly}
          >
            <SelectTrigger id="status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="disabled">Disabled</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-border">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancel
          </Button>
          {mode !== 'view' && (
            <Button type="submit" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Spinner className="mr-2 h-4 w-4" />
                  {mode === 'create' ? 'Creating...' : 'Saving...'}
                </>
              ) : (
                mode === 'create' ? 'Create' : 'Save'
              )}
            </Button>
          )}
        </div>
      </form>
    </ModalShell>
  )
}

