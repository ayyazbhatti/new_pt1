import { useState, useMemo, useEffect, useRef } from 'react'
import { DataTable } from '@/shared/ui/table'
import { Button } from '@/shared/ui/button'
import { Switch } from '@/shared/ui/Switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { UserGroup, GroupSymbol } from '../types/group'
import { useModalStore } from '@/app/store'
import { toast } from '@/shared/components/common'
import { ColumnDef } from '@tanstack/react-table'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useLeverageProfilesList } from '@/features/leverageProfiles/hooks/useLeverageProfiles'
import { usePriceStream, normalizeSymbolKey } from '@/features/symbols/hooks/usePriceStream'
import { Skeleton } from '@/shared/ui/loading'
import { getGroupSymbols, updateGroupSymbols } from '../api/groups.api'
import { groupsQueryKeys } from '../hooks/useGroups'

function formatPrice(value: string | undefined): string {
  if (value == null || value === '') return '—'
  const num = parseFloat(value)
  if (Number.isNaN(num)) return value
  return num.toFixed(8).replace(/\.?0+$/, '') || '0'
}

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

  const displaySymbolsList = symbols.length > 0 ? symbols : initialSymbols
  const symbolCodesForPrice = useMemo(
    () => displaySymbolsList.map((s) => s.symbolCode.toUpperCase().trim()).filter(Boolean),
    [displaySymbolsList]
  )
  const { prices } = usePriceStream(symbolCodesForPrice)

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
      id: 'bid',
      header: 'Bid',
      cell: ({ row }) => {
        const code = row.original.symbolCode
        const price = prices.get(normalizeSymbolKey(code))
        return (
          <span className="font-mono text-sm text-success">
            {formatPrice(price?.bid)}
          </span>
        )
      },
    },
    {
      id: 'ask',
      header: 'Ask',
      cell: ({ row }) => {
        const code = row.original.symbolCode
        const price = prices.get(normalizeSymbolKey(code))
        return (
          <span className="font-mono text-sm text-danger">
            {formatPrice(price?.ask)}
          </span>
        )
      },
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
          <DataTable data={displaySymbolsList} columns={columns} />
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
    </div>
  )
}
