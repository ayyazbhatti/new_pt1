import { useCallback } from 'react'
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ContentShell, PageHeader } from '@/shared/layout'
import { Card } from '@/shared/ui/card'
import { Button } from '@/shared/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/ui/tabs'
import { useModalStore } from '@/app/store'
import { useCanAccess } from '@/shared/utils/permissions'
import { getLeadById, getLeadActivities } from '../api/leads.api'
import { StatusBadge } from '../components/StatusBadge'
import { SourceBadge } from '../components/SourceBadge'
import { OwnerDisplay } from '../components/OwnerDisplay'
import { EditLeadModal } from '../modals/EditLeadModal'
import { ConvertLeadModal } from '../modals/ConvertLeadModal'
import { AssignOwnerModal } from '../modals/AssignOwnerModal'
import { AddActivityModal } from '../modals/AddActivityModal'
import { DeleteLeadModal } from '../modals/DeleteLeadModal'
import {
  Pencil,
  UserPlus,
  Trash2,
  Plus,
  Mail,
  Phone,
  Building2,
  ChevronRight,
  StickyNote,
  PhoneCall,
  Mail as MailIcon,
  Calendar,
} from 'lucide-react'
import type { Lead, LeadActivity } from '../types/leads'
import { getAppointments } from '@/features/appointments/api/appointments.api'
import { CreateAppointmentModal } from '@/features/appointments/modals/CreateAppointmentModal'
import { createAppointment } from '@/features/appointments/api/appointments.api'
import { toast } from '@/shared/components/common'
import { getApiErrorMessage } from '@/shared/api/http'
import type { Appointment } from '@/features/appointments/types'

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  } catch {
    return iso
  }
}

function ActivityIcon({ type }: { type: LeadActivity['type'] }) {
  if (type === 'note') return <StickyNote className="h-4 w-4 text-text-muted" />
  if (type === 'call') return <PhoneCall className="h-4 w-4 text-text-muted" />
  if (type === 'email') return <MailIcon className="h-4 w-4 text-text-muted" />
  return <StickyNote className="h-4 w-4 text-text-muted" />
}

const LEAD_DETAIL_TABS = ['overview', 'activity', 'meetings'] as const
type LeadDetailTab = (typeof LEAD_DETAIL_TABS)[number]

function isValidLeadTab(tab: string | null): tab is LeadDetailTab {
  return tab != null && LEAD_DETAIL_TABS.includes(tab as LeadDetailTab)
}

export function AdminLeadDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const openModal = useModalStore((state) => state.openModal)
  const queryClient = useQueryClient()

  const tabParam = searchParams.get('tab')
  const activeTab: LeadDetailTab = isValidLeadTab(tabParam) ? tabParam : 'overview'

  const setActiveTab = useCallback(
    (tab: string) => {
      if (isValidLeadTab(tab)) {
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev)
          next.set('tab', tab)
          return next
        })
      }
    },
    [setSearchParams]
  )

  const {
    data: lead,
    isLoading: leadLoading,
    error: leadError,
  } = useQuery({
    queryKey: ['leads', id],
    queryFn: () => getLeadById(id!),
    enabled: !!id,
  })

  const { data: activities = [] } = useQuery({
    queryKey: ['leads', id, 'activities'],
    queryFn: () => getLeadActivities(id!),
    enabled: !!id,
  })

  const sortedActivities = [...activities].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )

  const canView = useCanAccess('leads:view')
  const canEdit = useCanAccess('leads:edit')
  const canConvert = useCanAccess('leads:convert')
  const canAssign = useCanAccess('leads:assign')
  const canDelete = useCanAccess('leads:delete')
  const canCreateAppointment = useCanAccess('appointments:create')

  const { data: appointmentsData } = useQuery({
    queryKey: ['admin', 'appointments', { lead_id: id }],
    queryFn: () => getAppointments({ lead_id: id!, limit: 50 }),
    enabled: !!id && canView,
  })
  const leadAppointments: Appointment[] = appointmentsData?.appointments ?? []

  const createAppointmentMutation = useMutation({
    mutationFn: createAppointment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'appointments'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'appointments', { lead_id: id }] })
      toast.success('Meeting scheduled.')
      useModalStore.getState().closeModal('lead-schedule-meeting')
    },
    onError: (err: unknown) => {
      toast.error(getApiErrorMessage(err))
    },
  })

  const invalidateDetail = useCallback(() => {
    if (id) {
      queryClient.invalidateQueries({ queryKey: ['leads'] })
      queryClient.invalidateQueries({ queryKey: ['leads', id] })
      queryClient.invalidateQueries({ queryKey: ['leads', id, 'activities'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'appointments', { lead_id: id }] })
    }
  }, [queryClient, id])

  const handleEdit = useCallback(() => {
    if (!lead) return
    openModal(
      `leads-edit-${lead.id}`,
      <EditLeadModal
        lead={lead}
        modalKey={`leads-edit-${lead.id}`}
        onSuccess={invalidateDetail}
      />,
      { title: 'Edit lead', size: 'md' }
    )
  }, [lead, openModal, invalidateDetail])

  const handleConvert = useCallback(() => {
    if (!lead) return
    openModal(
      `leads-convert-${lead.id}`,
      <ConvertLeadModal
        lead={lead}
        modalKey={`leads-convert-${lead.id}`}
        onSuccess={invalidateDetail}
      />,
      { title: 'Convert to customer', size: 'sm' }
    )
  }, [lead, openModal, invalidateDetail])

  const handleAssign = useCallback(() => {
    if (!lead) return
    openModal(
      `leads-assign-${lead.id}`,
      <AssignOwnerModal
        lead={lead}
        modalKey={`leads-assign-${lead.id}`}
        onSuccess={invalidateDetail}
      />,
      { title: 'Assign owner', size: 'sm' }
    )
  }, [lead, openModal, invalidateDetail])

  const handleAddActivity = useCallback(() => {
    if (!lead) return
    openModal(
      `leads-activity-${lead.id}`,
      <AddActivityModal
        lead={lead}
        modalKey={`leads-activity-${lead.id}`}
        onSuccess={invalidateDetail}
      />,
      { title: 'Add activity', size: 'md' }
    )
  }, [lead, openModal, invalidateDetail])

  const handleDelete = useCallback(() => {
    if (!lead) return
    openModal(
      `leads-delete-${lead.id}`,
      <DeleteLeadModal
        lead={lead}
        modalKey={`leads-delete-${lead.id}`}
        onSuccess={() => {
          invalidateDetail()
          navigate('/admin/leads')
        }}
      />,
      { title: 'Delete lead', size: 'sm' }
    )
  }, [lead, openModal, navigate, invalidateDetail])

  const handleScheduleMeeting = useCallback(() => {
    if (!lead) return
    openModal(
      'lead-schedule-meeting',
      <CreateAppointmentModal
        initialLead={{ id: lead.id, name: lead.name || lead.email, email: lead.email }}
        onSearchUsers={async () => []}
        onSubmit={(payload) => createAppointmentMutation.mutate(payload)}
        submitting={createAppointmentMutation.isPending}
      />,
      { title: 'Schedule meeting', size: 'md' }
    )
  }, [lead, openModal, createAppointmentMutation])

  if (!canView) {
    return (
      <ContentShell>
        <PageHeader title="Lead" description="View lead details." />
        <p className="text-sm text-text-muted">
          You do not have permission to view this lead.
        </p>
      </ContentShell>
    )
  }

  if (!id) {
    return (
      <ContentShell>
        <PageHeader title="Lead" />
        <div className="rounded-lg border border-border bg-surface-2 p-8 text-center">
          <p className="text-text-muted">Lead not found.</p>
          <Button variant="outline" className="mt-4" asChild>
            <Link to="/admin/leads">Back to leads</Link>
          </Button>
        </div>
      </ContentShell>
    )
  }

  if (leadLoading && !lead) {
    return (
      <ContentShell>
        <PageHeader title="Lead" />
        <div className="flex items-center justify-center h-64">
          <div className="text-text-muted">Loading lead…</div>
        </div>
      </ContentShell>
    )
  }

  if (leadError) {
    return (
      <ContentShell>
        <PageHeader title="Lead" />
        <div className="rounded-lg border border-border bg-surface-2 p-8 text-center">
          <p className="text-danger mb-2">Failed to load lead.</p>
          <p className="text-sm text-text-muted mb-4">
            {leadError instanceof Error ? leadError.message : 'Unknown error'}
          </p>
          <Button variant="outline" asChild>
            <Link to="/admin/leads">Back to leads</Link>
          </Button>
        </div>
      </ContentShell>
    )
  }

  if (!lead) {
    return (
      <ContentShell>
        <PageHeader title="Lead" />
        <div className="rounded-lg border border-border bg-surface-2 p-8 text-center">
          <p className="text-text-muted">Lead not found.</p>
          <Button variant="outline" className="mt-4" asChild>
            <Link to="/admin/leads">Back to leads</Link>
          </Button>
        </div>
      </ContentShell>
    )
  }

  const displayName = lead.name || lead.email || `Lead #${lead.id}`

  return (
    <ContentShell>
      {/* Breadcrumb */}
      <nav className="mb-4 flex items-center gap-2 text-sm text-text-muted">
        <Link to="/admin/leads" className="hover:text-text">
          Leads
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-text">{displayName}</span>
      </nav>

      {/* Header */}
      <PageHeader
        title={displayName}
        description={lead.email}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={lead.status} size="sm" />
            <OwnerDisplay ownerName={lead.ownerName} />
            {canAssign && (
              <Button variant="outline" size="sm" onClick={handleAssign}>
                <UserPlus className="h-4 w-4 mr-1" />
                Assign
              </Button>
            )}
            {canEdit && (
              <Button variant="outline" size="sm" onClick={handleEdit}>
                <Pencil className="h-4 w-4 mr-1" />
                Edit
              </Button>
            )}
            {canConvert && lead.status !== 'converted' && (
              <Button size="sm" onClick={handleConvert}>
                Convert to customer
              </Button>
            )}
            {canDelete && (
              <Button
                variant="outline"
                size="sm"
                className="text-danger"
                onClick={handleDelete}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Delete
              </Button>
            )}
          </div>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="meetings">Meetings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-4">
          <Card className="rounded-lg border border-border bg-surface-2 p-4">
            <h3 className="text-sm font-medium text-text mb-3">
              Contact information
            </h3>
            <div className="grid gap-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-text-muted w-20">Name</span>
                <span className="text-text">{lead.name || '—'}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-text-muted w-20">Email</span>
                <a
                  href={`mailto:${lead.email}`}
                  className="text-primary hover:underline flex items-center gap-1"
                >
                  <Mail className="h-4 w-4" />
                  {lead.email}
                </a>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-text-muted w-20">Phone</span>
                {lead.phone ? (
                  <a
                    href={`tel:${lead.phone}`}
                    className="text-primary hover:underline flex items-center gap-1"
                  >
                    <Phone className="h-4 w-4" />
                    {lead.phone}
                  </a>
                ) : (
                  <span className="text-text-muted">—</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-text-muted w-20">Company</span>
                <span className="text-text flex items-center gap-1">
                  {lead.company ? (
                    <>
                      <Building2 className="h-4 w-4" />
                      {lead.company}
                    </>
                  ) : (
                    '—'
                  )}
                </span>
              </div>
            </div>
          </Card>

          <Card className="rounded-lg border border-border bg-surface-2 p-4">
            <h3 className="text-sm font-medium text-text mb-3">Lead details</h3>
            <div className="grid gap-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-text-muted w-24">Source</span>
                <SourceBadge source={lead.source} />
              </div>
              {lead.campaign && (
                <div className="flex items-center gap-2">
                  <span className="text-text-muted w-24">Campaign</span>
                  <span className="text-text">{lead.campaign}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="text-text-muted w-24">Score</span>
                <span className="text-text">{lead.score ?? '—'}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-text-muted w-24">Created</span>
                <span className="text-text">{formatDate(lead.createdAt)}</span>
              </div>
              {lead.lastActivityAt && (
                <div className="flex items-center gap-2">
                  <span className="text-text-muted w-24">Last activity</span>
                  <span className="text-text">
                    {formatDate(lead.lastActivityAt)}
                  </span>
                </div>
              )}
            </div>
          </Card>

          {lead.status === 'converted' &&
            (lead.convertedAt || lead.convertedUserId) && (
              <Card className="rounded-lg border border-border bg-surface-2 p-4 border-success/30">
                <h3 className="text-sm font-medium text-text mb-2">Converted</h3>
                <p className="text-sm text-text-muted">
                  {lead.convertedAt &&
                    `Converted on ${formatDate(lead.convertedAt)}.`}
                  {lead.convertedUserId &&
                    ` Linked to user ID: ${lead.convertedUserId}.`}
                </p>
                {lead.convertedUserId && (
                  <Button variant="outline" size="sm" className="mt-2" asChild>
                    <Link
                      to={`/admin/users?user=${lead.convertedUserId}`}
                    >
                      View customer
                    </Link>
                  </Button>
                )}
              </Card>
            )}
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-text">Activity timeline</h3>
            {canEdit && (
              <Button size="sm" onClick={handleAddActivity}>
                <Plus className="h-4 w-4 mr-2" />
                Add activity
              </Button>
            )}
          </div>
          {sortedActivities.length === 0 ? (
            <Card className="rounded-lg border border-border bg-surface-2 p-8 text-center">
              <p className="text-text-muted">
                No activity yet. Add a note or log a call.
              </p>
              {canEdit && (
                <Button className="mt-3" onClick={handleAddActivity}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add activity
                </Button>
              )}
            </Card>
          ) : (
            <div className="space-y-4">
              {sortedActivities.map((activity) => (
                <Card
                  key={activity.id}
                  className="rounded-lg border border-border bg-surface-2 p-4"
                >
                  <div className="flex gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-1">
                      <ActivityIcon type={activity.type} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-text capitalize">
                        {activity.type.replace('_', ' ')}
                      </p>
                      <p className="text-sm text-text-muted mt-1 whitespace-pre-wrap">
                        {activity.content}
                      </p>
                      <p className="text-xs text-text-muted mt-2">
                        {activity.createdBy} · {formatDate(activity.createdAt)}
                      </p>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="meetings" className="mt-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-text">Meetings</h3>
            {canCreateAppointment && (
              <Button size="sm" onClick={handleScheduleMeeting}>
                <Calendar className="h-4 w-4 mr-2" />
                Schedule meeting
              </Button>
            )}
          </div>
          {leadAppointments.length === 0 ? (
            <Card className="rounded-lg border border-border bg-surface-2 p-8 text-center">
              <p className="text-text-muted">No meetings scheduled for this lead.</p>
              {canCreateAppointment && (
                <Button className="mt-3" onClick={handleScheduleMeeting}>
                  <Calendar className="h-4 w-4 mr-2" />
                  Schedule meeting
                </Button>
              )}
            </Card>
          ) : (
            <div className="space-y-4">
              {leadAppointments.map((apt) => (
                <Card
                  key={apt.id}
                  className="rounded-lg border border-border bg-surface-2 p-4"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-sm font-medium text-text">{apt.title}</p>
                      <p className="text-xs text-text-muted mt-1">
                        {formatDate(apt.scheduled_at)} · {apt.duration_minutes} min · {apt.status}
                      </p>
                      {apt.description && (
                        <p className="text-sm text-text-muted mt-2">{apt.description}</p>
                      )}
                    </div>
                    <Button variant="outline" size="sm" asChild>
                      <Link to={`/admin/appointments?highlight=${apt.id}`}>View in calendar</Link>
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </ContentShell>
  )
}
