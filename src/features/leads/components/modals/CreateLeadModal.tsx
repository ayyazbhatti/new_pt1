import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ModalShell } from '@/shared/ui/modal'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { useLeadsUiStore } from '../../store/leads.ui.store'
import { useCreateLead } from '../../hooks/useLeads'
import { useLeadStages } from '../../hooks/useLeadStages'
import { mockUsers } from '../../api/leads.mock'

const schema = z.object({
  firstName: z.string().min(1, 'First name required'),
  lastName: z.string().min(1, 'Last name required'),
  email: z.string().email('Invalid email'),
  phone: z.string().optional(),
  country: z.string().optional(),
  city: z.string().optional(),
  stageId: z.string().min(1, 'Stage required'),
  ownerUserId: z.string().optional(),
  source: z.string().optional(),
  priority: z.enum(['low', 'normal', 'high', 'vip']).optional(),
})

type FormData = z.infer<typeof schema>

export function CreateLeadModal() {
  const { modal, closeModal } = useLeadsUiStore()
  const open = modal.createLead
  const createLead = useCreateLead()
  const { data: stages } = useLeadStages()

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      stageId: stages?.[0]?.id ?? '',
      ownerUserId: mockUsers[0]?.id,
      priority: 'normal',
    },
  })

  const onSubmit = (data: FormData) => {
    createLead.mutate(
      {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone,
        country: data.country,
        city: data.city,
        stageId: data.stageId,
        ownerUserId: data.ownerUserId,
        source: data.source,
        priority: data.priority,
      },
      { onSuccess: () => closeModal('createLead') }
    )
  }

  return (
    <ModalShell open={open} onOpenChange={(o) => !o && closeModal('createLead')} title="Create lead" size="lg">
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
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-text mb-1">Country</label>
            <Input {...register('country')} />
          </div>
          <div>
            <label className="block text-sm font-medium text-text mb-1">City</label>
            <Input {...register('city')} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-text mb-1">Stage</label>
          <Select onValueChange={(v) => setValue('stageId', v)} value={watch('stageId')}>
            <SelectTrigger><SelectValue placeholder="Stage" /></SelectTrigger>
            <SelectContent>
              {(stages ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="block text-sm font-medium text-text mb-1">Owner</label>
          <Select onValueChange={(v) => setValue('ownerUserId', v)} value={watch('ownerUserId')}>
            <SelectTrigger><SelectValue placeholder="Owner" /></SelectTrigger>
            <SelectContent>
              {mockUsers.map((u) => (
                <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="block text-sm font-medium text-text mb-1">Source</label>
          <Input {...register('source')} />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => closeModal('createLead')}>Cancel</Button>
          <Button type="submit" disabled={createLead.isPending}>Create</Button>
        </div>
      </form>
    </ModalShell>
  )
}
