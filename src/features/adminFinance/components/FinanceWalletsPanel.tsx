import { useState, useMemo } from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/shared/ui/table'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Wallet, WalletType, Currency } from '../types/finance'
import { useModalStore } from '@/app/store'
import { WalletDetailsModal } from '../modals/WalletDetailsModal'
import { ManualAdjustmentModal } from '../modals/ManualAdjustmentModal'
import { Eye, Plus, Loader2 } from 'lucide-react'
import { formatDateTime, formatCurrency } from '../utils/formatters'
import { useQuery } from '@tanstack/react-query'
import { fetchWallets, Wallet as ApiWallet } from '../api/finance.api'

export function FinanceWalletsPanel() {
  const openModal = useModalStore((state) => state.openModal)
  const [filters, setFilters] = useState({
    search: '',
    walletType: 'all' as 'all' | WalletType,
    currency: 'all' as 'all' | Currency,
    balanceMin: '',
    balanceMax: '',
  })

  const { data: apiWallets, isLoading, refetch } = useQuery({
    queryKey: ['finance-wallets', filters],
    queryFn: () => fetchWallets({
      search: filters.search || undefined,
      walletType: filters.walletType !== 'all' ? filters.walletType : undefined,
      currency: filters.currency !== 'all' ? filters.currency : undefined,
      balanceMin: filters.balanceMin ? parseFloat(filters.balanceMin) : undefined,
      balanceMax: filters.balanceMax ? parseFloat(filters.balanceMax) : undefined,
    }),
  })

  const wallets = useMemo(() => {
    if (!apiWallets) return []
    return apiWallets.map((w) => ({
      id: w.id,
      userId: w.userId,
      userEmail: w.userEmail,
      walletType: w.walletType,
      currency: w.currency as any,
      available: Number(w.availableBalance),
      locked: Number(w.lockedBalance),
      equity: Number(w.equity),
      updatedAt: w.updatedAt,
    })) as Wallet[]
  }, [apiWallets])

  const filteredWallets = useMemo(() => {
    return wallets.filter((wallet) => {
      if (filters.search) {
        const searchLower = filters.search.toLowerCase()
        if (
          !wallet.userEmail.toLowerCase().includes(searchLower) &&
          !wallet.userId.toLowerCase().includes(searchLower)
        ) {
          return false
        }
      }
      if (filters.walletType !== 'all' && wallet.walletType !== filters.walletType) return false
      if (filters.currency !== 'all' && wallet.currency !== filters.currency) return false
      if (filters.balanceMin) {
        const min = parseFloat(filters.balanceMin)
        if (wallet.available < min) return false
      }
      if (filters.balanceMax) {
        const max = parseFloat(filters.balanceMax)
        if (wallet.available > max) return false
      }
      return true
    })
  }, [wallets, filters])

  const handleViewWallet = (wallet: Wallet) => {
    openModal(`wallet-${wallet.id}`, <WalletDetailsModal wallet={wallet} />, {
      title: 'Wallet Details',
      size: 'lg',
    })
  }

  const handleAdjustBalance = (wallet?: Wallet) => {
    openModal(
      wallet ? `adjust-${wallet.id}` : 'manual-adjustment',
      <ManualAdjustmentModal wallet={wallet} />,
      {
        title: 'Manual Adjustment',
        size: 'md',
      }
    )
  }

  const columns: ColumnDef<Wallet>[] = [
    {
      id: 'user',
      header: 'User',
      cell: ({ row }) => {
        const wallet = row.original
        return (
          <div>
            <div className="text-sm text-text">{wallet.userEmail}</div>
            <div className="text-xs text-text-muted font-mono">{wallet.userId}</div>
          </div>
        )
      },
    },
    {
      accessorKey: 'walletType',
      header: 'Wallet Type',
      cell: ({ row }) => {
        return <span className="capitalize">{row.getValue('walletType')}</span>
      },
    },
    {
      accessorKey: 'currency',
      header: 'Currency',
      cell: ({ row }) => {
        return <span className="font-mono font-semibold">{row.getValue('currency')}</span>
      },
    },
    {
      accessorKey: 'available',
      header: 'Available',
      cell: ({ row }) => {
        const wallet = row.original
        return (
          <span className="font-mono font-semibold text-text">
            {formatCurrency(wallet.available, wallet.currency)}
          </span>
        )
      },
    },
    {
      accessorKey: 'locked',
      header: 'Locked',
      cell: ({ row }) => {
        const wallet = row.original
        return (
          <span className="font-mono text-text-muted">
            {formatCurrency(wallet.locked, wallet.currency)}
          </span>
        )
      },
    },
    {
      accessorKey: 'equity',
      header: 'Equity',
      cell: ({ row }) => {
        const wallet = row.original
        if (wallet.equity !== undefined) {
          return (
            <span className="font-mono text-text">
              {formatCurrency(wallet.equity, wallet.currency)}
            </span>
          )
        }
        return <span className="text-text-muted">—</span>
      },
    },
    {
      accessorKey: 'updatedAt',
      header: 'Updated',
      cell: ({ row }) => {
        return <span className="text-sm text-text-muted">{formatDateTime(row.getValue('updatedAt'))}</span>
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const wallet = row.original
        return (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => handleViewWallet(wallet)} title="View">
              <Eye className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleAdjustBalance(wallet)}
              title="Adjust Balance"
            >
              <Plus className="h-4 w-4" />
            </Button>
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
          placeholder="Search user..."
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          className="flex-1 max-w-sm"
        />
        <Select
          value={filters.walletType}
          onValueChange={(value) => setFilters({ ...filters, walletType: value as typeof filters.walletType })}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Wallet Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="spot">Spot</SelectItem>
            <SelectItem value="margin">Margin</SelectItem>
            <SelectItem value="funding">Funding</SelectItem>
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
          type="number"
          placeholder="Min Balance"
          value={filters.balanceMin}
          onChange={(e) => setFilters({ ...filters, balanceMin: e.target.value })}
          className="w-[130px]"
        />
        <Input
          type="number"
          placeholder="Max Balance"
          value={filters.balanceMax}
          onChange={(e) => setFilters({ ...filters, balanceMax: e.target.value })}
          className="w-[130px]"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setFilters({ search: '', walletType: 'all', currency: 'all', balanceMin: '', balanceMax: '' })
          }
        >
          Clear
        </Button>
      </div>
      <DataTable data={filteredWallets} columns={columns} />
    </div>
  )
}

