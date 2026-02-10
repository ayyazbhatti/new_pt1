import { useState, useMemo } from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/shared/ui/table'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Position } from '../types/adminTrading'
import { useModalStore } from '@/app/store'
import { PositionDetailsModal } from '../modals/PositionDetailsModal'
import { ConfirmActionModal } from '../modals/ConfirmActionModal'
import { Eye, X } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { filterPositions } from '../utils/filters'
import { formatDateTime, formatPercent } from '../utils/formatters'
import { mockGroups } from '../mocks/groups.mock'
import { mockPositions } from '../mocks/positions.mock'

export function PositionsAdminPanel() {
  const openModal = useModalStore((state) => state.openModal)
  const [positions, setPositions] = useState<Position[]>(mockPositions)
  const [filters, setFilters] = useState({
    status: 'open',
    side: 'all',
    group: 'all',
    symbol: '',
    minPnl: '',
    maxPnl: '',
  })

  const filteredPositions = useMemo(() => {
    return filterPositions(positions, {
      ...filters,
      minPnl: filters.minPnl ? parseFloat(filters.minPnl) : undefined,
      maxPnl: filters.maxPnl ? parseFloat(filters.maxPnl) : undefined,
    })
  }, [positions, filters])

  const handleView = (position: Position) => {
    openModal(`position-details-${position.id}`, <PositionDetailsModal position={position} />, {
      title: `Position Details - ${position.id}`,
      size: 'lg',
    })
  }

  const handleForceClose = (position: Position) => {
    const modalKey = `force-close-${position.id}`
    openModal(
      modalKey,
      <ConfirmActionModal
        title="Force Close Position"
        message={`Force close position ${position.id} at current market price?`}
        onConfirm={() => {
          setPositions(
            positions.map((p) =>
              p.id === position.id
                ? { ...p, status: 'closed' as const, closedAt: new Date().toISOString() }
                : p
            )
          )
          toast.success(`Position ${position.id} force closed`)
        }}
        modalKey={modalKey}
      />,
      {
        title: 'Confirm Force Close',
        size: 'sm',
      }
    )
  }

  const getSideBadge = (side: string) => {
    return (
      <Badge variant={side === 'long' ? 'success' : 'danger'} className="uppercase">
        {side}
      </Badge>
    )
  }

  const columns: ColumnDef<Position>[] = [
    {
      accessorKey: 'id',
      header: 'Position ID',
      cell: ({ row }) => {
        return <span className="font-mono text-sm">{row.getValue('id')}</span>
      },
    },
    {
      id: 'user',
      header: 'User',
      cell: ({ row }) => {
        const position = row.original
        return (
          <div>
            <div className="text-sm text-text">{position.userName}</div>
            <div className="text-xs text-text-muted font-mono">{position.userId}</div>
          </div>
        )
      },
    },
    {
      accessorKey: 'groupName',
      header: 'Group',
    },
    {
      accessorKey: 'symbol',
      header: 'Symbol',
      cell: ({ row }) => {
        return <span className="font-mono font-semibold">{row.getValue('symbol')}</span>
      },
    },
    {
      accessorKey: 'side',
      header: 'Side',
      cell: ({ row }) => getSideBadge(row.getValue('side')),
    },
    {
      accessorKey: 'size',
      header: 'Size',
      cell: ({ row }) => {
        return <span className="font-mono">{row.getValue('size')}</span>
      },
    },
    {
      accessorKey: 'entryPrice',
      header: 'Entry',
      cell: ({ row }) => {
        return <span className="font-mono">{row.getValue('entryPrice')}</span>
      },
    },
    {
      accessorKey: 'markPrice',
      header: 'Mark',
      cell: ({ row }) => {
        return <span className="font-mono">{row.getValue('markPrice')}</span>
      },
    },
    {
      accessorKey: 'pnl',
      header: 'PnL',
      cell: ({ row }) => {
        const position = row.original
        const color = position.pnl >= 0 ? 'text-success' : 'text-danger'
        return (
          <div>
            <div className={`font-mono font-semibold ${color}`}>
              {position.pnl >= 0 ? '+' : ''}
              {position.pnl.toFixed(2)}
            </div>
            <div className={`text-xs ${color}`}>{formatPercent(position.pnlPercent)}</div>
          </div>
        )
      },
    },
    {
      accessorKey: 'leverage',
      header: 'Leverage',
      cell: ({ row }) => {
        return <span className="font-mono">1:{row.getValue('leverage')}</span>
      },
    },
    {
      accessorKey: 'marginUsed',
      header: 'Margin Used',
      cell: ({ row }) => {
        return <span className="font-mono">${row.getValue('marginUsed')}</span>
      },
    },
    {
      accessorKey: 'liquidationPrice',
      header: 'Liquidation',
      cell: ({ row }) => {
        return <span className="font-mono text-danger">{row.getValue('liquidationPrice')}</span>
      },
    },
    {
      accessorKey: 'openedAt',
      header: 'Opened',
      cell: ({ row }) => {
        return <span className="text-sm text-text-muted">{formatDateTime(row.getValue('openedAt'))}</span>
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const position = row.original
        return (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => handleView(position)} title="View">
              <Eye className="h-4 w-4" />
            </Button>
            {position.status === 'open' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleForceClose(position)}
                title="Force Close"
                className="text-danger hover:text-danger hover:bg-danger/10"
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
      <div className="flex items-center gap-4 flex-wrap">
        <Select
          value={filters.status}
          onValueChange={(value) => setFilters({ ...filters, status: value })}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.side} onValueChange={(value) => setFilters({ ...filters, side: value })}>
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder="Side" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="long">Long</SelectItem>
            <SelectItem value="short">Short</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filters.group}
          onValueChange={(value) => setFilters({ ...filters, group: value })}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Group" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Groups</SelectItem>
            {mockGroups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="search"
          placeholder="Search symbols..."
          value={filters.symbol}
          onChange={(e) => setFilters({ ...filters, symbol: e.target.value })}
          className="flex-1 max-w-sm"
        />
        <Input
          type="number"
          placeholder="Min PnL"
          value={filters.minPnl}
          onChange={(e) => setFilters({ ...filters, minPnl: e.target.value })}
          className="w-[120px]"
        />
        <Input
          type="number"
          placeholder="Max PnL"
          value={filters.maxPnl}
          onChange={(e) => setFilters({ ...filters, maxPnl: e.target.value })}
          className="w-[120px]"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setFilters({ status: 'open', side: 'all', group: 'all', symbol: '', minPnl: '', maxPnl: '' })
          }
        >
          Clear
        </Button>
      </div>
      <DataTable data={filteredPositions} columns={columns} />
    </div>
  )
}

