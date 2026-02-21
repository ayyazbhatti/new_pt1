import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ModalShell } from '@/shared/ui/modal'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { useLeadsUiStore } from '../../store/leads.ui.store'
import { useLogCall } from '../../hooks/useLeadCommsMutations'

const schema = z.object({
  outcome: z.string().min(1, 'Outcome required'),
  durationMinutes: z.coerce.number().min(0).optional(),
  notes: z.string().optional(),
  nextFollowupAt: z.string().optional(),
})

type FormData = z.infer<typeof schema>

export function LogCallModal() {
  const { modal, closeModal, modalLead } = useLeadsUiStore()
  const open = modal.logCall
  const logCall = useLogCall()

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const onSubmit = (data: FormData) => {
    if (!modalLead) return
    logCall.mutate(
      {
        leadId: modalLead.id,
        outcome: data.outcome,
        durationMinutes: data.durationMinutes,
        notes: data.notes,
        nextFollowupAt: data.nextFollowupAt,
      },
      { onSuccess: () => closeModal('logCall') }
    )
  }

  return (
    <ModalShell open={open} onOpenChange={(o) => !o && closeModal('logCall')} title="Log call" size="md">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-text mb-1">Outcome</label>
          <Input {...register('outcome')} placeholder="e.g. Interested, Not interested" />
          {errors.outcome && <p className="text-xs text-danger mt-1">{errors.outcome.message}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-text mb-1">Duration (minutes)</label>
          <Input type="number" {...register('durationMinutes')} />
        </div>
        <div>
          <label className="block text-sm font-medium text-text mb-1">Notes</label>
          <Input {...register('notes')} />
        </div>
        <div>
          <label className="block text-sm font-medium text-text mb-1">Next follow-up (optional)</label>
          <Input type="datetime-local" {...register('nextFollowupAt')} />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => closeModal('logCall')}>Cancel</Button>
          <Button type="submit" disabled={logCall.isPending}>Log call</Button>
        </div>
      </form>
    </ModalShell>
  )
}
