import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ModalShell } from '@/shared/ui/modal'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { useCreateTemplate, useUpdateTemplate, useTemplate } from '../../hooks/useTemplates'

const schema = z.object({
  name: z.string().min(1, 'Name required'),
  subject: z.string().min(1, 'Subject required'),
  body: z.string().min(1, 'Body required'),
})

type FormData = z.infer<typeof schema>

const VARIABLES = ['{{firstName}}', '{{lastName}}', '{{email}}', '{{phone}}', '{{country}}', '{{ownerName}}']

interface CreateEditTemplateModalProps {
  templateId: string | null
  onClose: () => void
}

export function CreateEditTemplateModal({ templateId, onClose }: CreateEditTemplateModalProps) {
  const { data: template } = useTemplate(templateId === 'new' ? null : templateId)
  const createTemplate = useCreateTemplate()
  const updateTemplate = useUpdateTemplate()

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    values: template
      ? { name: template.name, subject: template.subject, body: template.body }
      : undefined,
    defaultValues: { name: '', subject: '', body: '' },
  })

  const body = watch('body')

  const insertVariable = (v: string) => {
    setValue('body', body + v)
  }

  const onSubmit = (data: FormData) => {
    if (templateId && templateId !== 'new') {
      updateTemplate.mutate(
        { id: templateId, data: { name: data.name, subject: data.subject, body: data.body } },
        { onSuccess: onClose }
      )
    } else {
      createTemplate.mutate(
        { name: data.name, subject: data.subject, body: data.body, tags: [] },
        { onSuccess: onClose }
      )
    }
  }

  return (
    <ModalShell open onOpenChange={(o) => !o && onClose()} title={templateId === 'new' || !templateId ? 'Create template' : 'Edit template'} size="lg">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-text mb-1">Name</label>
          <Input {...register('name')} />
          {errors.name && <p className="text-xs text-danger mt-1">{errors.name.message}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-text mb-1">Subject</label>
          <Input {...register('subject')} />
          {errors.subject && <p className="text-xs text-danger mt-1">{errors.subject.message}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-text mb-1">Body</label>
          <div className="flex flex-wrap gap-1 mb-2">
            {VARIABLES.map((v) => (
              <button
                key={v}
                type="button"
                className="inline-flex items-center rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs font-medium text-text hover:bg-surface-2/80"
                onClick={() => insertVariable(v)}
              >
                {v}
              </button>
            ))}
          </div>
          <textarea
            className="w-full min-h-[160px] rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-text"
            {...register('body')}
          />
          {errors.body && <p className="text-xs text-danger mt-1">{errors.body.message}</p>}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={createTemplate.isPending || updateTemplate.isPending}>Save</Button>
        </div>
      </form>
    </ModalShell>
  )
}
