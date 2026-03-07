import { useState, useMemo, useEffect, useRef } from 'react'
import { DataTable } from '@/shared/ui/table'
import { Button } from '@/shared/ui/button'
import { Switch } from '@/shared/ui/Switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Checkbox } from '@/shared/ui/Checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/shared/ui/dialog'
import { UserGroup, GroupSymbol } from '../types/group'
import { useModalStore } from '@/app/store'
import { toast } from '@/shared/components/common'
import { ColumnDef } from '@tanstack/react-table'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useLeverageProfilesList } from '@/features/leverageProfiles/hooks/useLeverageProfiles'
import { Skeleton } from '@/shared/ui/loading'
import { Copy, ArrowRightLeft } from 'lucide-react'
import { getGroupSymbols, updateGroupSymbols } from '../api/groups.api'
import { groupsQueryKeys } from '../hooks/useGroups'

interface AssignSymbolsModalProps {
  group: UserGroup
}

export function AssignSymbolsModal({ group }: AssignSymbolsModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const queryClient = useQueryClient()

  const { data: groupSymbolsData, isLoading: symbolsLoading } = useQuery({
    queryKey: ['adminGroups', 'groupSymbols', group.id],
    queryFn: () => getGroupSymbols(group.id),
    enabled: !!group.id,
  })
  const { data: leverageProfilesData } = useLeverageProfilesList({ page_size: 500 })
  const leverageProfiles = leverageProfilesData?.items ?? []

  const initialSymbols: GroupSymbol[] = useMemo(
    () => groupSymbolsData ?? [],
    [groupSymbolsData]
  )

  const [symbols, setSymbols] = useState<GroupSymbol[]>([])
  const populatedForGroupIdRef = useRef<string | null>(null)
  const [transferSource, setTransferSource] = useState<GroupSymbol | null>(null)
  const [transferSelectedIds, setTransferSelectedIds] = useState<Set<string>>(new Set())

  const displaySymbolsList = symbols.length > 0 ? symbols : initialSymbols

  useEffect(() => {
    if (group.id !== populatedForGroupIdRef.current && initialSymbols.length > 0) {
      setSymbols([...initialSymbols])
      populatedForGroupIdRef.current = group.id
    }
    if (group.id !== populatedForGroupIdRef.current && initialSymbols.length === 0) {
      populatedForGroupIdRef.current = null
    }
  }, [group.id, initialSymbols])

  const saveMutation = useMutation({
    mutationFn: (payload: GroupSymbol[]) =>
      updateGroupSymbols(
        group.id,
        payload.map((s) => ({
          symbolId: s.symbolId,
          leverageProfileId: s.leverageProfileId,
          enabled: s.enabled,
        })),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: groupsQueryKeys.all })
      queryClient.invalidateQueries({ queryKey: ['adminGroups', 'groupSymbols', group.id] })
      toast.success(`Symbol settings saved for ${group.name}`)
    },
    onError: (error: any) => {
      const message =
        error?.response?.data?.error?.message || error?.message || 'Failed to save symbol settings'
      toast.error(message)
    },
  })

  const handleLeverageProfileChange = (symbolId: string, profileId: string | null) => {
    const normalizedId = profileId ? String(profileId).toLowerCase() : null
    const profile = normalizedId
      ? leverageProfiles.find((p) => String(p.id).toLowerCase() === normalizedId)
      : null
    setSymbols((prev) => {
      const base = prev.length > 0 ? prev : initialSymbols
      return base.map((s) =>
        s.symbolId === symbolId
          ? {
              ...s,
              leverageProfileId: normalizedId,
              leverageProfileName: profile?.name ?? null,
            }
          : s
      )
    })
  }

  const handleEnabledToggle = (symbolId: string) => {
    setSymbols((prev) => {
      const base = prev.length > 0 ? prev : initialSymbols
      return base.map((s) => (s.symbolId === symbolId ? { ...s, enabled: !s.enabled } : s))
    })
  }

  /** Apply this row's Leverage Profile and enabled state to all symbols in the list. */
  const handleTransferToAll = (source: GroupSymbol) => {
    setSymbols((prev) => {
      const base = prev.length > 0 ? prev : initialSymbols
      return base.map((s) => ({
        ...s,
        leverageProfileId: source.leverageProfileId,
        leverageProfileName: source.leverageProfileName,
        enabled: source.enabled,
      }))
    })
    toast.success(`Settings from ${source.symbolCode} applied to all symbols. Click Save to persist.`)
  }

  const openTransferDialog = (source: GroupSymbol) => {
    setTransferSource(source)
    setTransferSelectedIds(new Set())
  }

  const closeTransferDialog = () => {
    setTransferSource(null)
    setTransferSelectedIds(new Set())
  }

  const transferTargetSymbols = useMemo(() => {
    if (!transferSource) return []
    return displaySymbolsList.filter((s) => s.symbolId !== transferSource.symbolId)
  }, [transferSource, displaySymbolsList])

  const toggleTransferSelection = (symbolId: string) => {
    setTransferSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(symbolId)) next.delete(symbolId)
      else next.add(symbolId)
      return next
    })
  }

  const selectAllTransferTargets = () => {
    setTransferSelectedIds(new Set(transferTargetSymbols.map((s) => s.symbolId)))
  }

  const deselectAllTransferTargets = () => {
    setTransferSelectedIds(new Set())
  }

  const handleTransferToSelected = () => {
    if (!transferSource || transferSelectedIds.size === 0) return
    setSymbols((prev) => {
      const base = prev.length > 0 ? prev : initialSymbols
      return base.map((s) =>
        transferSelectedIds.has(s.symbolId)
          ? {
              ...s,
              leverageProfileId: transferSource.leverageProfileId,
              leverageProfileName: transferSource.leverageProfileName,
              enabled: transferSource.enabled,
            }
          : s
      )
    })
    const count = transferSelectedIds.size
    toast.success(
      `Settings from ${transferSource.symbolCode} applied to ${count} symbol${count !== 1 ? 's' : ''}. Click Save to persist.`
    )
    closeTransferDialog()
  }

  const handleSave = () => {
    saveMutation.mutate(displaySymbolsList)
  }

  const columns: ColumnDef<GroupSymbol>[] = [
    {
      accessorKey: 'symbolCode',
      header: 'Symbol',
      cell: ({ row }) => (
        <span className="font-mono font-semibold">{row.getValue('symbolCode')}</span>
      ),
    },
    {
      accessorKey: 'leverageProfileName',
      header: 'Leverage Profile',
      cell: ({ row }) => {
        const symbol = row.original
        const value = symbol.leverageProfileId ? String(symbol.leverageProfileId).toLowerCase() : '__none__'
        const optionIds = new Set(leverageProfiles.map((p) => String(p.id).toLowerCase()))
        const valueNotInList = value !== '__none__' && !optionIds.has(value)
        return (
          <Select
            key={`lev-${symbol.symbolId}-${value}`}
            value={value}
            onValueChange={(v) =>
              handleLeverageProfileChange(symbol.symbolId, v === '__none__' ? null : v)
            }
          >
            <SelectTrigger className="w-48 h-8">
              <SelectValue placeholder="Default" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Default (group)</SelectItem>
              {leverageProfiles.map((p) => (
                <SelectItem key={p.id} value={String(p.id).toLowerCase()}>
                  {p.name}
                </SelectItem>
              ))}
              {valueNotInList && (
                <SelectItem value={value}>
                  {symbol.leverageProfileName ? `${symbol.leverageProfileName} (removed)` : value}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        )
      },
    },
    {
      accessorKey: 'enabled',
      header: 'Enabled',
      cell: ({ row }) => {
        const symbol = row.original
        return (
          <Switch
            checked={symbol.enabled}
            onCheckedChange={() => handleEnabledToggle(symbol.symbolId)}
          />
        )
      },
    },
    {
      id: 'actions',
      header: 'Transfer settings',
      cell: ({ row }) => {
        const symbol = row.original
        return (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => handleTransferToAll(symbol)}
              title="Apply this symbol's Leverage Profile and Enabled state to all symbols"
            >
              <Copy className="h-4 w-4" />
              Apply to all
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => openTransferDialog(symbol)}
              title="Apply this symbol's settings to specific symbols"
            >
              <ArrowRightLeft className="h-4 w-4" />
              To selected
            </Button>
          </div>
        )
      },
    },
  ]

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
        <div className="text-sm text-text-muted space-y-1">
        <p>
          Configure symbol-specific settings for <strong className="text-text">{group.name}</strong>.
          Leverage profile and enable/disable per symbol. Markup is set in the{' '}
          <strong>price stream profile</strong> assigned to this group.
        </p>
        {leverageProfiles.length === 0 && (
          <p className="text-amber-600 dark:text-amber-400">
            No leverage profiles in the system. Create them in <strong>Admin → Leverage Profiles</strong> to see more options than “Default (group)” here.
          </p>
        )}
        </div>
        {symbolsLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : displaySymbolsList.length === 0 ? (
        <p className="text-sm text-text-muted py-4">No symbols found.</p>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <DataTable data={displaySymbolsList} columns={columns} disablePagination />
        </div>
      )}
      </div>
      <div className="flex-shrink-0 flex justify-end gap-2 pt-4 border-t border-border">
        <Button variant="outline" onClick={() => closeModal(`group-symbol-settings-${group.id}`)}>
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          disabled={displaySymbolsList.length === 0 || saveMutation.isPending}
        >
          {saveMutation.isPending ? 'Saving…' : 'Save Changes'}
        </Button>
      </div>

      <Dialog open={!!transferSource} onOpenChange={(open) => !open && closeTransferDialog()}>
        <DialogContent className="max-w-md z-[110]" showClose={true}>
          <DialogHeader>
            <DialogTitle>Transfer settings to specific symbols</DialogTitle>
            <DialogDescription>
              {transferSource ? (
                <>
                  Apply <strong className="font-mono text-text">{transferSource.symbolCode}</strong>'s
                  Leverage Profile ({transferSource.leverageProfileName ?? 'Default (group)'}) and
                  Enabled ({transferSource.enabled ? 'On' : 'Off'}) to the symbols you select below.
                </>
              ) : (
                'Select target symbols.'
              )}
            </DialogDescription>
          </DialogHeader>
          {transferSource && transferTargetSymbols.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={selectAllTransferTargets}>
                  Select all
                </Button>
                <Button variant="outline" size="sm" onClick={deselectAllTransferTargets}>
                  Deselect all
                </Button>
                <span className="text-sm text-text-muted">
                  {transferSelectedIds.size} of {transferTargetSymbols.length} selected
                </span>
              </div>
              <div className="max-h-64 overflow-y-auto rounded-lg border border-border bg-surface p-2 space-y-1">
                {transferTargetSymbols.map((s) => (
                  <label
                    key={s.symbolId}
                    className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-surface-2 cursor-pointer"
                  >
                    <Checkbox
                      checked={transferSelectedIds.has(s.symbolId)}
                      onChange={() => toggleTransferSelection(s.symbolId)}
                    />
                    <span className="font-mono text-sm">{s.symbolCode}</span>
                    <span className="text-xs text-text-muted">
                      {s.leverageProfileName ?? 'Default'} · {s.enabled ? 'On' : 'Off'}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {transferSource && transferTargetSymbols.length === 0 && (
            <p className="text-sm text-text-muted">No other symbols to transfer to.</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeTransferDialog}>
              Cancel
            </Button>
            <Button
              onClick={handleTransferToSelected}
              disabled={!transferSource || transferSelectedIds.size === 0}
            >
              Apply to {transferSelectedIds.size} symbol{transferSelectedIds.size !== 1 ? 's' : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
