import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { ModalShell } from '@/shared/ui/modal'
import { UserGroup, CreateGroupPayload, UpdateGroupPayload } from '../types/group'
import { useCreateGroup, useUpdateGroup } from '../hooks/useGroups'
import { Spinner } from '@/shared/ui/loading'
import { Label } from '@/shared/ui/label'
import { TimezoneSelect } from '@/shared/components/TimezoneSelect'
import { CurrencySelect } from '@/shared/components/CurrencySelect'
import { getGeneralSettings } from '@/features/settings/api/generalSettings.api'
import { getGroupOpenPositionsCount } from '../api/groups.api'

const groupSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(40, 'Name must be at most 40 characters'),
  description: z.string().optional().nullable(),
  status: z.enum(['active', 'disabled']),
  margin_call_level: z.number().min(0).max(1000).optional().nullable(),
  stop_out_level: z.number().min(0).max(1000).optional().nullable(),
  signup_slug: z.string().max(20).optional().nullable(),
  hide_leverage_in_terminal: z.boolean().optional(),
  timezone: z.string().optional().nullable(),
  display_currency: z.string().nullable().optional(),
  swap_enabled: z.boolean().optional(),
  fees_enabled: z.boolean().optional(),
  default_slippage_bps: z.union([z.number().int().min(0), z.null()]).optional(),
})

type GroupFormData = z.infer<typeof groupSchema>

interface GroupFormDialogProps {
  mode: 'create' | 'edit' | 'view'
  initial?: UserGroup
  open: boolean
  onOpenChange: (open: boolean) => void
  /** After successful create/update; use to patch parent table (Admin Users pattern). */
  onSaved?: (group: UserGroup) => void
}

export function GroupFormDialog({ mode, initial, open, onOpenChange, onSaved }: GroupFormDialogProps) {
  const createGroup = useCreateGroup()
  const updateGroup = useUpdateGroup()

  const { data: generalSettings } = useQuery({
    queryKey: ['admin', 'settings', 'general'],
    queryFn: getGeneralSettings,
    enabled: open,
    staleTime: 60_000,
  })
  const platformDefaultTimezone = generalSettings?.timezone ?? 'UTC'
  const platformDefaultCurrency = generalSettings?.currency ?? 'USD'
  const platformDefaultSlippageBps =
    typeof generalSettings?.defaultSlippageBps === 'number' && Number.isFinite(generalSettings.defaultSlippageBps)
      ? generalSettings.defaultSlippageBps
      : 50

  const baselineSwapEnabledRef = useRef(false)

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<GroupFormData>({
    resolver: zodResolver(groupSchema),
    defaultValues: {
      name: '',
      description: '',
      status: 'active',
      margin_call_level: undefined,
      stop_out_level: undefined,
      signup_slug: '',
      hide_leverage_in_terminal: false,
      timezone: '',
      display_currency: '',
      swap_enabled: false,
      fees_enabled: false,
      default_slippage_bps: null,
    },
  })

  const { data: openPositionsCount = 0 } = useQuery({
    queryKey: ['admin', 'groups', initial?.id, 'open-positions-count'],
    queryFn: () => getGroupOpenPositionsCount(initial!.id),
    enabled: open && mode === 'edit' && !!initial?.id,
    staleTime: 30_000,
  })

  useEffect(() => {
    if (!open) return
    if (initial && (mode === 'edit' || mode === 'view')) {
      baselineSwapEnabledRef.current = !!initial.swapEnabled
      reset({
        name: initial.name,
        description: initial.description || '',
        status: initial.status,
        margin_call_level: initial.marginCallLevel ?? undefined,
        stop_out_level: initial.stopOutLevel ?? undefined,
        signup_slug: initial.signupSlug ?? '',
        hide_leverage_in_terminal: initial.hideLeverageInTerminal ?? false,
        timezone: initial.timezone ?? '',
        display_currency: initial.displayCurrency ?? '',
        swap_enabled: initial.swapEnabled ?? false,
        fees_enabled: initial.feesEnabled ?? false,
        default_slippage_bps:
          initial.defaultSlippageBps != null && Number.isFinite(initial.defaultSlippageBps)
            ? initial.defaultSlippageBps
            : null,
      })
    } else if (open && mode === 'create') {
      baselineSwapEnabledRef.current = false
      reset({
        name: '',
        description: '',
        status: 'active',
        margin_call_level: undefined,
        stop_out_level: undefined,
        signup_slug: '',
        hide_leverage_in_terminal: false,
        timezone: '',
        display_currency: '',
        swap_enabled: false,
        fees_enabled: false,
        default_slippage_bps: null,
      })
    }
  }, [open, initial?.id, mode, initial, reset])

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
        timezone: data.timezone?.trim() ? data.timezone.trim() : null,
        display_currency: data.display_currency?.trim() ? data.display_currency.trim() : null,
        swap_enabled: data.swap_enabled ?? false,
        fees_enabled: data.fees_enabled ?? false,
        default_slippage_bps: data.default_slippage_bps ?? null,
      }

      if (mode === 'create') {
        const created = await createGroup.mutateAsync(payload as CreateGroupPayload)
        onSaved?.(created)
      } else if (initial) {
        const updated = await updateGroup.mutateAsync({ id: initial.id, payload })
        onSaved?.(updated)
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

        <div className="rounded-lg border border-border p-3 space-y-3">
          <div className="flex items-start gap-2">
            <input
              type="checkbox"
              id="swap_enabled"
              checked={watch('swap_enabled') ?? false}
              onChange={(e) => setValue('swap_enabled', e.target.checked)}
              disabled={isLoading || isReadOnly}
              className="h-4 w-4 mt-1 rounded border-border"
            />
            <div className="min-w-0 flex-1">
              <Label htmlFor="swap_enabled" className="text-sm font-normal cursor-pointer">
                Swap (overnight financing)
              </Label>
              <p className="text-xs text-text-muted mt-1">
                Charges overnight financing on open positions at rollover time per configured swap rules.
              </p>
              {openPositionsCount > 0 &&
                (watch('swap_enabled') ?? false) &&
                !baselineSwapEnabledRef.current && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 font-medium">
                    {openPositionsCount} open position(s) in this group will be charged at the next rollover after swap
                    is enabled.
                  </p>
                )}
            </div>
          </div>

          <div className="flex items-start gap-2">
            <input
              type="checkbox"
              id="fees_enabled"
              checked={watch('fees_enabled') ?? false}
              onChange={(e) => setValue('fees_enabled', e.target.checked)}
              disabled={isLoading || isReadOnly}
              className="h-4 w-4 mt-1 rounded border-border"
            />
            <div className="min-w-0 flex-1">
              <Label htmlFor="fees_enabled" className="text-sm font-normal cursor-pointer">
                Trading fees
              </Label>
              <p className="text-xs text-text-muted mt-1">
                Charges a percentage fee on each new trade per configured fee rules (at order placement when Phase 2
                is active).
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="group_timezone">Timezone</Label>
          <TimezoneSelect
            id="group_timezone"
            variant="list"
            value={watch('timezone') ?? ''}
            onChange={(v) => setValue('timezone', v || null)}
            placeholder="Use platform default"
            allowClear
            disabled={isLoading || isReadOnly}
          />
          <p className="text-xs text-text-muted">
            Members of this group will use this timezone by default. Individual users can override this. Leave empty to
            use the platform default ({platformDefaultTimezone}).
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="group_display_currency">Display currency</Label>
          <CurrencySelect
            id="group_display_currency"
            variant="list"
            value={watch('display_currency') ?? ''}
            onChange={(v) => setValue('display_currency', v || null)}
            placeholder="Use platform default"
            allowClear
            disabled={isLoading || isReadOnly}
          />
          <p className="text-xs text-text-muted">
            Members of this group will see balances and prices converted to this currency unless their user-level
            currency override is set. Leave empty to use the platform default ({platformDefaultCurrency}).
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="group_default_slippage">Default slippage tolerance (optional)</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="group_default_slippage"
              type="number"
              min={0}
              step={1}
              placeholder="Use platform default"
              disabled={isLoading || isReadOnly}
              value={watch('default_slippage_bps') ?? ''}
              onChange={(e) => {
                const raw = e.target.value
                if (raw === '') {
                  setValue('default_slippage_bps', null, { shouldDirty: true })
                  return
                }
                const n = parseInt(raw, 10)
                if (Number.isFinite(n) && n >= 0) {
                  setValue('default_slippage_bps', n, { shouldDirty: true })
                }
              }}
              className="w-36"
            />
            <span className="text-sm text-text-muted">bps</span>
            {watch('default_slippage_bps') != null && (
              <>
                <span className="text-xs text-text-muted">
                  ({((watch('default_slippage_bps') as number) / 100).toFixed(2)}%)
                </span>
                {mode !== 'view' && (
                  <button
                    type="button"
                    className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline"
                    onClick={() => setValue('default_slippage_bps', null, { shouldDirty: true })}
                  >
                    Clear
                  </button>
                )}
              </>
            )}
          </div>
          <p className="text-xs text-text-muted">
            Members see this as the default max slippage in the market order ticket. Leave empty to use the platform
            default ({platformDefaultSlippageBps} bps). Per-order overrides in the terminal are capped at 500 bps (5%);
            this group value can exceed that cap.
          </p>
          {errors.default_slippage_bps && (
            <p className="text-sm text-danger">{String(errors.default_slippage_bps.message)}</p>
          )}
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

