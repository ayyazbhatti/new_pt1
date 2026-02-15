import { useState } from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/shared/ui/table'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Input } from '@/shared/ui/input'
import { useModalStore } from '@/app/store'
import { SymbolOverrideModal } from '../modals/SymbolOverrideModal'
import { SymbolPriceOverride } from '../types/pricing'
import { mockSymbolOverrides } from '../mocks/symbolOverrides.mock'
import { Edit, X, Search } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { useMemo } from 'react'

export function SymbolPriceOverridePanel() {
  const openModal = useModalStore((state) => state.openModal)
  const [overrides, setOverrides] = useState<SymbolPriceOverride[]>(mockSymbolOverrides)
  const [search, setSearch] = useState('')

  const filteredOverrides = useMemo(() => {
    if (!search) return overrides
    const searchLower = search.toLowerCase()
    return overrides.filter(
      (o) =>
        o.symbol.toLowerCase().includes(searchLower) ||
        o.symbolName.toLowerCase().includes(searchLower)
    )
  }, [overrides, search])

  const handleSetOverride = (override: SymbolPriceOverride) => {
    openModal(
      `symbol-override-${override.symbol}`,
      <SymbolOverrideModal override={override} />,
      {
        title: 'Set Symbol Price Override',
        size: 'sm',
      }
    )
  }

  const handleRemoveOverride = (override: SymbolPriceOverride) => {
    setOverrides(
      overrides.map((o) =>
        o.symbol === override.symbol
          ? { ...o, overrideProfileId: null, overrideProfileName: null }
          : o
      )
    )
    toast.success(`Override removed for ${override.symbol}`)
  }

  const formatMarkup = (value: number) => {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
  }

  const columns: ColumnDef<SymbolPriceOverride>[] = [
    {
      accessorKey: 'symbol',
      header: 'Symbol',
      cell: ({ row }) => {
        return <span className="font-mono font-semibold text-text">{row.getValue('symbol')}</span>
      },
    },
    {
      accessorKey: 'defaultGroupProfileName',
      header: 'Default Group Profile',
      cell: ({ row }) => {
        return <span className="text-sm text-text-muted">{row.getValue('defaultGroupProfileName')}</span>
      },
    },
    {
      accessorKey: 'overrideProfileName',
      header: 'Override Profile',
      cell: ({ row }) => {
        const override = row.original
        if (override.overrideProfileName) {
          return <Badge variant="success">{override.overrideProfileName}</Badge>
        }
        return <span className="text-sm text-text-muted">None</span>
      },
    },
    {
      id: 'effectiveBidMarkup',
      header: 'Effective Bid Markup',
      cell: ({ row }) => {
        const override = row.original
        return (
          <span className="font-mono text-sm text-text">
            {formatMarkup(override.effectiveBidMarkup)}
          </span>
        )
      },
    },
    {
      id: 'effectiveAskMarkup',
      header: 'Effective Ask Markup',
      cell: ({ row }) => {
        const override = row.original
        return (
          <span className="font-mono text-sm text-text">
            {formatMarkup(override.effectiveAskMarkup)}
          </span>
        )
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const override = row.original
        return (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleSetOverride(override)}
              title="Set Override"
            >
              <Edit className="h-4 w-4 mr-2" />
              {override.overrideProfileName ? 'Change' : 'Set Override'}
            </Button>
            {override.overrideProfileName && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleRemoveOverride(override)}
                className="text-danger hover:text-danger hover:bg-danger/10"
                title="Remove Override"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        )
      },
    },
  ]

  return (
    <div className="space-y-4">
      <div className="mb-4">
        <p className="text-sm text-text-muted mb-4">
          Override the default group profile for specific symbols. If an override exists, the symbol uses that profile instead of the group profile.
        </p>
        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-sm">
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
      </div>
      <DataTable data={filteredOverrides} columns={columns} />
    </div>
  )
}

