import { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/shared/ui/table'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Switch } from '@/shared/ui/Switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { AdminSymbol } from '../types/symbol'
import { useModalStore } from '@/app/store'
import { EditSymbolModal } from '../modals/EditSymbolModal'
import { SymbolGroupMarkupsModal } from '../modals/SymbolGroupMarkupsModal'
import { Eye, Edit, Trash2, TrendingUp, Info, Loader2 } from 'lucide-react'
import { useToggleSymbolEnabled, useBulkToggleSymbolsEnabled, useDeleteSymbol } from '../hooks/useSymbols'
import { useLeverageProfilesList } from '@/features/leverageProfiles/hooks/useLeverageProfiles'
import { useUpdateSymbol } from '../hooks/useSymbols'
import { useCanAccess } from '@/shared/utils/permissions'
import { toast } from '@/shared/components/common'
import { PriceCell } from './PriceCell'
import { usePriceStreamConnection } from '../hooks/usePriceStream'
import { useMemo, useCallback, useState, useEffect } from 'react'
import { Checkbox } from '@/shared/ui/Checkbox'
import { normalizeSymbolKey } from '@/shared/utils/symbolKeyNormalize'

const BULK_TOGGLE_MAX = 500

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
  const canEdit = useCanAccess('symbols:edit')
  const canDelete = useCanAccess('symbols:delete')
  const toggleEnabled = useToggleSymbolEnabled()
  const bulkToggleEnabled = useBulkToggleSymbolsEnabled()
  const deleteSymbol = useDeleteSymbol()
  const updateSymbol = useUpdateSymbol()
  const { data: leverageProfiles, isLoading: leverageProfilesLoading } = useLeverageProfilesList({ page_size: 500 })

  // Get all symbol codes for price streaming (use provider symbol or symbol code, uppercase)
  const symbolCodes = useMemo(() => {
    return symbols
      .map((s) => normalizeSymbolKey((s.providerSymbol || s.symbolCode).toUpperCase()))
      .filter((code) => code && code.length > 0)
  }, [symbols])

  // Subscribe to price stream (connection only – no state on tick, so table doesn't re-render when prices change)
  const { isConnected } = usePriceStreamConnection(symbolCodes)

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const rowIdsKey = useMemo(() => symbols.map((s) => s.id).join(','), [symbols])
  useEffect(() => {
    setSelectedIds(new Set())
  }, [page, rowIdsKey])

  /** Drives DataTable row re-renders when bulk selection changes (row memo skips if only `row.original` is stable). */
  const selectionRowMemoExtra = useMemo(() => [...selectedIds].sort().join(','), [selectedIds])

  const selectedOnPageCount = useMemo(
    () => symbols.filter((s) => selectedIds.has(s.id)).length,
    [symbols, selectedIds]
  )
  const allOnPageSelected = symbols.length > 0 && symbols.every((s) => selectedIds.has(s.id))
  const someOnPageSelected = symbols.some((s) => selectedIds.has(s.id))

  const toggleSelectAllOnPage = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allOnPageSelected) {
        symbols.forEach((s) => next.delete(s.id))
      } else {
        symbols.forEach((s) => next.add(s.id))
      }
      return next
    })
  }, [symbols, allOnPageSelected])

  const toggleRowSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleBulkSetEnabled = useCallback(
    async (isEnabled: boolean) => {
      const ids = symbols.filter((s) => selectedIds.has(s.id)).map((s) => s.id)
      if (ids.length === 0) return
      if (ids.length > BULK_TOGGLE_MAX) {
        toast.error(`Select at most ${BULK_TOGGLE_MAX} symbols per bulk action`)
        return
      }
      if (!isEnabled && !confirm(`Disable ${ids.length} symbol(s)?`)) return
      try {
        await bulkToggleEnabled.mutateAsync({ ids, isEnabled })
        setSelectedIds(new Set())
      } catch {
        /* toast in hook */
      }
    },
    [symbols, selectedIds, bulkToggleEnabled]
  )

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
  const columns = useMemo(() => [
    {
      id: 'bulkSelect',
      size: 40,
      header: () =>
        canEdit ? (
          <span data-no-row-click className="inline-flex pl-1" onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={allOnPageSelected}
              indeterminate={someOnPageSelected && !allOnPageSelected}
              onChange={toggleSelectAllOnPage}
              aria-label="Select all on this page"
            />
          </span>
        ) : (
          <span className="w-4" />
        ),
      cell: ({ row }) => {
        const symbol = row.original
        return (
          <span data-no-row-click className="inline-flex pl-1" onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={selectedIds.has(symbol.id)}
              onChange={() => toggleRowSelected(symbol.id)}
              disabled={!canEdit || bulkToggleEnabled.isPending || toggleEnabled.isPending}
              aria-label={`Select ${symbol.symbolCode}`}
            />
          </span>
        )
      },
    },
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
      id: 'bid',
      header: (
        <div className="flex items-center gap-2">
          <span>Bid</span>
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
      cell: ({ row }) => {
        const symbol = row.original
        const symbolCode = normalizeSymbolKey((symbol.providerSymbol || symbol.symbolCode).toUpperCase())
        return <PriceCell symbol={symbolCode} variant="bid" />
      },
      enableSorting: false,
    },
    {
      id: 'ask',
      header: 'Ask',
      cell: ({ row }) => {
        const symbol = row.original
        const symbolCode = normalizeSymbolKey((symbol.providerSymbol || symbol.symbolCode).toUpperCase())
        return <PriceCell symbol={symbolCode} variant="ask" />
      },
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
        const profileId = symbol.leverageProfileId != null ? String(symbol.leverageProfileId) : null
        const value = profileId ?? 'none'
        const profileIds = new Set((leverageProfiles?.items ?? []).map((p) => String(p.id)))
        const hasCurrentInList = profileId != null && profileIds.has(profileId)
        const selectedProfile = leverageProfiles?.items?.find((p) => String(p.id) === profileId)
        const displayLabel =
          value === 'none'
            ? 'No Profile'
            : (selectedProfile?.name ?? symbol.leverageProfileName ?? 'Unknown profile')
        if (leverageProfilesLoading) {
          return (
            <div className="flex h-10 w-[180px] items-center rounded-lg border border-border bg-surface-1 px-3 py-2">
              <span className="text-sm text-text-muted">Loading...</span>
            </div>
          )
        }
        return (
          <Select
            key={`${symbol.id}-${leverageProfiles?.items?.length ?? 0}`}
            value={value}
            onValueChange={(v) =>
              handleLeverageProfileChange(symbol, v === 'none' ? null : v)
            }
            disabled={!canEdit || updateSymbol.isPending}
          >
            <SelectTrigger className="w-[180px]">
              <span className="truncate">{displayLabel}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No Profile</SelectItem>
              {profileId && !hasCurrentInList && (
                <SelectItem value={profileId} key={profileId}>
                  {symbol.leverageProfileName ?? 'Unknown profile'}
                </SelectItem>
              )}
              {leverageProfiles?.items?.map((profile) => (
                <SelectItem key={profile.id} value={String(profile.id)}>
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
          <span title="Minimum price movement (pip size)"><Info className="h-3 w-3 text-text-muted" /></span>
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
          <span title="Minimum lot size allowed"><Info className="h-3 w-3 text-text-muted" /></span>
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
          <span title="Maximum lot size allowed"><Info className="h-3 w-3 text-text-muted" /></span>
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
          <span title="Default pip position value suggested for this symbol (USD per pip)"><Info className="h-3 w-3 text-text-muted" /></span>
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
          <span title="Minimum allowed pip position for this symbol (USD per pip)"><Info className="h-3 w-3 text-text-muted" /></span>
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
          <span title="Maximum allowed pip position for this symbol (USD per pip)"><Info className="h-3 w-3 text-text-muted" /></span>
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
              disabled={!canEdit || toggleEnabled.isPending}
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
            {canEdit && (
              <>
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
              </>
            )}
            {canDelete && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDelete(symbol)}
                title="Delete"
                className="text-danger hover:text-danger"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        )
      },
    },
  ], [
    isConnected,
    canEdit,
    canDelete,
    handleView,
    handleEdit,
    handleGroupMarkups,
    handleDelete,
    handleToggleEnabled,
    handleLeverageProfileChange,
    leverageProfiles,
    leverageProfilesLoading,
    updateSymbol.isPending,
    toggleEnabled.isPending,
    bulkToggleEnabled.isPending,
    selectedIds,
    allOnPageSelected,
    someOnPageSelected,
    toggleSelectAllOnPage,
    toggleRowSelected,
  ]) as ColumnDef<AdminSymbol>[]

  return (
    <div className="space-y-3">
      {canEdit && selectedOnPageCount > 0 && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-2/60 px-3 py-2.5 text-sm"
          data-no-row-click
        >
          <span className="text-text-muted font-medium">
            {selectedOnPageCount} selected
          </span>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={bulkToggleEnabled.isPending}
            onClick={() => handleBulkSetEnabled(true)}
          >
            {bulkToggleEnabled.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : null}
            Enable
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={bulkToggleEnabled.isPending}
            onClick={() => handleBulkSetEnabled(false)}
          >
            Disable
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
            Clear
          </Button>
        </div>
      )}
    <DataTable
      data={symbols}
      columns={columns}
      rowMemoExtra={selectionRowMemoExtra}
      pagination={{
        page,
        pageSize,
        total,
        onPageChange,
        onPageSizeChange,
      }}
    />
    </div>
  )
}
