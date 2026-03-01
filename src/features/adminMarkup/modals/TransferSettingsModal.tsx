import { useState, useMemo } from 'react'
import { useModalStore } from '@/app/store'
import { useMarkupProfiles } from '../hooks/useMarkup'
import { MarkupProfile } from '../types/markup'
import { Copy, Search, X, AlertTriangle } from 'lucide-react'
import { CheckSquare, Square } from 'lucide-react'

interface TransferSettingsModalProps {
  sourceStream: MarkupProfile
}

export function TransferSettingsModal({ sourceStream }: TransferSettingsModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const { data: profiles } = useMarkupProfiles()
  const [includeMarkups, setIncludeMarkups] = useState(true)
  const [targetIds, setTargetIds] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const modalKey = `transfer-settings-${sourceStream.id}`

  const targetStreams = useMemo(() => {
    if (!profiles) return []
    return profiles.filter((p) => p.id !== sourceStream.id)
  }, [profiles, sourceStream.id])

  const filteredTargets = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return targetStreams
    return targetStreams.filter(
      (p) =>
        p.name.toLowerCase().includes(term) ||
        (p.id?.toLowerCase().includes(term) ?? false)
    )
  }, [targetStreams, search])

  const selectedCount = targetIds.size
  const allSelected =
    filteredTargets.length > 0 &&
    filteredTargets.every((p) => targetIds.has(p.id))
  const someSelected = filteredTargets.some((p) => targetIds.has(p.id))

  const toggleAll = () => {
    if (allSelected) {
      setTargetIds((prev) => {
        const next = new Set(prev)
        filteredTargets.forEach((p) => next.delete(p.id))
        return next
      })
    } else {
      setTargetIds((prev) => {
        const next = new Set(prev)
        filteredTargets.forEach((p) => next.add(p.id))
        return next
      })
    }
  }

  const toggleOne = (id: string) => {
    setTargetIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleTransfer = async () => {
    if (selectedCount === 0) return
    setLoading(true)
    setError(null)
    try {
      // Placeholder: call transfer API when available
      await new Promise((r) => setTimeout(r, 800))
      closeModal(modalKey)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transfer failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 shadow-xl w-full max-w-[calc(100vw-1rem)] sm:max-w-2xl md:max-w-3xl max-h-[95vh] sm:max-h-[90vh] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-3 sm:p-4 md:p-6 border-b border-slate-700 flex-shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 pr-2">
          <div className="p-1.5 sm:p-2 bg-blue-600/20 rounded-lg flex-shrink-0">
            <Copy className="w-4 h-4 sm:w-5 sm:h-5 text-blue-400" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-semibold text-white truncate">
              Transfer Price Stream Settings
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 truncate">
              Copy settings from <span className="text-white font-medium">{sourceStream.name}</span> to other streams
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => closeModal(modalKey)}
          className="p-1 text-slate-400 hover:text-white disabled:opacity-50 flex-shrink-0"
        >
          <X className="w-4 h-4 sm:w-5 sm:h-5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 space-y-3 sm:space-y-4 min-h-0">
        <div className="bg-slate-700/30 rounded-lg p-3 sm:p-4 border border-slate-700">
          <p className="text-xs sm:text-sm font-medium text-slate-300 mb-2">
            Settings to Transfer
          </p>
          <label className="inline-flex items-center space-x-2 text-xs sm:text-sm text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={includeMarkups}
              onChange={(e) => setIncludeMarkups(e.target.checked)}
              className="rounded text-blue-500 focus:ring-blue-500 bg-slate-800 border-slate-600 w-3 h-3 sm:w-4 sm:h-4"
            />
            <span>Markups (copy all symbol markups)</span>
          </label>
        </div>

        <div className="bg-slate-700/30 rounded-lg p-3 sm:p-4 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs sm:text-sm font-medium text-slate-300">
              Target Streams ({selectedCount} selected)
            </p>
            <button
              type="button"
              onClick={toggleAll}
              className="text-xs text-blue-400 hover:text-blue-300"
            >
              {allSelected ? 'Deselect All' : 'Select All'}
            </button>
          </div>
          <div className="relative mb-3">
            <Search className="absolute left-2 sm:left-3 top-1/2 -translate-y-1/2 w-3 h-3 sm:w-4 sm:h-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search streams..."
              className="w-full pl-8 sm:pl-10 pr-3 sm:pr-4 py-1.5 sm:py-2 bg-slate-800 border border-slate-600 rounded-lg text-white text-xs sm:text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="max-h-48 sm:max-h-64 overflow-y-auto space-y-2">
            {filteredTargets.length === 0 ? (
              <p className="text-center text-slate-400 py-4 sm:py-6 text-xs sm:text-sm">
                No target streams available
              </p>
            ) : (
              filteredTargets.map((p) => (
                <label
                  key={p.id}
                  className={`flex items-center justify-between p-2 sm:p-3 rounded border cursor-pointer ${
                    targetIds.has(p.id)
                      ? 'bg-blue-600/10 border-blue-500/30'
                      : 'bg-slate-800/50 border-slate-600 hover:border-slate-500'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-white text-xs sm:text-sm truncate block">
                      {p.name}
                    </span>
                    <span className="text-xs text-slate-400 truncate block">
                      {p.id}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      toggleOne(p.id)
                    }}
                    className="flex-shrink-0 ml-2"
                  >
                    {targetIds.has(p.id) ? (
                      <CheckSquare className="w-4 h-4 sm:w-5 sm:h-5 text-blue-400" />
                    ) : (
                      <Square className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400" />
                    )}
                  </button>
                </label>
              ))
            )}
          </div>
        </div>

        {error && (
          <div className="flex items-center space-x-2 p-2 sm:p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
            <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 text-red-400 flex-shrink-0" />
            <p className="text-xs sm:text-sm text-red-400">{error}</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 sm:gap-3 p-3 sm:p-4 md:p-6 border-t border-slate-700 flex-shrink-0">
        <button
          type="button"
          onClick={() => closeModal(modalKey)}
          disabled={loading}
          className="w-full sm:w-auto px-3 sm:px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-xs sm:text-sm"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleTransfer}
          disabled={loading || selectedCount === 0}
          className="flex items-center justify-center space-x-1.5 sm:space-x-2 px-3 sm:px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:text-slate-400 text-white rounded-lg text-xs sm:text-sm disabled:cursor-not-allowed"
        >
          <Copy className="w-3 h-3 sm:w-4 sm:h-4" />
          <span>
            {loading
              ? 'Transferring...'
              : `Transfer to ${selectedCount} stream(s)`}
          </span>
        </button>
      </div>
    </div>
  )
}
