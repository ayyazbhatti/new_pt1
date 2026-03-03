import { useState, useMemo } from 'react'
import { useModalStore } from '@/app/store'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { useMarkupProfiles } from '../hooks/useMarkup'
import { MarkupProfile } from '../types/markup'
import { transferMarkupsToProfiles } from '../api/markup.api'
import { Copy, Search, AlertTriangle } from 'lucide-react'
import { CheckSquare, Square } from 'lucide-react'
import { toast } from '@/shared/components/common'

interface TransferSettingsModalProps {
  sourceStream: MarkupProfile
}

export function TransferSettingsModal({ sourceStream }: TransferSettingsModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const queryClient = useQueryClient()
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
      const ids = Array.from(targetIds)
      const { copied_overrides } = await transferMarkupsToProfiles(sourceStream.id, {
        target_profile_ids: ids,
        include_markups: includeMarkups,
      })
      toast.success(
        includeMarkups
          ? `Transferred ${copied_overrides} markup override(s) to ${selectedCount} stream(s)`
          : `Transfer completed for ${selectedCount} stream(s)`
      )
      queryClient.invalidateQueries({ queryKey: ['markup'] })
      closeModal(modalKey)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transfer failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col overflow-hidden min-h-0">
      <p className="text-sm text-text-muted mb-4">
        Copy settings from <span className="font-medium text-text">{sourceStream.name}</span> to other streams.
      </p>
      <div className="flex-1 overflow-y-auto space-y-4 min-h-0">
        <div className="rounded-lg p-4 border border-border bg-surface-2">
          <p className="text-sm font-medium text-text mb-2">Settings to Transfer</p>
          <label className="inline-flex items-center space-x-2 text-sm text-text-muted cursor-pointer">
            <input
              type="checkbox"
              checked={includeMarkups}
              onChange={(e) => setIncludeMarkups(e.target.checked)}
              className="rounded border-border text-accent focus:ring-accent bg-surface-1 w-4 h-4"
            />
            <span>Markups (copy all symbol markups)</span>
          </label>
        </div>

        <div className="rounded-lg p-4 border border-border bg-surface-2">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-text">
              Target Streams ({selectedCount} selected)
            </p>
            <button
              type="button"
              onClick={toggleAll}
              className="text-sm text-accent hover:text-accent/90"
            >
              {allSelected ? 'Deselect All' : 'Select All'}
            </button>
          </div>
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <Input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search streams..."
              className="pl-9"
            />
          </div>
          <div className="max-h-48 sm:max-h-64 overflow-y-auto space-y-2">
            {filteredTargets.length === 0 ? (
              <p className="text-center text-text-muted py-6 text-sm">
                No target streams available
              </p>
            ) : (
              filteredTargets.map((p) => (
                <label
                  key={p.id}
                  className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer ${
                    targetIds.has(p.id)
                      ? 'bg-accent/10 border-accent/50'
                      : 'bg-surface-1 border-border hover:border-border/80'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-text text-sm truncate block">
                      {p.name}
                    </span>
                    <span className="text-sm text-text-muted truncate block">
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
                      <CheckSquare className="w-4 h-4 text-accent" />
                    ) : (
                      <Square className="w-4 h-4 text-text-muted" />
                    )}
                  </button>
                </label>
              ))
            )}
          </div>
        </div>

        {error && (
          <div className="flex items-center space-x-2 p-3 bg-danger/10 border border-danger/30 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-danger flex-shrink-0" />
            <p className="text-sm text-danger">{error}</p>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-4 border-t border-border flex-shrink-0">
        <Button
          type="button"
          variant="outline"
          onClick={() => closeModal(modalKey)}
          disabled={loading}
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={handleTransfer}
          disabled={loading || selectedCount === 0}
          className="flex items-center gap-2"
        >
          <Copy className="w-4 h-4" />
          {loading ? 'Transferring...' : `Transfer to ${selectedCount} stream(s)`}
        </Button>
      </div>
    </div>
  )
}
