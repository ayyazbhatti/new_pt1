import { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/shared/ui/table'
import { Button } from '@/shared/ui/button'
import { LeverageTier } from '../types/leverageProfile'
import { Trash2, Edit } from 'lucide-react'
import { toast } from '@/shared/components/common'

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
        const val = (tier.from ?? Number(tier.notionalFrom)) || 0
        return (
          <span className="font-mono text-text">
            ${val.toLocaleString()}
          </span>
        )
      },
    },
    {
      accessorKey: 'to',
      header: 'Margin To',
      cell: ({ row }) => {
        const tier = row.original
        const val = tier.to ?? (tier.notionalTo != null ? Number(tier.notionalTo) : null)
        return (
          <span className="font-mono text-text">
            {val != null ? `$${val.toLocaleString()}` : '—'}
          </span>
        )
      },
    },
    {
      accessorKey: 'leverage',
      header: 'Leverage',
      cell: ({ row }) => {
        const tier = row.original
        const lev = tier.leverage ?? tier.maxLeverage ?? 0
        return (
          <span className="font-mono font-semibold">
            {lev}:1
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
            {onTierDelete && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDelete(tier.id)}
                className="text-danger hover:text-danger hover:bg-danger/10"
                title="Delete Tier"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        )
      },
    },
  ]

  return <DataTable data={tiers} columns={columns} />
}

