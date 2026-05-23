import { useState, useMemo, useEffect, memo, useCallback, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
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
  BarChart3,
  TrendingUp,
  Wallet,
  DollarSign,
  ArrowUpRight,
  ArrowDownRight,
  MoreHorizontal,
  Loader2,
  Search,
  X,
  History,
  Activity,
} from 'lucide-react'
import { cn } from '@/shared/utils'
import { getOpenPositions, getClosedPositions, type Position } from '@/features/terminal/api/positions.api'
import {
  usePriceStreamConnection,
  useSymbolPrice,
  normalizeSymbolKey,
} from '@/features/symbols/hooks/usePriceStream'
import {
  useCurrencyCode,
  useFormatFromQuoteCurrency,
  useFormatSignedFromQuoteCurrency,
  useFxRatesMap,
} from '@/shared/currency'
import type { CurrencyCode } from '@/shared/currency/types'
import { convertAmount, formatAmount, formatSignedAmount } from '@/shared/currency/format'
import { formatPositionSize } from '@/shared/finance/sizeFormat'
import { formatSymbolPrice } from '@/shared/finance/priceFormat'
import { useSymbolMetaLookup, getSymbolMetaForCode } from '@/features/terminal/hooks/useSymbolMetaLookup'

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

function parseNum(s: string | undefined): number {
  if (s == null || s === '') return 0
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : 0
}

/** Compute unrealized PnL from a live tick (or stored unrealized when tick missing). */
function unrealizedPnlFromTick(pos: Position, tick: { bid: string; ask: string } | null): number {
  const entryPrice = parseNum(pos.entry_price)
  const sizeNum = parseNum(pos.size)
  if (tick) {
    const mark = pos.side === 'LONG' ? parseFloat(tick.bid) : parseFloat(tick.ask)
    if (Number.isFinite(mark)) {
      return pos.side === 'LONG'
        ? (mark - entryPrice) * sizeNum
        : (entryPrice - mark) * sizeNum
    }
  }
  return parseNum(pos.unrealized_pnl)
}

type ViewMode = 'open' | 'history'

const OpenPositionUnrealizedPnlCell = memo(function OpenPositionUnrealizedPnlCell({ pos }: { pos: Position }) {
  const tick = useSymbolPrice(normalizeSymbolKey(pos.symbol))
  const symbolMetaLookup = useSymbolMetaLookup()
  const formatSignedQuote = useFormatSignedFromQuoteCurrency()
  const pnl = useMemo(() => unrealizedPnlFromTick(pos, tick), [pos, tick])
  const positive = pnl >= 0
  const meta = getSymbolMetaForCode(symbolMetaLookup, pos.symbol)
  const quote = (meta?.quoteCurrency ?? 'USD').trim() || 'USD'
  const notional = parseNum(pos.entry_price) * parseNum(pos.size)
  const pnlPercent = notional > 0 ? (pnl / notional) * 100 : 0
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span className={cn('tabular-nums font-medium', positive ? 'text-success' : 'text-danger')}>
        {formatSignedQuote(pnl, quote as CurrencyCode)}
      </span>
      <span className={cn('text-xs tabular-nums', positive ? 'text-success' : 'text-danger')}>
        ({positive ? '+' : ''}
        {pnlPercent.toFixed(2)}%)
      </span>
    </span>
  )
})

const UserPositionUnrealizedOverviewShard = memo(function UserPositionUnrealizedOverviewShard({
  position,
  onReport,
}: {
  position: Position
  onReport: (id: string, n: number, symbol: string) => void
}) {
  const tick = useSymbolPrice(normalizeSymbolKey(position.symbol))
  const n = useMemo(() => unrealizedPnlFromTick(position, tick), [position, tick])
  useEffect(() => {
    onReport(position.id, n, position.symbol)
  }, [position.id, position.symbol, n, onReport])
  return null
})

const UserPositionsOverviewSection = memo(function UserPositionsOverviewSection({
  isLoading,
  filterView,
  total,
  filteredPositions,
}: {
  isLoading: boolean
  filterView: ViewMode
  total: number
  filteredPositions: Position[]
}) {
  const isHistory = filterView === 'history'
  const displayCode = useCurrencyCode()
  const rates = useFxRatesMap()
  const symbolMetaLookup = useSymbolMetaLookup()

  const pnlPartsRef = useRef<Map<string, { v: number; sym: string }>>(new Map())
  const [pnlTick, setPnlTick] = useState(0)
  const reportPnl = useCallback((id: string, v: number, symbol: string) => {
    const prev = pnlPartsRef.current.get(id)
    if (prev && prev.v === v && prev.sym === symbol) return
    pnlPartsRef.current.set(id, { v, sym: symbol })
    setPnlTick((t) => t + 1)
  }, [])

  const quoteFor = useCallback(
    (symbol: string) =>
      (getSymbolMetaForCode(symbolMetaLookup, symbol)?.quoteCurrency ?? 'USD').trim() || 'USD',
    [symbolMetaLookup],
  )

  const totalExposureConverted = useMemo(
    () =>
      filteredPositions.reduce((sum, p) => {
        const q = quoteFor(p.symbol) as CurrencyCode
        const raw = parseNum(p.size) * parseNum(p.entry_price)
        return sum + (convertAmount(raw, q, displayCode, rates) ?? 0)
      }, 0),
    [filteredPositions, quoteFor, displayCode, rates],
  )

  const totalMarginConverted = useMemo(
    () =>
      filteredPositions.reduce((sum, p) => {
        const q = quoteFor(p.symbol) as CurrencyCode
        const raw = parseNum(p.margin)
        return sum + (convertAmount(raw, q, displayCode, rates) ?? 0)
      }, 0),
    [filteredPositions, quoteFor, displayCode, rates],
  )

  const totalRealizedConverted = useMemo(
    () =>
      filteredPositions.reduce((sum, p) => {
        const q = quoteFor(p.symbol) as CurrencyCode
        const raw = parseNum(p.realized_pnl)
        return sum + (convertAmount(raw, q, displayCode, rates) ?? 0)
      }, 0),
    [filteredPositions, quoteFor, displayCode, rates],
  )

  const totalUnrealizedLive = useMemo(() => {
    return filteredPositions.reduce((sum, p) => {
      const snap = pnlPartsRef.current.get(p.id)
      const raw = snap !== undefined ? snap.v : parseNum(p.unrealized_pnl)
      const sym = snap !== undefined ? snap.sym : p.symbol
      const q = quoteFor(sym) as CurrencyCode
      return sum + (convertAmount(raw, q, displayCode, rates) ?? 0)
    }, 0)
  }, [filteredPositions, pnlTick, quoteFor, displayCode, rates])

  const displayPnl = isHistory ? totalRealizedConverted : totalUnrealizedLive
  const isProfit = isHistory ? totalRealizedConverted >= 0 : totalUnrealizedLive >= 0

  return (
    <section className="mb-8">
      <h2 className="mb-4 text-lg font-semibold text-text">Overview</h2>
      {!isHistory &&
        filteredPositions.map((p) => (
          <UserPositionUnrealizedOverviewShard key={p.id} position={p} onReport={reportPnl} />
        ))}
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
            title={isHistory ? 'Closed positions' : 'Open positions'}
            value={String(total)}
            subtext={isHistory ? 'Past trades' : 'Active trades'}
            icon={isHistory ? History : BarChart3}
          />
          <StatCard
            title="Total exposure"
            value={formatAmount(totalExposureConverted, displayCode)}
            subtext="Notional value (converted)"
            icon={TrendingUp}
          />
          <StatCard
            title={isHistory ? 'Realized P/L' : 'Unrealized P/L'}
            value={formatSignedAmount(displayPnl, displayCode)}
            subtext={isHistory ? 'Closed P/L' : 'Floating profit/loss'}
            icon={DollarSign}
            valueClassName={isProfit ? 'text-success' : 'text-danger'}
          />
          <StatCard
            title="Margin used"
            value={formatAmount(totalMarginConverted, displayCode)}
            subtext="Collateral in use (converted)"
            icon={Wallet}
          />
        </div>
      )}
    </section>
  )
})

const UserPositionSizeCell = memo(function UserPositionSizeCell({ position }: { position: Position }) {
  const symbolMetaLookup = useSymbolMetaLookup()
  const meta = getSymbolMetaForCode(symbolMetaLookup, position.symbol)
  const fmt = formatPositionSize(parseNum(position.size), meta)
  return (
    <span className="tabular-nums text-text" title={fmt.secondary || undefined}>
      {fmt.display}
    </span>
  )
})

const UserPositionEntryPriceCell = memo(function UserPositionEntryPriceCell({ position }: { position: Position }) {
  const symbolMetaLookup = useSymbolMetaLookup()
  const meta = getSymbolMetaForCode(symbolMetaLookup, position.symbol)
  return (
    <span className="tabular-nums text-text-muted">
      {formatSymbolPrice(parseNum(position.entry_price), meta)}
    </span>
  )
})

const UserPositionExitPriceCell = memo(function UserPositionExitPriceCell({ position }: { position: Position }) {
  const symbolMetaLookup = useSymbolMetaLookup()
  const meta = getSymbolMetaForCode(symbolMetaLookup, position.symbol)
  const ex = position.exit_price
  if (ex == null || String(ex).trim() === '') {
    return <span className="tabular-nums text-text-muted">—</span>
  }
  return (
    <span className="tabular-nums text-text-muted">{formatSymbolPrice(parseNum(ex), meta)}</span>
  )
})

const UserPositionMarginCell = memo(function UserPositionMarginCell({ position }: { position: Position }) {
  const symbolMetaLookup = useSymbolMetaLookup()
  const formatFromQuote = useFormatFromQuoteCurrency()
  const meta = getSymbolMetaForCode(symbolMetaLookup, position.symbol)
  const quote = (meta?.quoteCurrency ?? 'USD').trim() || 'USD'
  return (
    <span className="tabular-nums text-text-muted">
      {formatFromQuote(parseNum(position.margin), quote as CurrencyCode)}
    </span>
  )
})

const ClosedPositionRealizedPnlCell = memo(function ClosedPositionRealizedPnlCell({
  position,
}: {
  position: Position
}) {
  const symbolMetaLookup = useSymbolMetaLookup()
  const formatSignedQuote = useFormatSignedFromQuoteCurrency()
  const pnl = parseNum(position.realized_pnl)
  const positive = pnl >= 0
  const meta = getSymbolMetaForCode(symbolMetaLookup, position.symbol)
  const quote = (meta?.quoteCurrency ?? 'USD').trim() || 'USD'
  const notional = parseNum(position.entry_price) * parseNum(position.size)
  const pnlPercent = notional > 0 ? (pnl / notional) * 100 : 0
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span className={cn('tabular-nums font-medium', positive ? 'text-success' : 'text-danger')}>
        {formatSignedQuote(pnl, quote as CurrencyCode)}
      </span>
      <span className={cn('text-xs tabular-nums', positive ? 'text-success' : 'text-danger')}>
        ({positive ? '+' : ''}
        {pnlPercent.toFixed(2)}%)
      </span>
    </span>
  )
})

function buildPositionColumns(viewMode: ViewMode): ColumnDef<Position>[] {
  const isHistory = viewMode === 'history'
  const columns: ColumnDef<Position>[] = [
    {
      accessorKey: 'symbol',
      header: 'Symbol',
      cell: ({ row }) => <span className="font-medium text-text">{row.original.symbol}</span>,
    },
    {
      id: 'side',
      header: 'Type',
      cell: ({ row }) => {
        const pos = row.original
        const isLong = pos.side === 'LONG'
        return (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium',
              isLong ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger',
            )}
          >
            {isLong ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {pos.side}
          </span>
        )
      },
    },
    {
      accessorKey: 'size',
      header: 'Size',
      cell: ({ row }) => <UserPositionSizeCell position={row.original} />,
    },
    {
      accessorKey: 'entry_price',
      header: 'Entry price',
      cell: ({ row }) => <UserPositionEntryPriceCell position={row.original} />,
    },
    ...(isHistory
      ? [
          {
            id: 'exit_price',
            header: 'Exit price',
            cell: ({ row }: { row: { original: Position } }) => (
              <UserPositionExitPriceCell position={row.original} />
            ),
          } as ColumnDef<Position>,
        ]
      : []),
    {
      accessorKey: 'leverage',
      header: 'Leverage',
      cell: ({ row }) => (
        <span className="tabular-nums text-text-muted">{row.original.leverage}x</span>
      ),
    },
    {
      id: isHistory ? 'realized_pnl' : 'unrealized_pnl',
      header: isHistory ? 'Realized P/L' : 'Unrealized P/L',
      cell: ({ row }) => {
        const pos = row.original
        if (isHistory) {
          return <ClosedPositionRealizedPnlCell position={pos} />
        }
        return <OpenPositionUnrealizedPnlCell pos={pos} />
      },
    },
    {
      accessorKey: 'margin',
      header: 'Margin',
      cell: ({ row }) => <UserPositionMarginCell position={row.original} />,
    },
    ...(isHistory
      ? [
          {
            id: 'closed_at',
            header: 'Closed at',
            cell: ({ row }: { row: { original: Position } }) => {
              const ts = row.original.closed_at ?? row.original.updated_at
              if (!ts) return <span className="text-text-muted text-xs">—</span>
              const ms = ts < 1e12 ? ts * 1000 : ts
              return (
                <span className="tabular-nums text-text-muted text-xs">
                  {format(new Date(ms), 'MMM d, yyyy HH:mm')}
                </span>
              )
            },
          } as ColumnDef<Position>,
        ]
      : []),
    ...(isHistory
      ? []
      : [
          {
            id: 'actions',
            header: '',
            cell: () => (
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" title="More actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            ),
          } as ColumnDef<Position>,
        ]),
  ]
  return columns
}

type SideFilter = 'all' | 'LONG' | 'SHORT'

export function UserPositionsPage() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [filterView, setFilterView] = useState<ViewMode>('open')
  const [filterSymbol, setFilterSymbol] = useState('')
  const [filterSide, setFilterSide] = useState<SideFilter>('all')

  const { data: openPositions = [], isLoading: openLoading, isError: openError, error: openErr } = useQuery({
    queryKey: ['user', 'positions', 'open'],
    queryFn: () => getOpenPositions(),
  })

  const { data: closedPositions = [], isLoading: closedLoading, isError: closedError, error: closedErr } = useQuery({
    queryKey: ['user', 'positions', 'closed'],
    queryFn: () => getClosedPositions({ limit: 200 }),
    enabled: filterView === 'history',
  })

  const isLoading = filterView === 'open' ? openLoading : closedLoading
  const isError = filterView === 'open' ? openError : closedError
  const error = filterView === 'open' ? openErr : closedErr

  const basePositions = filterView === 'open' ? openPositions : closedPositions

  const filteredPositions = useMemo(() => {
    return basePositions.filter((p) => {
      const matchSymbol =
        !filterSymbol.trim() ||
        p.symbol.toUpperCase().includes(filterSymbol.trim().toUpperCase())
      const matchSide = filterSide === 'all' || p.side === filterSide
      return matchSymbol && matchSide
    })
  }, [basePositions, filterSymbol, filterSide])

  const total = filteredPositions.length
  const hasActiveFilters = filterSymbol.trim() !== '' || filterSide !== 'all'

  // Subscribe to live price stream for open position symbols only (real-time, no polling)
  const positionSymbols = useMemo(() => {
    const symbols = openPositions.map((p) => p.symbol.toUpperCase().replace('USDT', 'USD'))
    return [...new Set(symbols)]
  }, [openPositions])
  usePriceStreamConnection(positionSymbols)

  const positionColumns = useMemo(() => buildPositionColumns(filterView), [filterView])

  const paginatedPositions = useMemo(() => {
    const start = (page - 1) * pageSize
    return filteredPositions.slice(start, start + pageSize)
  }, [filteredPositions, page, pageSize])

  useEffect(() => {
    const totalPages = Math.ceil(total / pageSize) || 1
    if (page > totalPages) setPage(1)
  }, [total, pageSize, page])

  const clearFilters = () => {
    setFilterSymbol('')
    setFilterSide('all')
    setPage(1)
  }

  return (
    <ContentShell>
      <PageHeader
        title="Positions"
        description="View and manage your open trading positions"
      />

      <UserPositionsOverviewSection
        isLoading={isLoading}
        filterView={filterView}
        total={total}
        filteredPositions={filteredPositions}
      />

      {/* Positions table */}
      <section>
        <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold text-text">
            {filterView === 'open' ? 'Open positions' : 'Position history'}
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
                    Open positions
                  </span>
                </SelectItem>
                <SelectItem value="history">
                  <span className="flex items-center gap-2">
                    <History className="h-3.5 w-3.5" />
                    Position history
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
                <SelectItem value="LONG">Long</SelectItem>
                <SelectItem value="SHORT">Short</SelectItem>
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
              Loading positions…
            </div>
          ) : isError ? (
            <div className="px-4 py-6 text-center text-sm text-danger">
              {error instanceof Error ? error.message : 'Failed to load positions'}
            </div>
          ) : (
            <DataTable<Position>
              data={paginatedPositions}
              columns={positionColumns}
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
          )}
        </Card>
      </section>
    </ContentShell>
  )
}
