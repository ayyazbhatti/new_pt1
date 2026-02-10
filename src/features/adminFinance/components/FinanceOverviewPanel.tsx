import { Card } from '@/shared/ui/card'
import { Badge } from '@/shared/ui/badge'
import { DataTable, ColumnDef } from '@/shared/ui/table'
import { Transaction } from '../types/finance'
import { mockTransactions } from '../mocks/finance.mock'
import { formatDateTime, formatCurrency } from '../utils/formatters'
import { ArrowUp, ArrowDown, TrendingUp } from 'lucide-react'
import { useMemo } from 'react'

export function FinanceOverviewPanel() {
  const today = new Date().toDateString()
  
  const stats = useMemo(() => {
    const totalBalances = 2418320.55
    const pendingDeposits = mockTransactions.filter(
      (t) => t.type === 'deposit' && t.status === 'pending'
    ).length
    const pendingWithdrawals = mockTransactions.filter(
      (t) => t.type === 'withdrawal' && t.status === 'pending'
    ).length
    const netFeesToday = mockTransactions
      .filter((t) => {
        const txDate = new Date(t.createdAt).toDateString()
        return txDate === today && (t.type === 'fee' || t.type === 'rebate')
      })
      .reduce((sum, t) => sum + (t.type === 'fee' ? -t.amount : t.amount), 0)

    const depositsToday = mockTransactions.filter(
      (t) => {
        const txDate = new Date(t.createdAt).toDateString()
        return txDate === today && t.type === 'deposit' && t.status === 'completed'
      }
    )
    const withdrawalsToday = mockTransactions.filter(
      (t) => {
        const txDate = new Date(t.createdAt).toDateString()
        return txDate === today && t.type === 'withdrawal' && t.status === 'completed'
      }
    )

    return {
      totalBalances,
      pendingDeposits,
      pendingWithdrawals,
      netFeesToday,
      depositsToday: {
        count: depositsToday.length,
        amount: depositsToday.reduce((sum, t) => sum + t.netAmount, 0),
      },
      withdrawalsToday: {
        count: withdrawalsToday.length,
        amount: withdrawalsToday.reduce((sum, t) => sum + t.netAmount, 0),
      },
    }
  }, [])

  const recentActivity = useMemo(() => {
    return mockTransactions
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 10)
  }, [])

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
      accessorKey: 'createdAt',
      header: 'Time',
      cell: ({ row }) => {
        return <span className="text-sm text-text-muted">{formatDateTime(row.getValue('createdAt'))}</span>
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
          <span className={`font-mono font-semibold ${color}`}>
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

