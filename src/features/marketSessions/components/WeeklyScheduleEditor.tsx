import { useMemo } from 'react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import type { SessionTemplateWindow } from '../types/sessionTemplate'
import { normalizeTimeForInput } from '../api/sessionTemplates.api'
import { Plus, Trash2 } from 'lucide-react'

export type WeeklyWindow = Pick<SessionTemplateWindow, 'dayOfWeek' | 'openTime' | 'closeTime'> & { id?: string }

const DOW_ROWS: { dow: number; label: string }[] = [
  { dow: 0, label: 'Sunday' },
  { dow: 1, label: 'Monday' },
  { dow: 2, label: 'Tuesday' },
  { dow: 3, label: 'Wednesday' },
  { dow: 4, label: 'Thursday' },
  { dow: 5, label: 'Friday' },
  { dow: 6, label: 'Saturday' },
]

export interface WeeklyScheduleEditorProps {
  value: WeeklyWindow[]
  onChange: (next: WeeklyWindow[]) => void
  disabled?: boolean
}

export function WeeklyScheduleEditor({ value, onChange, disabled }: WeeklyScheduleEditorProps) {
  const byDay = useMemo(() => {
    const m: Record<number, WeeklyWindow[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] }
    for (const w of value) {
      const d = Math.min(6, Math.max(0, Math.floor(Number(w.dayOfWeek))))
      m[d].push(w)
    }
    for (const d of [0, 1, 2, 3, 4, 5, 6]) {
      m[d].sort((a, b) => a.openTime.localeCompare(b.openTime))
    }
    return m
  }, [value])

  const updateDay = (dow: number, slots: WeeklyWindow[]) => {
    const others = value.filter((w) => w.dayOfWeek !== dow)
    onChange([...others, ...slots])
  }

  const addSlot = (dow: number) => {
    updateDay(dow, [...byDay[dow], { dayOfWeek: dow, openTime: '09:00', closeTime: '17:00' }])
  }

  const removeSlot = (dow: number, idx: number) => {
    const next = [...byDay[dow]]
    next.splice(idx, 1)
    updateDay(dow, next)
  }

  const patchSlot = (dow: number, idx: number, patch: Partial<Pick<WeeklyWindow, 'openTime' | 'closeTime'>>) => {
    const next = [...byDay[dow]]
    const cur = next[idx]
    if (!cur) return
    next[idx] = { ...cur, ...patch, dayOfWeek: dow }
    updateDay(dow, next)
  }

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="text-sm text-muted">
        Times are interpreted in the template timezone. Split overnight sessions into two rows (per day).
      </div>
      {DOW_ROWS.map(({ dow, label }) => (
        <div key={dow} className="flex flex-col gap-2 border-b border-border pb-3 last:border-0 last:pb-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label className="min-w-[7rem] font-medium">{label}</Label>
            <Button type="button" variant="outline" size="sm" onClick={() => addSlot(dow)} disabled={disabled}>
              <Plus className="mr-1 h-3 w-3" />
              Window
            </Button>
          </div>
          {byDay[dow].length === 0 ? (
            <p className="text-xs text-muted">Closed this day (no windows)</p>
          ) : (
            <div className="flex flex-col gap-2 pl-0 md:pl-2">
              {byDay[dow].map((slot, idx) => (
                <div key={slot.id ?? `d${dow}-i${idx}`} className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted">Open</Label>
                    <Input
                      type="time"
                      step={60}
                      value={normalizeTimeForInput(slot.openTime)}
                      onChange={(e) => patchSlot(dow, idx, { openTime: e.target.value })}
                      disabled={disabled}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted">Close</Label>
                    <Input
                      type="time"
                      step={60}
                      value={normalizeTimeForInput(slot.closeTime)}
                      onChange={(e) => patchSlot(dow, idx, { closeTime: e.target.value })}
                      disabled={disabled}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    aria-label="Remove window"
                    onClick={() => removeSlot(dow, idx)}
                    disabled={disabled}
                  >
                    <Trash2 className="h-4 w-4 text-danger" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
