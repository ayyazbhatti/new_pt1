import { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/shared/ui/table'
import { Button } from '@/shared/ui/button'
import { LeverageTier } from '../types/leverageProfile'
import { Trash2, Edit } from 'lucide-react'
import { toast } from 'react-hot-toast'

interface TiersTableProps {
  tiers: LeverageTier[]
  onTierDelete?: (tierId: string) => void
  onTierUpdate?: (tierId: string, field: keyof LeverageTier, value: number) => void
  onTierEdit?: (tier: LeverageTier) => void
}

export function TiersTable({ tiers, onTierDelete, onTierUpdate, onTierEdit }: TiersTableProps) {
  const handleDelete = (tierId: string) => {
    if (onTierDelete) {
      onTierDelete(tierId)
    } else {
      toast.success('Tier deleted')
    }
  }

  const handleUpdate = (tierId: string, field: keyof LeverageTier, value: number) => {
    if (onTierUpdate) {
      onTierUpdate(tierId, field, value)
    } else {
      toast.success('Tier updated')
    }
  }

  const columns: ColumnDef<LeverageTier>[] = [
    {
      id: 'tierNumber',
      header: 'Tier #',
      cell: ({ row, table }) => {
        const index = table.getRowModel().rows.findIndex((r) => r.id === row.id)
        return <span className="font-medium">{index + 1}</span>
      },
    },
    {
      accessorKey: 'from',
      header: 'Margin From',
      cell: ({ row }) => {
        const tier = row.original
        return (
          <span className="font-mono text-text">
            ${tier.from.toLocaleString()}
          </span>
        )
      },
    },
    {
      accessorKey: 'to',
      header: 'Margin To',
      cell: ({ row }) => {
        const tier = row.original
        return (
          <span className="font-mono text-text">
            ${tier.to.toLocaleString()}
          </span>
        )
      },
    },
    {
      accessorKey: 'leverage',
      header: 'Leverage',
      cell: ({ row }) => {
        const tier = row.original
        return (
          <span className="font-mono font-semibold">
            1:{tier.leverage}
          </span>
        )
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const tier = row.original
        return (
          <div className="flex items-center gap-2">
            {onTierEdit && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onTierEdit(tier)}
                title="Edit Tier"
              >
                <Edit className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleDelete(tier.id)}
              className="text-danger hover:text-danger hover:bg-danger/10"
              title="Delete Tier"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )
      },
    },
  ]

  return <DataTable data={tiers} columns={columns} />
}

