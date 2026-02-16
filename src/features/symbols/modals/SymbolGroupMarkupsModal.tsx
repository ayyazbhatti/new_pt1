import { useState } from 'react'
import { DataTable } from '@/shared/ui/table'
import { Button } from '@/shared/ui/button'
import { Switch } from '@/shared/ui/Switch'
import { Input } from '@/shared/ui/input'
import { AdminSymbol, GroupMarkup } from '../types/symbol'
import { useModalStore } from '@/app/store'
import { toast } from 'react-hot-toast'
import { ColumnDef } from '@tanstack/react-table'
import { mockGroups } from '@/features/groups/mocks/groups.mock'

interface SymbolGroupMarkupsModalProps {
  symbol: AdminSymbol
}

export function SymbolGroupMarkupsModal({ symbol }: SymbolGroupMarkupsModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)

  // Initialize markups from groups
  const [markups, setMarkups] = useState<GroupMarkup[]>(
    mockGroups.map((group) => ({
      groupId: group.id,
      groupName: group.name,
      markupType: 'percent' as const,
      markupValue: group.spreadMarkup,
      enabled: true,
    }))
  )

  const handleMarkupValueChange = (groupId: string, value: number) => {
    setMarkups(
      markups.map((m) => (m.groupId === groupId ? { ...m, markupValue: value } : m))
    )
  }

  const handleEnabledToggle = (groupId: string) => {
    setMarkups(
      markups.map((m) => (m.groupId === groupId ? { ...m, enabled: !m.enabled } : m))
    )
  }

  const handleSave = () => {
    toast.success(`Group markups saved for ${symbol.code}`)
    closeModal(`group-markups-${symbol.id}`)
  }

  const columns: ColumnDef<GroupMarkup>[] = [
    {
      accessorKey: 'groupName',
      header: 'Group Name',
    },
    {
      accessorKey: 'markupType',
      header: 'Markup Type',
      cell: () => <span className="text-text">%</span>,
    },
    {
      accessorKey: 'markupValue',
      header: 'Markup (%)',
      cell: ({ row }) => {
        const markup = row.original
        return (
          <Input
            type="number"
            step="0.1"
            value={markup.markupValue}
            onChange={(e) =>
              handleMarkupValueChange(markup.groupId, parseFloat(e.target.value) || 0)
            }
            className="w-24 h-8"
          />
        )
      },
    },
    {
      accessorKey: 'enabled',
      header: 'Enabled',
      cell: ({ row }) => {
        const markup = row.original
        return (
          <Switch
            checked={markup.enabled}
            onCheckedChange={() => handleEnabledToggle(markup.groupId)}
          />
        )
      },
    },
  ]

  return (
    <div className="space-y-4">
      <div className="text-sm text-text-muted">
        Configure group-specific markups for <strong className="text-text">{symbol.code}</strong>.
        Markup is applied to displayed price for users in that group.
      </div>
      <div className="border border-border rounded-lg overflow-hidden">
        <DataTable data={markups} columns={columns} />
      </div>
      <div className="p-4 bg-surface-2 rounded-lg">
        <p className="text-xs text-text-muted">
          Markup is applied to displayed price for users in that group.
        </p>
      </div>
      <div className="flex justify-end gap-2 pt-4 border-t border-border">
        <Button variant="outline" onClick={() => closeModal(`group-markups-${symbol.id}`)}>
          Close
        </Button>
        <Button onClick={handleSave}>Save</Button>
      </div>
    </div>
  )
}

