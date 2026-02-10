import { Card } from '@/shared/ui/card'
import { DataTable, ColumnDef } from '@/shared/ui/table'
import { Wallet, LedgerEntry } from '../types/finance'
import { useModalStore } from '@/app/store'
import { formatDateTime, formatCurrency } from '../utils/formatters'
import { mockLedgerEntries } from '../mocks/finance.mock'

interface WalletDetailsModalProps {
  wallet: Wallet
}

export function WalletDetailsModal({ wallet }: WalletDetailsModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const ledgerEntries = mockLedgerEntries[wallet.id] || []

  const getTypeLabel = (type: string) => {
    return type.charAt(0).toUpperCase() + type.slice(1)
  }

  const columns: ColumnDef<LedgerEntry>[] = [
    {
      accessorKey: 'time',
      header: 'Time',
      cell: ({ row }) => {
        return <span className="text-sm text-text-muted">{formatDateTime(row.getValue('time'))}</span>
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
      accessorKey: 'delta',
      header: 'Delta',
      cell: ({ row }) => {
        const entry = row.original
        const color = entry.delta >= 0 ? 'text-success' : 'text-danger'
        return (
          <span className={`font-mono font-semibold ${color}`}>
            {entry.delta >= 0 ? '+' : ''}
            {formatCurrency(entry.delta, wallet.currency)}
          </span>
        )
      },
    },
    {
      accessorKey: 'balanceAfter',
      header: 'Balance After',
      cell: ({ row }) => {
        return (
          <span className="font-mono text-text">
            {formatCurrency(row.getValue('balanceAfter'), wallet.currency)}
          </span>
        )
      },
    },
    {
      accessorKey: 'ref',
      header: 'Reference',
      cell: ({ row }) => {
        return <span className="font-mono text-sm text-text-muted">{row.getValue('ref')}</span>
      },
    },
  ]

  return (
    <div className="space-y-4">
      <Card className="p-4 bg-surface-2">
        <div className="text-sm font-semibold text-text mb-3">User Summary</div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-text-muted mb-1">User Email</div>
            <div className="text-sm text-text">{wallet.userEmail}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">User ID</div>
            <div className="font-mono text-sm text-text">{wallet.userId}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Wallet Type</div>
            <div className="text-sm text-text capitalize">{wallet.walletType}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Currency</div>
            <div className="font-mono text-sm font-semibold text-text">{wallet.currency}</div>
          </div>
        </div>
      </Card>

      <Card className="p-4 bg-surface-2">
        <div className="text-sm font-semibold text-text mb-3">Wallet Balances</div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="text-xs text-text-muted mb-1">Available</div>
            <div className="font-mono font-semibold text-text text-lg">
              {formatCurrency(wallet.available, wallet.currency)}
            </div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Locked</div>
            <div className="font-mono text-text-muted text-lg">
              {formatCurrency(wallet.locked, wallet.currency)}
            </div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Total</div>
            <div className="font-mono font-semibold text-text text-lg">
              {formatCurrency(wallet.available + wallet.locked, wallet.currency)}
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-4 bg-surface-2">
        <div className="text-sm font-semibold text-text mb-3">Recent Ledger Entries</div>
        {ledgerEntries.length > 0 ? (
          <DataTable data={ledgerEntries} columns={columns} />
        ) : (
          <div className="text-sm text-text-muted py-4 text-center">No ledger entries</div>
        )}
      </Card>
    </div>
  )
}

