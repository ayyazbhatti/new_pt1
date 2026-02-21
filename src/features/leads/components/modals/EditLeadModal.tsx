import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ModalShell } from '@/shared/ui/modal'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { useLeadsUiStore } from '../../store/leads.ui.store'
import { useUpdateLead } from '../../hooks/useLeads'
import { useLeadStages } from '../../hooks/useLeadStages'
import { mockUsers } from '../../api/leads.mock'

const schema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  country: z.string().optional(),
  city: z.string().optional(),
  source: z.string().optional(),
  priority: z.enum(['low', 'normal', 'high', 'vip']).optional(),
})

type FormData = z.infer<typeof schema>

export function EditLeadModal() {
  const { modal, closeModal, modalLead } = useLeadsUiStore()
  const open = modal.editLead
  const updateLead = useUpdateLead()
  const { data: stages } = useLeadStages()

  const { register, handleSubmit, setValue, watch, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    values: modalLead
      ? {
          firstName: modalLead.firstName,
          lastName: modalLead.lastName,
          email: modalLead.email,
          phone: modalLead.phone,
          country: modalLead.country,
          city: modalLead.city,
          source: modalLead.source,
          priority: modalLead.priority,
        }
      : undefined,
  })

  const onSubmit = (data: FormData) => {
    if (!modalLead) return
    updateLead.mutate(
      { id: modalLead.id, payload: data },
      { onSuccess: () => { closeModal('editLead'); reset() } }
    )
  }

  return (
    <ModalShell open={open} onOpenChange={(o) => !o && closeModal('editLead')} title="Edit lead" size="lg">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-text mb-1">First name</label>
            <Input {...register('firstName')} />
            {errors.firstName && <p className="text-xs text-danger mt-1">{errors.firstName.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-text mb-1">Last name</label>
            <Input {...register('lastName')} />
            {errors.lastName && <p className="text-xs text-danger mt-1">{errors.lastName.message}</p>}
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-text mb-1">Email</label>
          <Input type="email" {...register('email')} />
          {errors.email && <p className="text-xs text-danger mt-1">{errors.email.message}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-text mb-1">Phone</label>
          <Input {...register('phone')} />
        </div>
        <div>
          <label className="block text-sm font-medium text-text mb-1">Country / City</label>
          <div className="flex gap-2">
            <Input {...register('country')} placeholder="Country" />
            <Input {...register('city')} placeholder="City" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-text mb-1">Source</label>
          <Input {...register('source')} />
        </div>
        <div>
          <label className="block text-sm font-medium text-text mb-1">Priority</label>
          <Select onValueChange={(v) => setValue('priority', v as FormData['priority'])} value={watch('priority')}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(['low', 'normal', 'high', 'vip'] as const).map((p) => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => closeModal('editLead')}>Cancel</Button>
          <Button type="submit" disabled={updateLead.isPending}>Save</Button>
        </div>
      </form>
    </ModalShell>
  )
}
