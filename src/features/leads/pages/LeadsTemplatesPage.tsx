import { useState } from 'react'
import { PageHeader } from '@/shared/layout'
import { ContentShell } from '@/shared/layout'
import { Button } from '@/shared/ui/button'
import { DataTable } from '@/shared/ui/table'
import { useTemplates } from '../hooks/useTemplates'
import { ColumnDef } from '@tanstack/react-table'
import type { EmailTemplate } from '../types/leads.types'
import { formatDate } from '@/shared/utils/time'
import { Plus } from 'lucide-react'
import { CreateEditTemplateModal } from '../components/modals/CreateEditTemplateModal'

export function LeadsTemplatesPage() {
  const { data: templates, isLoading } = useTemplates()
  const [editingId, setEditingId] = useState<string | null>(null)

  const columns: ColumnDef<EmailTemplate>[] = [
    { accessorKey: 'name', header: 'Name' },
    { accessorKey: 'subject', header: 'Subject' },
    {
      accessorKey: 'createdAt',
      header: 'Created',
      cell: ({ row }) => formatDate(row.original.createdAt),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <Button variant="ghost" size="sm" onClick={() => setEditingId(row.original.id)}>
          Edit
        </Button>
      ),
    },
  ]

  return (
    <ContentShell>
      <PageHeader
        title="Email templates"
        actions={
          <Button onClick={() => setEditingId('new')}>
            <Plus className="w-4 h-4 mr-2" />
            Create template
          </Button>
        }
      />
      <div className="rounded-lg border border-border overflow-hidden">
        {isLoading ? (
          <div className="p-8 animate-pulse space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 bg-surface-2 rounded" />
            ))}
          </div>
        ) : (
          <DataTable data={templates ?? []} columns={columns} bordered={false} />
        )}
      </div>
      {editingId && (
        <CreateEditTemplateModal
          templateId={editingId === 'new' ? null : editingId}
          onClose={() => setEditingId(null)}
        />
      )}
    </ContentShell>
  )
}
