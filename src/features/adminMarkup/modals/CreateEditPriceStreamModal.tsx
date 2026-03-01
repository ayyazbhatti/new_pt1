import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useModalStore } from '@/app/store'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { useCreateMarkupProfile, useUpdateMarkupProfile } from '../hooks/useMarkup'
import { MarkupProfile } from '../types/markup'

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
})

type FormData = z.infer<typeof schema>

interface CreateEditPriceStreamModalProps {
  stream?: MarkupProfile
}

export function CreateEditPriceStreamModal({ stream }: CreateEditPriceStreamModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const createProfile = useCreateMarkupProfile()
  const updateProfile = useUpdateMarkupProfile()
  const isEdit = !!stream

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: stream?.name ?? '' },
  })

  const onSubmit = async (data: FormData) => {
    try {
      if (isEdit) {
        await updateProfile.mutateAsync({
          id: stream!.id,
          payload: {
            name: data.name,
            markup_type: 'percent',
            bid_markup: stream!.bidMarkup ?? '0',
            ask_markup: stream!.askMarkup ?? '0',
          },
        })
        closeModal(`edit-price-stream-${stream!.id}`)
      } else {
        await createProfile.mutateAsync({
          name: data.name,
          description: null,
          markup_type: 'percent',
          bid_markup: '0',
          ask_markup: '0',
        })
        closeModal('create-price-stream')
      }
    } catch {
      // Toast from hook
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Name</label>
        <Input
          {...register('name')}
          placeholder="Price stream name"
          disabled={isSubmitting}
          className={errors.name ? 'border-danger' : ''}
        />
        {errors.name && (
          <p className="mt-1 text-sm text-danger">{errors.name.message}</p>
        )}
      </div>
      <div className="flex justify-end gap-2 pt-4 border-t border-border">
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            closeModal(
              isEdit ? `edit-price-stream-${stream!.id}` : 'create-price-stream'
            )
          }
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : isEdit ? 'Save Changes' : 'Create'}
        </Button>
      </div>
    </form>
  )
}
