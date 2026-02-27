import type { AppointmentStatus } from '../types'

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

export function getStatusBadgeClasses(status: AppointmentStatus): string {
  const base = 'px-2 py-1 rounded-md text-xs font-medium border'
  const map: Record<AppointmentStatus, string> = {
    scheduled: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    confirmed: 'bg-green-500/10 text-green-400 border-green-500/20',
    completed: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
    cancelled: 'bg-red-500/10 text-red-400 border-red-500/20',
    rescheduled: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  }
  return `${base} ${map[status] ?? 'bg-slate-500/10 text-slate-400 border-slate-500/20'}`
}
