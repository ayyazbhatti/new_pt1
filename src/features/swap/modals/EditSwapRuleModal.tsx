import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Switch } from '@/shared/ui/Switch'
import { useModalStore } from '@/app/store'
import { toast } from 'react-hot-toast'
import { useState, useEffect } from 'react'
import { SwapRule, SwapCalcMode, SwapUnit, WeekendRule } from '../types/swap'
import { mockGroups } from '@/features/groups/mocks/groups.mock'
import { swapSymbols } from '../mocks/symbols.mock'

const swapRuleSchema = z.object({
  groupId: z.string().min(1, 'Group is required'),
  symbol: z.string().min(1, 'Symbol is required'),
  market: z.enum(['crypto', 'forex', 'commodities', 'indices', 'stocks']),
  calcMode: z.enum(['daily', 'hourly', 'funding_8h']),
  unit: z.enum(['percent', 'fixed']),
  longRate: z.number(),
  shortRate: z.number(),
  rolloverTimeUtc: z.string().min(1, 'Rollover time is required'),
  tripleDay: z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']).optional(),
  weekendRule: z.enum(['none', 'triple_day', 'fri_triple', 'custom']),
  minCharge: z.number().optional(),
  maxCharge: z.number().optional(),
  notes: z.string().optional(),
})

type SwapRuleFormData = z.infer<typeof swapRuleSchema>

interface EditSwapRuleModalProps {
  rule: SwapRule
}

export function EditSwapRuleModal({ rule }: EditSwapRuleModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const [status, setStatus] = useState(rule.status === 'active')
  const [market, setMarket] = useState(rule.market)
  const [calcMode, setCalcMode] = useState<SwapCalcMode>(rule.calcMode)
  const [unit, setUnit] = useState<SwapUnit>(rule.unit)
  const [weekendRule, setWeekendRule] = useState<WeekendRule>(rule.weekendRule)
  const [tripleDay, setTripleDay] = useState(rule.tripleDay)

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<SwapRuleFormData>({
    resolver: zodResolver(swapRuleSchema),
    defaultValues: {
      groupId: rule.groupId,
      symbol: rule.symbol,
      market: rule.market,
      calcMode: rule.calcMode,
      unit: rule.unit,
      longRate: rule.longRate,
      shortRate: rule.shortRate,
      rolloverTimeUtc: rule.rolloverTimeUtc,
      tripleDay: rule.tripleDay,
      weekendRule: rule.weekendRule,
      minCharge: rule.minCharge,
      maxCharge: rule.maxCharge,
      notes: rule.notes,
    },
  })

  useEffect(() => {
    setStatus(rule.status === 'active')
    setMarket(rule.market)
    setCalcMode(rule.calcMode)
    setUnit(rule.unit)
    setWeekendRule(rule.weekendRule)
    setTripleDay(rule.tripleDay)
  }, [rule])

  const symbol = watch('symbol')
  const groupId = watch('groupId')

  const filteredSymbols = swapSymbols.filter((s) => s.market === market)

  const onSubmit = (data: SwapRuleFormData) => {
    toast.success(`Swap rule updated for ${data.symbol}`)
    closeModal(`edit-swap-${rule.id}`)
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
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
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium text-text mb-2 block">Calc Mode *</label>
          <Select
            value={calcMode}
            onValueChange={(value) => {
              setCalcMode(value as SwapCalcMode)
              setValue('calcMode', value as SwapCalcMode)
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="hourly">Hourly</SelectItem>
              <SelectItem value="funding_8h">8H Funding</SelectItem>
            </SelectContent>
          </Select>
          {errors.calcMode && <p className="mt-1 text-sm text-danger">{errors.calcMode.message}</p>}
        </div>
        <div>
          <label className="text-sm font-medium text-text mb-2 block">Unit *</label>
          <Select
            value={unit}
            onValueChange={(value) => {
              setUnit(value as SwapUnit)
              setValue('unit', value as SwapUnit)
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="percent">Percent</SelectItem>
              <SelectItem value="fixed">Fixed</SelectItem>
            </SelectContent>
          </Select>
          {errors.unit && <p className="mt-1 text-sm text-danger">{errors.unit.message}</p>}
        </div>
      </div>
      <div className="border-t border-border pt-4">
        <div className="text-sm font-semibold text-text mb-3">Rates</div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-text mb-2 block">
              Long Rate * {unit === 'percent' && '(%)'}
            </label>
            <Input
              type="number"
              step={unit === 'percent' ? '0.001' : '0.1'}
              {...register('longRate', { valueAsNumber: true })}
            />
            {unit === 'percent' && (
              <p className="mt-1 text-xs text-text-muted">Example: 0.02 means 0.02%</p>
            )}
            {errors.longRate && (
              <p className="mt-1 text-sm text-danger">{errors.longRate.message}</p>
            )}
          </div>
          <div>
            <label className="text-sm font-medium text-text mb-2 block">
              Short Rate * {unit === 'percent' && '(%)'}
            </label>
            <Input
              type="number"
              step={unit === 'percent' ? '0.001' : '0.1'}
              {...register('shortRate', { valueAsNumber: true })}
            />
            {unit === 'percent' && (
              <p className="mt-1 text-xs text-text-muted">Example: -0.05 means -0.05%</p>
            )}
            {errors.shortRate && (
              <p className="mt-1 text-sm text-danger">{errors.shortRate.message}</p>
            )}
          </div>
        </div>
      </div>
      <div className="border-t border-border pt-4">
        <div className="text-sm font-semibold text-text mb-3">Schedule</div>
        <div>
          <label className="text-sm font-medium text-text mb-2 block">Rollover Time (UTC) *</label>
          <Input
            type="time"
            {...register('rolloverTimeUtc')}
          />
          {errors.rolloverTimeUtc && (
            <p className="mt-1 text-sm text-danger">{errors.rolloverTimeUtc.message}</p>
          )}
        </div>
        <div className="mt-4">
          <label className="text-sm font-medium text-text mb-2 block">Weekend Rule *</label>
          <Select
            value={weekendRule}
            onValueChange={(value) => {
              setWeekendRule(value as WeekendRule)
              setValue('weekendRule', value as WeekendRule)
              if (value !== 'triple_day') {
                setTripleDay(undefined)
                setValue('tripleDay', undefined)
              }
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="triple_day">Triple Day</SelectItem>
              <SelectItem value="fri_triple">Friday Triple</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
          {errors.weekendRule && (
            <p className="mt-1 text-sm text-danger">{errors.weekendRule.message}</p>
          )}
        </div>
        {weekendRule === 'triple_day' && (
          <div className="mt-4">
            <label className="text-sm font-medium text-text mb-2 block">Triple Day *</label>
            <Select
              value={tripleDay || 'wed'}
              onValueChange={(value) => {
                setTripleDay(value as typeof tripleDay)
                setValue('tripleDay', value as typeof tripleDay)
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mon">Monday</SelectItem>
                <SelectItem value="tue">Tuesday</SelectItem>
                <SelectItem value="wed">Wednesday</SelectItem>
                <SelectItem value="thu">Thursday</SelectItem>
                <SelectItem value="fri">Friday</SelectItem>
                <SelectItem value="sat">Saturday</SelectItem>
                <SelectItem value="sun">Sunday</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      <div className="border-t border-border pt-4">
        <div className="text-sm font-semibold text-text mb-3">Clamps (Optional)</div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-text mb-2 block">Min Charge</label>
            <Input
              type="number"
              step="0.1"
              {...register('minCharge', { valueAsNumber: true })}
            />
          </div>
          <div>
            <label className="text-sm font-medium text-text mb-2 block">Max Charge</label>
            <Input
              type="number"
              step="0.1"
              {...register('maxCharge', { valueAsNumber: true })}
            />
          </div>
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
          onClick={() => closeModal(`edit-swap-${rule.id}`)}
        >
          Cancel
        </Button>
        <Button type="submit">Save Changes</Button>
      </div>
    </form>
  )
}

