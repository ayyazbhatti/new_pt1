import { useNavigate } from 'react-router-dom'
import { PageHeader } from '@/shared/layout'
import { ContentShell } from '@/shared/layout'
import { Card } from '@/shared/ui/card'
import { Button } from '@/shared/ui/button'
import { useTaskList } from '../hooks/useTaskList'
import { useLeadRealtime } from '../hooks/useLeadRealtime'
import { useAuthStore } from '@/shared/store/auth.store'
import { formatDate } from '@/shared/utils/time'
import { EmptyState } from '@/shared/ui/empty'
import { Check } from 'lucide-react'
import { useCompleteTask } from '../hooks/useLeadTasksMutations'

interface LeadsTasksPageProps {
  basePath: string
  /** When true, show only current user's tasks */
  myTasksOnly?: boolean
}

export function LeadsTasksPage({ basePath, myTasksOnly = true }: LeadsTasksPageProps) {
  useLeadRealtime()
  const navigate = useNavigate()
  const userId = useAuthStore((s) => s.user?.id)
  const { data: taskList, isLoading } = useTaskList(myTasksOnly ? userId ?? undefined : undefined)
  const completeTask = useCompleteTask()

  const items = taskList ?? []
  const overdue = items.filter((x) => new Date(x.task.dueAt) < new Date())
  const upcoming = items.filter((x) => new Date(x.task.dueAt) >= new Date())

  const leadName = (x: (typeof items)[0]) => `${x.lead.firstName} ${x.lead.lastName}`

  return (
    <ContentShell className="flex flex-col h-full overflow-hidden">
      <PageHeader title={myTasksOnly ? 'My tasks' : 'Team tasks'} />
      {isLoading ? (
        <div className="animate-pulse space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-surface-2 rounded" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1 overflow-auto">
          <Card className="p-4 border border-border h-fit">
            <h3 className="text-sm font-medium text-text mb-2">Overdue</h3>
            {overdue.length === 0 ? (
              <EmptyState description="No overdue tasks" />
            ) : (
              <ul className="space-y-2">
                {overdue.map((x) => (
                  <li key={x.task.id} className="flex items-center justify-between rounded-lg border border-border p-2 border-warning/50">
                    <div className="min-w-0">
                      <button
                        type="button"
                        className="text-sm font-medium text-text hover:underline text-left"
                        onClick={() => navigate(`${basePath}/${x.lead.id}`)}
                      >
                        {leadName(x)} · {x.task.type}
                      </button>
                      <p className="text-xs text-warning">Due {formatDate(x.task.dueAt)}</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => completeTask.mutate({ taskId: x.task.id })}>
                      <Check className="w-4 h-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="p-4 border border-border h-fit">
            <h3 className="text-sm font-medium text-text mb-2">Upcoming</h3>
            {upcoming.length === 0 ? (
              <EmptyState description="No upcoming tasks" />
            ) : (
              <ul className="space-y-2">
                {upcoming.slice(0, 10).map((x) => (
                  <li key={x.task.id} className="flex items-center justify-between rounded-lg border border-border p-2">
                    <div className="min-w-0">
                      <button
                        type="button"
                        className="text-sm font-medium text-text hover:underline text-left"
                        onClick={() => navigate(`${basePath}/${x.lead.id}`)}
                      >
                        {leadName(x)} · {x.task.type}
                      </button>
                      <p className="text-xs text-text-muted">Due {formatDate(x.task.dueAt)}</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => completeTask.mutate({ taskId: x.task.id })}>
                      <Check className="w-4 h-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </ContentShell>
  )
}
