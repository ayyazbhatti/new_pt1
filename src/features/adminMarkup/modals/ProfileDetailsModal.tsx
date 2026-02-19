import { useMemo, useState, useEffect } from 'react'
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

/** Local bid/ask per symbol so refetch never overwrites the field the user didn't edit */
function useLocalMarkups(symbolsWithMarkup: SymbolWithMarkup[]) {
  const [local, setLocal] = useState<Record<string, { bid: string; ask: string }>>({})

  // Seed from server only for symbolIds we don't have yet (never overwrite after user edit / refetch)
  useEffect(() => {
    if (symbolsWithMarkup.length === 0) return
    setLocal((prev) => {
      let next = prev
      for (const s of symbolsWithMarkup) {
        const key = s.symbolId
        if (key in prev) continue
        next = next === prev ? { ...prev } : next
        next[key] = { bid: s.bidMarkup, ask: s.askMarkup }
      }
      return next
    })
  }, [symbolsWithMarkup])

  return [local, setLocal] as const
}

export function ProfileDetailsModal({ profile }: ProfileDetailsModalProps) {
  const { data: symbols, isLoading: symbolsLoading } = useSymbolsList({ page_size: 1000 })
  const { data: overrides, isLoading: overridesLoading } = useSymbolOverrides(profile.id, true)
  const upsertOverride = useUpsertSymbolOverride()

  // Create symbol list with markup data from server
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

  const [localMarkups, setLocalMarkups] = useLocalMarkups(symbolsWithMarkup)

  // Debounced save: send both bid and ask so server never overwrites the other field
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
    500
  )

  const handleBidMarkupChange = (symbolId: string, value: string) => {
    const current = localMarkups[symbolId] ?? { bid: '0', ask: '0' }
    setLocalMarkups((prev) => ({ ...prev, [symbolId]: { ...current, bid: value } }))
    debouncedSave(symbolId, value, current.ask)
  }

  const handleAskMarkupChange = (symbolId: string, value: string) => {
    const current = localMarkups[symbolId] ?? { bid: '0', ask: '0' }
    setLocalMarkups((prev) => ({ ...prev, [symbolId]: { ...current, ask: value } }))
    debouncedSave(symbolId, current.bid, value)
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
        const local = localMarkups[symbol.symbolId]
        const bidValue = local?.bid ?? symbol.bidMarkup
        const isSaving = upsertOverride.isPending
        return (
          <div className="flex items-center gap-2">
            <Input
              type="number"
              step="0.01"
              value={bidValue}
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
        const local = localMarkups[symbol.symbolId]
        const askValue = local?.ask ?? symbol.askMarkup
        const isSaving = upsertOverride.isPending
        return (
          <div className="flex items-center gap-2">
            <Input
              type="number"
              step="0.01"
              value={askValue}
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

