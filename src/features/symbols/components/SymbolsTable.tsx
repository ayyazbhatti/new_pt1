import { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/shared/ui/table'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Switch } from '@/shared/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { AdminSymbol } from '../types/symbol'
import { useModalStore } from '@/app/store'
import { EditSymbolModal } from '../modals/EditSymbolModal'
import { SymbolGroupMarkupsModal } from '../modals/SymbolGroupMarkupsModal'
import { Eye, Edit, Trash2, TrendingUp, Info } from 'lucide-react'
import { useToggleSymbolEnabled, useDeleteSymbol } from '../hooks/useSymbols'
import { useLeverageProfilesList } from '@/features/leverageProfiles/hooks/useLeverageProfiles'
import { useUpdateSymbol } from '../hooks/useSymbols'
import { toast } from 'react-hot-toast'
import { PriceCell } from './PriceCell'
import { usePriceStream } from '../hooks/usePriceStream'
import { useMemo, useEffect, useCallback } from 'react'

interface SymbolsTableProps {
  symbols: AdminSymbol[]
  total: number
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}

const assetClassBadgeColors: Record<string, 'primary' | 'success' | 'warning' | 'info'> = {
  Crypto: 'primary',
  FX: 'success',
  Metals: 'warning',
  Indices: 'info',
  Stocks: 'primary',
  Commodities: 'warning',
}

export function SymbolsTable({
  symbols,
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: SymbolsTableProps) {
  const openModal = useModalStore((state) => state.openModal)
  const toggleEnabled = useToggleSymbolEnabled()
  const deleteSymbol = useDeleteSymbol()
  const updateSymbol = useUpdateSymbol()
  const { data: leverageProfiles } = useLeverageProfilesList()

  // Get all symbol codes for price streaming (use provider symbol or symbol code, uppercase)
  const symbolCodes = useMemo(() => {
    const codes = symbols
      .map((s) => (s.providerSymbol || s.symbolCode).toUpperCase())
      .filter((code) => code && code.length > 0)
    console.log('📋 SymbolsTable: Symbol codes to subscribe:', codes)
    console.log('📋 SymbolsTable: Symbols data:', symbols.map(s => ({ 
      code: s.symbolCode, 
      provider: s.providerSymbol,
      final: (s.providerSymbol || s.symbolCode).toUpperCase()
    })))
    return codes
  }, [symbols])

  // Subscribe to price stream for current page symbols
  const { isConnected } = usePriceStream(symbolCodes)
  
  // Debug: Log connection status
  useEffect(() => {
    console.log('🔌 SymbolsTable: WebSocket connection status:', isConnected, '| Symbols:', symbolCodes)
  }, [isConnected, symbolCodes.join(',')])

  // Memoize handlers to prevent re-renders on price updates
  const handleView = useCallback((symbol: AdminSymbol) => {
    openModal(`view-symbol-${symbol.id}`, <EditSymbolModal symbol={symbol} readOnly />, {
      title: `View Symbol - ${symbol.symbolCode}`,
      size: 'lg',
    })
  }, [openModal])

  const handleEdit = useCallback((symbol: AdminSymbol) => {
    openModal(`edit-symbol-${symbol.id}`, <EditSymbolModal symbol={symbol} />, {
      title: 'Edit Symbol',
      size: 'lg',
    })
  }, [openModal])

  const handleGroupMarkups = useCallback((symbol: AdminSymbol) => {
    openModal(`group-markups-${symbol.id}`, <SymbolGroupMarkupsModal symbol={symbol} />, {
      title: `Group Markups - ${symbol.symbolCode}`,
      size: 'xl',
    })
  }, [openModal])

  const handleToggleEnabled = useCallback(async (symbol: AdminSymbol) => {
    try {
      await toggleEnabled.mutateAsync({
        id: symbol.id,
        isEnabled: !symbol.isEnabled,
      })
    } catch (error) {
      // Error handled by hook
    }
  }, [toggleEnabled])

  const handleLeverageProfileChange = useCallback(async (symbol: AdminSymbol, profileId: string | null) => {
    try {
      await updateSymbol.mutateAsync({
        id: symbol.id,
        payload: {
          symbol_code: symbol.symbolCode,
          provider_symbol: symbol.providerSymbol || symbol.symbolCode.toLowerCase(),
          asset_class: symbol.assetClass || 'FX',
          base_currency: symbol.baseCurrency,
          quote_currency: symbol.quoteCurrency,
          price_precision: symbol.pricePrecision,
          volume_precision: symbol.volumePrecision,
          contract_size: symbol.contractSize,
          is_enabled: symbol.isEnabled,
          trading_enabled: symbol.tradingEnabled,
          leverage_profile_id: profileId,
        },
      })
    } catch (error) {
      // Error handled by hook
    }
  }, [updateSymbol])

  const handleDelete = useCallback(async (symbol: AdminSymbol) => {
    if (confirm(`Are you sure you want to delete symbol "${symbol.symbolCode}"?`)) {
      try {
        await deleteSymbol.mutateAsync(symbol.id)
      } catch (error) {
        // Error handled by hook
      }
    }
  }, [deleteSymbol])


  // Memoize columns to prevent re-renders when only prices change
  const columns: ColumnDef<AdminSymbol>[] = useMemo(() => [
    {
      accessorKey: 'symbolCode',
      header: 'Symbol',
      cell: ({ row }) => {
        const symbol = row.original
        return (
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold">{symbol.symbolCode}</span>
            {symbol.assetClass && (
              <Badge
                variant={assetClassBadgeColors[symbol.assetClass] || 'neutral'}
                className="text-xs"
              >
                {symbol.assetClass}
              </Badge>
            )}
          </div>
        )
      },
    },
    {
      accessorKey: 'baseCurrency',
      header: 'Currency Pair',
      cell: ({ row }) => {
        const symbol = row.original
        return (
          <span className="font-mono text-sm">
            {symbol.baseCurrency}/{symbol.quoteCurrency}
          </span>
        )
      },
    },
    {
      id: 'livePrice',
      header: (
        <div className="flex items-center gap-2">
          <span>Live Price</span>
          {isConnected ? (
            <Badge variant="success" className="text-xs">
              Live
            </Badge>
          ) : (
            <Badge variant="neutral" className="text-xs">
              Offline
            </Badge>
          )}
        </div>
      ),
      // Stable cell renderer - PriceCell is memoized internally
      cell: ({ row }) => {
        const symbol = row.original
        // Use provider symbol if available, otherwise use symbol code
        // Data provider expects uppercase symbols
        const symbolCode = (symbol.providerSymbol || symbol.symbolCode).toUpperCase()
        // PriceCell is memoized, so it only re-renders when its own price updates
        return <PriceCell symbol={symbolCode} />
      },
      // Enable cell-level memoization in TanStack Table
      enableSorting: false,
    },
    {
      accessorKey: 'providerSymbol',
      header: 'Provider Symbol',
      cell: ({ row }) => {
        const providerSymbol = row.getValue('providerSymbol') as string | null
        return <span className="font-mono text-sm text-text-muted">{providerSymbol || '-'}</span>
      },
    },
    {
      accessorKey: 'leverageProfileName',
      header: 'Leverage Profile',
      cell: ({ row }) => {
        const symbol = row.original
        return (
          <Select
            value={symbol.leverageProfileId || 'none'}
            onValueChange={(value) =>
              handleLeverageProfileChange(symbol, value === 'none' ? null : value)
            }
            disabled={updateSymbol.isPending}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select profile" />
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
        )
      },
    },
    {
      accessorKey: 'contractSize',
      header: 'Contract Size',
      cell: ({ row }) => {
        const size = row.getValue('contractSize') as string
        return <span className="font-mono text-sm">{size}</span>
      },
    },
    {
      id: 'tickSize',
      header: () => (
        <div className="flex items-center gap-1">
          <span>Tick Size</span>
          <Info className="h-3 w-3 text-text-muted" title="Minimum price movement (pip size)" />
        </div>
      ),
      cell: ({ row }) => {
        const symbol = row.original
        const tickSize = symbol.tickSize
        return (
          <span className="font-mono text-sm">
            {tickSize !== null && tickSize !== undefined ? tickSize.toFixed(8).replace(/\.?0+$/, '') : '-'}
          </span>
        )
      },
    },
    {
      id: 'lotMin',
      header: () => (
        <div className="flex items-center gap-1">
          <span>Lot Min</span>
          <Info className="h-3 w-3 text-text-muted" title="Minimum lot size allowed" />
        </div>
      ),
      cell: ({ row }) => {
        const symbol = row.original
        const lotMin = symbol.lotMin
        return (
          <span className="font-mono text-sm">
            {lotMin !== null && lotMin !== undefined ? lotMin.toFixed(2) : '-'}
          </span>
        )
      },
    },
    {
      id: 'lotMax',
      header: () => (
        <div className="flex items-center gap-1">
          <span>Lot Max</span>
          <Info className="h-3 w-3 text-text-muted" title="Maximum lot size allowed" />
        </div>
      ),
      cell: ({ row }) => {
        const symbol = row.original
        const lotMax = symbol.lotMax
        return (
          <span className="font-mono text-sm">
            {lotMax !== null && lotMax !== undefined ? lotMax.toFixed(2) : '-'}
          </span>
        )
      },
    },
    {
      id: 'defaultPipPosition',
      header: () => (
        <div className="flex items-center gap-1">
          <span>Default Pip Pos</span>
          <Info className="h-3 w-3 text-text-muted" title="Default pip position value suggested for this symbol (USD per pip)" />
        </div>
      ),
      cell: ({ row }) => {
        const symbol = row.original
        const defaultPipPosition = symbol.defaultPipPosition
        return (
          <span className="font-mono text-sm">
            {defaultPipPosition !== null && defaultPipPosition !== undefined ? `$${defaultPipPosition.toFixed(2)}` : '-'}
          </span>
        )
      },
    },
    {
      id: 'pipPositionMin',
      header: () => (
        <div className="flex items-center gap-1">
          <span>Pip Pos Min</span>
          <Info className="h-3 w-3 text-text-muted" title="Minimum allowed pip position for this symbol (USD per pip)" />
        </div>
      ),
      cell: ({ row }) => {
        const symbol = row.original
        const pipPositionMin = symbol.pipPositionMin
        return (
          <span className="font-mono text-sm">
            {pipPositionMin !== null && pipPositionMin !== undefined ? `$${pipPositionMin.toFixed(2)}` : '-'}
          </span>
        )
      },
    },
    {
      id: 'pipPositionMax',
      header: () => (
        <div className="flex items-center gap-1">
          <span>Pip Pos Max</span>
          <Info className="h-3 w-3 text-text-muted" title="Maximum allowed pip position for this symbol (USD per pip)" />
        </div>
      ),
      cell: ({ row }) => {
        const symbol = row.original
        const pipPositionMax = symbol.pipPositionMax
        return (
          <span className="font-mono text-sm">
            {pipPositionMax !== null && pipPositionMax !== undefined ? `$${pipPositionMax.toFixed(2)}` : '-'}
          </span>
        )
      },
    },
    {
      id: 'precision',
      header: 'Precision',
      cell: ({ row }) => {
        const symbol = row.original
        return (
          <span className="text-sm text-text-muted">
            Price: {symbol.pricePrecision} | Vol: {symbol.volumePrecision}
          </span>
        )
      },
    },
    {
      accessorKey: 'isEnabled',
      header: 'Enabled',
      cell: ({ row }) => {
        const symbol = row.original
        return (
          <div className="flex items-center gap-2">
            <Switch
              checked={symbol.isEnabled}
              onCheckedChange={() => handleToggleEnabled(symbol)}
              disabled={toggleEnabled.isPending}
            />
            <Badge variant={symbol.isEnabled ? 'success' : 'danger'} className="text-xs">
              {symbol.isEnabled ? 'Enabled' : 'Disabled'}
            </Badge>
          </div>
        )
      },
    },
    {
      accessorKey: 'tradingEnabled',
      header: 'Trading',
      cell: ({ row }) => {
        const tradingEnabled = row.getValue('tradingEnabled') as boolean
        return (
          <Badge variant={tradingEnabled ? 'success' : 'danger'} className="text-xs">
            {tradingEnabled ? 'Enabled' : 'Disabled'}
          </Badge>
        )
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const symbol = row.original
        return (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => handleView(symbol)} title="View">
              <Eye className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => handleEdit(symbol)} title="Edit">
              <Edit className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleGroupMarkups(symbol)}
              title="Group Markups"
            >
              <TrendingUp className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleDelete(symbol)}
              title="Delete"
              className="text-danger hover:text-danger"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )
      },
    },
  ], [
    isConnected,
    handleView,
    handleEdit,
    handleGroupMarkups,
    handleDelete,
    handleToggleEnabled,
    handleLeverageProfileChange,
    leverageProfiles,
    updateSymbol.isPending,
    toggleEnabled.isPending,
  ])

  return (
    <DataTable
      data={symbols}
      columns={columns}
      pagination={{
        page,
        pageSize,
        total,
        onPageChange,
        onPageSizeChange,
      }}
    />
  )
}
