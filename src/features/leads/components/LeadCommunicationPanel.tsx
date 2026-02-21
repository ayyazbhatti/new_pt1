import { Mail, Send, AlertCircle } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { useLeadMessages } from '../hooks/useLeadById'
import { useLeadsUiStore } from '../store/leads.ui.store'
import { formatDateTime } from '@/shared/utils/time'
import { cn } from '@/shared/utils'
import { SendEmailModal } from './modals/SendEmailModal'

interface LeadCommunicationPanelProps {
  leadId: string
  className?: string
}

export function LeadCommunicationPanel({ leadId, className }: LeadCommunicationPanelProps) {
  const { data: messages, isLoading } = useLeadMessages(leadId)
  const openSendEmail = () => {
    useLeadsUiStore.getState().setModalLead({ id: leadId } as any)
    useLeadsUiStore.getState().openModal('sendEmail')
  }

  if (isLoading) {
    return (
      <div className={cn('space-y-2', className)}>
        {[1, 2].map((i) => (
          <div key={i} className="h-16 rounded bg-surface-2 animate-pulse" />
        ))}
      </div>
    )
  }

  const list = messages ?? []

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text">Communication</h3>
        <Button variant="secondary" size="sm" onClick={openSendEmail}>
          <Send className="w-4 h-4 mr-1" />
          Send email
        </Button>
      </div>
      <SendEmailModal leadId={leadId} />
      <div className="space-y-2">
        {list.map((m) => (
          <div
            key={m.id}
            className={cn(
              'rounded-lg border border-border bg-surface-1 p-3',
              m.status === 'failed' && 'border-danger/50'
            )}
          >
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-text-muted shrink-0" />
              <span className="text-sm font-medium text-text truncate">{m.subject ?? '(No subject)'}</span>
              <span
                className={cn(
                  'text-xs shrink-0',
                  m.status === 'sent' && 'text-success',
                  m.status === 'failed' && 'text-danger',
                  m.status === 'queued' && 'text-text-muted'
                )}
              >
                {m.status}
              </span>
            </div>
            {m.body && (
              <p className="text-xs text-text-muted mt-1 line-clamp-2">{m.body}</p>
            )}
            <p className="text-xs text-text-muted mt-1">{formatDateTime(m.createdAt)}</p>
          </div>
        ))}
        {list.length === 0 && (
          <p className="text-sm text-text-muted">No messages yet.</p>
        )}
      </div>
    </div>
  )
}
