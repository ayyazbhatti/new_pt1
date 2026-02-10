import { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/shared/ui/table'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { AdminSymbol } from '../types/symbol'
import { useModalStore } from '@/app/store'
import { EditSymbolModal } from '../modals/EditSymbolModal'
import { SymbolGroupMarkupsModal } from '../modals/SymbolGroupMarkupsModal'
import { Eye, Edit, DollarSign, X, TrendingUp } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'

interface SymbolsTableProps {
  symbols: AdminSymbol[]
  filters?: {
    search: string
    market: string
    status: string
  }
}

const marketBadgeColors: Record<string, 'primary' | 'success' | 'warning' | 'info'> = {
  crypto: 'primary',
  forex: 'success',
  metals: 'warning',
  indices: 'info',
  stocks: 'primary',
}

export function SymbolsTable({ symbols, filters }: SymbolsTableProps) {
  const openModal = useModalStore((state) => state.openModal)
  const navigate = useNavigate()

  const filteredSymbols = useMemo(() => {
    return symbols.filter((symbol) => {
      if (filters?.search) {
        const searchLower = filters.search.toLowerCase()
        if (
          !symbol.code.toLowerCase().includes(searchLower) &&
          !symbol.name.toLowerCase().includes(searchLower)
        ) {
          return false
        }
      }
      if (filters?.market && filters.market !== 'all') {
        if (symbol.market !== filters.market) {
          return false
        }
      }
      if (filters?.status && filters.status !== 'all') {
        if (symbol.status !== filters.status) {
          return false
        }
      }
      return true
    })
  }, [symbols, filters])

  const handleView = (symbol: AdminSymbol) => {
    openModal(`view-symbol-${symbol.id}`, <EditSymbolModal symbol={symbol} readOnly />, {
      title: `View Symbol - ${symbol.code}`,
      size: 'lg',
    })
  }

  const handleEdit = (symbol: AdminSymbol) => {
    openModal(`edit-symbol-${symbol.id}`, <EditSymbolModal symbol={symbol} />, {
      title: 'Edit Symbol',
      size: 'lg',
    })
  }

  const handleGroupMarkups = (symbol: AdminSymbol) => {
    openModal(`group-markups-${symbol.id}`, <SymbolGroupMarkupsModal symbol={symbol} />, {
      title: `Group Markups - ${symbol.code}`,
      size: 'xl',
    })
  }

  const handleMarkup = (symbol: AdminSymbol) => {
    navigate(`/admin/markup?symbol=${symbol.code}`)
  }

  const handleDisable = (symbol: AdminSymbol) => {
    toast.success(`Symbol "${symbol.code}" ${symbol.status === 'enabled' ? 'disabled' : 'enabled'}`)
  }

  const columns: ColumnDef<AdminSymbol>[] = [
    {
      accessorKey: 'code',
      header: 'Symbol',
      cell: ({ row }) => {
        const symbol = row.original
        return (
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold">{symbol.code}</span>
            <Badge variant={marketBadgeColors[symbol.market] || 'neutral'} className="text-xs">
              {symbol.market}
            </Badge>
          </div>
        )
      },
    },
    {
      accessorKey: 'name',
      header: 'Display Name',
    },
    {
      accessorKey: 'market',
      header: 'Market',
      cell: ({ row }) => {
        const market = row.getValue('market') as string
        return <span className="capitalize">{market}</span>
      },
    },
    {
      accessorKey: 'provider',
      header: 'Price Source',
    },
    {
      accessorKey: 'leverageProfileName',
      header: 'Leverage Profile',
    },
    {
      accessorKey: 'contractSize',
      header: 'Contract Size',
      cell: ({ row }) => {
        const size = row.getValue('contractSize') as number
        return <span className="font-mono">{size.toLocaleString()}</span>
      },
    },
    {
      accessorKey: 'tickSize',
      header: 'Tick Size',
      cell: ({ row }) => {
        const size = row.getValue('tickSize') as number
        return <span className="font-mono">{size}</span>
      },
    },
    {
      id: 'lotRange',
      header: 'Lot Min / Max',
      cell: ({ row }) => {
        const symbol = row.original
        return (
          <span className="font-mono text-sm">
            {symbol.lotMin} / {symbol.lotMax}
          </span>
        )
      },
    },
    {
      id: 'groupsMarkup',
      header: 'Groups Markup',
      cell: ({ row }) => {
        // Mock: 3 groups assigned
        return (
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-muted">3 groups</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleGroupMarkups(row.original)}
              className="h-6 px-2 text-xs"
            >
              View
            </Button>
          </div>
        )
      },
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const status = row.getValue('status') as string
        const variant = status === 'enabled' ? 'success' : 'danger'
        return <Badge variant={variant}>{status}</Badge>
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const symbol = row.original
        return (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleView(symbol)}
              title="View"
            >
              <Eye className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleEdit(symbol)}
              title="Edit"
            >
              <Edit className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleGroupMarkups(symbol)}
              title="Group Markups"
            >
              <DollarSign className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleMarkup(symbol)}
              title="Markup"
            >
              <TrendingUp className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleDisable(symbol)}
              title={symbol.status === 'enabled' ? 'Disable' : 'Enable'}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )
      },
    },
  ]

  return <DataTable data={filteredSymbols} columns={columns} />
}

