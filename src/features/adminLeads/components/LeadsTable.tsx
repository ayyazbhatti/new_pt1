import { useNavigate } from 'react-router-dom'
import { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/shared/ui/table'
import { Button } from '@/shared/ui/button'
import { useModalStore } from '@/app/store'
import { useCanAccess } from '@/shared/utils/permissions'
import { StatusBadge } from './StatusBadge'
import { SourceBadge } from './SourceBadge'
import { OwnerDisplay } from './OwnerDisplay'
import { EditLeadModal } from '../modals/EditLeadModal'
import { ConvertLeadModal } from '../modals/ConvertLeadModal'
import { AssignOwnerModal } from '../modals/AssignOwnerModal'
import { DeleteLeadModal } from '../modals/DeleteLeadModal'
import { Eye, Pencil, UserPlus, Trash2 } from 'lucide-react'
import { formatRelative, formatDateTime } from '../utils/formatDate'
import type { Lead } from '../types/leads'

interface LeadsTableProps {
  leads: Lead[]
  pagination?: {
    page: number
    pageSize: number
    total: number
    onPageChange: (page: number) => void
    onPageSizeChange: (size: number) => void
  }
  /** Called after any mutation (edit, assign, convert, delete) so list can refetch. */
  onMutationSuccess?: () => void
}

export function LeadsTable({ leads, pagination, onMutationSuccess }: LeadsTableProps) {
  const navigate = useNavigate()
  const openModal = useModalStore((state) => state.openModal)
  const onSuccess = onMutationSuccess ?? (() => {})

  const canEdit = useCanAccess('leads:edit')
  const canConvert = useCanAccess('leads:convert')
  const canAssign = useCanAccess('leads:assign')
  const canDelete = useCanAccess('leads:delete')

  const handleView = (lead: Lead) => {
    navigate(`/admin/leads/${lead.id}`)
  }

  const handleEdit = (lead: Lead) => {
    openModal(
      `leads-edit-${lead.id}`,
      <EditLeadModal lead={lead} modalKey={`leads-edit-${lead.id}`} onSuccess={onSuccess} />,
      { title: 'Edit lead', size: 'md' }
    )
  }

  const handleConvert = (lead: Lead) => {
    openModal(
      `leads-convert-${lead.id}`,
      <ConvertLeadModal lead={lead} modalKey={`leads-convert-${lead.id}`} onSuccess={onSuccess} />,
      { title: 'Convert to customer', size: 'sm' }
    )
  }

  const handleAssign = (lead: Lead) => {
    openModal(
      `leads-assign-${lead.id}`,
      <AssignOwnerModal lead={lead} modalKey={`leads-assign-${lead.id}`} onSuccess={onSuccess} />,
      { title: 'Assign owner', size: 'sm' }
    )
  }

  const handleDelete = (lead: Lead) => {
    openModal(
      `leads-delete-${lead.id}`,
      <DeleteLeadModal lead={lead} modalKey={`leads-delete-${lead.id}`} onSuccess={onSuccess} />,
      { title: 'Delete lead', size: 'sm' }
    )
  }

  const columns: ColumnDef<Lead>[] = [
    {
      accessorKey: 'id',
      header: 'Lead ID',
      cell: ({ row }) => {
        const lead = row.original
        return (
          <button
            type="button"
            className="font-mono text-sm whitespace-nowrap text-left text-accent hover:underline cursor-pointer bg-transparent border-0 p-0"
            onClick={(e) => {
              e.stopPropagation()
              handleView(lead)
            }}
            title="View lead details"
          >
            {row.getValue('id') as string}
          </button>
        )
      },
    },
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => {
        const lead = row.original
        return (
          <button
            type="button"
            className="font-semibold text-text whitespace-nowrap text-left hover:underline cursor-pointer bg-transparent border-0 p-0"
            onClick={(e) => {
              e.stopPropagation()
              handleView(lead)
            }}
            title="View lead details"
          >
            {(row.getValue('name') as string) || '—'}
          </button>
        )
      },
    },
    {
      accessorKey: 'email',
      header: 'Email',
      cell: ({ row }) => {
        const lead = row.original
        return (
          <button
            type="button"
            className="text-sm text-text-muted whitespace-nowrap text-left hover:underline cursor-pointer bg-transparent border-0 p-0"
            onClick={(e) => {
              e.stopPropagation()
              handleView(lead)
            }}
            title="View lead details"
          >
            {row.getValue('email') as string}
          </button>
        )
      },
    },
    {
      accessorKey: 'company',
      header: 'Company',
      cell: ({ row }) => (
        <span className="text-sm text-text-muted whitespace-nowrap">
          {(row.getValue('company') as string) || '—'}
        </span>
      ),
    },
    {
      accessorKey: 'source',
      header: 'Source',
      cell: ({ row }) => (
        <div className="whitespace-nowrap">
          <SourceBadge source={row.getValue('source') as Lead['source']} />
        </div>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <div className="whitespace-nowrap">
          <StatusBadge status={row.getValue('status') as Lead['status']} size="sm" />
        </div>
      ),
    },
    {
      accessorKey: 'ownerName',
      header: 'Owner',
      cell: ({ row }) => (
        <div className="whitespace-nowrap">
          <OwnerDisplay ownerName={row.getValue('ownerName') as string | undefined} />
        </div>
      ),
    },
    {
      accessorKey: 'score',
      header: 'Score',
      cell: ({ row }) => (
        <span className="font-mono text-sm text-text whitespace-nowrap">
          {row.getValue('score') != null ? String(row.getValue('score')) : '—'}
        </span>
      ),
    },
    {
      accessorKey: 'createdAt',
      header: 'Created',
      cell: ({ row }) => (
        <span className="text-sm text-text-muted whitespace-nowrap">
          {formatDateTime(row.getValue('createdAt') as string)}
        </span>
      ),
    },
    {
      accessorKey: 'lastActivityAt',
      header: 'Last activity',
      cell: ({ row }) => {
        const at = row.getValue('lastActivityAt') as string | undefined
        return (
          <span className="text-sm text-text-muted whitespace-nowrap">
            {at ? formatRelative(at) : '—'}
          </span>
        )
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const lead = row.original
        return (
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()} data-no-row-click>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleView(lead)}
              title="View"
              className="text-text-muted hover:text-text hover:bg-white/10"
            >
              <Eye className="h-4 w-4" />
            </Button>
            {canEdit && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleEdit(lead)}
                title="Edit"
                className="text-accent hover:text-accent hover:bg-accent/10"
              >
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {canAssign && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleAssign(lead)}
                title="Assign owner"
                className="text-accent hover:text-accent hover:bg-accent/10"
              >
                <UserPlus className="h-4 w-4" />
              </Button>
            )}
            {canConvert && lead.status !== 'converted' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleConvert(lead)}
                title="Convert to customer"
                className="text-success hover:text-success hover:bg-success/10"
              >
                <span className="text-xs font-medium">Convert</span>
              </Button>
            )}
            {canDelete && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDelete(lead)}
                title="Delete"
                className="text-danger hover:text-danger hover:bg-danger/10"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        )
      },
    },
  ]

  return (
    <DataTable
      data={leads}
      columns={columns}
      onRowClick={handleView}
      rowClickTitle="View lead details"
      pagination={pagination}
    />
  )
}
