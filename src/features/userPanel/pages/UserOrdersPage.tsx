import { useState, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ColumnDef } from '@tanstack/react-table'
import { ContentShell, PageHeader } from '@/shared/layout'
import {
  Card,
  Button,
  Input,
  DataTable,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui'
import { format } from 'date-fns'
import {
  FileText,
  History,
  Loader2,
  Search,
  X,
  Activity,
  ClipboardList,
  DollarSign,
  Clock,
} from 'lucide-react'
import { cn } from '@/shared/utils'
import { listOrders, cancelOrder, Order } from '@/features/terminal/api/orders.api'
import { toast } from '@/shared/components/common'

function StatCard({
  title,
  value,
  subtext,
  icon: Icon,
  valueClassName,
}: {
  title: string
  value: string
  subtext?: string
  icon: React.ElementType
  valueClassName?: string
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-muted">{title}</p>
          <p className={cn('mt-1 text-2xl font-bold tabular-nums', valueClassName ?? 'text-text')}>
            {value}
          </p>
          {subtext != null && subtext !== '' && (
            <p className="mt-0.5 text-xs text-text-muted">{subtext}</p>
          )}
        </div>
        <div className="rounded-lg bg-surface-2 p-2.5 shrink-0">
          <Icon className="h-5 w-5 text-accent" />
        </div>
      </div>
    </Card>
  )
}

type ViewMode = 'open' | 'history'
type SideFilter = 'all' | 'BUY' | 'SELL'

function buildOrderColumns(viewMode: ViewMode): ColumnDef<Order>[] {
  const isHistory = viewMode === 'history'
  return [
    {
      id: 'id',
      header: 'ID',
      cell: ({ row }) => (
        <span className="font-mono text-xs text-text-muted">{row.original.id.slice(0, 8)}…</span>
      ),
    },
    {
      accessorKey: 'symbol',
      header: 'Symbol',
      cell: ({ row }) => <span className="font-medium text-text">{row.original.symbol}</span>,
    },
    {
      accessorKey: 'order_type',
      header: 'Type',
      cell: ({ row }) => (
        <span className="text-text-muted uppercase text-xs">{row.original.order_type}</span>
      ),
    },
    {
      accessorKey: 'side',
      header: 'Side',
      cell: ({ row }) => {
        const side = row.original.side
        const isBuy = side === 'BUY'
        return (
          <span
            className={cn(
              'inline-flex rounded px-2 py-0.5 text-xs font-medium',
              isBuy ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'
            )}
          >
            {side}
          </span>
        )
      },
    },
    {
      accessorKey: 'size',
      header: 'Size',
      cell: ({ row }) => (
        <span className="tabular-nums text-text">
          {parseFloat(row.original.size || '0').toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 6,
          })}
        </span>
      ),
    },
    ...(isHistory
      ? [
          {
            id: 'filled_size',
            header: 'Filled',
            cell: ({ row }: { row: { original: Order } }) => {
              const filled = parseFloat(
                row.original.filled_size || row.original.size || '0'
              )
              return (
                <span className="tabular-nums text-text">
                  {filled.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 6,
                  })}
                </span>
              )
            },
          } as ColumnDef<Order>,
          {
            id: 'avg_price',
            header: 'Avg price',
            cell: ({ row }: { row: { original: Order } }) => {
              const avg =
                parseFloat(
                  row.original.average_price ||
                    row.original.avg_fill_price ||
                    row.original.price ||
                    '0'
                )
              return (
                <span className="tabular-nums text-text-muted">
                  {avg > 0 ? `$${avg.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                </span>
              )
            },
          } as ColumnDef<Order>,
        ]
      : [
          {
            accessorKey: 'price',
            header: 'Price',
            cell: ({ row }: { row: { original: Order } }) => (
              <span className="tabular-nums text-text-muted">
                {row.original.price || row.original.stop_price || '—'}
              </span>
            ),
          } as ColumnDef<Order>,
        ]),
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const status = row.original.status
        const statusClass =
          status === 'filled'
            ? 'bg-success/15 text-success'
            : status === 'pending'
              ? 'bg-blue-500/15 text-blue-400'
              : 'bg-text-muted/15 text-text-muted'
        return (
          <span className={cn('inline-flex rounded px-2 py-0.5 text-xs font-medium', statusClass)}>
            {status}
          </span>
        )
      },
    },
    {
      id: 'created_at',
      header: isHistory ? 'Created' : 'Created',
      cell: ({ row }) => (
        <span className="tabular-nums text-text-muted text-xs">
          {format(new Date(row.original.created_at), 'MMM d, HH:mm')}
        </span>
      ),
    },
  ]
}

export function UserOrdersPage() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [filterView, setFilterView] = useState<ViewMode>('open')
  const [filterSymbol, setFilterSymbol] = useState('')
  const [filterSide, setFilterSide] = useState<SideFilter>('all')

  const queryClient = useQueryClient()

  const { data: pendingData, isLoading: pendingLoading } = useQuery({
    queryKey: ['user', 'orders', 'pending'],
    queryFn: () => listOrders({ status: 'pending', limit: 100 }),
  })
  const { data: filledData, isLoading: filledLoading } = useQuery({
    queryKey: ['user', 'orders', 'filled'],
    queryFn: () => listOrders({ status: 'filled', limit: 100 }),
  })
  const { data: cancelledData } = useQuery({
    queryKey: ['user', 'orders', 'cancelled'],
    queryFn: () => listOrders({ status: 'cancelled', limit: 100 }),
  })

  const pendingOrders = useMemo(() => pendingData?.items ?? [], [pendingData])
  const historyOrders = useMemo(() => {
    const filled = filledData?.items ?? []
    const cancelled = cancelledData?.items ?? []
    const all = [...filled, ...cancelled].sort(
      (a, b) =>
        new Date(b.filled_at || b.cancelled_at || b.updated_at || b.created_at).getTime() -
        new Date(a.filled_at || a.cancelled_at || a.updated_at || a.created_at).getTime()
    )
    return all
  }, [filledData, cancelledData])

  const baseOrders = filterView === 'open' ? pendingOrders : historyOrders

  const filteredOrders = useMemo(() => {
    return baseOrders.filter((o) => {
      const matchSymbol =
        !filterSymbol.trim() ||
        o.symbol.toUpperCase().includes(filterSymbol.trim().toUpperCase())
      const matchSide = filterSide === 'all' || o.side === filterSide
      return matchSymbol && matchSide
    })
  }, [baseOrders, filterSymbol, filterSide])

  const total = filteredOrders.length
  const hasActiveFilters = filterSymbol.trim() !== '' || filterSide !== 'all'
  const isLoading = filterView === 'open' ? pendingLoading : filledLoading

  const positionColumns = useMemo(() => buildOrderColumns(filterView), [filterView])

  const paginatedOrders = useMemo(() => {
    const start = (page - 1) * pageSize
    return filteredOrders.slice(start, start + pageSize)
  }, [filteredOrders, page, pageSize])

  useEffect(() => {
    const totalPages = Math.ceil(total / pageSize) || 1
    if (page > totalPages) setPage(1)
  }, [total, pageSize, page])

  const isHistory = filterView === 'history'
  const totalNotional = useMemo(
    () =>
      filteredOrders.reduce(
        (sum, o) =>
          sum +
          parseFloat(o.size || '0') *
            parseFloat(o.average_price || o.avg_fill_price || o.price || '0'),
        0
      ),
    [filteredOrders]
  )

  const clearFilters = () => {
    setFilterSymbol('')
    setFilterSide('all')
    setPage(1)
  }

  const handleCancelOrder = async (orderId: string) => {
    try {
      await cancelOrder(orderId)
      toast.success('Order cancelled')
      queryClient.invalidateQueries({ queryKey: ['user', 'orders', 'pending'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to cancel order')
    }
  }

  return (
    <ContentShell>
      <PageHeader
        title="Orders"
        description="View and manage your orders and order history"
      />

      <section className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-text">Overview</h2>
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i} className="p-5">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
                  <span className="text-sm text-text-muted">Loading…</span>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title={isHistory ? 'Filled orders' : 'Open orders'}
              value={String(total)}
              subtext={isHistory ? 'Completed' : 'Pending'}
              icon={isHistory ? History : ClipboardList}
            />
            <StatCard
              title="Total notional"
              value={`$${totalNotional.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              subtext="Size × price"
              icon={DollarSign}
            />
            <StatCard
              title="Orders"
              value={String(filteredOrders.length)}
              subtext={isHistory ? 'In history' : 'Active'}
              icon={FileText}
            />
            <StatCard
              title="View"
              value={isHistory ? 'History' : 'Open'}
              subtext="Current tab"
              icon={Clock}
            />
          </div>
        )}
      </section>

      <section>
        <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold text-text">
            {filterView === 'open' ? 'Open orders' : 'Order history'}
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            <Select
              value={filterView}
              onValueChange={(value) => {
                setFilterView(value as ViewMode)
                setPage(1)
              }}
            >
              <SelectTrigger className="w-[160px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">
                  <span className="flex items-center gap-2">
                    <Activity className="h-3.5 w-3.5" />
                    Open orders
                  </span>
                </SelectItem>
                <SelectItem value="history">
                  <span className="flex items-center gap-2">
                    <History className="h-3.5 w-3.5" />
                    Order history
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
            <div className="relative flex-1 min-w-[140px] sm:min-w-[180px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <Input
                type="text"
                placeholder="Filter by symbol"
                value={filterSymbol}
                onChange={(e) => {
                  setFilterSymbol(e.target.value)
                  setPage(1)
                }}
                className="pl-9 h-9"
              />
            </div>
            <Select
              value={filterSide}
              onValueChange={(value) => {
                setFilterSide(value as SideFilter)
                setPage(1)
              }}
            >
              <SelectTrigger className="w-[120px] h-9">
                <SelectValue placeholder="Side" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sides</SelectItem>
                <SelectItem value="BUY">Buy</SelectItem>
                <SelectItem value="SELL">Sell</SelectItem>
              </SelectContent>
            </Select>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="h-9 text-text-muted hover:text-text"
              >
                <X className="h-4 w-4 mr-1" />
                Clear filters
              </Button>
            )}
          </div>
        </div>
        <Card className="overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-text-muted">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading orders…
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-text-muted">
              {isHistory ? (
                <>
                  <History className="h-12 w-12 mb-3 opacity-50" />
                  <p className="text-sm font-medium">No order history</p>
                  <p className="text-xs mt-1">Filled orders will appear here</p>
                </>
              ) : (
                <>
                  <ClipboardList className="h-12 w-12 mb-3 opacity-50" />
                  <p className="text-sm font-medium">No open orders</p>
                  <p className="text-xs mt-1">Place an order to see it here</p>
                </>
              )}
            </div>
          ) : (
            <>
              <DataTable<Order>
                data={paginatedOrders}
                columns={
                  filterView === 'open'
                    ? [
                        ...positionColumns,
                        {
                          id: 'actions',
                          header: '',
                          cell: ({ row }: { row: { original: Order } }) => (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 text-danger hover:text-danger hover:bg-danger/10"
                              onClick={() => handleCancelOrder(row.original.id)}
                            >
                              Cancel
                            </Button>
                          ),
                        } as ColumnDef<Order>,
                      ]
                    : positionColumns
                }
                bordered={false}
                pagination={{
                  page,
                  pageSize,
                  total,
                  onPageChange: setPage,
                  onPageSizeChange: (size) => {
                    setPageSize(size)
                    setPage(1)
                  },
                }}
              />
            </>
          )}
        </Card>
      </section>
    </ContentShell>
  )
}
