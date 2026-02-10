import { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/shared/ui/table'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { MarkupRule } from '../types/markup'
import { useModalStore } from '@/app/store'
import { EditMarkupRuleModal } from '../modals/EditMarkupRuleModal'
import { PreviewMarkupModal } from '../modals/PreviewMarkupModal'
import { ConfirmDeleteModal } from '../modals/ConfirmDeleteModal'
import { Eye, Edit, X, Trash2 } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { useMemo } from 'react'

interface MarkupRulesTableProps {
  rules: MarkupRule[]
  filters?: {
    group: string
    market: string
    symbol: string
    status: string
  }
}

export function MarkupRulesTable({ rules, filters }: MarkupRulesTableProps) {
  const openModal = useModalStore((state) => state.openModal)

  const filteredRules = useMemo(() => {
    return rules.filter((rule) => {
      if (filters?.group && filters.group !== 'all') {
        if (rule.groupId !== filters.group) return false
      }
      if (filters?.market && filters.market !== 'all') {
        if (rule.market !== filters.market) return false
      }
      if (filters?.symbol) {
        const searchLower = filters.symbol.toLowerCase()
        if (!rule.symbol.toLowerCase().includes(searchLower)) return false
      }
      if (filters?.status && filters.status !== 'all') {
        if (rule.status !== filters.status) return false
      }
      return true
    })
  }, [rules, filters])

  const handlePreview = (rule: MarkupRule) => {
    openModal(`preview-${rule.id}`, <PreviewMarkupModal rule={rule} />, {
      title: `Price Preview - ${rule.symbol}`,
      size: 'lg',
    })
  }

  const handleEdit = (rule: MarkupRule) => {
    openModal(`edit-rule-${rule.id}`, <EditMarkupRuleModal rule={rule} />, {
      title: 'Edit Markup Rule',
      size: 'md',
    })
  }

  const handleDelete = (rule: MarkupRule) => {
    openModal(`delete-${rule.id}`, <ConfirmDeleteModal rule={rule} />, {
      title: 'Confirm Delete',
      size: 'sm',
    })
  }

  const handleDisable = (rule: MarkupRule) => {
    toast.success(`Rule ${rule.status === 'active' ? 'disabled' : 'enabled'}`)
  }

  const columns: ColumnDef<MarkupRule>[] = [
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
      accessorKey: 'markupType',
      header: 'Markup Type',
      cell: ({ row }) => {
        const type = row.getValue('markupType') as string
        return <span className="capitalize">{type}</span>
      },
    },
    {
      accessorKey: 'value',
      header: 'Value',
      cell: ({ row }) => {
        const rule = row.original
        const suffix = rule.markupType === 'percent' ? '%' : ''
        return (
          <span className="font-mono">
            {rule.value.toFixed(rule.markupType === 'percent' ? 2 : rule.rounding)}
            {suffix}
          </span>
        )
      },
    },
    {
      accessorKey: 'applyTo',
      header: 'Apply To',
      cell: ({ row }) => {
        const applyTo = row.getValue('applyTo') as string
        return <span className="capitalize">{applyTo}</span>
      },
    },
    {
      accessorKey: 'rounding',
      header: 'Rounding',
      cell: ({ row }) => {
        return <span className="font-mono">{row.getValue('rounding')} decimals</span>
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

  return <DataTable data={filteredRules} columns={columns} />
}

