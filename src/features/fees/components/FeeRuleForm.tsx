import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Label } from '@/shared/ui/label'
import { useGroupsList } from '@/features/groups/hooks/useGroups'
import type { FeeRule, FeeRuleMarket } from '../types/feeRule'
import { useCreateFeeRule, useUpdateFeeRule } from '../hooks/useFeeRules'
import { Spinner } from '@/shared/ui/loading'

/** Radix Select.Item cannot use `value=""` (empty string is reserved for clearing). */
const MARKET_SELECT_ANY = '__fee_rule_market_any__'

const markets: { value: FeeRuleMarket; label: string }[] = [
  { value: 'crypto', label: 'Crypto' },
  { value: 'forex', label: 'Forex' },
  { value: 'commodities', label: 'Commodities' },
  { value: 'indices', label: 'Indices' },
  { value: 'stocks', label: 'Stocks' },
]

const schema = z.object({
  groupId: z.string().min(1, 'Group is required'),
  symbol: z.string().optional(),
  market: z.enum(['', 'crypto', 'forex', 'commodities', 'indices', 'stocks']),
  feeBps: z.coerce.number().min(0, 'Min 0 bps').max(10000, 'Max 10000 bps (100%)'),
  minFee: z.coerce.number().min(0, 'Min fee must be >= 0'),
  maxFee: z.coerce.number().optional().nullable(),
  status: z.enum(['active', 'disabled']),
  notes: z.string().optional(),
})

type FormData = z.infer<typeof schema>

export interface FeeRuleFormProps {
  mode: 'create' | 'edit'
  initial?: FeeRule
  onDone: () => void
}

export function FeeRuleForm({ mode, initial, onDone }: FeeRuleFormProps) {
  const { data: groupsData } = useGroupsList()
  const groups = groupsData?.items ?? []
  const createRule = useCreateFeeRule()
  const updateRule = useUpdateFeeRule()

  const defaultBps =
    mode === 'edit' && initial ? Math.round(initial.feePercent * 10000 * 1000) / 1000 : 5

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      groupId: initial?.groupId ?? '',
      symbol: initial?.symbol ?? '',
      market: (initial?.market ?? '') as FormData['market'],
      feeBps: defaultBps,
      minFee: initial?.minFee ?? 0,
      maxFee: initial?.maxFee ?? undefined,
      status: initial?.status ?? 'active',
      notes: initial?.notes ?? '',
    },
  })

  const onSubmit = async (data: FormData) => {
    const feePercent = data.feeBps / 10000
    const symbolTrim = data.symbol?.trim()
    const marketVal = data.market === '' ? null : (data.market as FeeRuleMarket)

    if (mode === 'create') {
      await createRule.mutateAsync({
        groupId: data.groupId,
        symbol: symbolTrim ? symbolTrim : null,
        market: marketVal,
        feePercent,
        minFee: data.minFee,
        maxFee: data.maxFee != null && !Number.isNaN(data.maxFee) ? data.maxFee : null,
        status: data.status,
        notes: data.notes?.trim() ? data.notes.trim() : null,
      })
    } else if (initial) {
      await updateRule.mutateAsync({
        id: initial.id,
        payload: {
          groupId: data.groupId,
          symbol: symbolTrim ? symbolTrim : null,
          market: marketVal,
          feePercent,
          minFee: data.minFee,
          maxFee: data.maxFee != null && !Number.isNaN(data.maxFee) ? data.maxFee : null,
          status: data.status,
          notes: data.notes?.trim() ? data.notes.trim() : null,
        },
      })
    }
    onDone()
  }

  const busy = isSubmitting || createRule.isPending || updateRule.isPending

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label>Group *</Label>
        <Select
          value={watch('groupId')}
          onValueChange={(v) => setValue('groupId', v)}
          disabled={busy || mode === 'edit'}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select group" />
          </SelectTrigger>
          <SelectContent>
            {groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.groupId && <p className="text-sm text-danger">{errors.groupId.message}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="fee_symbol">Symbol (optional)</Label>
        <Input
          id="fee_symbol"
          placeholder="Empty = all symbols in group"
          disabled={busy}
          {...register('symbol')}
        />
      </div>

      <div className="space-y-2">
        <Label>Market (optional)</Label>
        <Select
          value={watch('market') === '' ? MARKET_SELECT_ANY : watch('market')}
          onValueChange={(v) =>
            setValue('market', (v === MARKET_SELECT_ANY ? '' : v) as FormData['market'])
          }
          disabled={busy}
        >
          <SelectTrigger>
            <SelectValue placeholder="Any market" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={MARKET_SELECT_ANY}>Any market</SelectItem>
            {markets.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="fee_bps">Fee (basis points) *</Label>
        <Input id="fee_bps" type="number" min={0} max={10000} step={0.001} disabled={busy} {...register('feeBps')} />
        <p className="text-xs text-text-muted">5 bps = 0.05% of notional. Sent to API as fee_percent = bps ÷ 10,000.</p>
        {errors.feeBps && <p className="text-sm text-danger">{errors.feeBps.message}</p>}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="min_fee">Min fee (USD) *</Label>
          <Input id="min_fee" type="number" min={0} step={0.01} disabled={busy} {...register('minFee')} />
          {errors.minFee && <p className="text-sm text-danger">{errors.minFee.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="max_fee">Max fee (USD, optional)</Label>
          <Input
            id="max_fee"
            type="number"
            min={0}
            step={0.01}
            disabled={busy}
            {...register('maxFee', { setValueAs: (v) => (v === '' || v == null ? undefined : Number(v)) })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Status</Label>
        <Select
          value={watch('status')}
          onValueChange={(v) => setValue('status', v as 'active' | 'disabled')}
          disabled={busy}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="disabled">Disabled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="fee_notes">Notes</Label>
        <textarea
          id="fee_notes"
          className="flex h-20 w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent disabled:opacity-50 resize-none"
          disabled={busy}
          {...register('notes')}
        />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? (
            <>
              <Spinner className="mr-2 h-4 w-4" />
              Saving…
            </>
          ) : mode === 'create' ? (
            'Create'
          ) : (
            'Save'
          )}
        </Button>
      </div>
    </form>
  )
}
