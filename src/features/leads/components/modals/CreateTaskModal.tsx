import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ModalShell } from '@/shared/ui/modal'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { useLeadsUiStore } from '../../store/leads.ui.store'
import { useCreateTask } from '../../hooks/useLeadTasksMutations'
import { mockUsers } from '../../api/leads.mock'
import type { LeadTaskType } from '../../types/leads.types'

const schema = z.object({
  type: z.enum(['call', 'email', 'whatsapp', 'meeting', 'doc']),
  dueAt: z.string().min(1, 'Due date required'),
  assignedToUserId: z.string().min(1, 'Assign to required'),
  priority: z.enum(['low', 'normal', 'high', 'vip']).optional(),
  notes: z.string().optional(),
})

type FormData = z.infer<typeof schema>

interface CreateTaskModalProps {
  leadId: string
}

export function CreateTaskModal({ leadId }: CreateTaskModalProps) {
  const { modal, closeModal } = useLeadsUiStore()
  const open = modal.createTask
  const createTask = useCreateTask()

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      type: 'call',
      assignedToUserId: mockUsers[0]?.id ?? '',
      priority: 'normal',
    },
  })

  const onSubmit = (data: FormData) => {
    createTask.mutate(
      {
        leadId,
        type: data.type as LeadTaskType,
        dueAt: data.dueAt,
        assignedToUserId: data.assignedToUserId,
        priority: data.priority as any,
        notes: data.notes,
      },
      { onSuccess: () => closeModal('createTask') }
    )
  }

  return (
    <ModalShell
      open={open}
      onOpenChange={(o) => !o && closeModal('createTask')}
      title="Create task"
      size="md"
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-text mb-1">Type</label>
          <Select onValueChange={(v) => setValue('type', v as FormData['type'])} value={watch('type')}>
            <SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              {(['call', 'email', 'whatsapp', 'meeting', 'doc'] as const).map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="block text-sm font-medium text-text mb-1">Due date</label>
          <Input type="datetime-local" {...register('dueAt')} />
          {errors.dueAt && <p className="text-xs text-danger mt-1">{errors.dueAt.message}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-text mb-1">Assign to</label>
          <Select onValueChange={(v) => setValue('assignedToUserId', v)} value={watch('assignedToUserId')}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {mockUsers.map((u) => (
                <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="block text-sm font-medium text-text mb-1">Notes</label>
          <Input {...register('notes')} placeholder="Optional" />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => closeModal('createTask')}>Cancel</Button>
          <Button type="submit" disabled={createTask.isPending}>Create</Button>
        </div>
      </form>
    </ModalShell>
  )
}
