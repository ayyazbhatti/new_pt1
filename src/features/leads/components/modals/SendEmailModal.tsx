import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ModalShell } from '@/shared/ui/modal'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { useLeadsUiStore } from '../../store/leads.ui.store'
import { useSendEmail } from '../../hooks/useLeadCommsMutations'
import { useLeadById } from '../../hooks/useLeadById'
import { useTemplates } from '../../hooks/useTemplates'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'

const schema = z.object({
  templateId: z.string().optional(),
  subject: z.string().min(1, 'Subject required'),
  body: z.string().min(1, 'Body required'),
})

type FormData = z.infer<typeof schema>

interface SendEmailModalProps {
  leadId: string
}

export function SendEmailModal({ leadId }: SendEmailModalProps) {
  const { modal, closeModal } = useLeadsUiStore()
  const open = modal.sendEmail
  const { data: lead } = useLeadById(leadId)
  const { data: templates } = useTemplates()
  const sendEmail = useSendEmail()

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { subject: '', body: '' },
  })

  const applyTemplate = (templateId: string) => {
    const t = templates?.find((x) => x.id === templateId)
    if (t) {
      setValue('subject', t.subject)
      setValue('body', t.body)
    }
  }

  const to = lead ? `${lead.firstName} ${lead.lastName} <${lead.email}>` : ''

  const onSubmit = (data: FormData) => {
    if (!lead) return
    sendEmail.mutate(
      {
        leadId,
        subject: data.subject,
        body: data.body,
        to: lead.email,
      },
      { onSuccess: () => closeModal('sendEmail') }
    )
  }

  return (
    <ModalShell
      open={open}
      onOpenChange={(o) => !o && closeModal('sendEmail')}
      title="Send email"
      size="lg"
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-text mb-1">Template</label>
          <Select onValueChange={applyTemplate}>
            <SelectTrigger><SelectValue placeholder="Optional template" /></SelectTrigger>
            <SelectContent>
              {(templates ?? []).map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="block text-sm font-medium text-text mb-1">To</label>
          <Input value={to} readOnly className="bg-surface-2" />
        </div>
        <div>
          <label className="block text-sm font-medium text-text mb-1">Subject</label>
          <Input {...register('subject')} placeholder="Subject" />
          {errors.subject && <p className="text-xs text-danger mt-1">{errors.subject.message}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-text mb-1">Body</label>
          <textarea
            className="w-full min-h-[120px] rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-text"
            {...register('body')}
          />
          {errors.body && <p className="text-xs text-danger mt-1">{errors.body.message}</p>}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => closeModal('sendEmail')}>Cancel</Button>
          <Button type="submit" disabled={sendEmail.isPending}>Send</Button>
        </div>
      </form>
    </ModalShell>
  )
}
