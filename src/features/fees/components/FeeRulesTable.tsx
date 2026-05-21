import { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/shared/ui/table'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import type { FeeRule } from '../types/feeRule'
import { useModalStore } from '@/app/store'
import { useCanAccess } from '@/shared/utils/permissions'
import { Edit, Trash2 } from 'lucide-react'
import { FeeRuleForm } from './FeeRuleForm'
import { useDeleteFeeRule } from '../hooks/useFeeRules'

interface FeeRulesTableProps {
  rules: FeeRule[]
  isLoading?: boolean
}

function formatBps(feePercent: number): string {
  const bps = feePercent * 10000
  if (!Number.isFinite(bps)) return '—'
  const rounded = Math.round(bps * 1000) / 1000
  return `${rounded} bps`
}

export function FeeRulesTable({ rules, isLoading }: FeeRulesTableProps) {
  const openModal = useModalStore((state) => state.openModal)
  const closeModal = useModalStore((state) => state.closeModal)
  const canEdit = useCanAccess('fees:edit')
  const deleteRule = useDeleteFeeRule()

  const handleEdit = (rule: FeeRule) => {
    openModal(`edit-fee-${rule.id}`, <FeeRuleForm mode="edit" initial={rule} onDone={() => closeModal(`edit-fee-${rule.id}`)} />, {
      title: 'Edit fee rule',
      size: 'md',
    })
  }

  const handleDelete = (rule: FeeRule) => {
    if (!confirm(`Delete fee rule for group "${rule.groupName}"?`)) return
    deleteRule.mutate(rule.id)
  }

  const columns: ColumnDef<FeeRule>[] = [
    { accessorKey: 'groupName', header: 'Group' },
    {
      accessorKey: 'symbol',
      header: 'Symbol',
      cell: ({ row }) => {
        const s = row.original.symbol
        return <span className="font-mono text-sm">{s?.trim() ? s : 'All symbols'}</span>
      },
    },
    {
      accessorKey: 'market',
      header: 'Market',
      cell: ({ row }) => {
        const m = row.original.market
        return <span className="capitalize">{m ?? 'Any'}</span>
      },
    },
    {
      id: 'bps',
      header: 'Fee (bps)',
      cell: ({ row }) => <span className="font-mono text-sm">{formatBps(row.original.feePercent)}</span>,
    },
    {
      accessorKey: 'minFee',
      header: 'Min fee (USD)',
      cell: ({ row }) => <span className="font-mono text-sm">{row.original.minFee}</span>,
    },
    {
      accessorKey: 'maxFee',
      header: 'Max fee (USD)',
      cell: ({ row }) => {
        const m = row.original.maxFee
        return <span className="font-mono text-sm">{m != null ? m : '—'}</span>
      },
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <Badge variant={row.original.status === 'active' ? 'success' : 'neutral'}>
          {row.original.status}
        </Badge>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const rule = row.original
        if (!canEdit) return null
        return (
          <div className="flex justify-end gap-1">
            <Button type="button" variant="ghost" size="icon" onClick={() => handleEdit(rule)} aria-label="Edit">
              <Edit className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" onClick={() => handleDelete(rule)} aria-label="Delete">
              <Trash2 className="h-4 w-4 text-danger" />
            </Button>
          </div>
        )
      },
    },
  ]

  if (isLoading) {
    return <div className="text-sm text-text-muted py-8 text-center">Loading fee rules…</div>
  }

  return <DataTable columns={columns} data={rules} />
}
