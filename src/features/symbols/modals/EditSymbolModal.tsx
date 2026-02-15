import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Switch } from '@/shared/ui/Switch'
import { Label } from '@/shared/ui/label'
// ModalShell is not needed here - ModalHost wraps the component
import { useModalStore } from '@/app/store'
import { AdminSymbol, AssetClass } from '../types/symbol'
import { useUpdateSymbol } from '../hooks/useSymbols'
import { useLeverageProfilesList } from '@/features/leverageProfiles/hooks/useLeverageProfiles'
import { Spinner } from '@/shared/ui/loading'
import { useEffect } from 'react'

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
  tick_size: z.string().nullable().optional().refine((val) => {
    if (!val || val === '') return true // Optional
    const num = parseFloat(val)
    return !isNaN(num) && num > 0
  }, 'Tick size must be a positive number'),
  lot_min: z.string().nullable().optional().refine((val) => {
    if (!val || val === '') return true // Optional
    const num = parseFloat(val)
    return !isNaN(num) && num > 0
  }, 'Lot min must be a positive number'),
  lot_max: z.string().nullable().optional().refine((val) => {
    if (!val || val === '') return true // Optional
    const num = parseFloat(val)
    return !isNaN(num) && num > 0
  }, 'Lot max must be a positive number'),
  default_pip_position: z.string().nullable().optional().refine((val) => {
    if (!val || val === '') return true // Optional
    const num = parseFloat(val)
    return !isNaN(num) && num > 0
  }, 'Default pip position must be a positive number'),
  pip_position_min: z.string().nullable().optional().refine((val) => {
    if (!val || val === '') return true // Optional
    const num = parseFloat(val)
    return !isNaN(num) && num > 0
  }, 'Pip position min must be a positive number'),
  pip_position_max: z.string().nullable().optional().refine((val) => {
    if (!val || val === '') return true // Optional
    const num = parseFloat(val)
    return !isNaN(num) && num > 0
  }, 'Pip position max must be a positive number'),
  is_enabled: z.boolean(),
  trading_enabled: z.boolean(),
  leverage_profile_id: z.string().nullable().optional(),
}).refine((data) => {
  // Validate lot_min < lot_max if both are provided
  if (data.lot_min && data.lot_max) {
    const min = parseFloat(data.lot_min)
    const max = parseFloat(data.lot_max)
    if (!isNaN(min) && !isNaN(max)) {
      return min < max
    }
  }
  return true
}, {
  message: 'Lot min must be less than lot max',
  path: ['lot_max'],
}).refine((data) => {
  // Validate pip_position_min < pip_position_max if both are provided
  if (data.pip_position_min && data.pip_position_max) {
    const min = parseFloat(data.pip_position_min)
    const max = parseFloat(data.pip_position_max)
    if (!isNaN(min) && !isNaN(max)) {
      return min < max
    }
  }
  return true
}, {
  message: 'Pip position min must be less than pip position max',
  path: ['pip_position_max'],
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

  // Defensive check: ensure symbol data exists
  if (!symbol) {
    return (
      <div className="p-4">
        <p className="text-danger">Error: Symbol data not available</p>
        <button onClick={() => closeModal(`edit-symbol-${symbol?.id || 'unknown'}`)} className="mt-2 px-4 py-2 bg-surface-2 rounded">
          Close
        </button>
      </div>
    )
  }

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<SymbolFormData>({
    resolver: zodResolver(symbolSchema),
    defaultValues: {
      symbol_code: symbol?.symbolCode || '',
      provider_symbol: symbol?.providerSymbol || symbol?.symbolCode?.toLowerCase() || '',
      asset_class: (symbol?.assetClass || 'FX') as AssetClass,
      base_currency: symbol?.baseCurrency || '',
      quote_currency: symbol?.quoteCurrency || '',
      price_precision: symbol?.pricePrecision || 2,
      volume_precision: symbol?.volumePrecision || 2,
      contract_size: symbol?.contractSize || '1',
      tick_size: symbol?.tickSize?.toString() || null,
      lot_min: symbol?.lotMin?.toString() || null,
      lot_max: symbol?.lotMax?.toString() || null,
      default_pip_position: symbol?.defaultPipPosition?.toString() || null,
      pip_position_min: symbol?.pipPositionMin?.toString() || null,
      pip_position_max: symbol?.pipPositionMax?.toString() || null,
      is_enabled: symbol?.isEnabled ?? true,
      trading_enabled: symbol?.tradingEnabled ?? true,
      leverage_profile_id: symbol?.leverageProfileId || null,
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

  const modalKey = readOnly ? `view-symbol-${symbol?.id || 'unknown'}` : `edit-symbol-${symbol?.id || 'unknown'}`

  // Debug: Log symbol data
  useEffect(() => {
    console.log('🔍 EditSymbolModal - Symbol data:', symbol)
    console.log('🔍 EditSymbolModal - Symbol fields:', {
      id: symbol?.id,
      symbolCode: symbol?.symbolCode,
      tickSize: symbol?.tickSize,
      lotMin: symbol?.lotMin,
      lotMax: symbol?.lotMax,
      contractSize: symbol?.contractSize,
    })
  }, [symbol])

  // Early return if symbol is missing critical data
  if (!symbol || !symbol.id || !symbol.symbolCode) {
    console.error('❌ EditSymbolModal - Missing symbol data:', symbol)
    return (
      <div className="p-4">
        <p className="text-danger mb-2">Error: Symbol data is incomplete</p>
        <p className="text-sm text-muted mb-4">
          Symbol ID: {symbol?.id || 'missing'}<br />
          Symbol Code: {symbol?.symbolCode || 'missing'}
        </p>
        <Button onClick={() => closeModal(modalKey)} variant="outline">
          Close
        </Button>
      </div>
    )
  }

  // ModalHost already wraps with ModalShell, so we just return the form content
  // The title is passed via props in openModal call
  return (
    <div className="space-y-4">
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

        <div className="grid grid-cols-3 gap-4">
          <div>
            <Label>
              Tick Size
              <span className="ml-1 text-xs text-muted" title="Minimum price movement (pip size). For EUR/USD: 0.0001">
                (ℹ️)
              </span>
            </Label>
            <Input
              type="number"
              step="0.00000001"
              {...register('tick_size')}
              disabled={readOnly || isSubmitting}
              placeholder="0.0001"
            />
            {errors.tick_size && (
              <p className="mt-1 text-sm text-danger">{errors.tick_size.message}</p>
            )}
          </div>
          <div>
            <Label>
              Lot Min
              <span className="ml-1 text-xs text-muted" title="Minimum lot size allowed (e.g., 0.01)">
                (ℹ️)
              </span>
            </Label>
            <Input
              type="number"
              step="0.01"
              {...register('lot_min')}
              disabled={readOnly || isSubmitting}
              placeholder="0.01"
            />
            {errors.lot_min && (
              <p className="mt-1 text-sm text-danger">{errors.lot_min.message}</p>
            )}
          </div>
          <div>
            <Label>
              Lot Max
              <span className="ml-1 text-xs text-muted" title="Maximum lot size allowed (e.g., 100)">
                (ℹ️)
              </span>
            </Label>
            <Input
              type="number"
              step="0.01"
              {...register('lot_max')}
              disabled={readOnly || isSubmitting}
              placeholder="100"
            />
            {errors.lot_max && (
              <p className="mt-1 text-sm text-danger">{errors.lot_max.message}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <Label>
              Default Pip Position
              <span className="ml-1 text-xs text-muted" title="Default pip position value suggested for this symbol (USD per pip)">
                (ℹ️)
              </span>
            </Label>
            <Input
              type="number"
              step="0.01"
              {...register('default_pip_position')}
              disabled={readOnly || isSubmitting}
              placeholder="5.00"
            />
            {errors.default_pip_position && (
              <p className="mt-1 text-sm text-danger">{errors.default_pip_position.message}</p>
            )}
          </div>
          <div>
            <Label>
              Pip Position Min
              <span className="ml-1 text-xs text-muted" title="Minimum allowed pip position for this symbol (USD per pip)">
                (ℹ️)
              </span>
            </Label>
            <Input
              type="number"
              step="0.01"
              {...register('pip_position_min')}
              disabled={readOnly || isSubmitting}
              placeholder="0.01"
            />
            {errors.pip_position_min && (
              <p className="mt-1 text-sm text-danger">{errors.pip_position_min.message}</p>
            )}
          </div>
          <div>
            <Label>
              Pip Position Max
              <span className="ml-1 text-xs text-muted" title="Maximum allowed pip position for this symbol (USD per pip)">
                (ℹ️)
              </span>
            </Label>
            <Input
              type="number"
              step="0.01"
              {...register('pip_position_max')}
              disabled={readOnly || isSubmitting}
              placeholder="1000.00"
            />
            {errors.pip_position_max && (
              <p className="mt-1 text-sm text-danger">{errors.pip_position_max.message}</p>
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
    </div>
  )
}
