import { useState, useMemo } from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/shared/ui/table'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { MarginEvent } from '../types/adminTrading'
import { useModalStore } from '@/app/store'
import { EventDetailsModal } from '../modals/EventDetailsModal'
import { Eye, CheckCircle } from 'lucide-react'
import { toast } from '@/shared/components/common'
import { filterMarginEvents } from '../utils/filters'
import { formatDateTime } from '../utils/formatters'
import { mockGroups } from '../mocks/groups.mock'
import { mockMarginEvents } from '../mocks/marginEvents.mock'

export function MarginEventsAdminPanel() {
  const openModal = useModalStore((state) => state.openModal)
  const [events, setEvents] = useState<MarginEvent[]>(mockMarginEvents)
  const [filters, setFilters] = useState({
    type: 'all',
    severity: 'all',
    group: 'all',
    symbol: '',
    user: '',
  })

  const filteredEvents = useMemo(() => {
    return filterMarginEvents(events, filters)
  }, [events, filters])

  const handleView = (event: MarginEvent) => {
    openModal(`event-details-${event.id}`, <EventDetailsModal event={event} />, {
      title: `Event Details - ${event.id}`,
      size: 'lg',
    })
  }

  const handleAcknowledge = (event: MarginEvent) => {
    setEvents(
      events.map((e) => (e.id === event.id ? { ...e, acknowledged: !e.acknowledged } : e))
    )
    toast.success(`Event ${event.id} ${event.acknowledged ? 'unacknowledged' : 'acknowledged'}`)
  }

  const getTypeBadge = (type: string) => {
    return (
      <Badge variant={type === 'liquidation' ? 'danger' : 'warning'} className="uppercase">
        {type.replace('_', ' ')}
      </Badge>
    )
  }

  const getSeverityBadge = (severity: string) => {
    const variants: Record<string, 'success' | 'warning' | 'danger'> = {
      low: 'success',
      medium: 'warning',
      high: 'danger',
    }
    return <Badge variant={variants[severity] || 'neutral'} className="capitalize">{severity}</Badge>
  }

  const columns: ColumnDef<MarginEvent>[] = [
    {
      accessorKey: 'id',
      header: 'Event ID',
      cell: ({ row }) => {
        return <span className="font-mono text-sm">{row.getValue('id')}</span>
      },
    },
    {
      accessorKey: 'time',
      header: 'Time',
      cell: ({ row }) => {
        return <span className="text-sm text-text-muted">{formatDateTime(row.getValue('time'))}</span>
      },
    },
    {
      accessorKey: 'type',
      header: 'Type',
      cell: ({ row }) => getTypeBadge(row.getValue('type')),
    },
    {
      accessorKey: 'severity',
      header: 'Severity',
      cell: ({ row }) => getSeverityBadge(row.getValue('severity')),
    },
    {
      id: 'user',
      header: 'User',
      cell: ({ row }) => {
        const event = row.original
        return (
          <div>
            <div className="text-sm text-text">{event.userName}</div>
            <div className="text-xs text-text-muted font-mono">{event.userId}</div>
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
      accessorKey: 'equity',
      header: 'Equity',
      cell: ({ row }) => {
        return <span className="font-mono">${row.getValue('equity')}</span>
      },
    },
    {
      accessorKey: 'margin',
      header: 'Margin',
      cell: ({ row }) => {
        return <span className="font-mono">${row.getValue('margin')}</span>
      },
    },
    {
      accessorKey: 'maintenance',
      header: 'Maintenance',
      cell: ({ row }) => {
        return <span className="font-mono">${row.getValue('maintenance')}</span>
      },
    },
    {
      accessorKey: 'message',
      header: 'Message',
      cell: ({ row }) => {
        return <span className="text-sm text-text-muted">{row.getValue('message')}</span>
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const event = row.original
        return (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => handleView(event)} title="View">
              <Eye className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleAcknowledge(event)}
              title={event.acknowledged ? 'Unacknowledge' : 'Acknowledge'}
              className={event.acknowledged ? 'text-success' : 'text-text-muted'}
            >
              <CheckCircle className="h-4 w-4" />
            </Button>
          </div>
        )
      },
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 flex-wrap">
        <Select
          value={filters.type}
          onValueChange={(value) => setFilters({ ...filters, type: value })}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="margin_call">Margin Call</SelectItem>
            <SelectItem value="liquidation">Liquidation</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filters.severity}
          onValueChange={(value) => setFilters({ ...filters, severity: value })}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="high">High</SelectItem>
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
          type="search"
          placeholder="Search users..."
          value={filters.user}
          onChange={(e) => setFilters({ ...filters, user: e.target.value })}
          className="flex-1 max-w-sm"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => setFilters({ type: 'all', severity: 'all', group: 'all', symbol: '', user: '' })}
        >
          Clear
        </Button>
      </div>
      <DataTable data={filteredEvents} columns={columns} />
    </div>
  )
}

