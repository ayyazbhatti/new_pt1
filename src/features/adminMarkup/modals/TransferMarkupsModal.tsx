import { useState, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { MarkupProfile, SymbolWithMarkup } from '../types/markup'
import { Search } from 'lucide-react'
import { useUpsertSymbolOverride } from '../hooks/useMarkup'
import { toast } from '@/shared/components/common'

interface TransferMarkupsModalProps {
  stream: MarkupProfile
  sourceSymbol: SymbolWithMarkup
  allSymbols: SymbolWithMarkup[]
  onClose: () => void
}

type Mode = 'all' | 'selected'

export function TransferMarkupsModal({
  stream,
  sourceSymbol,
  allSymbols,
  onClose,
}: TransferMarkupsModalProps) {
  const [mode, setMode] = useState<Mode>('all')
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [transferring, setTransferring] = useState(false)

  const upsertOverride = useUpsertSymbolOverride()
  const queryClient = useQueryClient()

  const targetsExceptSource = useMemo(
    () => allSymbols.filter((s) => s.symbolId !== sourceSymbol.symbolId),
    [allSymbols, sourceSymbol.symbolId]
  )
  const filteredBySearch = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return targetsExceptSource
    return targetsExceptSource.filter(
      (s) =>
        s.symbolCode.toLowerCase().includes(term) ||
        s.baseCurrency?.toLowerCase().includes(term) ||
        s.quoteCurrency?.toLowerCase().includes(term)
    )
  }, [targetsExceptSource, search])
  const targets = mode === 'all' ? targetsExceptSource : filteredBySearch

  const selectedTargets =
    mode === 'all' ? targets : targets.filter((s) => selectedIds.has(s.symbolId))
  const canTransfer =
    selectedTargets.length > 0 && !transferring
  const onlyOneSymbol = allSymbols.length <= 1

  const BATCH_SIZE = 20

  const handleTransfer = async () => {
    if (!canTransfer) return
    setTransferring(true)
    try {
      const bid = sourceSymbol.bidMarkup ?? '0'
      const ask = sourceSymbol.askMarkup ?? '0'
      // Batch requests so "Apply to all" doesn't fire 100+ parallel requests
      for (let i = 0; i < selectedTargets.length; i += BATCH_SIZE) {
        const chunk = selectedTargets.slice(i, i + BATCH_SIZE)
        await Promise.all(
          chunk.map((s) =>
            upsertOverride.mutateAsync({
              profileId: stream.id,
              symbolId: s.symbolId,
              payload: { bid_markup: bid, ask_markup: ask },
              silent: true,
            })
          )
        )
      }
      queryClient.invalidateQueries({ queryKey: ['markup'] })
      toast.success(`Transferred markups to ${selectedTargets.length} symbol(s)`)
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Transfer failed')
    } finally {
      setTransferring(false)
    }
  }

  const toggleSelected = (symbolId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(symbolId)) next.delete(symbolId)
      else next.add(symbolId)
      return next
    })
  }

  return (
    <div className="w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="mb-4 flex-shrink-0">
          <h2 className="text-lg font-semibold text-white">
            Transfer Markups
          </h2>
          <p className="text-sm text-slate-400 mt-0.5">
            Copy markups from{' '}
            <span className="text-white font-medium">{sourceSymbol.symbolCode}</span>
          </p>
        </div>

        <div className="bg-slate-900 rounded-lg p-3 border border-slate-700 mb-4 flex-shrink-0">
          <p className="text-sm text-slate-300">
            Bid %: <span className="text-white font-medium">{sourceSymbol.bidMarkup}</span>
          </p>
          <p className="text-sm text-slate-300 mt-1">
            Ask %: <span className="text-white font-medium">{sourceSymbol.askMarkup}</span>
          </p>
        </div>

        {onlyOneSymbol ? (
          <div className="mb-4 p-3 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-300">
            This stream only has markups for{' '}
            <span className="text-white font-medium">{sourceSymbol.symbolCode}</span>.
            Add more symbols to enable transferring.
          </div>
        ) : (
          <>
            <div className="space-y-2 mb-4 flex-shrink-0">
              <label className="flex items-center space-x-2 text-sm text-slate-300 cursor-pointer">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === 'all'}
                  onChange={() => setMode('all')}
                  className="text-blue-500 focus:ring-blue-500 bg-slate-900 border-slate-700"
                />
                <span>Apply to all symbols</span>
              </label>
              <label className="flex items-center space-x-2 text-sm text-slate-300 cursor-pointer">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === 'selected'}
                  onChange={() => setMode('selected')}
                  className="text-blue-500 focus:ring-blue-500 bg-slate-900 border-slate-700"
                />
                <span>Choose specific symbols</span>
              </label>
            </div>

            {mode === 'selected' && (
              <div className="border border-slate-700 rounded-lg mb-4 flex-1 min-h-0 flex flex-col">
                <div className="p-3 border-b border-slate-700">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search symbols..."
                      className="w-full pl-10 pr-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    />
                  </div>
                </div>
                <div className="max-h-64 overflow-auto">
                  {targets.length === 0 ? (
                    <p className="p-4 text-sm text-slate-400 text-center">
                      No symbols match your search.
                    </p>
                  ) : (
                    targets.map((s) => (
                      <label
                        key={s.symbolId}
                        className="flex items-center justify-between px-4 py-2 text-sm text-slate-200 hover:bg-slate-900 border-b border-slate-800 cursor-pointer"
                      >
                        <div>
                          <span className="font-medium text-white block">
                            {s.symbolCode}
                          </span>
                          <span className="text-xs text-slate-400">
                            {s.baseCurrency}/{s.quoteCurrency}
                          </span>
                        </div>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(s.symbolId)}
                          onChange={() => toggleSelected(s.symbolId)}
                          className="rounded text-blue-500 focus:ring-blue-500 bg-slate-900 border-slate-700"
                        />
                      </label>
                    ))
                  )}
                </div>
              </div>
            )}
          </>
        )}

        <div className="flex justify-end space-x-3 mt-auto pt-4 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleTransfer}
            disabled={!canTransfer || onlyOneSymbol}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Transfer Markups
          </button>
        </div>
    </div>
  )
}
