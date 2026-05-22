import { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/shared/ui/table'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import type { SessionTemplate } from '../types/sessionTemplate'
import { useModalStore } from '@/app/store'
import { useCanAccess } from '@/shared/utils/permissions'
import { Edit, Trash2 } from 'lucide-react'
import { SessionTemplateForm } from './SessionTemplateForm'
import { useDeleteSessionTemplate } from '../hooks/useSessionTemplates'

interface SessionTemplatesTableProps {
  templates: SessionTemplate[]
  isLoading?: boolean
}

export function SessionTemplatesTable({ templates, isLoading }: SessionTemplatesTableProps) {
  const openModal = useModalStore((state) => state.openModal)
  const closeModal = useModalStore((state) => state.closeModal)
  const canEdit = useCanAccess('sessions:edit')
  const deleteT = useDeleteSessionTemplate()

  const handleEdit = (t: SessionTemplate) => {
    openModal(`edit-session-${t.id}`, <SessionTemplateForm mode="edit" initial={t} onDone={() => closeModal(`edit-session-${t.id}`)} />, {
      title: `Edit session template — ${t.name}`,
      size: 'lg',
    })
  }

  const handleDelete = (t: SessionTemplate) => {
    if (!confirm(`Delete session template "${t.name}"? Symbols using it will fall back to Auto (null).`)) return
    deleteT.mutate(t.id)
  }

  const columns: ColumnDef<SessionTemplate>[] = [
    { accessorKey: 'name', header: 'Name' },
    { accessorKey: 'timezone', header: 'Timezone', cell: ({ row }) => <span className="font-mono text-sm">{row.original.timezone}</span> },
    {
      id: 'schedule',
      header: 'Schedule',
      cell: ({ row }) =>
        row.original.is24_7 ? (
          <Badge variant="success">24/7</Badge>
        ) : (
          <Badge variant="neutral">{row.original.windows.length} window(s)</Badge>
        ),
    },
    {
      accessorKey: 'isDefaultForMarket',
      header: 'Default for',
      cell: ({ row }) => {
        const m = row.original.isDefaultForMarket
        return <span className="capitalize">{m ?? '—'}</span>
      },
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const t = row.original
        if (!canEdit) return null
        return (
          <div className="flex justify-end gap-1">
            <Button type="button" variant="ghost" size="icon" onClick={() => handleEdit(t)} aria-label="Edit">
              <Edit className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" onClick={() => handleDelete(t)} aria-label="Delete">
              <Trash2 className="h-4 w-4 text-danger" />
            </Button>
          </div>
        )
      },
    },
  ]

  if (isLoading) {
    return <div className="py-8 text-center text-sm text-muted">Loading session templates…</div>
  }

  return <DataTable columns={columns} data={templates} />
}
