import { useMemo } from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/shared/ui/table'
import { Input } from '@/shared/ui/input'
import { Badge } from '@/shared/ui/badge'
import { useSymbolOverrides, useUpsertSymbolOverride } from '../hooks/useMarkup'
import { useSymbolsList } from '@/features/symbols/hooks/useSymbols'
import { MarkupProfile, SymbolWithMarkup } from '../types/markup'
import { Spinner } from '@/shared/ui/loading'
import { useDebouncedCallback } from '@/shared/hooks/useDebounce'

interface ProfileDetailsModalProps {
  profile: MarkupProfile
}

export function ProfileDetailsModal({ profile }: ProfileDetailsModalProps) {
  const { data: symbols, isLoading: symbolsLoading } = useSymbolsList({ page_size: 1000 })
  const { data: overrides, isLoading: overridesLoading } = useSymbolOverrides(profile.id, true)
  const upsertOverride = useUpsertSymbolOverride()

  // Create symbol list with markup data
  const symbolsWithMarkup = useMemo<SymbolWithMarkup[]>(() => {
    if (!symbols?.items) return []

    const overrideMap = new Map(
      overrides?.map((o) => [o.symbolId, { bid: o.bidMarkup, ask: o.askMarkup }]) || []
    )

    return symbols.items.map((symbol) => {
      const override = overrideMap.get(symbol.id)
      return {
        symbolId: symbol.id,
        symbolCode: symbol.symbolCode,
        baseCurrency: symbol.baseCurrency,
        quoteCurrency: symbol.quoteCurrency,
        bidMarkup: override?.bid ?? '0',
        askMarkup: override?.ask ?? '0',
        isOverride: !!override,
      }
    })
  }, [symbols, profile, overrides])

  // Debounced save function
  const debouncedSave = useDebouncedCallback(
    (symbolId: string, bidMarkup: string, askMarkup: string) => {
      upsertOverride.mutate({
        profileId: profile.id,
        symbolId,
        payload: {
          bid_markup: bidMarkup,
          ask_markup: askMarkup,
        },
      })
    },
    500 // 500ms debounce
  )

  const handleBidMarkupChange = (symbolId: string, value: string) => {
    const symbol = symbolsWithMarkup.find((s) => s.symbolId === symbolId)
    if (!symbol) return
    debouncedSave(symbolId, value, symbol.askMarkup)
  }

  const handleAskMarkupChange = (symbolId: string, value: string) => {
    const symbol = symbolsWithMarkup.find((s) => s.symbolId === symbolId)
    if (!symbol) return
    debouncedSave(symbolId, symbol.bidMarkup, value)
  }

  const formatMarkup = (value: string) => {
    const num = parseFloat(value)
    return `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`
  }

  const columns: ColumnDef<SymbolWithMarkup>[] = [
    {
      accessorKey: 'symbolCode',
      header: 'Symbol',
      cell: ({ row }) => {
        const symbol = row.original
        return (
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold">{symbol.symbolCode}</span>
            {symbol.isOverride && (
              <Badge variant="warning" className="text-xs">
                Override
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
          <span className="font-mono text-sm text-text-muted">
            {symbol.baseCurrency}/{symbol.quoteCurrency}
          </span>
        )
      },
    },
    {
      accessorKey: 'bidMarkup',
      header: 'Bid Markup',
      cell: ({ row }) => {
        const symbol = row.original
        const isSaving = upsertOverride.isPending
        return (
          <div className="flex items-center gap-2">
            <Input
              type="number"
              step="0.01"
              value={symbol.bidMarkup}
              onChange={(e) => handleBidMarkupChange(symbol.symbolId, e.target.value)}
              className="w-24 font-mono text-sm"
              disabled={isSaving}
            />
            <span className="text-xs text-text-muted">%</span>
          </div>
        )
      },
    },
    {
      accessorKey: 'askMarkup',
      header: 'Ask Markup',
      cell: ({ row }) => {
        const symbol = row.original
        const isSaving = upsertOverride.isPending
        return (
          <div className="flex items-center gap-2">
            <Input
              type="number"
              step="0.01"
              value={symbol.askMarkup}
              onChange={(e) => handleAskMarkupChange(symbol.symbolId, e.target.value)}
              className="w-24 font-mono text-sm"
              disabled={isSaving}
            />
            <span className="text-xs text-text-muted">%</span>
          </div>
        )
      },
    },
  ]

  return (
    <div className="flex flex-col min-h-0">
      <h3 className="text-sm font-semibold text-text shrink-0 mb-3">Symbol Markups</h3>
      {symbolsLoading || overridesLoading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner className="h-8 w-8" />
        </div>
      ) : symbolsWithMarkup.length > 0 ? (
        <div className="flex flex-col min-h-0 overflow-hidden">
          <p className="text-sm text-text-muted shrink-0 mb-3">
            Set bid/ask markup (%) per symbol. Changes save automatically.
          </p>
          {upsertOverride.isPending && (
            <div className="flex items-center gap-2 text-sm text-text-muted shrink-0 mb-2">
              <Spinner className="h-4 w-4" />
              <span>Saving...</span>
            </div>
          )}
          <div className="overflow-auto min-h-0 max-h-[70vh]">
            <DataTable data={symbolsWithMarkup} columns={columns} dense bordered={false} className="space-y-0" />
          </div>
        </div>
      ) : (
        <div className="text-center py-12 text-text-muted">
          No symbols found. Import symbols first.
        </div>
      )}
    </div>
  )
}

