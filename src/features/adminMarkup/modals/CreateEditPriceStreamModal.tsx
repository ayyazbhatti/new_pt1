import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useModalStore } from '@/app/store'
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
    <div className="bg-slate-800 rounded-lg p-4 sm:p-6 w-full max-w-md">
      <h2 className="text-lg sm:text-xl font-bold text-white mb-4">
        {isEdit ? 'Edit Price Stream' : 'Create Price Stream'}
      </h2>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Name
          </label>
          <input
            {...register('name')}
            placeholder="Price stream name"
            disabled={isSubmitting}
            className={`w-full px-3 py-2 bg-slate-700 border rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm sm:text-base ${
              errors.name ? 'border-red-500' : 'border-slate-600'
            }`}
          />
          {errors.name && (
            <p className="mt-1 text-sm text-red-400">{errors.name.message}</p>
          )}
        </div>
        <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:space-x-2">
          <button
            type="button"
            onClick={() =>
              closeModal(
                isEdit ? `edit-price-stream-${stream!.id}` : 'create-price-stream'
              )
            }
            disabled={isSubmitting}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white rounded-lg text-sm sm:text-base"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm sm:text-base"
          >
            {isSubmitting ? 'Saving...' : isEdit ? 'Update' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  )
}
