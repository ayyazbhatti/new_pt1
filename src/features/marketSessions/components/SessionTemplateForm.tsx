import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { Button } from '@/shared/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Label } from '@/shared/ui/label'
import { Switch } from '@/shared/ui/Switch'
import { TimezoneSelect } from '@/shared/components/TimezoneSelect'
import type { SessionDefaultMarket, SessionTemplate, SessionTemplateWindow } from '../types/sessionTemplate'
import { WeeklyScheduleEditor, type WeeklyWindow } from './WeeklyScheduleEditor'
import { useCreateSessionTemplate, useUpdateSessionTemplate } from '../hooks/useSessionTemplates'
import { Spinner } from '@/shared/ui/loading'
import { normalizeTimeForInput } from '../api/sessionTemplates.api'

const MARKET_NONE = '__session_default_market_none__' as const

const defaultMarketSchema = z.enum([
  MARKET_NONE,
  'crypto',
  'forex',
  'commodities',
  'indices',
  'stocks',
])

const schema = z
  .object({
    name: z.string().min(1, 'Name is required').max(64),
    timezone: z.string().min(1, 'Timezone is required'),
    description: z.string().optional(),
    is24_7: z.boolean(),
    defaultMarket: defaultMarketSchema,
    windows: z.array(
      z.object({
        id: z.string().optional(),
        dayOfWeek: z.number().int().min(0).max(6),
        openTime: z.string().min(1),
        closeTime: z.string().min(1),
      })
    ),
  })
  .superRefine((data, ctx) => {
    if (data.is24_7) return
    for (let i = 0; i < data.windows.length; i++) {
      const w = data.windows[i]!
      if (w.openTime >= w.closeTime) {
        ctx.addIssue({
          code: 'custom',
          message: 'Each window must have open time strictly before close time (split overnight into two rows).',
          path: ['windows', i, 'closeTime'],
        })
      }
    }
  })

type FormData = z.infer<typeof schema>

export interface SessionTemplateFormProps {
  mode: 'create' | 'edit'
  initial?: SessionTemplate
  onDone: () => void
}

function mapInitialWindows(t?: SessionTemplate): SessionTemplateWindow[] {
  if (!t?.windows?.length) return []
  return t.windows.map((w) => ({
    id: w.id,
    dayOfWeek: w.dayOfWeek,
    openTime: normalizeTimeForInput(w.openTime),
    closeTime: normalizeTimeForInput(w.closeTime),
  }))
}

export function SessionTemplateForm({ mode, initial, onDone }: SessionTemplateFormProps) {
  const createT = useCreateSessionTemplate()
  const updateT = useUpdateSessionTemplate()

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: initial?.name ?? '',
      timezone: initial?.timezone ?? 'UTC',
      description: initial?.description ?? '',
      is24_7: initial?.is24_7 ?? false,
      defaultMarket: (initial?.isDefaultForMarket as FormData['defaultMarket']) ?? MARKET_NONE,
      windows: mapInitialWindows(initial),
    },
  })

  const is24_7 = watch('is24_7')
  const windows = watch('windows')

  const onSubmit = async (data: FormData) => {
    const isDefaultForMarket =
      data.defaultMarket === MARKET_NONE ? null : (data.defaultMarket as SessionDefaultMarket)
    const payloadWindows = (data.is24_7 ? [] : data.windows).map((w) => ({
      dayOfWeek: w.dayOfWeek,
      openTime: w.openTime,
      closeTime: w.closeTime,
    }))

    if (mode === 'create') {
      await createT.mutateAsync({
        name: data.name,
        timezone: data.timezone,
        description: data.description?.trim() ? data.description.trim() : null,
        is24_7: data.is24_7,
        isDefaultForMarket: isDefaultForMarket,
        windows: payloadWindows,
      })
    } else if (initial) {
      await updateT.mutateAsync({
        id: initial.id,
        payload: {
          name: data.name,
          timezone: data.timezone,
          description: data.description?.trim() ? data.description.trim() : null,
          is24_7: data.is24_7,
          isDefaultForMarket: isDefaultForMarket,
          windows: payloadWindows,
        },
      })
    }
    onDone()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="max-h-[80vh] space-y-4 overflow-y-auto pr-1">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Name</Label>
          <Input {...register('name')} disabled={isSubmitting} />
          {errors.name && <p className="text-sm text-danger">{errors.name.message}</p>}
        </div>
        <div className="space-y-2">
          <Label>Default for market</Label>
          <Select
            value={watch('defaultMarket')}
            onValueChange={(v) => setValue('defaultMarket', v as FormData['defaultMarket'])}
            disabled={isSubmitting}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={MARKET_NONE}>None (not a market default)</SelectItem>
              <SelectItem value="crypto">Crypto</SelectItem>
              <SelectItem value="forex">Forex</SelectItem>
              <SelectItem value="commodities">Commodities</SelectItem>
              <SelectItem value="indices">Indices</SelectItem>
              <SelectItem value="stocks">Stocks</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted">Only one template can be the default per market.</p>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Timezone (IANA)</Label>
        <TimezoneSelect variant="list" value={watch('timezone')} onChange={(tz) => setValue('timezone', tz)} disabled={isSubmitting} />
        {errors.timezone && <p className="text-sm text-danger">{errors.timezone.message}</p>}
      </div>

      <div className="space-y-2">
        <Label>Description</Label>
        <Textarea rows={3} {...register('description')} disabled={isSubmitting} />
      </div>

      <div className="flex items-center gap-2">
        <Switch checked={is24_7} onCheckedChange={(c) => setValue('is24_7', c)} disabled={isSubmitting} />
        <Label>24/7 (always open — windows ignored)</Label>
      </div>

      {!is24_7 && (
        <div className="space-y-2">
          <Label>Weekly schedule</Label>
          <WeeklyScheduleEditor
            value={(windows ?? []) as WeeklyWindow[]}
            onChange={(next) => setValue('windows', next as FormData['windows'])}
            disabled={isSubmitting}
          />
          {errors.windows && typeof errors.windows.message === 'string' && (
            <p className="text-sm text-danger">{errors.windows.message}</p>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="outline" onClick={onDone} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Spinner className="h-4 w-4" /> : mode === 'create' ? 'Create' : 'Save'}
        </Button>
      </div>
    </form>
  )
}
