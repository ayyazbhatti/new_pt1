import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Switch } from '@/shared/ui/Switch'
import { useModalStore } from '@/app/store'
import { toast } from 'react-hot-toast'
import { useState } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { SymbolMarket } from '../types/symbol'
import { leverageProfilesList } from '../mocks/leverageProfiles.mock'

const symbolSchema = z.object({
  code: z.string().min(1, 'Symbol code is required'),
  name: z.string().min(1, 'Display name is required'),
  market: z.enum(['crypto', 'forex', 'metals', 'indices', 'stocks']),
  provider: z.string().min(1, 'Data provider is required'),
  leverageProfileName: z.string().min(1, 'Leverage profile is required'),
  contractSize: z.number().min(0.0001, 'Contract size must be greater than 0'),
  tickSize: z.number().min(0.0001, 'Tick size must be greater than 0'),
  pricePrecision: z.number().min(0).max(8, 'Price precision must be between 0-8'),
  lotMin: z.number().min(0.0001, 'Min lot must be greater than 0'),
  lotMax: z.number().min(0.0001, 'Max lot must be greater than min lot'),
  commission: z.number().min(0).optional(),
  swapProfile: z.string().optional(),
  notes: z.string().optional(),
})

type SymbolFormData = z.infer<typeof symbolSchema>

export function AddSymbolModal() {
  const closeModal = useModalStore((state) => state.closeModal)
  const [status, setStatus] = useState(true)
  const [market, setMarket] = useState<SymbolMarket>('crypto')

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<SymbolFormData>({
    resolver: zodResolver(symbolSchema),
    defaultValues: {
      code: '',
      name: '',
      market: 'crypto',
      provider: 'Binance',
      leverageProfileName: '',
      contractSize: 1,
      tickSize: 0.01,
      pricePrecision: 2,
      lotMin: 0.01,
      lotMax: 100,
      commission: 0.1,
      swapProfile: '',
      notes: '',
    },
  })

  const provider = watch('provider')
  const leverageProfile = watch('leverageProfileName')
  const swapProfile = watch('swapProfile')

  const onSubmit = (data: SymbolFormData) => {
    toast.success(`Symbol "${data.code}" created successfully`)
    closeModal('add-symbol')
  }

  return (
    <Tabs.Root defaultValue="general" className="w-full">
      <Tabs.List className="flex border-b border-border mb-4">
        <Tabs.Trigger
          value="general"
          className="px-4 py-2 text-sm font-medium text-text-muted data-[state=active]:text-text data-[state=active]:border-b-2 data-[state=active]:border-accent"
        >
          General
        </Tabs.Trigger>
        <Tabs.Trigger
          value="trading"
          className="px-4 py-2 text-sm font-medium text-text-muted data-[state=active]:text-text data-[state=active]:border-b-2 data-[state=active]:border-accent"
        >
          Trading Settings
        </Tabs.Trigger>
        <Tabs.Trigger
          value="fees"
          className="px-4 py-2 text-sm font-medium text-text-muted data-[state=active]:text-text data-[state=active]:border-b-2 data-[state=active]:border-accent"
        >
          Fees & Swap
        </Tabs.Trigger>
      </Tabs.List>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Tabs.Content value="general" className="space-y-4">
          <div>
            <label className="text-sm font-medium text-text mb-2 block">Symbol Code</label>
            <Input {...register('code')} placeholder="e.g., BTCUSDT" />
            {errors.code && <p className="mt-1 text-sm text-danger">{errors.code.message}</p>}
          </div>
          <div>
            <label className="text-sm font-medium text-text mb-2 block">Display Name</label>
            <Input {...register('name')} placeholder="e.g., Bitcoin / Tether" />
            {errors.name && <p className="mt-1 text-sm text-danger">{errors.name.message}</p>}
          </div>
          <div>
            <label className="text-sm font-medium text-text mb-2 block">Market</label>
            <Select
              value={market}
              onValueChange={(value) => {
                setMarket(value as SymbolMarket)
                setValue('market', value as SymbolMarket)
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="crypto">Crypto</SelectItem>
                <SelectItem value="forex">Forex</SelectItem>
                <SelectItem value="metals">Metals</SelectItem>
                <SelectItem value="indices">Indices</SelectItem>
                <SelectItem value="stocks">Stocks</SelectItem>
              </SelectContent>
            </Select>
            {errors.market && <p className="mt-1 text-sm text-danger">{errors.market.message}</p>}
          </div>
          <div>
            <label className="text-sm font-medium text-text mb-2 block">Data Provider</label>
            <Select value={provider} onValueChange={(value) => setValue('provider', value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Binance">Binance</SelectItem>
                <SelectItem value="Coinbase">Coinbase</SelectItem>
                <SelectItem value="Kraken">Kraken</SelectItem>
                <SelectItem value="Other">Other</SelectItem>
              </SelectContent>
            </Select>
            {errors.provider && (
              <p className="mt-1 text-sm text-danger">{errors.provider.message}</p>
            )}
          </div>
          <div className="flex items-center justify-between py-2">
            <label className="text-sm font-medium text-text">Status</label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-muted">{status ? 'Enabled' : 'Disabled'}</span>
              <Switch checked={status} onCheckedChange={setStatus} />
            </div>
          </div>
        </Tabs.Content>

        <Tabs.Content value="trading" className="space-y-4">
          <div>
            <label className="text-sm font-medium text-text mb-2 block">Leverage Profile</label>
            <Select
              value={leverageProfile}
              onValueChange={(value) => setValue('leverageProfileName', value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select leverage profile" />
              </SelectTrigger>
              <SelectContent>
                {leverageProfilesList.map((profile) => (
                  <SelectItem key={profile} value={profile}>
                    {profile}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.leverageProfileName && (
              <p className="mt-1 text-sm text-danger">{errors.leverageProfileName.message}</p>
            )}
          </div>
          <div>
            <label className="text-sm font-medium text-text mb-2 block">Contract Size</label>
            <Input
              type="number"
              step="0.0001"
              {...register('contractSize', { valueAsNumber: true })}
            />
            {errors.contractSize && (
              <p className="mt-1 text-sm text-danger">{errors.contractSize.message}</p>
            )}
          </div>
          <div>
            <label className="text-sm font-medium text-text mb-2 block">Tick Size</label>
            <Input
              type="number"
              step="0.0001"
              {...register('tickSize', { valueAsNumber: true })}
            />
            {errors.tickSize && (
              <p className="mt-1 text-sm text-danger">{errors.tickSize.message}</p>
            )}
          </div>
          <div>
            <label className="text-sm font-medium text-text mb-2 block">Price Precision</label>
            <Input
              type="number"
              {...register('pricePrecision', { valueAsNumber: true })}
            />
            {errors.pricePrecision && (
              <p className="mt-1 text-sm text-danger">{errors.pricePrecision.message}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-text mb-2 block">Lot Min</label>
              <Input
                type="number"
                step="0.0001"
                {...register('lotMin', { valueAsNumber: true })}
              />
              {errors.lotMin && (
                <p className="mt-1 text-sm text-danger">{errors.lotMin.message}</p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium text-text mb-2 block">Lot Max</label>
              <Input
                type="number"
                step="0.0001"
                {...register('lotMax', { valueAsNumber: true })}
              />
              {errors.lotMax && (
                <p className="mt-1 text-sm text-danger">{errors.lotMax.message}</p>
              )}
            </div>
          </div>
        </Tabs.Content>

        <Tabs.Content value="fees" className="space-y-4">
          <div>
            <label className="text-sm font-medium text-text mb-2 block">Commission (%)</label>
            <Input
              type="number"
              step="0.01"
              {...register('commission', { valueAsNumber: true })}
            />
            {errors.commission && (
              <p className="mt-1 text-sm text-danger">{errors.commission.message}</p>
            )}
          </div>
          <div>
            <label className="text-sm font-medium text-text mb-2 block">Swap Profile (Optional)</label>
            <Select
              value={swapProfile}
              onValueChange={(value) => setValue('swapProfile', value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select swap profile" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">None</SelectItem>
                <SelectItem value="Standard Swap">Standard Swap</SelectItem>
                <SelectItem value="VIP Swap">VIP Swap</SelectItem>
                <SelectItem value="No Swap">No Swap</SelectItem>
                <SelectItem value="Islamic Swap">Islamic Swap</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium text-text mb-2 block">Notes</label>
            <textarea
              {...register('notes')}
              className="flex min-h-[80px] w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="Additional notes..."
            />
          </div>
        </Tabs.Content>

        <div className="flex justify-end gap-2 pt-4 border-t border-border">
          <Button
            type="button"
            variant="outline"
            onClick={() => closeModal('add-symbol')}
          >
            Cancel
          </Button>
          <Button type="submit">Create Symbol</Button>
        </div>
      </form>
    </Tabs.Root>
  )
}

