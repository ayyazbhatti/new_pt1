import { useMemo, useState, useCallback, useEffect } from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { useModalStore } from '@/app/store'
import { useSymbolOverrides, useUpsertSymbolOverride } from '../hooks/useMarkup'
import { useSymbolsList } from '@/features/symbols/hooks/useSymbols'
import { usePriceStream, normalizeSymbolKey } from '@/features/symbols/hooks/usePriceStream'
import { DataTable } from '@/shared/ui/table'
import { MarkupProfile, SymbolWithMarkup } from '../types/markup'
import { X, Search, RotateCcw, ArrowRightLeft, Save } from 'lucide-react'
import { toast } from '@/shared/components/common'
import { TransferMarkupsModal } from './TransferMarkupsModal'

interface ConfigureMarkupsModalProps {
  stream: MarkupProfile
}

function formatPrice(value: number): string {
  return value >= 1 ? value.toFixed(2) : value.toFixed(6)
}

/** Input that keeps local state while typing and only commits to parent on blur to avoid re-renders blocking typing */
function MarkupInput({
  value,
  onCommit,
  className,
  placeholder,
  onKeyDown,
}: {
  value: string
  onCommit: (v: string) => void
  className?: string
  placeholder?: string
  onKeyDown?: (e: React.KeyboardEvent) => void
}) {
  const [local, setLocal] = useState(value)
  useEffect(() => {
    setLocal(value)
  }, [value])
  return (
    <input
      type="text"
      inputMode="decimal"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => onCommit(local)}
      onKeyDown={onKeyDown}
      className={className}
      placeholder={placeholder}
    />
  )
}

export function ConfigureMarkupsModal({ stream }: ConfigureMarkupsModalProps) {
  const openModal = useModalStore((state) => state.openModal)
  const closeModal = useModalStore((state) => state.closeModal)
  const modalKey = `configure-markups-${stream.id}`

  const { data: symbolsData } = useSymbolsList({ page_size: 1000 })
  const { data: overrides, isLoading: overridesLoading } = useSymbolOverrides(
    stream.id,
    true
  )
  const upsertOverride = useUpsertSymbolOverride()

  const symbolCodes = useMemo(() => {
    return (symbolsData?.items ?? []).map((s) => s.symbolCode)
  }, [symbolsData])

  const { prices } = usePriceStream(symbolCodes)
  const [search, setSearch] = useState('')
  const [localMarkups, setLocalMarkups] = useState<
    Record<string, { bid: string; ask: string }>
  >({})

  const symbolsWithMarkup = useMemo<SymbolWithMarkup[]>(() => {
    const items = symbolsData?.items ?? []
    const overrideMap = new Map(
      overrides?.map((o) => [o.symbolId, { bid: o.bidMarkup, ask: o.askMarkup }]) ?? []
    )
    return items.map((symbol) => {
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
  }, [symbolsData, overrides])

  useEffect(() => {
    setLocalMarkups((prev) => {
      let changed = false
      const next = { ...prev }
      for (const s of symbolsWithMarkup) {
        if (!(s.symbolId in next)) {
          next[s.symbolId] = { bid: s.bidMarkup, ask: s.askMarkup }
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [symbolsWithMarkup])

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term)
      return symbolsWithMarkup
    return symbolsWithMarkup.filter(
      (s) =>
        s.symbolCode.toLowerCase().includes(term) ||
        s.baseCurrency?.toLowerCase().includes(term) ||
        s.quoteCurrency?.toLowerCase().includes(term)
    )
  }, [symbolsWithMarkup, search])

  const tableData = useMemo(
    () =>
      filteredRows.map((r) => ({
        ...r,
        id: r.symbolId,
        localBid: localMarkups[r.symbolId]?.bid ?? r.bidMarkup,
        localAsk: localMarkups[r.symbolId]?.ask ?? r.askMarkup,
      })),
    [filteredRows, localMarkups]
  )

  const handleBidChange = useCallback(
    (symbolId: string, delta: number) => {
      const cur = localMarkups[symbolId] ?? { bid: '0', ask: '0' }
      const next = (parseFloat(cur.bid) || 0) + delta
      const clamped = Math.max(-50, Math.min(50, next))
      const str = clamped.toFixed(1)
      setLocalMarkups((p) => ({ ...p, [symbolId]: { ...cur, bid: str } }))
    },
    [localMarkups]
  )

  const handleAskChange = useCallback(
    (symbolId: string, delta: number) => {
      const cur = localMarkups[symbolId] ?? { bid: '0', ask: '0' }
      const next = (parseFloat(cur.ask) || 0) + delta
      const clamped = Math.max(-50, Math.min(50, next))
      const str = clamped.toFixed(1)
      setLocalMarkups((p) => ({ ...p, [symbolId]: { ...cur, ask: str } }))
    },
    [localMarkups]
  )

  const handleReset = useCallback((symbolId: string) => {
    setLocalMarkups((p) => ({
      ...p,
      [symbolId]: { bid: '0', ask: '0' },
    }))
  }, [])

  const [isSaving, setIsSaving] = useState(false)
  const handleSave = useCallback(async () => {
    const toSave = symbolsWithMarkup
      .map((s) => ({
        symbolId: s.symbolId,
        bid: localMarkups[s.symbolId]?.bid ?? s.bidMarkup,
        ask: localMarkups[s.symbolId]?.ask ?? s.askMarkup,
      }))
      .filter(
        (x) => {
          const s = symbolsWithMarkup.find((r) => r.symbolId === x.symbolId)!
          return x.bid !== s.bidMarkup || x.ask !== s.askMarkup
        }
      )
    if (toSave.length === 0) return
    setIsSaving(true)
    try {
      await Promise.all(
        toSave.map(({ symbolId, bid, ask }) =>
          upsertOverride.mutateAsync({
            profileId: stream.id,
            symbolId,
            payload: { bid_markup: bid, ask_markup: ask },
            silent: true,
          })
        )
      )
      toast.success('Markups saved', { duration: 2000 })
    } catch {
      // Error already handled by mutation
    } finally {
      setIsSaving(false)
    }
  }, [symbolsWithMarkup, localMarkups, stream.id, upsertOverride])

  const openTransferMarkups = useCallback(
    (source: SymbolWithMarkup) => {
      openModal(
        `transfer-markups-${stream.id}-${source.symbolId}`,
        <TransferMarkupsModal
          stream={stream}
          sourceSymbol={source}
          allSymbols={symbolsWithMarkup}
          onClose={() =>
            closeModal(`transfer-markups-${stream.id}-${source.symbolId}`)
          }
        />,
        { title: '', size: 'md' }
      )
    },
    [stream, symbolsWithMarkup, openModal, closeModal]
  )

  const columns: ColumnDef<SymbolWithMarkup>[] = useMemo(
    () => [
      {
        id: 'symbol',
        size: 100,
        header: 'Symbol',
        cell: ({ row }) => {
          const s = row.original
          return (
            <div>
              <span className="font-medium text-text block">{s.symbolCode}</span>
              <span className="text-sm text-text-muted">
                {s.baseCurrency}/{s.quoteCurrency}
              </span>
            </div>
          )
        },
      },
      {
        id: 'liveBid',
        size: 82,
        header: 'Live Bid',
        cell: ({ row }) => {
          const live = prices.get(normalizeSymbolKey(row.original.symbolCode))
          const n = live ? parseFloat(live.bid) : NaN
          if (!live) return <span className="text-text-muted text-sm">N/A</span>
          return (
            <span className="text-green-600 dark:text-green-400 font-mono text-sm">
              {formatPrice(n)}
            </span>
          )
        },
      },
      {
        id: 'liveAsk',
        size: 82,
        header: 'Live Ask',
        cell: ({ row }) => {
          const live = prices.get(normalizeSymbolKey(row.original.symbolCode))
          const n = live ? parseFloat(live.ask) : NaN
          if (!live) return <span className="text-text-muted text-sm">N/A</span>
          return (
            <span className="text-red-600 dark:text-red-400 font-mono text-sm">
              {formatPrice(n)}
            </span>
          )
        },
      },
      {
        id: 'bidAfter',
        size: 88,
        header: 'Bid (after)',
        cell: ({ row }) => {
          const s = row.original
          const live = prices.get(normalizeSymbolKey(s.symbolCode))
          const bidPct = localMarkups[s.symbolId]?.bid ?? s.bidMarkup
          const liveBid = live ? parseFloat(live.bid) : NaN
          const after =
            !Number.isNaN(liveBid) && liveBid !== 0
              ? liveBid * (1 + (parseFloat(bidPct) || 0) / 100)
              : NaN
          if (Number.isNaN(after))
            return <span className="text-text-muted text-sm">—</span>
          return (
            <span className="text-green-600 dark:text-green-300 font-mono text-sm">
              {formatPrice(after)}
            </span>
          )
        },
      },
      {
        id: 'askAfter',
        size: 88,
        header: 'Ask (after)',
        cell: ({ row }) => {
          const s = row.original
          const live = prices.get(normalizeSymbolKey(s.symbolCode))
          const askPct = localMarkups[s.symbolId]?.ask ?? s.askMarkup
          const liveAsk = live ? parseFloat(live.ask) : NaN
          const after =
            !Number.isNaN(liveAsk) && liveAsk !== 0
              ? liveAsk * (1 + (parseFloat(askPct) || 0) / 100)
              : NaN
          if (Number.isNaN(after))
            return <span className="text-text-muted text-sm">—</span>
          return (
            <span className="text-red-600 dark:text-red-300 font-mono text-sm">
              {formatPrice(after)}
            </span>
          )
        },
      },
      {
        id: 'bidPct',
        size: 112,
        header: 'Bid %',
        cell: ({ row }) => {
          const s = row.original
          const bidPct = localMarkups[s.symbolId]?.bid ?? s.bidMarkup
          const cur = localMarkups[s.symbolId] ?? { bid: '0', ask: '0' }
          return (
            <div className="relative inline-flex items-center" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => handleBidChange(s.symbolId, -0.1)}
                className="absolute left-1 h-6 w-6 flex items-center justify-center text-text-muted hover:text-accent text-sm"
              >
                −
              </button>
              <MarkupInput
                value={bidPct}
                onCommit={(v) =>
                  setLocalMarkups((p) => ({
                    ...p,
                    [s.symbolId]: { ...(p[s.symbolId] ?? { bid: '0', ask: '0' }), bid: v },
                  }))
                }
                onKeyDown={(e) => e.stopPropagation()}
                className="w-20 sm:w-24 pl-6 pr-6 py-1.5 bg-surface-2 border border-border rounded text-text text-sm focus:ring-1 focus:ring-accent"
                placeholder="0.0"
              />
              <button
                type="button"
                onClick={() => handleBidChange(s.symbolId, 0.1)}
                className="absolute right-1 h-6 w-6 flex items-center justify-center text-text-muted hover:text-accent text-sm"
              >
                +
              </button>
            </div>
          )
        },
      },
      {
        id: 'askPct',
        size: 112,
        header: 'Ask %',
        cell: ({ row }) => {
          const s = row.original
          const askPct = localMarkups[s.symbolId]?.ask ?? s.askMarkup
          const cur = localMarkups[s.symbolId] ?? { bid: '0', ask: '0' }
          return (
            <div className="relative inline-flex items-center" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => handleAskChange(s.symbolId, -0.1)}
                className="absolute left-1 h-6 w-6 flex items-center justify-center text-text-muted hover:text-accent text-sm"
              >
                −
              </button>
              <MarkupInput
                value={askPct}
                onCommit={(v) =>
                  setLocalMarkups((p) => ({
                    ...p,
                    [s.symbolId]: { ...(p[s.symbolId] ?? { bid: '0', ask: '0' }), ask: v },
                  }))
                }
                onKeyDown={(e) => e.stopPropagation()}
                className="w-20 sm:w-24 pl-6 pr-6 py-1.5 bg-surface-2 border border-border rounded text-text text-sm focus:ring-1 focus:ring-accent"
                placeholder="0.0"
              />
              <button
                type="button"
                onClick={() => handleAskChange(s.symbolId, 0.1)}
                className="absolute right-1 h-6 w-6 flex items-center justify-center text-text-muted hover:text-accent text-sm"
              >
                +
              </button>
            </div>
          )
        },
      },
      {
        id: 'spread',
        size: 88,
        header: 'Preview Spread',
        cell: ({ row }) => {
          const s = row.original
          const live = prices.get(normalizeSymbolKey(s.symbolCode))
          const bidPct = localMarkups[s.symbolId]?.bid ?? s.bidMarkup
          const askPct = localMarkups[s.symbolId]?.ask ?? s.askMarkup
          const liveBid = live ? parseFloat(live.bid) : NaN
          const liveAsk = live ? parseFloat(live.ask) : NaN
          const bidAfter =
            !Number.isNaN(liveBid) && liveBid !== 0
              ? liveBid * (1 + (parseFloat(bidPct) || 0) / 100)
              : NaN
          const askAfter =
            !Number.isNaN(liveAsk) && liveAsk !== 0
              ? liveAsk * (1 + (parseFloat(askPct) || 0) / 100)
              : NaN
          const spreadPct =
            !Number.isNaN(bidAfter) && !Number.isNaN(askAfter) && bidAfter > 0
              ? (((askAfter - bidAfter) / bidAfter) * 100).toFixed(1)
              : '0.0'
          return <span className="text-sm text-text-muted">{spreadPct}%</span>
        },
      },
      {
        id: 'actions',
        size: 72,
        header: 'Actions',
        cell: ({ row }) => {
          const s = row.original
          return (
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => handleReset(s.symbolId)}
                className="p-1 rounded hover:bg-surface-2"
                title="Reset bid/ask to 0"
              >
                <RotateCcw className="w-4 h-4 text-text-muted" />
              </button>
              <button
                type="button"
                onClick={() => openTransferMarkups(s)}
                className="p-1 rounded hover:bg-surface-2"
                title="Transfer markups"
              >
                <ArrowRightLeft className="w-4 h-4 text-accent" />
              </button>
            </div>
          )
        },
      },
    ],
    [
      prices,
      localMarkups,
      stream.id,
      handleBidChange,
      handleAskChange,
      handleReset,
      openTransferMarkups,
    ]
  )

  if (overridesLoading) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex items-center justify-center min-h-[200px] text-sm text-slate-400">
          Loading markup configuration...
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex items-center justify-between flex-shrink-0 p-4 md:p-6 pb-3">
        <div className="min-w-0 pr-4">
          <h2 className="text-base sm:text-lg md:text-xl font-bold text-white truncate">
            Configure Markups - {stream.name}
          </h2>
          <p className="text-sm text-slate-400 truncate mt-0.5">
            Set bid/ask markups for each symbol in this stream
          </p>
        </div>
        <button
          type="button"
          onClick={() => closeModal(modalKey)}
          className="p-1.5 sm:p-2 rounded-lg hover:bg-slate-700 flex-shrink-0 text-slate-400 hover:text-white"
        >
          <X className="w-4 h-4 sm:w-5 sm:h-5" />
        </button>
      </div>

      <div className="flex-shrink-0 relative px-4 md:px-6 mb-3">
        <Search className="absolute left-6 sm:left-8 top-1/2 -translate-y-1/2 text-slate-400 w-3 h-3 sm:w-4 sm:h-4" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search symbols..."
          className="w-full pl-8 sm:pl-10 pr-3 sm:pr-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="flex-1 min-h-0 flex flex-col px-4 md:px-6">
        <div className="flex-1 min-h-0 overflow-auto">
          <DataTable
            data={tableData}
            columns={columns}
            dense
            compact
            bordered={false}
            tableClassName="w-max"
            className="space-y-0"
          />
        </div>
      </div>

      <div className="flex flex-col sm:flex-row justify-end items-stretch sm:items-center gap-2 sm:gap-3 flex-shrink-0 p-4 md:p-6 pt-4 border-t border-slate-600">
        <button
          type="button"
          onClick={() => closeModal(modalKey)}
          className="px-3 sm:px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={isSaving}
          onClick={handleSave}
          className="px-3 sm:px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm flex items-center justify-center gap-2"
        >
          <Save className="w-4 h-4" />
          {isSaving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}
