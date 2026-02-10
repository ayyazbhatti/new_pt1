import { useState } from 'react'
import { DataTable } from '@/shared/ui/table'
import { Button } from '@/shared/ui/button'
import { Switch } from '@/shared/ui/Switch'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { UserGroup, GroupSymbol } from '../types/group'
import { useModalStore } from '@/app/store'
import { toast } from 'react-hot-toast'
import { ColumnDef } from '@tanstack/react-table'

interface AssignSymbolsModalProps {
  group: UserGroup
}

const mockSymbols: GroupSymbol[] = [
  { symbol: 'EURUSD', currentMarkup: 1.5, leverageProfile: 'Standard Profile', enabled: true },
  { symbol: 'GBPUSD', currentMarkup: 2.0, leverageProfile: 'Standard Profile', enabled: true },
  { symbol: 'USDJPY', currentMarkup: 1.2, leverageProfile: 'Standard Profile', enabled: true },
  { symbol: 'AUDUSD', currentMarkup: 1.8, leverageProfile: 'Conservative Profile', enabled: true },
  { symbol: 'USDCAD', currentMarkup: 1.5, leverageProfile: 'Standard Profile', enabled: false },
  { symbol: 'EURGBP', currentMarkup: 2.5, leverageProfile: 'Standard Profile', enabled: true },
  { symbol: 'USDCHF', currentMarkup: 1.3, leverageProfile: 'Standard Profile', enabled: true },
  { symbol: 'NZDUSD', currentMarkup: 2.2, leverageProfile: 'Standard Profile', enabled: true },
]

export function AssignSymbolsModal({ group }: AssignSymbolsModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const [symbols, setSymbols] = useState<GroupSymbol[]>(mockSymbols)

  const handleMarkupChange = (symbol: string, markup: number) => {
    setSymbols(
      symbols.map((s) => (s.symbol === symbol ? { ...s, currentMarkup: markup } : s))
    )
  }

  const handleLeverageProfileChange = (symbol: string, profile: string) => {
    setSymbols(
      symbols.map((s) => (s.symbol === symbol ? { ...s, leverageProfile: profile } : s))
    )
  }

  const handleEnabledToggle = (symbol: string) => {
    setSymbols(
      symbols.map((s) => (s.symbol === symbol ? { ...s, enabled: !s.enabled } : s))
    )
  }

  const handleSave = () => {
    toast.success(`Symbol assignments saved for ${group.name}`)
    closeModal(`assign-symbols-${group.id}`)
  }

  const columns: ColumnDef<GroupSymbol>[] = [
    {
      accessorKey: 'symbol',
      header: 'Symbol',
      cell: ({ row }) => {
        return <span className="font-mono font-semibold">{row.getValue('symbol')}</span>
      },
    },
    {
      accessorKey: 'currentMarkup',
      header: 'Current Markup',
      cell: ({ row }) => {
        const symbol = row.original
        return (
          <Input
            type="number"
            step="0.1"
            value={symbol.currentMarkup}
            onChange={(e) =>
              handleMarkupChange(symbol.symbol, parseFloat(e.target.value) || 0)
            }
            className="w-24 h-8"
          />
        )
      },
    },
    {
      accessorKey: 'leverageProfile',
      header: 'Leverage Profile',
      cell: ({ row }) => {
        const symbol = row.original
        return (
          <Select
            value={symbol.leverageProfile}
            onValueChange={(value) => handleLeverageProfileChange(symbol.symbol, value)}
          >
            <SelectTrigger className="w-48 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Standard Profile">Standard Profile</SelectItem>
              <SelectItem value="Conservative Profile">Conservative Profile</SelectItem>
              <SelectItem value="Aggressive Profile">Aggressive Profile</SelectItem>
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
            onCheckedChange={() => handleEnabledToggle(symbol.symbol)}
          />
        )
      },
    },
  ]

  return (
    <div className="space-y-4">
      <div className="text-sm text-text-muted">
        Configure symbol-specific settings for <strong className="text-text">{group.name}</strong>
      </div>
      <div className="border border-border rounded-lg overflow-hidden">
        <DataTable data={symbols} columns={columns} />
      </div>
      <div className="flex justify-end gap-2 pt-4 border-t border-border">
        <Button variant="outline" onClick={() => closeModal(`assign-symbols-${group.id}`)}>
          Cancel
        </Button>
        <Button onClick={handleSave}>Save Changes</Button>
      </div>
    </div>
  )
}

