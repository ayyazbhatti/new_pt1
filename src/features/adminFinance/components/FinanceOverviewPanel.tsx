import { Card } from '@/shared/ui/card'
import { Badge } from '@/shared/ui/badge'
import { DataTable, ColumnDef } from '@/shared/ui/table'
import { Transaction } from '../types/finance'
import { formatDateTime, formatCurrency } from '../utils/formatters'
import { ArrowUp, ArrowDown, TrendingUp, Loader2 } from 'lucide-react'
import { useMemo, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchFinanceOverview, fetchTransactions, Transaction as ApiTransaction } from '../api/finance.api'

export function FinanceOverviewPanel() {
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['finance-overview'],
    queryFn: fetchFinanceOverview,
    refetchInterval: 30000, // Refetch every 30 seconds
  })

  const { data: recentTransactions, isLoading: transactionsLoading } = useQuery({
    queryKey: ['finance-recent-transactions'],
    queryFn: () => fetchTransactions({ page: 1, pageSize: 10 }),
    refetchInterval: 30000,
  })

  const stats = useMemo(() => {
    if (!overview) {
      return {
        totalBalances: 0,
        pendingDeposits: 0,
        pendingWithdrawals: 0,
        netFeesToday: 0,
        depositsToday: { count: 0, amount: 0 },
        withdrawalsToday: { count: 0, amount: 0 },
      }
    }
    return {
      totalBalances: Number(overview.totalBalances),
      pendingDeposits: overview.pendingDeposits,
      pendingWithdrawals: overview.pendingWithdrawals,
      netFeesToday: Number(overview.netFeesToday),
      depositsToday: {
        count: overview.depositsToday?.count ?? 0,
        amount: Number(overview.depositsToday?.amount ?? 0),
      },
      withdrawalsToday: {
        count: overview.withdrawalsToday?.count ?? 0,
        amount: Number(overview.withdrawalsToday?.amount ?? 0),
      },
    }
  }, [overview])

  const recentActivity = useMemo(() => {
    if (!recentTransactions) return []
    return recentTransactions.map((tx) => ({
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
      reference: tx.reference,
      methodDetails: tx.methodDetails,
      adminNotes: tx.adminNotes,
      rejectionReason: tx.rejectionReason,
    })) as Transaction[]
  }, [recentTransactions])

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
      approved: 'success',
      completed: 'success', // Backward compatibility
      pending: 'warning',
      rejected: 'danger',
      failed: 'danger',
    }
    // Map 'completed' to 'approved' for display (backward compatibility)
    const displayStatus = status === 'completed' ? 'approved' : status
    return <Badge variant={variants[status] || 'neutral'}>{displayStatus}</Badge>
  }

  const getTypeLabel = (type: string) => {
    return type.charAt(0).toUpperCase() + type.slice(1)
  }

  const columns: ColumnDef<Transaction>[] = [
    {
      accessorKey: 'createdAt',
      header: 'Time',
      cell: ({ row }) => {
        const dateValue = row.getValue('createdAt') as string | null | undefined
        return <span className="text-sm text-text-muted">{formatDateTime(dateValue)}</span>
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
          <span className={`font-mono font-semibold ${color}`}>
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
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => getStatusBadge(row.getValue('status')),
    },
    {
      accessorKey: 'reference',
      header: 'Reference',
      cell: ({ row }) => {
        return <span className="font-mono text-sm text-text-muted">{row.getValue('reference')}</span>
      },
    },
  ]

  if (overviewLoading || transactionsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 bg-surface-2">
          <div className="text-sm text-text-muted mb-1">Total User Balances</div>
          <div className="text-2xl font-bold text-text mb-2">
            {formatCurrency(stats.totalBalances, 'USD')}
          </div>
          <div className="flex items-center gap-1 text-xs text-text-muted">
            <TrendingUp className="h-3 w-3" />
            <span>All wallets</span>
          </div>
        </Card>
        <Card className="p-4 bg-surface-2">
          <div className="text-sm text-text-muted mb-1">Pending Deposits</div>
          <div className="text-2xl font-bold text-text mb-2">{stats.pendingDeposits}</div>
          <Badge variant="warning" className="text-xs">Requires review</Badge>
        </Card>
        <Card className="p-4 bg-surface-2">
          <div className="text-sm text-text-muted mb-1">Pending Withdrawals</div>
          <div className="text-2xl font-bold text-text mb-2">{stats.pendingWithdrawals}</div>
          <Badge variant="warning" className="text-xs">Requires review</Badge>
        </Card>
        <Card className="p-4 bg-surface-2">
          <div className="text-sm text-text-muted mb-1">Net Fees (Today)</div>
          <div className="text-2xl font-bold text-text mb-2">
            {formatCurrency(stats.netFeesToday, 'USD')}
          </div>
          <div className="flex items-center gap-1 text-xs text-text-muted">
            {stats.netFeesToday >= 0 ? (
              <ArrowUp className="h-3 w-3 text-success" />
            ) : (
              <ArrowDown className="h-3 w-3 text-danger" />
            )}
            <span>Today's net</span>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-4 bg-surface-2">
          <div className="text-sm text-text-muted mb-2">Deposits Processed Today</div>
          <div className="text-xl font-bold text-text mb-1">{stats.depositsToday.count}</div>
          <div className="text-sm text-text-muted">
            Total: {formatCurrency(stats.depositsToday.amount, 'USD')}
          </div>
        </Card>
        <Card className="p-4 bg-surface-2">
          <div className="text-sm text-text-muted mb-2">Withdrawals Processed Today</div>
          <div className="text-xl font-bold text-text mb-1">{stats.withdrawalsToday.count}</div>
          <div className="text-sm text-text-muted">
            Total: {formatCurrency(stats.withdrawalsToday.amount, 'USD')}
          </div>
        </Card>
      </div>

      <Card className="p-4 bg-surface-2">
        <div className="text-lg font-semibold text-text mb-4">Recent Activity</div>
        <DataTable data={recentActivity} columns={columns} />
      </Card>
    </div>
  )
}

