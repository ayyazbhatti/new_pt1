import { Check, Phone, Mail, Calendar } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { useLeadTasks } from '../hooks/useLeadById'
import { useCompleteTask } from '../hooks/useLeadTasksMutations'
import { useLeadsUiStore } from '../store/leads.ui.store'
import { formatDate } from '@/shared/utils/time'
import { cn } from '@/shared/utils'
import type { LeadTaskType } from '../types/leads.types'
import { CreateTaskModal } from './modals/CreateTaskModal'

const taskIcon: Record<LeadTaskType, React.ComponentType<{ className?: string }>> = {
  call: Phone,
  email: Mail,
  whatsapp: Mail,
  meeting: Calendar,
  doc: Calendar,
}

interface LeadTasksPanelProps {
  leadId: string
  className?: string
}

export function LeadTasksPanel({ leadId, className }: LeadTasksPanelProps) {
  const { data: tasks, isLoading } = useLeadTasks(leadId)
  const completeTask = useCompleteTask()
  const openCreateTask = () => {
    useLeadsUiStore.getState().setModalLead({ id: leadId } as any)
    useLeadsUiStore.getState().openModal('createTask')
  }

  if (isLoading) {
    return (
      <div className={cn('space-y-2', className)}>
        {[1, 2].map((i) => (
          <div key={i} className="h-12 rounded bg-surface-2 animate-pulse" />
        ))}
      </div>
    )
  }

  const pending = tasks?.filter((t) => t.status !== 'completed' && t.status !== 'cancelled') ?? []
  const completed = tasks?.filter((t) => t.status === 'completed') ?? []

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text">Tasks</h3>
        <Button variant="secondary" size="sm" onClick={openCreateTask}>
          Add task
        </Button>
      </div>
      <CreateTaskModal leadId={leadId} />
      <div className="space-y-2">
        {pending.map((t) => {
          const Icon = taskIcon[t.type] ?? Calendar
          const isOverdue = t.dueAt && new Date(t.dueAt) < new Date()
          return (
            <div
              key={t.id}
              className={cn(
                'flex items-center gap-3 rounded-lg border border-border bg-surface-1 p-3',
                isOverdue && 'border-warning/50'
              )}
            >
              <Icon className="w-4 h-4 text-text-muted shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text capitalize">{t.type}</p>
                {t.notes && <p className="text-xs text-text-muted truncate">{t.notes}</p>}
                <p className={cn('text-xs', isOverdue ? 'text-warning' : 'text-text-muted')}>
                  Due {formatDate(t.dueAt)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => completeTask.mutate({ taskId: t.id })}
                disabled={completeTask.isPending}
              >
                <Check className="w-4 h-4" />
              </Button>
            </div>
          )
        })}
        {completed.length > 0 && (
          <>
            <p className="text-xs text-text-muted font-medium mt-4">Completed</p>
            {completed.map((t) => {
              const Icon = taskIcon[t.type] ?? Calendar
              return (
                <div key={t.id} className="flex items-center gap-3 rounded-lg border border-border bg-surface-2/50 p-3 opacity-75">
                  <Icon className="w-4 h-4 text-text-muted shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-text-muted capitalize">{t.type}</p>
                    <p className="text-xs text-text-muted">Done {formatDate(t.completedAt)}</p>
                  </div>
                </div>
              )
            })}
          </>
        )}
        {pending.length === 0 && completed.length === 0 && (
          <p className="text-sm text-text-muted">No tasks.</p>
        )}
      </div>
    </div>
  )
}
