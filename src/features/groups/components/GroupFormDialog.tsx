import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { ModalShell } from '@/shared/ui/modal'
import { UserGroup, CreateGroupPayload, UpdateGroupPayload } from '../types/group'
import { useCreateGroup, useUpdateGroup } from '../hooks/useGroups'
import { Spinner } from '@/shared/ui/loading'
import { Label } from '@/shared/ui/label'

const groupSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(40, 'Name must be at most 40 characters'),
  description: z.string().optional().nullable(),
  status: z.enum(['active', 'disabled']),
  margin_call_level: z.number().min(0).max(1000).optional().nullable(),
  stop_out_level: z.number().min(0).max(1000).optional().nullable(),
  signup_slug: z.string().max(20).optional().nullable(),
  hide_leverage_in_terminal: z.boolean().optional(),
})

type GroupFormData = z.infer<typeof groupSchema>

interface GroupFormDialogProps {
  mode: 'create' | 'edit' | 'view'
  initial?: UserGroup
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function GroupFormDialog({ mode, initial, open, onOpenChange }: GroupFormDialogProps) {
  const createGroup = useCreateGroup()
  const updateGroup = useUpdateGroup()

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<GroupFormData>({
    resolver: zodResolver(groupSchema),
    defaultValues: initial
      ? {
          name: initial.name,
          description: initial.description || '',
          status: initial.status,
          margin_call_level: initial.marginCallLevel ?? undefined,
          stop_out_level: initial.stopOutLevel ?? undefined,
          signup_slug: initial.signupSlug ?? '',
          hide_leverage_in_terminal: initial.hideLeverageInTerminal ?? false,
        }
      : {
          name: '',
          description: '',
          status: 'active',
          margin_call_level: undefined,
          stop_out_level: undefined,
          signup_slug: '',
          hide_leverage_in_terminal: false,
        },
  })

  const onSubmit = async (data: GroupFormData) => {
    if (mode === 'view') {
      onOpenChange(false)
      return
    }

    try {
      const payload: CreateGroupPayload | UpdateGroupPayload = {
        name: data.name,
        description: data.description || null,
        status: data.status,
        margin_call_level: data.margin_call_level ?? null,
        stop_out_level: data.stop_out_level ?? null,
        signup_slug: data.signup_slug?.trim() || null,
        hide_leverage_in_terminal: data.hide_leverage_in_terminal ?? null,
      }

      if (mode === 'create') {
        await createGroup.mutateAsync(payload as CreateGroupPayload)
      } else if (initial) {
        await updateGroup.mutateAsync({ id: initial.id, payload })
      }

      onOpenChange(false)
      reset()
    } catch (error) {
      // Error is handled by the mutation hook
    }
  }

  const isLoading = isSubmitting || createGroup.isPending || updateGroup.isPending
  const isReadOnly = mode === 'view'

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      title={mode === 'create' ? 'Create Group' : mode === 'edit' ? 'Edit Group' : 'View Group'}
      description={mode === 'create' ? 'Create a new user group with risk limits and trading permissions' : mode === 'edit' ? 'Update group settings' : 'View group details'}
      size="lg"
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Name *</Label>
          <Input
            id="name"
            {...register('name')}
            placeholder="e.g., VIP Group"
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
          <Label htmlFor="signup_slug">Signup link slug</Label>
          <Input
            id="signup_slug"
            {...register('signup_slug')}
            placeholder={mode === 'create' ? "e.g. golduser (or leave empty for auto 5-7 chars)" : "e.g. golduser (leave empty to clear)"}
            disabled={isLoading || isReadOnly}
            className="font-mono text-sm"
          />
          <p className="text-xs text-text-muted">Used in signup URL: /register?ref=<strong>{watch('signup_slug')?.trim() || '&lt;slug&gt;'}</strong>. 3-20 letters/numbers. Create: leave empty to auto-generate.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
          <div className="space-y-2">
            <Label htmlFor="margin_call_level">Margin call level (%)</Label>
            <Input
              id="margin_call_level"
              type="number"
              min={0}
              max={1000}
              step={0.5}
              placeholder="e.g. 50 (empty = default)"
              disabled={isLoading || isReadOnly}
              {...register('margin_call_level', { setValueAs: (v) => (v === '' || Number.isNaN(Number(v)) ? undefined : Number(v)) })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="stop_out_level">Stop out level (%)</Label>
            <Input
              id="stop_out_level"
              type="number"
              min={0}
              max={1000}
              step={0.5}
              placeholder="e.g. 20 (empty = off)"
              disabled={isLoading || isReadOnly}
              {...register('stop_out_level', { setValueAs: (v) => (v === '' || Number.isNaN(Number(v)) ? undefined : Number(v)) })}
            />
          </div>
        </div>
        <p className="text-xs text-text-muted">
          Margin call: when user margin level falls below this %, they see a margin call warning. Leave empty for default (50%). Stop out: when margin falls below this %, positions are closed automatically. Leave empty to disable. Stop out should be lower than margin call.
        </p>

        <div className="flex items-center gap-2 pt-2">
          <input
            type="checkbox"
            id="hide_leverage_in_terminal"
            checked={watch('hide_leverage_in_terminal') ?? false}
            onChange={(e) => setValue('hide_leverage_in_terminal', e.target.checked)}
            disabled={isLoading || isReadOnly}
            className="h-4 w-4 rounded border-border"
          />
          <Label htmlFor="hide_leverage_in_terminal" className="text-sm font-normal cursor-pointer">
            Hide leverage section in user trading terminal
          </Label>
        </div>
        <p className="text-xs text-text-muted">
          When checked, users in this group will not see the Leverage collapse in the right panel of the trading terminal.
        </p>

        <div className="flex justify-end gap-2 pt-4 border-t border-border">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isLoading || isReadOnly}
          >
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

