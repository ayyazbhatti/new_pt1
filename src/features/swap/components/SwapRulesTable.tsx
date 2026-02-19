import { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/shared/ui/table'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { SwapRule } from '../types/swap'
import { useModalStore } from '@/app/store'
import { EditSwapRuleModal } from '../modals/EditSwapRuleModal'
import { PreviewSwapModal } from '../modals/PreviewSwapModal'
import { ConfirmDeleteModal } from '../modals/ConfirmDeleteModal'
import { Eye, Edit, X, Trash2 } from 'lucide-react'

interface SwapRulesTableProps {
  rules: SwapRule[]
  isLoading?: boolean
  onDisable?: (rule: SwapRule) => void
}

export function SwapRulesTable({ rules, isLoading, onDisable }: SwapRulesTableProps) {
  const openModal = useModalStore((state) => state.openModal)

  const handlePreview = (rule: SwapRule) => {
    openModal(`preview-swap-${rule.id}`, <PreviewSwapModal rule={rule} />, {
      title: `Swap Preview - ${rule.symbol}`,
      size: 'lg',
    })
  }

  const handleEdit = (rule: SwapRule) => {
    openModal(`edit-swap-${rule.id}`, <EditSwapRuleModal rule={rule} />, {
      title: 'Edit Swap Rule',
      size: 'md',
    })
  }

  const handleDelete = (rule: SwapRule) => {
    openModal(`delete-swap-${rule.id}`, <ConfirmDeleteModal rule={rule} />, {
      title: 'Confirm Delete',
      size: 'sm',
    })
  }

  const handleDisable = (rule: SwapRule) => {
    onDisable?.(rule)
  }

  const getCalcModeLabel = (mode: string) => {
    switch (mode) {
      case 'daily':
        return 'Daily'
      case 'hourly':
        return 'Hourly'
      case 'funding_8h':
        return '8H'
      default:
        return mode
    }
  }

  const getWeekendRuleLabel = (rule: SwapRule) => {
    if (rule.weekendRule === 'triple_day' && rule.tripleDay) {
      return `Triple ${rule.tripleDay}`
    } else if (rule.weekendRule === 'fri_triple') {
      return 'Fri Triple'
    } else if (rule.weekendRule === 'custom') {
      return 'Custom'
    }
    return 'None'
  }

  const columns: ColumnDef<SwapRule>[] = [
    {
      accessorKey: 'groupName',
      header: 'Group',
    },
    {
      accessorKey: 'symbol',
      header: 'Symbol',
      cell: ({ row }) => {
        return <span className="font-mono font-semibold">{row.getValue('symbol')}</span>
      },
    },
    {
      accessorKey: 'market',
      header: 'Market',
      cell: ({ row }) => {
        const market = row.getValue('market') as string
        return <span className="capitalize">{market}</span>
      },
    },
    {
      accessorKey: 'calcMode',
      header: 'Calc Mode',
      cell: ({ row }) => {
        const mode = row.getValue('calcMode') as string
        return <Badge variant="neutral">{getCalcModeLabel(mode)}</Badge>
      },
    },
    {
      accessorKey: 'unit',
      header: 'Unit',
      cell: ({ row }) => {
        const unit = row.getValue('unit') as string
        return <span className="capitalize">{unit}</span>
      },
    },
    {
      accessorKey: 'longRate',
      header: 'Long Rate',
      cell: ({ row }) => {
        const rule = row.original
        const suffix = rule.unit === 'percent' ? '%' : ''
        return (
          <span className="font-mono text-success">
            {rule.longRate >= 0 ? '+' : ''}
            {rule.longRate.toFixed(rule.unit === 'percent' ? 3 : 2)}
            {suffix}
          </span>
        )
      },
    },
    {
      accessorKey: 'shortRate',
      header: 'Short Rate',
      cell: ({ row }) => {
        const rule = row.original
        const suffix = rule.unit === 'percent' ? '%' : ''
        return (
          <span className="font-mono text-danger">
            {rule.shortRate >= 0 ? '+' : ''}
            {rule.shortRate.toFixed(rule.unit === 'percent' ? 3 : 2)}
            {suffix}
          </span>
        )
      },
    },
    {
      accessorKey: 'rolloverTimeUtc',
      header: 'Rollover Time',
      cell: ({ row }) => {
        return <span className="font-mono text-sm">{row.getValue('rolloverTimeUtc')} UTC</span>
      },
    },
    {
      id: 'weekendRule',
      header: 'Weekend / Triple',
      cell: ({ row }) => {
        const rule = row.original
        return <span className="text-sm">{getWeekendRuleLabel(rule)}</span>
      },
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const status = row.getValue('status') as string
        const variant = status === 'active' ? 'success' : 'danger'
        return <Badge variant={variant}>{status}</Badge>
      },
    },
    {
      accessorKey: 'updatedAt',
      header: 'Updated',
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const rule = row.original
        return (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handlePreview(rule)}
              title="Preview"
            >
              <Eye className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleEdit(rule)}
              title="Edit"
            >
              <Edit className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleDisable(rule)}
              title={rule.status === 'active' ? 'Disable' : 'Enable'}
            >
              <X className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleDelete(rule)}
              className="text-danger hover:text-danger hover:bg-danger/10"
              title="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )
      },
    },
  ]

  if (isLoading) {
    return (
      <div className="text-sm text-text-muted py-8 text-center">
        Loading swap rules...
      </div>
    )
  }
  return <DataTable data={rules} columns={columns} />
}

