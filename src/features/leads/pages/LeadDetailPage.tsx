import { useParams, useNavigate } from 'react-router-dom'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { ContentShell } from '@/shared/layout'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/ui/tabs'
import { LeadHeader } from '../components/LeadHeader'
import { LeadTimeline } from '../components/LeadTimeline'
import { LeadTasksPanel } from '../components/LeadTasksPanel'
import { LeadCommunicationPanel } from '../components/LeadCommunicationPanel'
import { useLeadById } from '../hooks/useLeadById'
import { useLeadRealtime } from '../hooks/useLeadRealtime'
import { useLeadsUiStore } from '../store/leads.ui.store'
import { Phone, Mail, ListTodo } from 'lucide-react'
import { Chip } from '@/shared/ui/chip'
import { formatDate } from '@/shared/utils/time'
import { LogCallModal } from '../components/modals/LogCallModal'
import { SendEmailModal } from '../components/modals/SendEmailModal'
import { CreateTaskModal } from '../components/modals/CreateTaskModal'

interface LeadDetailPageProps {
  basePath: string
}

export function LeadDetailPage({ basePath }: LeadDetailPageProps) {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  useLeadRealtime()
  const { data: lead, isLoading } = useLeadById(id ?? null)
  const { setModalLead, openModal } = useLeadsUiStore()

  const openLogCall = () => {
    if (lead) setModalLead(lead)
    openModal('logCall')
  }
  const openSendEmail = () => {
    if (lead) setModalLead(lead)
    openModal('sendEmail')
  }
  const openCreateTask = () => {
    if (lead) setModalLead(lead)
    openModal('createTask')
  }

  if (!id) {
    navigate(basePath)
    return null
  }

  if (isLoading || !lead) {
    return (
      <ContentShell>
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-64 bg-surface-2 rounded" />
          <div className="h-64 bg-surface-2 rounded" />
        </div>
      </ContentShell>
    )
  }

  return (
    <ContentShell className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate(basePath)}>
          ← Back
        </Button>
      </div>
      <LeadHeader leadId={lead.id} basePath={basePath} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6 flex-1 min-h-0">
        <div className="lg:col-span-1">
          <Card className="p-4 border border-border">
            <h3 className="text-sm font-medium text-text mb-3">Contact</h3>
            <p className="text-sm text-text">{lead.email}</p>
            <p className="text-sm text-text">{lead.phone || '—'}</p>
            <p className="text-sm text-text-muted mt-2">
              {lead.city && lead.country ? `${lead.city}, ${lead.country}` : lead.country || '—'}
            </p>
            <h3 className="text-sm font-medium text-text mt-4 mb-2">Source</h3>
            <p className="text-sm text-text-muted">{lead.source || '—'}</p>
            {lead.tags?.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {lead.tags.map((t) => (
                  <Chip key={t} size="sm">{t}</Chip>
                ))}
              </div>
            )}
            <p className="text-sm text-text-muted mt-2">Score: {lead.score}</p>
          </Card>
        </div>
        <div className="lg:col-span-2 flex flex-col min-h-0">
          <Tabs defaultValue="timeline" className="flex-1 flex flex-col min-h-0">
            <TabsList>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
              <TabsTrigger value="tasks">Tasks</TabsTrigger>
              <TabsTrigger value="communication">Communication</TabsTrigger>
            </TabsList>
            <TabsContent value="timeline" className="flex-1 overflow-auto mt-4">
              <LeadTimeline leadId={lead.id} />
            </TabsContent>
            <TabsContent value="tasks" className="flex-1 overflow-auto mt-4">
              <LeadTasksPanel leadId={lead.id} />
            </TabsContent>
            <TabsContent value="communication" className="flex-1 overflow-auto mt-4">
              <LeadCommunicationPanel leadId={lead.id} />
            </TabsContent>
          </Tabs>
        </div>
        <div className="lg:col-span-1">
          <Card className="p-4 border border-border">
            <h3 className="text-sm font-medium text-text mb-3">Quick actions</h3>
            <div className="space-y-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={openLogCall}
              >
                <Phone className="w-4 h-4 mr-2" />
                Log call
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={openSendEmail}
              >
                <Mail className="w-4 h-4 mr-2" />
                Send email
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={openCreateTask}
              >
                <ListTodo className="w-4 h-4 mr-2" />
                Add task
              </Button>
              {lead.phone && (
                <a href={`tel:${lead.phone}`}>
                  <Button variant="outline" size="sm" className="w-full justify-start">
                    <Phone className="w-4 h-4 mr-2" />
                    Click to call
                  </Button>
                </a>
              )}
            </div>
          </Card>
        </div>
      </div>
      <LogCallModal />
      <SendEmailModal leadId={lead.id} />
      <CreateTaskModal leadId={lead.id} />
    </ContentShell>
  )
}
