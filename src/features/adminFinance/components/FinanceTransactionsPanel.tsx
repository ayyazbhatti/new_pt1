import { useState, useMemo, useCallback } from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/shared/ui/table'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Transaction, TransactionType, TransactionStatus, Currency } from '../types/finance'
import { useModalStore } from '@/app/store'
import { TransactionDetailsModal } from '../modals/TransactionDetailsModal'
import { ApproveRejectModal } from '../modals/ApproveRejectModal'
import { Eye, CheckCircle, X, Loader2 } from 'lucide-react'
import { toast } from '@/shared/components/common'
import { formatDateTime, formatCurrency } from '../utils/formatters'
import { useQuery } from '@tanstack/react-query'
import { fetchTransactions, Transaction as ApiTransaction } from '../api/finance.api'
import { useWebSocketSubscription } from '@/shared/ws/wsHooks'
import { WsInboundEvent } from '@/shared/ws/wsEvents'

export function FinanceTransactionsPanel() {
  const openModal = useModalStore((state) => state.openModal)
  const [filters, setFilters] = useState({
    search: '',
    type: 'all' as 'all' | TransactionType,
    status: 'all' as 'all' | TransactionStatus,
    currency: 'all' as 'all' | Currency,
    dateFrom: '',
    dateTo: '',
  })

  const { data: apiTransactions, isLoading, refetch } = useQuery({
    queryKey: ['finance-transactions', filters],
    queryFn: () => fetchTransactions({
      search: filters.search || undefined,
      type: filters.type !== 'all' ? filters.type : undefined,
      status: filters.status !== 'all' ? filters.status : undefined,
      currency: filters.currency !== 'all' ? filters.currency : undefined,
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
    }),
  })

  // Subscribe to WebSocket events for real-time updates
  useWebSocketSubscription(
    useCallback(
      (event: WsInboundEvent) => {
        // When a new deposit request is created, refresh the list and show notification
        if (event.type === 'deposit.request.created') {
          const payload = event.payload as any
          const amount = payload.amount || 0
          const userId = payload.userId || payload.user_id || ''
          const transactionId = payload.transactionId || payload.requestId || ''
          
          toast.success(
            `💰 New deposit request: $${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} from user ${userId.slice(0, 8)}...`,
            { 
              duration: 5000,
            }
          )
          // Refresh the transaction list to show the new deposit
          refetch()
        }
        // When admin receives notification about new deposit request
        else if (event.type === 'notification.push') {
          const payload = event.payload as any
          if (payload.kind === 'DEPOSIT_REQUEST') {
            const amount = payload.meta?.amount || 0
            toast.success(
              `💰 New deposit request: $${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
              { 
                duration: 5000,
              }
            )
            // Refresh the transaction list to show the new deposit
            refetch()
          }
        }
        // When a transaction is approved, refresh the list
        else if (event.type === 'deposit.request.approved') {
          const payload = event.payload as any
          const amount = payload.amount || 0
          toast.success(
            `✅ Deposit approved: $${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            { duration: 3000 }
          )
          // Refresh the transaction list to show updated status
          refetch()
        }
        // When balance is updated (transaction approved), refresh the list
        else if (event.type === 'wallet.balance.updated') {
          // Refresh the transaction list to show updated status
          refetch()
        }
      },
      [refetch]
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

  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      if (filters.search) {
        const searchLower = filters.search.toLowerCase()
        if (
          !tx.user.email.toLowerCase().includes(searchLower) &&
          !tx.id.toLowerCase().includes(searchLower) &&
          !tx.reference.toLowerCase().includes(searchLower)
        ) {
          return false
        }
      }
      if (filters.type !== 'all' && tx.type !== filters.type) return false
      if (filters.status !== 'all' && tx.status !== filters.status) return false
      if (filters.currency !== 'all' && tx.currency !== filters.currency) return false
      if (filters.dateFrom) {
        const txDate = new Date(tx.createdAt).toISOString().split('T')[0]
        if (txDate < filters.dateFrom) return false
      }
      if (filters.dateTo) {
        const txDate = new Date(tx.createdAt).toISOString().split('T')[0]
        if (txDate > filters.dateTo) return false
      }
      return true
    })
  }, [transactions, filters])

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
          refetch()
        }}
      />,
      {
        title: 'Approve Transaction',
        size: 'sm',
      }
    )
  }

  const handleReject = (tx: Transaction) => {
    openModal(
      `reject-tx-${tx.id}`,
      <ApproveRejectModal 
        transaction={tx} 
        action="reject"
        onSuccess={() => {
          refetch()
        }}
      />,
      {
        title: 'Reject Transaction',
        size: 'sm',
      }
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

  const getTypeLabel = (type: string) => {
    return type.charAt(0).toUpperCase() + type.slice(1)
  }

  const columns: ColumnDef<Transaction>[] = [
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
        const type = row.getValue('type') as string
        const isWithdrawal = type.toLowerCase() === 'withdrawal'
        return (
          <span className={`capitalize ${isWithdrawal ? 'text-danger font-semibold' : ''}`}>
            {getTypeLabel(type)}
          </span>
        )
      },
    },
    {
      accessorKey: 'netAmount',
      header: 'Amount',
      cell: ({ row }) => {
        const tx = row.original
        const isWithdrawal = tx.type.toLowerCase() === 'withdrawal'
        // Withdrawals should be red, otherwise use normal logic (positive=green, negative=red)
        const color = isWithdrawal ? 'text-danger' : (tx.netAmount >= 0 ? 'text-success' : 'text-danger')
        // Withdrawals should show minus sign, deposits/adjustments show plus for positive
        const sign = isWithdrawal ? '-' : (tx.netAmount >= 0 ? '+' : '')
        return (
          <span className={`font-mono font-semibold ${color} text-right block`}>
            {sign}
            {formatCurrency(Math.abs(tx.netAmount), tx.currency)}
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
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleApprove(tx)}
                  className="text-success hover:text-success hover:bg-success/10"
                  title="Approve"
                >
                  <CheckCircle className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleReject(tx)}
                  className="text-danger hover:text-danger hover:bg-danger/10"
                  title="Reject"
                >
                  <X className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        )
      },
    },
  ]

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 flex-wrap">
        <Input
          type="search"
          placeholder="Search user, Tx ID, or reference..."
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          className="flex-1 max-w-sm"
        />
        <Select
          value={filters.type}
          onValueChange={(value) => setFilters({ ...filters, type: value as typeof filters.type })}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="deposit">Deposit</SelectItem>
            <SelectItem value="withdrawal">Withdrawal</SelectItem>
            <SelectItem value="adjustment">Adjustment</SelectItem>
            <SelectItem value="fee">Fee</SelectItem>
            <SelectItem value="rebate">Rebate</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filters.status}
          onValueChange={(value) => setFilters({ ...filters, status: value as typeof filters.status })}
        >
          <SelectTrigger className="w-[150px]">
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
          onValueChange={(value) => setFilters({ ...filters, currency: value as typeof filters.currency })}
        >
          <SelectTrigger className="w-[120px]">
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
        <Input
          type="date"
          placeholder="From"
          value={filters.dateFrom}
          onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
          className="w-[150px]"
        />
        <Input
          type="date"
          placeholder="To"
          value={filters.dateTo}
          onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
          className="w-[150px]"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setFilters({ search: '', type: 'all', status: 'all', currency: 'all', dateFrom: '', dateTo: '' })
          }
        >
          Clear
        </Button>
      </div>
      <DataTable data={filteredTransactions} columns={columns} />
    </div>
  )
}

