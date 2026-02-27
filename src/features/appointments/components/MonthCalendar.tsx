import type { Appointment } from '../types'
import { getMonthCalendarCells, isSameCalendarDay } from '../utils/calendar'
import { formatTime } from '../utils/format'
import { StatusBadge } from './StatusBadge'
import { cn } from '@/shared/utils'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MAX_VISIBLE = 3

interface MonthCalendarProps {
  calendarDate: Date
  appointments: Appointment[]
  onPrevMonth: () => void
  onNextMonth: () => void
  onToday: () => void
  onAppointmentClick: (apt: Appointment) => void
}

export function MonthCalendar({
  calendarDate,
  appointments,
  onPrevMonth,
  onNextMonth,
  onToday,
  onAppointmentClick,
}: MonthCalendarProps) {
  const cells = getMonthCalendarCells(calendarDate)
  const today = new Date()
  const monthLabel = calendarDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const getAppointmentsForDay = (day: number) => {
    const cellDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth(), day)
    return appointments.filter((a) => {
      if (a.status === 'cancelled') return false
      const aptDate = new Date(a.scheduled_at)
      return isSameCalendarDay(aptDate, cellDate)
    })
  }

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800 p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onPrevMonth}
            className="rounded-lg border border-slate-600 bg-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-600"
          >
            ← Prev
          </button>
          <span className="min-w-[180px] text-center text-lg font-bold text-white">
            {monthLabel}
          </span>
          <button
            type="button"
            onClick={onNextMonth}
            className="rounded-lg border border-slate-600 bg-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-600"
          >
            Next →
          </button>
        </div>
        <button
          type="button"
          onClick={onToday}
          className="rounded-lg border border-slate-600 bg-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-600"
        >
          Today
        </button>
      </div>

      <div className="grid grid-cols-7 gap-px">
        {DAY_NAMES.map((name) => (
          <div
            key={name}
            className="border-b border-slate-700 py-2 text-center text-xs font-medium text-slate-400"
          >
            {name}
          </div>
        ))}
        {cells.map((day, idx) => {
          if (day === null) {
            return <div key={`empty-${idx}`} className="min-h-[100px] bg-slate-800/50" />
          }
          const dayAppointments = getAppointmentsForDay(day)
          const cellDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth(), day)
          const isToday = isSameCalendarDay(cellDate, today)
          return (
            <div
              key={day}
              className={cn(
                'min-h-[100px] aspect-square border border-slate-700 p-2',
                isToday && 'bg-blue-500/10 border-blue-500/30'
              )}
            >
              <span className="text-sm font-medium text-slate-300">{day}</span>
              <div className="mt-1 space-y-0.5">
                {dayAppointments.slice(0, MAX_VISIBLE).map((apt) => (
                  <button
                    key={apt.id}
                    type="button"
                    onClick={() => onAppointmentClick(apt)}
                    className="block w-full truncate rounded px-1 py-0.5 text-left text-xs text-slate-300 hover:bg-slate-700"
                    title={`${formatTime(apt.scheduled_at)} ${apt.title}`}
                  >
                    {formatTime(apt.scheduled_at)} {apt.title}
                  </button>
                ))}
                {dayAppointments.length > MAX_VISIBLE && (
                  <span className="block text-xs text-slate-400">
                    +{dayAppointments.length - MAX_VISIBLE} more
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
