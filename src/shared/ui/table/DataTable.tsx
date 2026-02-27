import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  ColumnDef,
  flexRender,
  Row,
} from '@tanstack/react-table'
import { cn } from '@/shared/utils'
import { Button } from '../button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../select'
import { memo } from 'react'

interface DataTableProps<TData> {
  data: TData[]
  columns: ColumnDef<TData>[]
  className?: string
  /** When true, reduces row height and cell padding for a denser table */
  dense?: boolean
  /** When false, table has no outer border/radius so it blends into parent (e.g. modal) */
  bordered?: boolean
  onRowClick?: (row: TData) => void
  pagination?: {
    page: number
    pageSize: number
    total: number
    onPageChange: (page: number) => void
    onPageSizeChange: (size: number) => void
  }
}

// Memoized table cell component to prevent re-renders
// For price cells (livePrice column), we allow re-renders since they update internally
const TableCell = memo(({ cell, onRowClick, dense }: { cell: any; onRowClick?: (row: any) => void; dense?: boolean }) => {
  return (
    <td
      key={cell.id}
      className={cn(
        'align-middle text-sm text-text whitespace-nowrap',
        dense ? 'py-2 px-3' : 'p-4'
      )}
    >
      {flexRender(cell.column.columnDef.cell, cell.getContext())}
    </td>
  )
}, (prev, next) => {
  // For price cells, cells with controlled inputs (e.g. Select), and tags dropdown (open state), allow re-renders
  const isLiveOrInteractiveCell =
    prev.cell.column.id === 'livePrice' ||
    next.cell.column.id === 'livePrice' ||
    prev.cell.column.id === 'leverageProfileName' ||
    next.cell.column.id === 'leverageProfileName' ||
    prev.cell.column.id === 'bid' ||
    next.cell.column.id === 'bid' ||
    prev.cell.column.id === 'ask' ||
    next.cell.column.id === 'ask' ||
    prev.cell.column.id === 'tags' ||
    next.cell.column.id === 'tags'
  if (isLiveOrInteractiveCell) {
    return false
  }
  
  // For other cells, only re-render if cell ID or value changes
  return prev.cell.id === next.cell.id &&
         prev.cell.getValue() === next.cell.getValue() &&
         prev.onRowClick === next.onRowClick &&
         prev.dense === next.dense
})

TableCell.displayName = 'TableCell'

// Memoized table row component
// Rows should only re-render when row data changes, not when individual cells update
const TableRow = memo(({
  row,
  onRowClick,
  dense,
}: {
  row: Row<any>
  onRowClick?: (row: any) => void
  dense?: boolean
}) => {
  return (
    <tr
      key={row.id}
      className={`hover:bg-surface-2/50 transition-colors ${onRowClick ? 'cursor-pointer' : ''}`}
      onClick={() => onRowClick?.(row.original)}
    >
      {row.getVisibleCells().map((cell) => (
        <TableCell key={cell.id} cell={cell} onRowClick={onRowClick} dense={dense} />
      ))}
    </tr>
  )
}, (prev, next) => {
  const rowDataChanged = prev.row.original !== next.row.original
  const rowIdChanged = prev.row.id !== next.row.id
  const onRowClickChanged = prev.onRowClick !== next.onRowClick
  const denseChanged = prev.dense !== next.dense
  if (!rowDataChanged && !rowIdChanged && !onRowClickChanged && !denseChanged) {
    return true
  }
  return false
})

TableRow.displayName = 'TableRow'

export function DataTable<TData>({ data, columns, className, dense, bordered = true, onRowClick, pagination }: DataTableProps<TData>) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: pagination ? undefined : getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    manualPagination: !!pagination,
    pageCount: pagination ? Math.ceil(pagination.total / pagination.pageSize) : undefined,
    // Provide stable row IDs to help with memoization
    getRowId: (row, index) => {
      // Try to use an ID field if available, otherwise use index
      if (typeof row === 'object' && row !== null && 'id' in row) {
        return String((row as any).id)
      }
      return String(index)
    },
  })

  return (
    <div className={cn('space-y-4', className)}>
      <div className={cn(bordered && 'rounded-lg border border-border', 'overflow-hidden')}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-surface-2 border-b border-border">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className={cn(
                        'text-left align-middle font-medium text-text-muted text-sm whitespace-nowrap',
                        dense ? 'h-9 py-2 px-3' : 'h-12 px-4'
                      )}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-border">
              {table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id} row={row} onRowClick={onRowClick} dense={dense} />
                ))
              ) : (
                <tr>
                  <td colSpan={columns.length} className="h-24 text-center text-text-muted">
                    No results.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {pagination ? (
        <div className="flex items-center justify-between">
          <div className="text-sm text-text-muted">
            Showing {(pagination.page - 1) * pagination.pageSize + 1} to{' '}
            {Math.min(pagination.page * pagination.pageSize, pagination.total)} of{' '}
            {pagination.total} results
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => pagination.onPageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
            >
              Previous
            </Button>
            <span className="text-sm text-text-muted">
              Page {pagination.page} of {Math.ceil(pagination.total / pagination.pageSize)}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => pagination.onPageChange(pagination.page + 1)}
              disabled={pagination.page * pagination.pageSize >= pagination.total}
            >
              Next
            </Button>
            <Select
              value={pagination.pageSize.toString()}
              onValueChange={(value) => pagination.onPageSizeChange(parseInt(value, 10))}
            >
              <SelectTrigger className="w-[100px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="20">20</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <div className="text-sm text-text-muted">
            Showing {table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1} to{' '}
            {Math.min(
              (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
              table.getFilteredRowModel().rows.length
            )}{' '}
            of {table.getFilteredRowModel().rows.length} results
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

