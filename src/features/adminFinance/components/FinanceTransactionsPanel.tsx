import { useState, useMemo, useCallback } from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/shared/ui/table'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Transaction, TransactionType, TransactionStatus, Currency } from '../types/finance'
import { useModalStore } from '@/app/store'
import { useCanAccess } from '@/shared/utils/permissions'
import { TransactionDetailsModal } from '../modals/TransactionDetailsModal'
import { ApproveRejectModal } from '../modals/ApproveRejectModal'
import { Eye, CheckCircle, X, Loader2, Search } from 'lucide-react'
import { toast } from '@/shared/components/common'
import { useFormatConverted, useFormatSignedFromUsd } from '@/shared/currency'
import { TradingTransactionTypeDisplay } from '@/shared/components/TradingTransactionTypeDisplay'
import { useFormatDateTime } from '@/shared/datetime'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchTransactions, Transaction as ApiTransaction, PaginatedTransactions } from '../api/finance.api'
import { useWebSocketSubscription } from '@/shared/ws/wsHooks'
import { WsInboundEvent } from '@/shared/ws/wsEvents'
import { cn } from '@/shared/utils'

const FINANCE_TRANSACTIONS_QUERY_KEY = ['finance-transactions']

export function FinanceTransactionsPanel() {
  const openModal = useModalStore((state) => state.openModal)
  const formatDateTime = useFormatDateTime()
  const formatConv = useFormatConverted()
  const formatSigned = useFormatSignedFromUsd()
  const queryClient = useQueryClient()
  const canApprove = useCanAccess('deposits:approve')
  const canReject = useCanAccess('deposits:reject')
  const [filters, setFilters] = useState({
    search: '',
    type: 'all' as 'all' | TransactionType,
    status: 'all' as 'all' | TransactionStatus,
    currency: 'all' as 'all' | Currency,
    dateFrom: '',
    dateTo: '',
  })
  const [auditFilter, setAuditFilter] = useState<'money' | 'all' | 'audit'>('money')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const { data: paginated, isLoading } = useQuery({
    queryKey: [...FINANCE_TRANSACTIONS_QUERY_KEY, filters, auditFilter, page, pageSize],
    queryFn: () => fetchTransactions({
      search: filters.search || undefined,
      type: filters.type !== 'all' ? filters.type : undefined,
      status: filters.status !== 'all' ? filters.status : undefined,
      currency: filters.currency !== 'all' ? filters.currency : undefined,
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      auditFilter,
      page,
      pageSize,
    }),
  })

  const total = paginated?.total ?? 0
  const apiTransactions = paginated?.items ?? []

  // Subscribe to WebSocket events for real-time updates
  useWebSocketSubscription(
    useCallback(
      (event: WsInboundEvent) => {
        // When a new deposit request is created, refresh the list and show notification
        if (event.type === 'deposit.request.created') {
          const payload = event.payload as any
          const amount = payload.amount || 0
          const userId = payload.userId || payload.user_id || ''
          
          toast.success(
            `💰 New deposit request: $${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} from user ${userId.slice(0, 8)}...`,
            { duration: 5000 }
          )
          queryClient.invalidateQueries({ queryKey: FINANCE_TRANSACTIONS_QUERY_KEY })
        }
        else if (event.type === 'notification.push') {
          const payload = event.payload as any
          if (payload.kind === 'DEPOSIT_REQUEST') {
            const amount = payload.meta?.amount || 0
            toast.success(
              `💰 New deposit request: $${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
              { duration: 5000 }
            )
            queryClient.invalidateQueries({ queryKey: FINANCE_TRANSACTIONS_QUERY_KEY })
          }
        }
        else if (event.type === 'deposit.request.approved') {
          const payload = event.payload as any
          const amount = payload.amount || 0
          toast.success(
            `✅ Deposit approved: $${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            { duration: 3000 }
          )
          queryClient.invalidateQueries({ queryKey: FINANCE_TRANSACTIONS_QUERY_KEY })
        }
        else if (event.type === 'wallet.balance.updated') {
          queryClient.invalidateQueries({ queryKey: FINANCE_TRANSACTIONS_QUERY_KEY })
        }
      },
      [queryClient]
    )
  )

  const transactions = useMemo(() => {
    if (!apiTransactions) return []
    return apiTransactions.map((tx) => ({
      id: tx.id,
      user: {
        id: tx.userId,
        email: tx.userEmail,
        name: tx.userFirstName && tx.userLastName 
          ? `${tx.userFirstName} ${tx.userLastName}` 
          : undefined,
        firstName: tx.userFirstName,
        lastName: tx.userLastName,
      },
      type: tx.type,
      amount: Number(tx.amount),
      currency: tx.currency as any,
      method: tx.method,
      fee: Number(tx.fee),
      netAmount: Number(tx.netAmount),
      status: tx.status,
      createdAt: tx.createdAt,
      updatedAt: tx.updatedAt,
      reference: tx.reference,
      methodDetails: tx.methodDetails,
      adminNotes: tx.adminNotes,
      rejectionReason: tx.rejectionReason,
    })) as Transaction[]
  }, [apiTransactions])

  const updateFilters = useCallback((next: Partial<typeof filters>) => {
    setFilters((f) => ({ ...f, ...next }))
    setPage(1)
  }, [])

  const handleView = (tx: Transaction) => {
    openModal(`tx-details-${tx.id}`, <TransactionDetailsModal transaction={tx} />, {
      title: 'Transaction Details',
      size: 'lg',
    })
  }

  const handleApprove = (tx: Transaction) => {
    openModal(
      `approve-tx-${tx.id}`,
      <ApproveRejectModal
        transaction={tx}
        action="approve"
        onSuccess={() => {
          const queryKey = [...FINANCE_TRANSACTIONS_QUERY_KEY, filters, auditFilter, page, pageSize]
          queryClient.setQueryData<PaginatedTransactions>(queryKey, (old) => {
            if (!old) return old
            return {
              ...old,
              items: old.items.map((t) => (t.id === tx.id ? { ...t, status: 'approved' as const } : t)),
            }
          })
          queryClient.invalidateQueries({ queryKey: FINANCE_TRANSACTIONS_QUERY_KEY })
        }}
      />,
      { title: 'Approve Transaction', size: 'sm' }
    )
  }

  const handleReject = (tx: Transaction) => {
    openModal(
      `reject-tx-${tx.id}`,
      <ApproveRejectModal
        transaction={tx}
        action="reject"
        onSuccess={() => {
          const queryKey = [...FINANCE_TRANSACTIONS_QUERY_KEY, filters, auditFilter, page, pageSize]
          queryClient.setQueryData<PaginatedTransactions>(queryKey, (old) => {
            if (!old) return old
            return {
              ...old,
              items: old.items.map((t) => (t.id === tx.id ? { ...t, status: 'rejected' as const } : t)),
            }
          })
          queryClient.invalidateQueries({ queryKey: FINANCE_TRANSACTIONS_QUERY_KEY })
        }}
      />,
      { title: 'Reject Transaction', size: 'sm' }
    )
  }

  const getStatusBadge = (status: string) => {
    // Map 'completed' to 'approved' for display (backward compatibility)
    const displayStatus = status === 'completed' ? 'approved' : status
    const variants: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
      approved: 'success',
      completed: 'success', // Backward compatibility
      pending: 'warning',
      rejected: 'danger',
      failed: 'danger',
    }
    return <Badge variant={variants[status] || 'neutral'}>{displayStatus}</Badge>
  }

  const columns: ColumnDef<Transaction>[] = useMemo(() => [
    {
      accessorKey: 'id',
      header: 'Tx ID',
      cell: ({ row }) => {
        return <span className="font-mono text-sm">{row.getValue('id')}</span>
      },
    },
    {
      id: 'userName',
      header: 'Name',
      cell: ({ row }) => {
        const tx = row.original
        const name = tx.user.name || (tx.user.firstName && tx.user.lastName
          ? `${tx.user.firstName} ${tx.user.lastName}`
          : tx.user.firstName || tx.user.lastName || '-')
        return (
          <span className="text-sm text-text">{name}</span>
        )
      },
    },
    {
      id: 'userEmail',
      header: 'Email',
      cell: ({ row }) => {
        const tx = row.original
        return (
          <span className="text-sm text-text-muted">{tx.user.email}</span>
        )
      },
    },
    {
      accessorKey: 'type',
      header: 'Type',
      cell: ({ row }) => {
        const tx = row.original
        const type = (row.getValue('type') as string).toLowerCase()
        const isWithdrawal = type === 'withdrawal'
        if (type === 'fee' || type === 'swap') {
          return <TradingTransactionTypeDisplay type={tx.type} amount={tx.amount} methodDetails={tx.methodDetails} />
        }
        return (
          <span className={`capitalize ${isWithdrawal ? 'text-danger font-semibold' : ''}`}>
            {type.charAt(0).toUpperCase() + type.slice(1)}
          </span>
        )
      },
    },
    {
      accessorKey: 'netAmount',
      header: 'Amount',
      cell: ({ row }) => {
        const tx = row.original
        const t = tx.type.toLowerCase()
        const isWithdrawal = t === 'withdrawal'
        if (t === 'fee' || t === 'swap') {
          return (
            <span className={`font-mono font-semibold text-right block ${tx.netAmount >= 0 ? 'text-success' : 'text-danger'}`}>
              {formatSigned(tx.netAmount)}
            </span>
          )
        }
        const color = isWithdrawal ? 'text-danger' : (tx.netAmount >= 0 ? 'text-success' : 'text-danger')
        const sign = isWithdrawal ? '-' : (tx.netAmount >= 0 ? '+' : '')
        return (
          <span className={`font-mono font-semibold ${color} text-right block`}>
            {sign}
            {formatConv(Math.abs(tx.netAmount), tx.currency)}
          </span>
        )
      },
    },
    {
      accessorKey: 'currency',
      header: 'Currency',
      cell: ({ row }) => {
        return <span className="font-mono text-sm">{row.getValue('currency')}</span>
      },
    },
    {
      accessorKey: 'method',
      header: 'Method',
      cell: ({ row }) => {
        return <span className="capitalize">{row.getValue('method')}</span>
      },
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => getStatusBadge(row.getValue('status')),
    },
    {
      accessorKey: 'createdAt',
      header: 'Created',
      cell: ({ row }) => {
        return <span className="text-sm text-text-muted">{formatDateTime(row.getValue('createdAt'))}</span>
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const tx = row.original
        return (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => handleView(tx)} title="View">
              <Eye className="h-4 w-4" />
            </Button>
            {tx.status === 'pending' && (
              <>
                {canApprove && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleApprove(tx)}
                    className="text-success hover:text-success hover:bg-success/10"
                    title="Approve"
                  >
                    <CheckCircle className="h-4 w-4" />
                  </Button>
                )}
                {canReject && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleReject(tx)}
                    className="text-danger hover:text-danger hover:bg-danger/10"
                    title="Reject"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </>
            )}
          </div>
        )
      },
    },
  ], [formatDateTime, formatConv, formatSigned, openModal, canApprove, canReject])

  const hasActiveFilters =
    filters.search.trim() !== '' ||
    filters.type !== 'all' ||
    filters.status !== 'all' ||
    filters.currency !== 'all' ||
    filters.dateFrom !== '' ||
    filters.dateTo !== '' ||
    auditFilter !== 'money'

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex min-w-0 flex-wrap items-end gap-x-3 gap-y-2">
        <div className="relative min-h-10 min-w-[min(100%,220px)] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <Input
            type="search"
            placeholder="Search user, Tx ID, or reference..."
            value={filters.search}
            onChange={(e) => updateFilters({ search: e.target.value })}
            className={cn('w-full min-w-0 pl-9', filters.search.trim() && 'pr-9')}
          />
          {filters.search.trim() ? (
            <button
              type="button"
              onClick={() => updateFilters({ search: '' })}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-text-muted hover:bg-surface-2 hover:text-text"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        <Select
          value={filters.type}
          onValueChange={(value) => updateFilters({ type: value as typeof filters.type })}
        >
          <SelectTrigger className="h-10 w-fit min-w-[10.5rem] max-w-[min(100%,16rem)] shrink-0">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="deposit">Deposit</SelectItem>
            <SelectItem value="withdrawal">Withdrawal</SelectItem>
            <SelectItem value="adjustment">Adjustment</SelectItem>
            <SelectItem value="fee">Fee</SelectItem>
            <SelectItem value="swap">Swap</SelectItem>
            <SelectItem value="rebate">Rebate</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filters.status}
          onValueChange={(value) => updateFilters({ status: value as typeof filters.status })}
        >
          <SelectTrigger className="h-10 w-fit min-w-[10.5rem] max-w-[min(100%,15rem)] shrink-0">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filters.currency}
          onValueChange={(value) => updateFilters({ currency: value as typeof filters.currency })}
        >
          <SelectTrigger className="h-10 w-fit min-w-[9rem] max-w-[min(100%,12rem)] shrink-0">
            <SelectValue placeholder="Currency" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="USD">USD</SelectItem>
            <SelectItem value="EUR">EUR</SelectItem>
            <SelectItem value="BTC">BTC</SelectItem>
            <SelectItem value="USDT">USDT</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex shrink-0 items-center gap-2">
          <label className="whitespace-nowrap text-xs text-text-muted" htmlFor="finance_tx_date_from">
            From
          </label>
          <Input
            id="finance_tx_date_from"
            type="date"
            value={filters.dateFrom}
            onChange={(e) => updateFilters({ dateFrom: e.target.value })}
            className="w-auto min-w-[10.5rem] shrink-0"
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <label className="whitespace-nowrap text-xs text-text-muted" htmlFor="finance_tx_date_to">
            To
          </label>
          <Input
            id="finance_tx_date_to"
            type="date"
            value={filters.dateTo}
            onChange={(e) => updateFilters({ dateTo: e.target.value })}
            className="w-auto min-w-[10.5rem] shrink-0"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={!hasActiveFilters}
          onClick={() => {
            setFilters({ search: '', type: 'all', status: 'all', currency: 'all', dateFrom: '', dateTo: '' })
            setAuditFilter('money')
            setPage(1)
          }}
        >
          Clear
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-text-muted">History:</span>
        {(
          [
            { id: 'money' as const, label: 'Money events' },
            { id: 'all' as const, label: 'All' },
            { id: 'audit' as const, label: 'Audit only' },
          ] as const
        ).map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => {
              setAuditFilter(opt.id)
              setPage(1)
            }}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
              auditFilter === opt.id
                ? 'bg-accent text-accent-foreground'
                : 'bg-surface-2 text-text-muted hover:bg-surface-3 border border-border',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <DataTable
        data={transactions}
        columns={columns}
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
    </div>
  )
}

