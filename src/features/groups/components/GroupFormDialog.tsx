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
  priority: z.number().min(-9999, 'Priority must be >= -9999').max(9999, 'Priority must be <= 9999'),
  max_open_positions: z.number().min(0, 'Max open positions must be >= 0'),
  max_open_orders: z.number().min(0, 'Max open orders must be >= 0'),
  risk_mode: z.enum(['standard', 'conservative', 'aggressive']),
})

type GroupFormData = z.infer<typeof groupSchema>

interface GroupFormDialogProps {
  mode: 'create' | 'edit'
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
          priority: initial.priority,
          max_open_positions: initial.maxOpenPositions,
          max_open_orders: initial.maxOpenOrders,
          risk_mode: initial.riskMode,
        }
      : {
          name: '',
          description: '',
          status: 'active',
          priority: 0,
          max_open_positions: 50,
          max_open_orders: 200,
          risk_mode: 'standard',
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
        priority: data.priority,
        min_leverage: initial?.minLeverage ?? 1,
        max_leverage: initial?.maxLeverage ?? 100,
        max_open_positions: data.max_open_positions,
        max_open_orders: data.max_open_orders,
        risk_mode: data.risk_mode,
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

        <div className="grid grid-cols-2 gap-4">
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
            <Label htmlFor="priority">Priority *</Label>
            <Input
              id="priority"
              type="number"
              {...register('priority', { valueAsNumber: true })}
              disabled={isLoading || isReadOnly}
            />
            {errors.priority && <p className="text-sm text-danger">{errors.priority.message}</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="max_open_positions">Max Open Positions *</Label>
            <Input
              id="max_open_positions"
              type="number"
              {...register('max_open_positions', { valueAsNumber: true })}
              disabled={isLoading || isReadOnly}
            />
            {errors.max_open_positions && <p className="text-sm text-danger">{errors.max_open_positions.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="max_open_orders">Max Open Orders *</Label>
            <Input
              id="max_open_orders"
              type="number"
              {...register('max_open_orders', { valueAsNumber: true })}
              disabled={isLoading || isReadOnly}
            />
            {errors.max_open_orders && <p className="text-sm text-danger">{errors.max_open_orders.message}</p>}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="risk_mode">Risk Mode *</Label>
          <Select
            value={watch('risk_mode')}
            onValueChange={(value) => setValue('risk_mode', value as 'standard' | 'conservative' | 'aggressive')}
            disabled={isLoading || isReadOnly}
          >
            <SelectTrigger id="risk_mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="standard">Standard</SelectItem>
              <SelectItem value="conservative">Conservative</SelectItem>
              <SelectItem value="aggressive">Aggressive</SelectItem>
            </SelectContent>
          </Select>
        </div>

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

