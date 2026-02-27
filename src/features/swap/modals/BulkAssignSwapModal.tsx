import { useState, useMemo, useEffect } from 'react'
import { DataTable } from '@/shared/ui/table'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Checkbox } from '@/shared/ui/Checkbox'
import { useModalStore } from '@/app/store'
import { toast } from '@/shared/components/common'
import { ColumnDef } from '@tanstack/react-table'
import { useQueryClient } from '@tanstack/react-query'
import { SwapCalcMode, SwapUnit, WeekendRule } from '../types/swap'
import { createSwapRule } from '../api/swap.api'
import { swapRulesQueryKeys } from '../hooks/useSwapRules'
import { useGroupsList } from '@/features/groups/hooks/useGroups'
import { useAdminSymbolsList } from '@/features/symbols/hooks/useSymbols'
import type { SwapRule } from '../types/swap'
import { Search } from 'lucide-react'

function assetClassToMarket(ac: string | null): SwapRule['market'] {
  if (!ac) return 'forex'
  const m = ac.toLowerCase()
  if (m === 'fx') return 'forex'
  if (m === 'crypto') return 'crypto'
  if (m === 'metals' || m === 'commodities') return 'commodities'
  if (m === 'indices') return 'indices'
  if (m === 'stocks') return 'stocks'
  return 'forex'
}

interface SymbolForBulk {
  code: string
  name: string
  market: string
  selected: boolean
}

export function BulkAssignSwapModal() {
  const closeModal = useModalStore((state) => state.closeModal)
  const queryClient = useQueryClient()
  const { data: groupsData } = useGroupsList()
  const { data: symbolsData } = useAdminSymbolsList()
  const groups = groupsData?.items ?? []
  const allSymbolsFromApi = useMemo(() => {
    const items = symbolsData?.items ?? []
    return items.map((s) => ({
      code: s.symbolCode,
      name: s.symbolCode,
      market: assetClassToMarket(s.assetClass ?? null),
      selected: false,
    }))
  }, [symbolsData?.items])

  const [groupId, setGroupId] = useState('')
  const [calcMode, setCalcMode] = useState<SwapCalcMode>('daily')
  const [unit, setUnit] = useState<SwapUnit>('percent')
  const [longRate, setLongRate] = useState(0.02)
  const [shortRate, setShortRate] = useState(-0.05)
  const [rolloverTimeUtc, setRolloverTimeUtc] = useState('00:00')
  const [weekendRule, setWeekendRule] = useState<WeekendRule>('none')
  const [tripleDay, setTripleDay] = useState<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun' | undefined>()
  const [search, setSearch] = useState('')
  const [symbols, setSymbols] = useState<SymbolForBulk[]>([])

  useEffect(() => {
    if (allSymbolsFromApi.length > 0 && symbols.length === 0) {
      setSymbols(allSymbolsFromApi.map((s) => ({ ...s, selected: false })))
    }
  }, [allSymbolsFromApi, symbols.length])

  const filteredSymbols = symbols.filter((s) => {
    if (search) {
      const searchLower = search.toLowerCase()
      return (
        s.code.toLowerCase().includes(searchLower) ||
        s.name.toLowerCase().includes(searchLower)
      )
    }
    return true
  })

  const handleToggleSymbol = (code: string) => {
    setSymbols(
      symbols.map((s) => (s.code === code ? { ...s, selected: !s.selected } : s))
    )
  }

  const handleSelectAll = () => {
    const allSelected = filteredSymbols.every((s) => s.selected)
    setSymbols(
      symbols.map((s) => {
        const isInFilter = filteredSymbols.some((f) => f.code === s.code)
        return isInFilter ? { ...s, selected: !allSelected } : s
      })
    )
  }

  const handleApply = async () => {
    const selectedSymbols = symbols.filter((s) => s.selected)
    const selectedCount = selectedSymbols.length
    if (!groupId) {
      toast.error('Please select a group')
      return
    }
    if (selectedCount === 0) {
      toast.error('Please select at least one symbol')
      return
    }
    try {
      for (const s of selectedSymbols) {
        await createSwapRule({
          groupId,
          symbol: s.code,
          market: s.market as SwapRule['market'],
          calcMode,
          unit,
          longRate,
          shortRate,
          rolloverTimeUtc,
          weekendRule,
          status: 'active',
          tripleDay: tripleDay ?? undefined,
          notes: undefined,
        })
      }
      queryClient.invalidateQueries({ queryKey: swapRulesQueryKeys.lists() })
      toast.success(`Swap rules created for ${selectedCount} symbol(s)`)
      closeModal('bulk-assign-swap')
    } catch (err: any) {
      const message =
        err?.response?.data?.error?.message || err?.message || 'Failed to create swap rules'
      toast.error(message)
    }
  }

  const selectedCount = symbols.filter((s) => s.selected).length
  const allSelected = filteredSymbols.length > 0 && filteredSymbols.every((s) => s.selected)

  const columns: ColumnDef<SymbolForBulk>[] = [
    {
      id: 'select',
      header: () => (
        <Checkbox checked={allSelected} onChange={handleSelectAll} />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.original.selected}
          onChange={() => handleToggleSymbol(row.original.code)}
        />
      ),
    },
    {
      accessorKey: 'code',
      header: 'Symbol',
      cell: ({ row }) => {
        return <span className="font-mono font-semibold">{row.getValue('code')}</span>
      },
    },
    {
      accessorKey: 'name',
      header: 'Name',
    },
    {
      accessorKey: 'market',
      header: 'Market',
      cell: ({ row }) => {
        const market = row.getValue('market') as string
        return <span className="capitalize">{market}</span>
      },
    },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium text-text mb-2 block">Group *</label>
          <Select value={groupId} onValueChange={setGroupId}>
            <SelectTrigger>
              <SelectValue placeholder="Select group" />
            </SelectTrigger>
            <SelectContent>
              {groups.map((group) => (
                <SelectItem key={group.id} value={group.id}>
                  {group.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-sm font-medium text-text mb-2 block">Calc Mode *</label>
          <Select value={calcMode} onValueChange={(value) => setCalcMode(value as SwapCalcMode)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="hourly">Hourly</SelectItem>
              <SelectItem value="funding_8h">8H Funding</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-sm font-medium text-text mb-2 block">Unit *</label>
          <Select value={unit} onValueChange={(value) => setUnit(value as SwapUnit)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="percent">Percent</SelectItem>
              <SelectItem value="fixed">Fixed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-sm font-medium text-text mb-2 block">Rollover Time (UTC) *</label>
          <Input
            type="time"
            value={rolloverTimeUtc}
            onChange={(e) => setRolloverTimeUtc(e.target.value)}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium text-text mb-2 block">
            Long Rate * {unit === 'percent' && '(%)'}
          </label>
          <Input
            type="number"
            step={unit === 'percent' ? '0.001' : '0.1'}
            value={longRate}
            onChange={(e) => setLongRate(parseFloat(e.target.value) || 0)}
          />
        </div>
        <div>
          <label className="text-sm font-medium text-text mb-2 block">
            Short Rate * {unit === 'percent' && '(%)'}
          </label>
          <Input
            type="number"
            step={unit === 'percent' ? '0.001' : '0.1'}
            value={shortRate}
            onChange={(e) => setShortRate(parseFloat(e.target.value) || 0)}
          />
        </div>
        <div>
          <label className="text-sm font-medium text-text mb-2 block">Weekend Rule *</label>
          <Select
            value={weekendRule}
            onValueChange={(value) => {
              setWeekendRule(value as WeekendRule)
              if (value !== 'triple_day') {
                setTripleDay(undefined)
              }
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="triple_day">Triple Day</SelectItem>
              <SelectItem value="fri_triple">Friday Triple</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {weekendRule === 'triple_day' && (
          <div>
            <label className="text-sm font-medium text-text mb-2 block">Triple Day *</label>
            <Select
              value={tripleDay || 'wed'}
              onValueChange={(value) =>
                setTripleDay(value as 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun')
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mon">Monday</SelectItem>
                <SelectItem value="tue">Tuesday</SelectItem>
                <SelectItem value="wed">Wednesday</SelectItem>
                <SelectItem value="thu">Thursday</SelectItem>
                <SelectItem value="fri">Friday</SelectItem>
                <SelectItem value="sat">Saturday</SelectItem>
                <SelectItem value="sun">Sunday</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="border-t border-border pt-4">
        <div className="flex items-center gap-4 mb-4">
          <div className="flex-1 max-w-sm">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <Input
                type="search"
                placeholder="Search symbols..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
          <div className="text-sm text-text-muted">
            {selectedCount} symbol{selectedCount !== 1 ? 's' : ''} selected
          </div>
        </div>
        <div className="border border-border rounded-lg overflow-hidden">
          <DataTable data={filteredSymbols} columns={columns} />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4 border-t border-border">
        <Button variant="outline" onClick={() => closeModal('bulk-assign-swap')}>
          Cancel
        </Button>
        <Button onClick={handleApply}>Apply to Selected</Button>
      </div>
    </div>
  )
}

