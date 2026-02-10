import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Switch } from '@/shared/ui/Switch'
import { Label } from '@/shared/ui/label'
import { ModalShell } from '@/shared/ui/modal'
import { useModalStore } from '@/app/store'
import { AdminSymbol, AssetClass } from '../types/symbol'
import { useUpdateSymbol } from '../hooks/useSymbols'
import { useLeverageProfilesList } from '@/features/leverageProfiles/hooks/useLeverageProfiles'
import { Spinner } from '@/shared/ui/loading'

const symbolSchema = z.object({
  symbol_code: z.string().min(2, 'Symbol code must be at least 2 characters').max(50),
  provider_symbol: z.string().min(1, 'Provider symbol is required'),
  asset_class: z.enum(['FX', 'Crypto', 'Metals', 'Indices', 'Stocks', 'Commodities']),
  base_currency: z.string().min(1, 'Base currency is required').max(10),
  quote_currency: z.string().min(1, 'Quote currency is required').max(10),
  price_precision: z.number().min(0).max(10),
  volume_precision: z.number().min(0).max(10),
  contract_size: z.string().refine((val) => {
    const num = parseFloat(val)
    return !isNaN(num) && num > 0
  }, 'Contract size must be a positive number'),
  is_enabled: z.boolean(),
  trading_enabled: z.boolean(),
  leverage_profile_id: z.string().nullable().optional(),
})

type SymbolFormData = z.infer<typeof symbolSchema>

interface EditSymbolModalProps {
  symbol: AdminSymbol
  readOnly?: boolean
}

export function EditSymbolModal({ symbol, readOnly = false }: EditSymbolModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const updateSymbol = useUpdateSymbol()
  const { data: leverageProfiles } = useLeverageProfilesList()

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<SymbolFormData>({
    resolver: zodResolver(symbolSchema),
    defaultValues: {
      symbol_code: symbol.symbolCode,
      provider_symbol: symbol.providerSymbol || symbol.symbolCode.toLowerCase(),
      asset_class: (symbol.assetClass || 'FX') as AssetClass,
      base_currency: symbol.baseCurrency,
      quote_currency: symbol.quoteCurrency,
      price_precision: symbol.pricePrecision,
      volume_precision: symbol.volumePrecision,
      contract_size: symbol.contractSize,
      is_enabled: symbol.isEnabled,
      trading_enabled: symbol.tradingEnabled,
      leverage_profile_id: symbol.leverageProfileId || null,
    },
  })

  const onSubmit = async (data: SymbolFormData) => {
    try {
      await updateSymbol.mutateAsync({
        id: symbol.id,
        payload: data,
      })
      closeModal(`edit-symbol-${symbol.id}`)
    } catch (error) {
      // Error handled by hook
    }
  }

  const modalKey = readOnly ? `view-symbol-${symbol.id}` : `edit-symbol-${symbol.id}`

  return (
    <ModalShell
      title={readOnly ? `View Symbol - ${symbol.symbolCode}` : 'Edit Symbol'}
      onClose={() => closeModal(modalKey)}
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Symbol Code</Label>
            <Input {...register('symbol_code')} disabled={readOnly || isSubmitting} />
            {errors.symbol_code && (
              <p className="mt-1 text-sm text-danger">{errors.symbol_code.message}</p>
            )}
          </div>
          <div>
            <Label>Provider Symbol</Label>
            <Input {...register('provider_symbol')} disabled={readOnly || isSubmitting} />
            {errors.provider_symbol && (
              <p className="mt-1 text-sm text-danger">{errors.provider_symbol.message}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Asset Class</Label>
            <Select
              value={watch('asset_class')}
              onValueChange={(value) => setValue('asset_class', value as AssetClass)}
              disabled={readOnly || isSubmitting}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="FX">FX</SelectItem>
                <SelectItem value="Crypto">Crypto</SelectItem>
                <SelectItem value="Metals">Metals</SelectItem>
                <SelectItem value="Indices">Indices</SelectItem>
                <SelectItem value="Stocks">Stocks</SelectItem>
                <SelectItem value="Commodities">Commodities</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Leverage Profile</Label>
            <Select
              value={watch('leverage_profile_id') || 'none'}
              onValueChange={(value) =>
                setValue('leverage_profile_id', value === 'none' ? null : value)
              }
              disabled={readOnly || isSubmitting}
            >
              <SelectTrigger>
                <SelectValue placeholder="No profile" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No Profile</SelectItem>
                {leverageProfiles?.items.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Base Currency</Label>
            <Input {...register('base_currency')} disabled={readOnly || isSubmitting} />
            {errors.base_currency && (
              <p className="mt-1 text-sm text-danger">{errors.base_currency.message}</p>
            )}
          </div>
          <div>
            <Label>Quote Currency</Label>
            <Input {...register('quote_currency')} disabled={readOnly || isSubmitting} />
            {errors.quote_currency && (
              <p className="mt-1 text-sm text-danger">{errors.quote_currency.message}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <Label>Price Precision</Label>
            <Input
              type="number"
              {...register('price_precision', { valueAsNumber: true })}
              disabled={readOnly || isSubmitting}
            />
            {errors.price_precision && (
              <p className="mt-1 text-sm text-danger">{errors.price_precision.message}</p>
            )}
          </div>
          <div>
            <Label>Volume Precision</Label>
            <Input
              type="number"
              {...register('volume_precision', { valueAsNumber: true })}
              disabled={readOnly || isSubmitting}
            />
            {errors.volume_precision && (
              <p className="mt-1 text-sm text-danger">{errors.volume_precision.message}</p>
            )}
          </div>
          <div>
            <Label>Contract Size</Label>
            <Input {...register('contract_size')} disabled={readOnly || isSubmitting} />
            {errors.contract_size && (
              <p className="mt-1 text-sm text-danger">{errors.contract_size.message}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Switch
              checked={watch('is_enabled')}
              onCheckedChange={(checked) => setValue('is_enabled', checked)}
              disabled={readOnly || isSubmitting}
            />
            <Label>Enabled (Streaming)</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={watch('trading_enabled')}
              onCheckedChange={(checked) => setValue('trading_enabled', checked)}
              disabled={readOnly || isSubmitting}
            />
            <Label>Trading Enabled</Label>
          </div>
        </div>

        {!readOnly && (
          <div className="flex justify-end gap-2 pt-4 border-t border-border">
            <Button
              type="button"
              variant="outline"
              onClick={() => closeModal(modalKey)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Spinner className="h-4 w-4" /> : 'Save Changes'}
            </Button>
          </div>
        )}
      </form>
    </ModalShell>
  )
}
