import { useState, useMemo } from 'react'
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
import { mockTransactions } from '../mocks/finance.mock'
import { Eye, CheckCircle, X } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { formatDateTime, formatCurrency } from '../utils/formatters'

export function FinanceTransactionsPanel() {
  const openModal = useModalStore((state) => state.openModal)
  const [transactions, setTransactions] = useState<Transaction[]>(mockTransactions)
  const [filters, setFilters] = useState({
    search: '',
    type: 'all' as 'all' | TransactionType,
    status: 'all' as 'all' | TransactionStatus,
    currency: 'all' as 'all' | Currency,
    dateFrom: '',
    dateTo: '',
  })

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
      <ApproveRejectModal transaction={tx} action="approve" />,
      {
        title: 'Approve Transaction',
        size: 'sm',
      }
    )
  }

  const handleReject = (tx: Transaction) => {
    openModal(
      `reject-tx-${tx.id}`,
      <ApproveRejectModal transaction={tx} action="reject" />,
      {
        title: 'Reject Transaction',
        size: 'sm',
      }
    )
  }

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
      completed: 'success',
      pending: 'warning',
      rejected: 'danger',
      failed: 'danger',
    }
    return <Badge variant={variants[status] || 'neutral'}>{status}</Badge>
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
      id: 'user',
      header: 'User',
      cell: ({ row }) => {
        const tx = row.original
        return (
          <div>
            <div className="text-sm text-text">{tx.user.name || tx.user.email}</div>
            <div className="text-xs text-text-muted">{tx.user.email}</div>
          </div>
        )
      },
    },
    {
      accessorKey: 'type',
      header: 'Type',
      cell: ({ row }) => {
        return <span className="capitalize">{getTypeLabel(row.getValue('type'))}</span>
      },
    },
    {
      accessorKey: 'netAmount',
      header: 'Amount',
      cell: ({ row }) => {
        const tx = row.original
        const color = tx.netAmount >= 0 ? 'text-success' : 'text-danger'
        return (
          <span className={`font-mono font-semibold ${color} text-right block`}>
            {tx.netAmount >= 0 ? '+' : ''}
            {formatCurrency(tx.netAmount, tx.currency)}
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
            <SelectItem value="completed">Completed</SelectItem>
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

