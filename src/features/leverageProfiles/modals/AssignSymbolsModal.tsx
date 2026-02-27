import { useState } from 'react'
import { DataTable } from '@/shared/ui/table'
import { Button } from '@/shared/ui/button'
import { Switch } from '@/shared/ui/Switch'
import { Badge } from '@/shared/ui/badge'
import { LeverageProfile } from '../types/leverageProfile'
import { useModalStore } from '@/app/store'
import { toast } from '@/shared/components/common'
import { ColumnDef } from '@tanstack/react-table'
import { mockSymbolsForAssignment, SymbolForAssignment } from '../mocks/symbols.mock'

interface AssignSymbolsModalProps {
  profile: LeverageProfile
}

export function AssignSymbolsModal({ profile }: AssignSymbolsModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)

  const [symbols, setSymbols] = useState<SymbolForAssignment[]>(
    mockSymbolsForAssignment.map((symbol) => ({
      ...symbol,
      currentProfile: symbol.currentProfile,
    }))
  )

  const handleToggle = (symbolCode: string) => {
    setSymbols(
      symbols.map((s) =>
        s.code === symbolCode
          ? {
              ...s,
              currentProfile:
                s.currentProfile === profile.name ? undefined : profile.name,
            }
          : s
      )
    )
  }

  const handleSave = () => {
    const assigned = symbols.filter((s) => s.currentProfile === profile.name).map((s) => s.code)
    toast.success(`${assigned.length} symbols assigned to ${profile.name}`)
    closeModal(`assign-symbols-${profile.id}`)
  }

  const columns: ColumnDef<SymbolForAssignment>[] = [
    {
      accessorKey: 'code',
      header: 'Symbol',
      cell: ({ row }) => {
        return <span className="font-mono font-semibold">{row.getValue('code')}</span>
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
      accessorKey: 'currentProfile',
      header: 'Current Profile',
      cell: ({ row }) => {
        const profile = row.getValue('currentProfile') as string | undefined
        return profile ? (
          <Badge variant="neutral">{profile}</Badge>
        ) : (
          <span className="text-text-muted text-sm">None</span>
        )
      },
    },
    {
      id: 'assign',
      header: 'Assign Toggle',
      cell: ({ row }) => {
        const symbol = row.original
        const isAssigned = symbol.currentProfile === profile.name
        return (
          <Switch
            checked={isAssigned}
            onCheckedChange={() => handleToggle(symbol.code)}
          />
        )
      },
    },
  ]

  const assignedCount = symbols.filter((s) => s.currentProfile === profile.name).length

  return (
    <div className="space-y-4">
      <div className="text-sm text-text-muted">
        Select symbols to assign to <strong className="text-text">{profile.name}</strong>
      </div>
      <div className="border border-border rounded-lg overflow-hidden">
        <DataTable data={symbols} columns={columns} />
      </div>
      <div className="flex items-center justify-between p-4 bg-surface-2 rounded-lg">
        <div className="text-sm text-text-muted">
          <strong className="text-text">{assignedCount}</strong> symbols assigned to this profile
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-4 border-t border-border">
        <Button variant="outline" onClick={() => closeModal(`assign-symbols-${profile.id}`)}>
          Close
        </Button>
        <Button onClick={handleSave}>Save</Button>
      </div>
    </div>
  )
}

