import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Switch } from '@/shared/ui/Switch'
import { useModalStore } from '@/app/store'
import { toast } from 'react-hot-toast'
import { useState, useEffect } from 'react'
import { PriceStreamProfile, RoundingMode } from '../types/pricing'

const profileSchema = z.object({
  name: z.string().min(1, 'Profile name is required'),
  description: z.string().optional(),
  markupType: z.literal('percent'),
  bidMarkup: z.number(),
  askMarkup: z.number(),
  allowNegative: z.boolean(),
  roundingMode: z.enum(['none', 'symbol', 'custom']),
  customRounding: z.number().optional(),
})

type ProfileFormData = z.infer<typeof profileSchema>

interface CreateEditProfileModalProps {
  profile?: PriceStreamProfile
}

export function CreateEditProfileModal({ profile }: CreateEditProfileModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const [status, setStatus] = useState(profile?.status === 'active' || true)
  const [roundingMode, setRoundingMode] = useState<RoundingMode>(profile?.roundingMode || 'symbol')

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: profile?.name || '',
      description: profile?.description || '',
      markupType: 'percent',
      bidMarkup: profile?.bidMarkup || 0,
      askMarkup: profile?.askMarkup || 0,
      allowNegative: profile?.allowNegative || false,
      roundingMode: profile?.roundingMode || 'symbol',
      customRounding: profile?.customRounding,
    },
  })

  useEffect(() => {
    if (profile) {
      setStatus(profile.status === 'active')
      setRoundingMode(profile.roundingMode)
    }
  }, [profile])

  const onSubmit = (data: ProfileFormData) => {
    if (profile) {
      toast.success(`Profile "${data.name}" updated`)
    } else {
      toast.success(`Profile "${data.name}" created`)
    }
    closeModal(profile ? `edit-profile-${profile.id}` : 'create-profile')
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="space-y-4">
        <div className="text-sm font-semibold text-text mb-2">General</div>
        <div>
          <label className="text-sm font-medium text-text mb-2 block">Profile Name *</label>
          <Input {...register('name')} />
          {errors.name && <p className="mt-1 text-sm text-danger">{errors.name.message}</p>}
        </div>
        <div>
          <label className="text-sm font-medium text-text mb-2 block">Description</label>
          <textarea
            {...register('description')}
            className="flex min-h-[80px] w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50"
            placeholder="Describe this pricing profile..."
          />
        </div>
        <div className="flex items-center justify-between py-2">
          <label className="text-sm font-medium text-text">Status</label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-muted">{status ? 'Active' : 'Disabled'}</span>
            <Switch checked={status} onCheckedChange={setStatus} />
          </div>
        </div>
      </div>

      <div className="space-y-4 border-t border-border pt-4">
        <div className="text-sm font-semibold text-text mb-2">Markup Logic</div>
        <div className="rounded-lg border border-border bg-surface-2/50 p-3">
          <p className="text-sm text-text-muted">Markup is applied as a <strong className="text-text">percentage (%)</strong> of the price.</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-text mb-2 block">Bid Markup (%) *</label>
            <Input
              type="number"
              step="0.01"
              {...register('bidMarkup', { valueAsNumber: true })}
            />
            {errors.bidMarkup && (
              <p className="mt-1 text-sm text-danger">{errors.bidMarkup.message}</p>
            )}
          </div>
          <div>
            <label className="text-sm font-medium text-text mb-2 block">Ask Markup (%) *</label>
            <Input
              type="number"
              step="0.01"
              {...register('askMarkup', { valueAsNumber: true })}
            />
            {errors.askMarkup && (
              <p className="mt-1 text-sm text-danger">{errors.askMarkup.message}</p>
            )}
          </div>
        </div>
        <div className="p-3 bg-surface-2 rounded-lg border border-border">
          <p className="text-xs text-text-muted">
            <strong className="text-text">Buy trades</strong> are opened at <strong>ASK</strong>,{' '}
            <strong className="text-text">Sell trades</strong> at <strong>BID</strong>. Markups directly affect spread and trader cost.
          </p>
        </div>
      </div>

      <div className="space-y-4 border-t border-border pt-4">
        <div className="text-sm font-semibold text-text mb-2">Advanced</div>
        <div className="flex items-center justify-between py-2">
          <label className="text-sm font-medium text-text">Allow Negative Markup</label>
          <Switch
            checked={watch('allowNegative')}
            onCheckedChange={(checked) => setValue('allowNegative', checked)}
          />
        </div>
        <div>
          <label className="text-sm font-medium text-text mb-2 block">Rounding Mode *</label>
          <Select
            value={roundingMode}
            onValueChange={(value) => {
              setRoundingMode(value as RoundingMode)
              setValue('roundingMode', value as RoundingMode)
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No Rounding</SelectItem>
              <SelectItem value="symbol">Symbol Digits</SelectItem>
              <SelectItem value="custom">Custom Digits</SelectItem>
            </SelectContent>
          </Select>
          {roundingMode === 'custom' && (
            <div className="mt-2">
              <label className="text-sm font-medium text-text mb-2 block">Custom Rounding Digits</label>
              <Input
                type="number"
                min="0"
                max="8"
                {...register('customRounding', { valueAsNumber: true })}
              />
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4 border-t border-border">
        <Button
          type="button"
          variant="outline"
          onClick={() => closeModal(profile ? `edit-profile-${profile.id}` : 'create-profile')}
        >
          Cancel
        </Button>
        <Button type="submit">{profile ? 'Save Changes' : 'Create Profile'}</Button>
      </div>
    </form>
  )
}

