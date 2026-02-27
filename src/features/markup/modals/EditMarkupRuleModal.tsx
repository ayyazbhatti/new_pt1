import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Switch } from '@/shared/ui/Switch'
import { useModalStore } from '@/app/store'
import { toast } from '@/shared/components/common'
import { useState, useEffect } from 'react'
import { MarkupRule, MarkupType, ApplyTo } from '../types/markup'
import { mockGroups } from '@/features/groups/mocks/groups.mock'
import { mockSymbols } from '@/features/symbols/mocks/symbols.mock'

const markupRuleSchema = z.object({
  groupId: z.string().min(1, 'Group is required'),
  symbol: z.string().min(1, 'Symbol is required'),
  market: z.enum(['crypto', 'forex', 'commodities', 'indices', 'stocks']),
  markupType: z.enum(['fixed', 'percent', 'spread']),
  value: z.number().min(0, 'Value must be 0 or greater'),
  applyTo: z.enum(['bid', 'ask', 'both']),
  rounding: z.number().min(0).max(8, 'Rounding must be between 0-8'),
  minMarkup: z.number().optional(),
  maxMarkup: z.number().optional(),
  notes: z.string().optional(),
})

type MarkupRuleFormData = z.infer<typeof markupRuleSchema>

interface EditMarkupRuleModalProps {
  rule: MarkupRule
}

export function EditMarkupRuleModal({ rule }: EditMarkupRuleModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const [status, setStatus] = useState(rule.status === 'active')
  const [market, setMarket] = useState(rule.market)
  const [markupType, setMarkupType] = useState<MarkupType>(rule.markupType)
  const [applyTo, setApplyTo] = useState<ApplyTo>(rule.applyTo)

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<MarkupRuleFormData>({
    resolver: zodResolver(markupRuleSchema),
    defaultValues: {
      groupId: rule.groupId,
      symbol: rule.symbol,
      market: rule.market,
      markupType: rule.markupType,
      value: rule.value,
      applyTo: rule.applyTo,
      rounding: rule.rounding,
      minMarkup: rule.minMarkup,
      maxMarkup: rule.maxMarkup,
      notes: rule.notes,
    },
  })

  useEffect(() => {
    setStatus(rule.status === 'active')
    setMarket(rule.market)
    setMarkupType(rule.markupType)
    setApplyTo(rule.applyTo)
  }, [rule])

  const symbol = watch('symbol')
  const groupId = watch('groupId')

  const filteredSymbols = mockSymbols.filter((s) => s.market === market)

  const onSubmit = (data: MarkupRuleFormData) => {
    toast.success(`Markup rule updated for ${data.symbol}`)
    closeModal(`edit-rule-${rule.id}`)
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Group *</label>
        <Select value={groupId} onValueChange={(value) => setValue('groupId', value)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {mockGroups.map((group) => (
              <SelectItem key={group.id} value={group.id}>
                {group.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.groupId && <p className="mt-1 text-sm text-danger">{errors.groupId.message}</p>}
      </div>
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Market *</label>
        <Select
          value={market}
          onValueChange={(value) => {
            setMarket(value as typeof market)
            setValue('market', value as typeof market)
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="crypto">Crypto</SelectItem>
            <SelectItem value="forex">Forex</SelectItem>
            <SelectItem value="commodities">Commodities</SelectItem>
            <SelectItem value="indices">Indices</SelectItem>
            <SelectItem value="stocks">Stocks</SelectItem>
          </SelectContent>
        </Select>
        {errors.market && <p className="mt-1 text-sm text-danger">{errors.market.message}</p>}
      </div>
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Symbol *</label>
        <Select value={symbol} onValueChange={(value) => setValue('symbol', value)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {filteredSymbols.map((s) => (
              <SelectItem key={s.code} value={s.code}>
                {s.code} - {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.symbol && <p className="mt-1 text-sm text-danger">{errors.symbol.message}</p>}
      </div>
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Markup Type *</label>
        <Select
          value={markupType}
          onValueChange={(value) => {
            setMarkupType(value as MarkupType)
            setValue('markupType', value as MarkupType)
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fixed">Fixed</SelectItem>
            <SelectItem value="percent">Percent</SelectItem>
            <SelectItem value="spread">Spread</SelectItem>
          </SelectContent>
        </Select>
        {errors.markupType && <p className="mt-1 text-sm text-danger">{errors.markupType.message}</p>}
      </div>
      <div>
        <label className="text-sm font-medium text-text mb-2 block">
          Value * {markupType === 'percent' && '(%)'}
        </label>
        <Input
          type="number"
          step={markupType === 'percent' ? '0.01' : '0.1'}
          {...register('value', { valueAsNumber: true })}
        />
        {errors.value && <p className="mt-1 text-sm text-danger">{errors.value.message}</p>}
      </div>
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Apply To *</label>
        <Select
          value={applyTo}
          onValueChange={(value) => {
            setApplyTo(value as ApplyTo)
            setValue('applyTo', value as ApplyTo)
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="bid">Bid</SelectItem>
            <SelectItem value="ask">Ask</SelectItem>
            <SelectItem value="both">Both</SelectItem>
          </SelectContent>
        </Select>
        {errors.applyTo && <p className="mt-1 text-sm text-danger">{errors.applyTo.message}</p>}
      </div>
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Rounding (decimals) *</label>
        <Input
          type="number"
          {...register('rounding', { valueAsNumber: true })}
        />
        {errors.rounding && <p className="mt-1 text-sm text-danger">{errors.rounding.message}</p>}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium text-text mb-2 block">Min Markup (optional)</label>
          <Input
            type="number"
            step="0.1"
            {...register('minMarkup', { valueAsNumber: true })}
          />
        </div>
        <div>
          <label className="text-sm font-medium text-text mb-2 block">Max Markup (optional)</label>
          <Input
            type="number"
            step="0.1"
            {...register('maxMarkup', { valueAsNumber: true })}
          />
        </div>
      </div>
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Notes</label>
        <textarea
          {...register('notes')}
          className="flex min-h-[80px] w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50"
          placeholder="Additional notes..."
        />
      </div>
      <div className="flex items-center justify-between py-2">
        <label className="text-sm font-medium text-text">Status</label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-muted">{status ? 'Active' : 'Disabled'}</span>
          <Switch checked={status} onCheckedChange={setStatus} />
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-4 border-t border-border">
        <Button
          type="button"
          variant="outline"
          onClick={() => closeModal(`edit-rule-${rule.id}`)}
        >
          Cancel
        </Button>
        <Button type="submit">Save Changes</Button>
      </div>
    </form>
  )
}

