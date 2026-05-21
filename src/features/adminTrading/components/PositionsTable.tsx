import React, { useMemo, useCallback, useRef, useState } from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { flexRender } from '@tanstack/react-table'
import { AdminPosition } from '../types'
import { Badge } from '@/shared/ui/badge'
import { TableRowActionsMenu } from './TableRowActionsMenu'
import { LivePnlAmountCell, LivePnlPercentCell } from './LivePnlCell'
import { format } from 'date-fns'
import { useAdminTradingStore } from '../store/adminTrading.store'
import { liquidatePosition } from '../api/positions'
import { useCanAccess } from '@/shared/utils/permissions'
import { toast } from '@/shared/components/common'
import { cn } from '@/shared/utils'
import { useFormatFromUsd } from '@/shared/currency'

/** Fixed column widths so header and body columns stay aligned when cells are empty */
const COLUMN_WIDTHS = [
  '90px',  // Position ID
  '120px', // Name
  '180px', // Email
  '90px',  // Group
  '100px', // Symbol
  '80px',  // Side
  '80px',  // Size
  '95px',  // Entry
  '90px',  // Mark
  '95px',  // Live PnL (USD-denominated; cell uses hooks)
  '80px',  // PnL %
  '90px',  // Margin
  '85px',  // SL
  '85px',  // TP
  '85px',  // Status
  '72px',  // Actions (⋮ menu only)
]
const TABLE_MIN_WIDTH = 1407 // sum of COLUMN_WIDTHS for horizontal scroll
const GRID_COLUMNS = COLUMN_WIDTHS.join(' ')

interface PositionsTableProps {
  positions: AdminPosition[]
  onPositionClick?: (position: AdminPosition) => void
  /** When true (e.g. Position History tab), hide Close/Modify/Liquidate; only show Details */
  readOnly?: boolean
}

export function PositionsTable({ positions, onPositionClick, readOnly }: PositionsTableProps) {
  const { setSelectedPositionId, setOpenModal } = useAdminTradingStore()
  const formatMoney = useFormatFromUsd()
  const [openActionsMenuId, setOpenActionsMenuId] = useState<string | null>(null)
  const canClosePosition = useCanAccess('trading:close_position')
  const canLiquidate = useCanAccess('trading:liquidate')

  const handleClose = useCallback(
    (position: AdminPosition) => {
      setSelectedPositionId(position.id)
      setOpenModal('close-position')
    },
    [setSelectedPositionId, setOpenModal]
  )

  const handleModifyPosition = useCallback(
    (position: AdminPosition) => {
      setSelectedPositionId(position.id)
      setOpenModal('modify-position')
    },
    [setSelectedPositionId, setOpenModal]
  )

  const handleModifySltp = useCallback(
    (position: AdminPosition) => {
      setSelectedPositionId(position.id)
      setOpenModal('modify-sltp')
    },
    [setSelectedPositionId, setOpenModal]
  )

  const handleLiquidate = useCallback(async (position: AdminPosition) => {
    if (
      !confirm(
        `Liquidate position ${position.id.slice(0, 8)}...? This is an emergency action and cannot be undone.`
      )
    ) {
      return
    }
    try {
      await liquidatePosition(position.id)
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Failed to liquidate position')
    }
  }, [])

  const handleRowClick = useCallback(
    (position: AdminPosition) => {
      setSelectedPositionId(position.id)
      setOpenModal('position-details')
      onPositionClick?.(position)
    },
    [setSelectedPositionId, setOpenModal, onPositionClick]
  )

  const columns: ColumnDef<AdminPosition>[] = useMemo(
    () => [
      {
        accessorKey: 'id',
        header: 'Position ID',
        cell: ({ row }) => (
          <button
            onClick={() => handleRowClick(row.original)}
            className="font-mono text-xs text-accent hover:underline"
          >
            {row.original.id.slice(0, 8)}...
          </button>
        ),
      },
      {
        accessorKey: 'userName',
        header: 'Name',
        cell: ({ row }) => (
          <span className="text-sm text-text">{row.original.userName ?? '—'}</span>
        ),
      },
      {
        accessorKey: 'userEmail',
        header: 'Email',
        cell: ({ row }) => (
          <span className="text-sm text-text-muted">{row.original.userEmail ?? '—'}</span>
        ),
      },
      {
        accessorKey: 'groupName',
        header: 'Group',
        cell: ({ row }) => <span className="text-sm text-text">{row.original.groupName}</span>,
      },
      {
        accessorKey: 'symbol',
        header: 'Symbol',
        cell: ({ row }) => <span className="text-sm font-medium text-text">{row.original.symbol}</span>,
      },
      {
        accessorKey: 'side',
        header: 'Side',
        cell: ({ row }) => (
          <Badge variant={row.original.side === 'LONG' ? 'success' : 'danger'}>
            {row.original.side}
          </Badge>
        ),
      },
      {
        accessorKey: 'size',
        header: 'Size',
        cell: ({ row }) => (
          <span className="text-sm font-mono text-text">{row.original.size.toLocaleString()}</span>
        ),
      },
      {
        accessorKey: 'entryPrice',
        header: 'Entry',
        cell: ({ row }) => (
          <span className="text-sm font-mono text-text">
            {row.original.entryPrice.toFixed(2)}
          </span>
        ),
      },
      {
        accessorKey: 'markPrice',
        header: 'Mark',
        cell: ({ row }) => (
          <span className="text-sm font-mono text-text">{row.original.markPrice.toFixed(2)}</span>
        ),
      },
      {
        id: 'livePnlAmount',
        header: readOnly ? 'Realized PnL' : 'Live PnL',
        cell: ({ row }) => <LivePnlAmountCell position={row.original} readOnly={readOnly} />,
      },
      {
        id: 'livePnlPercent',
        header: readOnly ? 'PnL %' : 'PnL %',
        cell: ({ row }) => <LivePnlPercentCell position={row.original} readOnly={readOnly} />,
      },
      {
        accessorKey: 'marginUsed',
        header: 'Margin',
        cell: ({ row }) => (
          <span className="text-sm font-mono text-text">
            {formatMoney(row.original.marginUsed)}
          </span>
        ),
      },
      {
        accessorKey: 'stopLoss',
        header: 'SL',
        cell: ({ row }) => (
          <span className="text-sm font-mono text-text">
            {row.original.stopLoss ? row.original.stopLoss.toFixed(2) : '—'}
          </span>
        ),
      },
      {
        accessorKey: 'takeProfit',
        header: 'TP',
        cell: ({ row }) => (
          <span className="text-sm font-mono text-text">
            {row.original.takeProfit ? row.original.takeProfit.toFixed(2) : '—'}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => {
          const status = row.original.status
          const variant =
            status === 'OPEN' ? 'success' : status === 'LIQUIDATED' ? 'danger' : 'neutral'
          return <Badge variant={variant}>{status}</Badge>
        },
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => {
          const position = row.original
          const isOpen = position.status === 'OPEN' || position.status === 'open'
          const menuItems = [
            { label: 'View details', onClick: () => handleRowClick(position) },
            ...(isOpen && !readOnly
              ? [
                  ...(canClosePosition
                    ? [
                        { label: 'Close position', onClick: () => handleClose(position) },
                        { label: 'Modify position', onClick: () => handleModifyPosition(position) },
                        { label: 'Modify SL/TP', onClick: () => handleModifySltp(position) },
                      ]
                    : []),
                  ...(canLiquidate
                    ? [
                        {
                          label: 'Liquidate',
                          onClick: () => handleLiquidate(position),
                          destructive: true,
                        },
                      ]
                    : []),
                ]
              : []),
          ]
          return (
            <div onClick={(e) => e.stopPropagation()}>
              <TableRowActionsMenu
                items={menuItems}
                open={openActionsMenuId === position.id}
                onOpenChange={(isOpen) =>
                  setOpenActionsMenuId(isOpen ? position.id : null)
                }
              />
            </div>
          )
        },
      },
    ],
    [
      handleClose,
      handleModifyPosition,
      handleModifySltp,
      handleLiquidate,
      handleRowClick,
      canClosePosition,
      canLiquidate,
      readOnly,
      openActionsMenuId,
      formatMoney,
    ]
  )

  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: positions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 10,
  })

  if (positions.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-text-muted">
        <p>No positions found</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      {/* Single scroll container so header and body scroll together horizontally */}
      <div ref={parentRef} className="scroll-surface h-[600px] overflow-auto">
        <div style={{ minWidth: TABLE_MIN_WIDTH, width: 'max-content' }}>
          {/* Header row - sticky for vertical scroll only, scrolls with content horizontally */}
          <div
            className="sticky top-0 z-10 grid bg-surface-2 border-b border-border"
            style={{ gridTemplateColumns: GRID_COLUMNS }}
          >
            {columns.map((column) => (
              <div
                key={(column as { id?: string; accessorKey?: string }).id || (column as { id?: string; accessorKey?: string }).accessorKey}
                className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider truncate"
              >
                {typeof column.header === 'string' ? column.header : '—'}
              </div>
            ))}
          </div>

          {/* Virtualized body */}
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const position = positions[virtualRow.index]
              return (
                <div
                  key={virtualRow.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    minWidth: TABLE_MIN_WIDTH,
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                    display: 'grid',
                    gridTemplateColumns: GRID_COLUMNS,
                    alignItems: 'center',
                  }}
                  className={cn(
                    'border-b border-border hover:bg-surface-2/50 transition-colors cursor-pointer'
                  )}
                  onClick={() => handleRowClick(position)}
                >
                  {columns.map((column) => (
                    <div
                      key={(column as { id?: string; accessorKey?: string }).id || (column as { id?: string; accessorKey?: string }).accessorKey}
                      className="px-4 py-3 truncate"
                      onClick={(e) => {
                        if (column.id === 'actions') {
                          e.stopPropagation()
                        }
                      }}
                    >
                      {column.cell
                        ? flexRender(column.cell, {
                            row: { original: position, getValue: () => position },
                          } as any)
                        : '—'}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

