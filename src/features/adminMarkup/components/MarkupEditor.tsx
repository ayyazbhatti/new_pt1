import { useState, useMemo } from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/shared/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Input } from '@/shared/ui/input'
import { Badge } from '@/shared/ui/badge'
import { useMarkupProfiles, useSymbolOverrides, useUpsertSymbolOverride } from '../hooks/useMarkup'
import { useSymbolsList } from '@/features/symbols/hooks/useSymbols'
import { SymbolWithMarkup } from '../types/markup'
import { Spinner } from '@/shared/ui/loading'
import { Save, AlertCircle } from 'lucide-react'
import { useDebouncedCallback } from '@/shared/hooks/useDebounce'

export function MarkupEditor() {
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const { data: profiles, isLoading: profilesLoading } = useMarkupProfiles()
  const { data: symbols, isLoading: symbolsLoading } = useSymbolsList({ page_size: 1000 })
  const { data: overrides, isLoading: overridesLoading } = useSymbolOverrides(selectedProfileId, !!selectedProfileId)
  const upsertOverride = useUpsertSymbolOverride()

  const selectedProfile = useMemo(() => {
    return profiles?.find((p) => p.id === selectedProfileId) || null
  }, [profiles, selectedProfileId])

  // Create symbol list with markup data
  const symbolsWithMarkup = useMemo<SymbolWithMarkup[]>(() => {
    if (!symbols?.items || !selectedProfile) return []

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
  }, [symbols, selectedProfile, overrides])

  // Debounced save function
  const debouncedSave = useDebouncedCallback(
    (symbolId: string, bidMarkup: string, askMarkup: string) => {
      if (!selectedProfileId) return

      upsertOverride.mutate({
        profileId: selectedProfileId,
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
    if (!selectedProfileId) return

    const symbol = symbolsWithMarkup.find((s) => s.symbolId === symbolId)
    if (!symbol) return

    const newSymbols = symbolsWithMarkup.map((s) =>
      s.symbolId === symbolId ? { ...s, bidMarkup: value, isOverride: true } : s
    )

    // Update local state immediately for instant UI feedback
    // The actual save is debounced
    debouncedSave(symbolId, value, symbol.askMarkup)
  }

  const handleAskMarkupChange = (symbolId: string, value: string) => {
    if (!selectedProfileId) return

    const symbol = symbolsWithMarkup.find((s) => s.symbolId === symbolId)
    if (!symbol) return

    // Update local state immediately for instant UI feedback
    debouncedSave(symbolId, symbol.bidMarkup, value)
  }

  const isLoading = profilesLoading || symbolsLoading || overridesLoading

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
              disabled={!selectedProfileId || isSaving}
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
              disabled={!selectedProfileId || isSaving}
            />
            <span className="text-xs text-text-muted">%</span>
          </div>
        )
      },
    },
  ]

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner className="h-8 w-8" />
      </div>
    )
  }

  if (!profiles || profiles.length === 0) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="h-12 w-12 mx-auto text-text-muted mb-4" />
        <p className="text-text-muted">No markup profiles found. Create a profile first.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="w-64">
          <label className="text-sm font-medium text-text mb-2 block">Select Profile</label>
          <Select value={selectedProfileId || ''} onValueChange={setSelectedProfileId}>
            <SelectTrigger>
              <SelectValue placeholder="Select a profile" />
            </SelectTrigger>
            <SelectContent>
              {profiles.map((profile) => (
                <SelectItem key={profile.id} value={profile.id}>
                  {profile.name} {profile.groupName && `(${profile.groupName})`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {upsertOverride.isPending && (
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <Spinner className="h-4 w-4" />
            <span>Saving...</span>
          </div>
        )}
      </div>

      {selectedProfileId && symbolsWithMarkup.length > 0 && (
        <div className="border border-border rounded-lg">
          <DataTable data={symbolsWithMarkup} columns={columns} />
        </div>
      )}

      {selectedProfileId && symbolsWithMarkup.length === 0 && (
        <div className="text-center py-12 text-text-muted">
          No symbols found. Import symbols first.
        </div>
      )}

      {!selectedProfileId && (
        <div className="text-center py-12 text-text-muted">
          Select a profile to edit symbol markups
        </div>
      )}
    </div>
  )
}

