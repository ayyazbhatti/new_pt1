import { useState } from 'react'
import { DataTable } from '@/shared/ui/table'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Checkbox } from '@/shared/ui/Checkbox'
import { useModalStore } from '@/app/store'
import { toast } from 'react-hot-toast'
import { ColumnDef } from '@tanstack/react-table'
import { MarkupType, ApplyTo } from '../types/markup'
import { mockGroups } from '@/features/groups/mocks/groups.mock'
import { mockSymbols } from '@/features/symbols/mocks/symbols.mock'
import { Search } from 'lucide-react'

interface SymbolForBulk {
  code: string
  name: string
  market: string
  selected: boolean
}

export function BulkAssignModal() {
  const closeModal = useModalStore((state) => state.closeModal)

  const [groupId, setGroupId] = useState('')
  const [markupType, setMarkupType] = useState<MarkupType>('spread')
  const [value, setValue] = useState(0)
  const [applyTo, setApplyTo] = useState<ApplyTo>('both')
  const [rounding, setRounding] = useState(2)
  const [search, setSearch] = useState('')
  const [symbols, setSymbols] = useState<SymbolForBulk[]>(
    mockSymbols.map((s) => ({
      code: s.code,
      name: s.name,
      market: s.market,
      selected: false,
    }))
  )

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

  const handleApply = () => {
    const selectedCount = symbols.filter((s) => s.selected).length
    if (!groupId) {
      toast.error('Please select a group')
      return
    }
    if (selectedCount === 0) {
      toast.error('Please select at least one symbol')
      return
    }
    toast.success(`Markup rules applied to ${selectedCount} symbols`)
    closeModal('bulk-assign')
  }

  const selectedCount = symbols.filter((s) => s.selected).length
  const allSelected = filteredSymbols.length > 0 && filteredSymbols.every((s) => s.selected)

  const columns: ColumnDef<SymbolForBulk>[] = [
    {
      id: 'select',
      header: () => (
        <Checkbox
          checked={allSelected}
          onChange={handleSelectAll}
        />
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
              {mockGroups.map((group) => (
                <SelectItem key={group.id} value={group.id}>
                  {group.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-sm font-medium text-text mb-2 block">Markup Type *</label>
          <Select value={markupType} onValueChange={(value) => setMarkupType(value as MarkupType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fixed">Fixed</SelectItem>
              <SelectItem value="percent">Percent</SelectItem>
              <SelectItem value="spread">Spread</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-sm font-medium text-text mb-2 block">
            Value * {markupType === 'percent' && '(%)'}
          </label>
          <Input
            type="number"
            step={markupType === 'percent' ? '0.01' : '0.1'}
            value={value}
            onChange={(e) => setValue(parseFloat(e.target.value) || 0)}
          />
        </div>
        <div>
          <label className="text-sm font-medium text-text mb-2 block">Apply To *</label>
          <Select value={applyTo} onValueChange={(value) => setApplyTo(value as ApplyTo)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bid">Bid</SelectItem>
              <SelectItem value="ask">Ask</SelectItem>
              <SelectItem value="both">Both</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-sm font-medium text-text mb-2 block">Rounding (decimals) *</label>
          <Input
            type="number"
            value={rounding}
            onChange={(e) => setRounding(parseInt(e.target.value) || 2)}
          />
        </div>
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
        <Button variant="outline" onClick={() => closeModal('bulk-assign')}>
          Cancel
        </Button>
        <Button onClick={handleApply}>Apply to Selected</Button>
      </div>
    </div>
  )
}

