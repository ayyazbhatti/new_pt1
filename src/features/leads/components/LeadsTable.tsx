import { useMemo } from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/shared/ui/table'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { MoreHorizontal, Phone, Mail, UserPlus, ArrowRight } from 'lucide-react'
import { Menu } from '@headlessui/react'
import { useLeadsUiStore } from '../store/leads.ui.store'

function SendEmailModalWrapper() {
  const modalLeadId = useLeadsUiStore((s) => s.modalLead?.id)
  if (!modalLeadId) return null
  return <SendEmailModal leadId={modalLeadId} />
}
import { formatDate } from '@/shared/utils/time'
import { mockUsers } from '../api/leads.mock'
import type { Lead } from '../types/leads.types'
import { AssignLeadModal } from './modals/AssignLeadModal'
import { ChangeStageModal } from './modals/ChangeStageModal'
import { LogCallModal } from './modals/LogCallModal'
import { SendEmailModal } from './modals/SendEmailModal'
import { EditLeadModal } from './modals/EditLeadModal'

function getOwnerName(ownerUserId: string): string {
  return mockUsers.find((u) => u.id === ownerUserId)?.name ?? ownerUserId
}

interface LeadsTableProps {
  leads: Lead[]
  stages: { id: string; name: string }[]
  total: number
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  onRowClick: (lead: Lead) => void
  basePath: string
  canAssign?: boolean
  canExport?: boolean
}

export function LeadsTable({
  leads,
  stages,
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  onRowClick,
  basePath,
  canAssign = true,
}: LeadsTableProps) {
  const { setModalLead, openModal } = useLeadsUiStore()

  const openAssign = (lead: Lead) => {
    setModalLead(lead)
    openModal('assignLead')
  }
  const openChangeStage = (lead: Lead) => {
    setModalLead(lead)
    openModal('changeStage')
  }
  const openLogCall = (lead: Lead) => {
    setModalLead(lead)
    openModal('logCall')
  }
  const openSendEmail = (lead: Lead) => {
    setModalLead(lead)
    openModal('sendEmail')
  }
  const openEdit = (lead: Lead) => {
    setModalLead(lead)
    openModal('editLead')
  }

  const getStageName = (stageId: string) => stages.find((s) => s.id === stageId)?.name ?? stageId

  const columns = useMemo<ColumnDef<Lead>[]>(
    () => [
      {
        accessorKey: 'firstName',
        header: 'Name',
        cell: ({ row }) => (
          <span className="font-medium text-text">
            {row.original.firstName} {row.original.lastName}
          </span>
        ),
      },
      { accessorKey: 'email', header: 'Email' },
      { accessorKey: 'phone', header: 'Phone' },
      { accessorKey: 'country', header: 'Country' },
      {
        accessorKey: 'stageId',
        header: 'Stage',
        cell: ({ row }) => getStageName(row.original.stageId),
      },
      {
        accessorKey: 'ownerUserId',
        header: 'Owner',
        cell: ({ row }) => getOwnerName(row.original.ownerUserId),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <Badge variant={row.original.status === 'open' ? 'success' : 'neutral'} className="capitalize">
            {row.original.status}
          </Badge>
        ),
      },
      { accessorKey: 'score', header: 'Score' },
      {
        accessorKey: 'lastContactAt',
        header: 'Last contact',
        cell: ({ row }) => formatDate(row.original.lastContactAt),
      },
      {
        accessorKey: 'nextFollowupAt',
        header: 'Next follow-up',
        cell: ({ row }) => formatDate(row.original.nextFollowupAt),
      },
      {
        accessorKey: 'createdAt',
        header: 'Created',
        cell: ({ row }) => formatDate(row.original.createdAt),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => {
          const lead = row.original
          return (
            <Menu as="div" className="relative">
              <Menu.Button
                as={Button}
                variant="ghost"
                size="sm"
                onClick={(e: React.MouseEvent) => e.stopPropagation()}
              >
                <MoreHorizontal className="w-4 h-4" />
              </Menu.Button>
              <Menu.Items
                className="absolute right-0 mt-1 min-w-[160px] rounded-lg border border-border bg-surface-1 py-1 shadow-lg z-50"
              >
                <Menu.Item>
                  {({ active }) => (
                    <button
                      type="button"
                      className={`flex w-full items-center px-3 py-2 text-sm text-text ${active ? 'bg-surface-2' : ''}`}
                      onClick={(e) => { e.stopPropagation(); onRowClick(lead) }}
                    >
                      View
                    </button>
                  )}
                </Menu.Item>
                {canAssign && (
                  <Menu.Item>
                    {({ active }) => (
                      <button
                        type="button"
                        className={`flex w-full items-center px-3 py-2 text-sm text-text ${active ? 'bg-surface-2' : ''}`}
                        onClick={(e) => { e.stopPropagation(); openAssign(lead) }}
                      >
                        <UserPlus className="w-4 h-4 mr-2" /> Assign
                      </button>
                    )}
                  </Menu.Item>
                )}
                <Menu.Item>
                  {({ active }) => (
                    <button
                      type="button"
                      className={`flex w-full items-center px-3 py-2 text-sm text-text ${active ? 'bg-surface-2' : ''}`}
                      onClick={(e) => { e.stopPropagation(); openChangeStage(lead) }}
                    >
                      <ArrowRight className="w-4 h-4 mr-2" /> Change stage
                    </button>
                  )}
                </Menu.Item>
                <Menu.Item>
                  {({ active }) => (
                    <button
                      type="button"
                      className={`flex w-full items-center px-3 py-2 text-sm text-text ${active ? 'bg-surface-2' : ''}`}
                      onClick={(e) => { e.stopPropagation(); openLogCall(lead) }}
                    >
                      <Phone className="w-4 h-4 mr-2" /> Log call
                    </button>
                  )}
                </Menu.Item>
                <Menu.Item>
                  {({ active }) => (
                    <button
                      type="button"
                      className={`flex w-full items-center px-3 py-2 text-sm text-text ${active ? 'bg-surface-2' : ''}`}
                      onClick={(e) => { e.stopPropagation(); openSendEmail(lead) }}
                    >
                      <Mail className="w-4 h-4 mr-2" /> Send email
                    </button>
                  )}
                </Menu.Item>
                <Menu.Item>
                  {({ active }) => (
                    <button
                      type="button"
                      className={`flex w-full items-center px-3 py-2 text-sm text-text ${active ? 'bg-surface-2' : ''}`}
                      onClick={(e) => { e.stopPropagation(); openEdit(lead) }}
                    >
                      Edit
                    </button>
                  )}
                </Menu.Item>
              </Menu.Items>
            </Menu>
          )
        },
      },
    ],
    [canAssign, onRowClick]
  )

  return (
    <>
      <DataTable
        data={leads}
        columns={columns}
        dense
        bordered
        onRowClick={onRowClick}
        pagination={{
          page,
          pageSize,
          total,
          onPageChange,
          onPageSizeChange,
        }}
      />
      <AssignLeadModal />
      <ChangeStageModal />
      <LogCallModal />
      <SendEmailModalWrapper />
      <EditLeadModal />
    </>
  )
}
