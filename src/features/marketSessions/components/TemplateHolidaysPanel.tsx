import { useMemo, useState } from 'react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { Textarea } from '@/shared/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { useCanAccess } from '@/shared/utils/permissions'
import { toast } from '@/shared/components/common'
import type { MarketHoliday, MarketHolidayType, UpsertMarketHolidayPayload } from '../types/sessionTemplate'
import {
  useTemplateHolidays,
  useCreateTemplateHoliday,
  useUpdateTemplateHoliday,
  useDeleteTemplateHoliday,
} from '../hooks/useSessionTemplates'

function formatHolidayDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`)
  return Number.isNaN(d.getTime()) ? isoDate : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function toTimeInputValue(t: string | null | undefined): string {
  if (!t) return ''
  const s = t.trim()
  if (/^\d{2}:\d{2}$/.test(s)) return s
  if (/^\d{2}:\d{2}:\d{2}$/.test(s)) return s.slice(0, 5)
  return s.slice(0, 5)
}

interface TemplateHolidaysPanelProps {
  templateId: string
}

export function TemplateHolidaysPanel({ templateId }: TemplateHolidaysPanelProps) {
  const canEdit = useCanAccess('sessions:edit')
  const cy = new Date().getFullYear()
  const yearOptions = useMemo(() => {
    const out: number[] = []
    for (let y = cy - 2; y <= cy + 5; y++) out.push(y)
    return out
  }, [cy])

  const [year, setYear] = useState(cy)
  const { data: holidays = [], isLoading } = useTemplateHolidays(templateId, year, true)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<MarketHoliday | null>(null)
  const [formDate, setFormDate] = useState('')
  const [formName, setFormName] = useState('')
  const [formType, setFormType] = useState<MarketHolidayType>('closed')
  const [formTime, setFormTime] = useState('')
  const [formNotes, setFormNotes] = useState('')

  const createH = useCreateTemplateHoliday()
  const updateH = useUpdateTemplateHoliday()
  const deleteH = useDeleteTemplateHoliday()

  const openCreate = () => {
    setEditing(null)
    setFormDate(`${cy}-01-01`)
    setFormName('')
    setFormType('closed')
    setFormTime('13:00')
    setFormNotes('')
    setDialogOpen(true)
  }

  const openEdit = (h: MarketHoliday) => {
    setEditing(h)
    setFormDate(h.holidayDate)
    setFormName(h.name)
    setFormType(h.type)
    setFormTime(toTimeInputValue(h.halfDayCloseTime))
    setFormNotes(h.notes ?? '')
    setDialogOpen(true)
  }

  const closeDialog = () => {
    setDialogOpen(false)
    setEditing(null)
  }

  const buildPayload = (): UpsertMarketHolidayPayload | null => {
    if (!formDate.trim()) {
      toast.error('Choose a date')
      return null
    }
    if (!formName.trim()) {
      toast.error('Enter a holiday name')
      return null
    }
    if (formType === 'half_day' && !formTime.trim()) {
      toast.error('Half-day holidays require a close time')
      return null
    }
    const t = formTime.trim()
    let halfDayCloseTime: string | null = null
    if (formType === 'half_day') {
      halfDayCloseTime = /^\d{2}:\d{2}$/.test(t) ? `${t}:00` : t
    }
    return {
      holidayDate: formDate,
      name: formName.trim(),
      type: formType,
      halfDayCloseTime,
      notes: formNotes.trim() || null,
    }
  }

  const handleSave = async () => {
    const payload = buildPayload()
    if (!payload) return
    if (editing) {
      await updateH.mutateAsync({ holidayId: editing.id, templateId, payload })
    } else {
      await createH.mutateAsync({ templateId, payload })
    }
    closeDialog()
  }

  const handleDelete = async (h: MarketHoliday) => {
    if (!confirm(`Delete holiday “${h.name}” on ${formatHolidayDate(h.holidayDate)}?`)) return
    await deleteH.mutateAsync({ holidayId: h.id, templateId })
  }

  const busy = createH.isPending || updateH.isPending || deleteH.isPending

  return (
    <section className="mt-6 border-t border-border pt-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-text">Holidays</h3>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted whitespace-nowrap">Year</Label>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="h-9 w-[100px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {canEdit ? (
            <Button type="button" size="sm" onClick={openCreate}>
              + Add holiday
            </Button>
          ) : null}
        </div>
      </div>
      <p className="mb-3 text-xs text-muted">
        Full-day <strong>closed</strong> dates override the weekly schedule. <strong>Half day</strong> closes early at the
        time you set (template timezone).
      </p>

      {isLoading ? (
        <div className="py-4 text-sm text-muted">Loading holidays…</div>
      ) : holidays.length === 0 ? (
        <div className="py-4 text-sm text-muted">No holidays in {year}.</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2/50 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Close time</th>
                {canEdit ? <th className="px-3 py-2 w-[120px]" /> : null}
              </tr>
            </thead>
            <tbody>
              {holidays.map((h) => (
                <tr key={h.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-mono text-xs">{formatHolidayDate(h.holidayDate)}</td>
                  <td className="px-3 py-2">{h.name}</td>
                  <td className="px-3 py-2">{h.type === 'half_day' ? 'Half day' : 'Closed'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{h.type === 'half_day' ? toTimeInputValue(h.halfDayCloseTime) : '—'}</td>
                  {canEdit ? (
                    <td className="px-3 py-2 text-right space-x-1">
                      <Button type="button" variant="ghost" size="sm" onClick={() => openEdit(h)}>
                        Edit
                      </Button>
                      <Button type="button" variant="ghost" size="sm" className="text-danger" onClick={() => void handleDelete(h)}>
                        Delete
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit holiday' : 'Add holiday'}</DialogTitle>
            <DialogDescription>Dates are interpreted in this template&apos;s timezone.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Date</Label>
              <Input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} disabled={busy} />
            </div>
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. Christmas" disabled={busy} />
            </div>
            <div className="space-y-1">
              <Label>Type</Label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="hol-type"
                    checked={formType === 'closed'}
                    onChange={() => setFormType('closed')}
                    disabled={busy}
                  />
                  Closed (full day)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="hol-type"
                    checked={formType === 'half_day'}
                    onChange={() => setFormType('half_day')}
                    disabled={busy}
                  />
                  Half day
                </label>
              </div>
            </div>
            {formType === 'half_day' ? (
              <div className="space-y-1">
                <Label>Close time (local)</Label>
                <Input type="time" value={formTime} onChange={(e) => setFormTime(e.target.value)} disabled={busy} />
              </div>
            ) : null}
            <div className="space-y-1">
              <Label>Notes (optional)</Label>
              <Textarea rows={2} value={formNotes} onChange={(e) => setFormNotes(e.target.value)} disabled={busy} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeDialog} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleSave()} disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
