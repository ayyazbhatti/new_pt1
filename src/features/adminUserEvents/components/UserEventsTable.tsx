import { useMemo } from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { format } from 'date-fns'
import { DataTable } from '@/shared/ui/table'
import { EventTypeBadge } from './EventTypeBadge'
import { DeviceBadge } from './DeviceBadge'
import type { UserEventItem } from '../types'

interface UserEventsTableProps {
  items: UserEventItem[]
}

function formatDateTime(iso: string): string {
  try {
    return format(new Date(iso), 'MMM d, yyyy HH:mm:ss')
  } catch {
    return iso
  }
}

function truncateUa(ua?: string | null, max = 48): string {
  if (!ua) return '—'
  return ua.length > max ? `${ua.slice(0, max)}…` : ua
}

export function UserEventsTable({ items }: UserEventsTableProps) {
  const columns = useMemo<ColumnDef<UserEventItem>[]>(
    () => [
      {
        id: 'createdAt',
        header: 'Time',
        accessorKey: 'createdAt',
        cell: ({ row }) => (
          <span className="text-sm text-text-muted whitespace-nowrap">
            {formatDateTime(row.original.createdAt)}
          </span>
        ),
      },
      {
        id: 'subject',
        header: 'User',
        cell: ({ row }) => (
          <div>
            <span className="font-medium text-text whitespace-nowrap">
              {row.original.subjectName.trim() || row.original.subjectEmail}
            </span>
            <p className="text-xs text-text-muted m-0 mt-0.5">{row.original.subjectEmail}</p>
          </div>
        ),
      },
      {
        id: 'eventType',
        header: 'Event',
        cell: ({ row }) => <EventTypeBadge eventType={row.original.eventType} />,
      },
      {
        id: 'category',
        header: 'Category',
        accessorKey: 'category',
        cell: ({ getValue }) => (
          <span className="capitalize text-sm text-text">{String(getValue() ?? '')}</span>
        ),
      },
      {
        id: 'ip',
        header: 'IP',
        accessorKey: 'ip',
        cell: ({ getValue }) => (
          <span className="text-xs font-mono text-text-muted">{String(getValue() ?? '—')}</span>
        ),
      },
      {
        id: 'device',
        header: 'Device',
        cell: ({ row }) => (
          <DeviceBadge
            deviceClass={row.original.deviceClass}
            deviceOs={row.original.deviceOs}
            deviceBrowser={row.original.deviceBrowser}
          />
        ),
      },
      {
        id: 'userAgent',
        header: 'User agent',
        accessorKey: 'userAgent',
        cell: ({ row }) => (
          <span
            className="text-xs text-text-muted max-w-[220px] truncate block"
            title={row.original.userAgent ?? undefined}
          >
            {truncateUa(row.original.userAgent)}
          </span>
        ),
      },
      {
        id: 'actor',
        header: 'Actor',
        cell: ({ row }) => (
          <span className="text-sm text-text whitespace-nowrap">
            {row.original.actorName ??
              row.original.actorEmail ??
              (row.original.actorUserId ? row.original.actorUserId.slice(0, 8) : '—')}
          </span>
        ),
      },
    ],
    []
  )

  return <DataTable data={items} columns={columns} disablePagination dense />
}
