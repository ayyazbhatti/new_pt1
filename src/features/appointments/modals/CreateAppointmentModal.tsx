import { useState, useEffect } from 'react'
import type { CreateAppointmentRequest, UserSearchResult, AppointmentType } from '../types'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'
import { useModalStore } from '@/app/store'
import { Search } from 'lucide-react'
import { cn } from '@/shared/utils'

const TYPES: AppointmentType[] = ['consultation', 'support', 'onboarding', 'review', 'other']
const DURATIONS = [15, 30, 45, 60]

interface CreateAppointmentModalProps {
  onSearchUsers: (q: string, limit?: number) => UserSearchResult[] | Promise<UserSearchResult[]>
  onSubmit: (payload: CreateAppointmentRequest) => void
  submitting?: boolean
  /** When set, user is pre-selected and read-only (e.g. when opening from User Details drawer). */
  initialUser?: UserSearchResult | null
}

export function CreateAppointmentModal({
  onSearchUsers,
  onSubmit,
  submitting = false,
  initialUser = null,
}: CreateAppointmentModalProps) {
  const closeModal = useModalStore((s) => s.closeModal)
  const [userQuery, setUserQuery] = useState('')
  const [userResults, setUserResults] = useState<UserSearchResult[]>([])
  const [showUserDropdown, setShowUserDropdown] = useState(false)
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(initialUser ?? null)
  const isUserLocked = initialUser != null

  useEffect(() => {
    if (initialUser) setSelectedUser(initialUser)
  }, [initialUser])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [scheduledDate, setScheduledDate] = useState('')
  const [scheduledTime, setScheduledTime] = useState('')
  const [duration_minutes, setDurationMinutes] = useState(30)
  const [type, setType] = useState<AppointmentType>('consultation')
  const [meeting_link, setMeetingLink] = useState('')
  const [location, setLocation] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (isUserLocked || userQuery.trim().length < 2) {
      setUserResults([])
      return
    }
    let cancelled = false
    Promise.resolve(onSearchUsers(userQuery, 10)).then((results) => {
      if (!cancelled) {
        setUserResults(results)
        setShowUserDropdown(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [isUserLocked, userQuery, onSearchUsers])

  const handleSelectUser = (u: UserSearchResult) => {
    setSelectedUser(u)
    setUserQuery('')
    setUserResults([])
    setShowUserDropdown(false)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedUser) return
    const [y, m, d] = scheduledDate.split('-').map(Number)
    const [hour, min] = scheduledTime.split(':').map(Number)
    const scheduled_at = new Date(y, m - 1, d, hour, min, 0).toISOString()
    onSubmit({
      user_id: selectedUser.id,
      title: title.trim(),
      description: description.trim() || undefined,
      scheduled_at,
      duration_minutes,
      type,
      meeting_link: meeting_link.trim() || undefined,
      location: location.trim() || undefined,
      notes: notes.trim() || undefined,
    })
    // Modal closed by parent on mutation success
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="relative">
        <label className="mb-1 block text-sm font-medium text-slate-300">User *</label>
        {selectedUser ? (
          <div className={cn('flex items-center justify-between rounded-lg border border-slate-600 bg-slate-700 p-2', isUserLocked && 'opacity-90')}>
            <span className="text-slate-200">
              {(selectedUser.full_name ?? `${(selectedUser.first_name ?? '')} ${(selectedUser.last_name ?? '')}`.trim()) || selectedUser.email}
            </span>
            {!isUserLocked && (
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="text-slate-400 hover:text-white"
              >
                Clear
              </button>
            )}
          </div>
        ) : !isUserLocked ? (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
                onFocus={() => userQuery.length >= 2 && setShowUserDropdown(true)}
                placeholder="Search by email or name..."
                className="pl-9 border-slate-600 bg-slate-700 text-white placeholder:text-slate-400"
              />
            </div>
            {showUserDropdown && userResults.length > 0 && (
              <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-slate-600 bg-slate-800 py-1">
                {userResults.map((u) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      onClick={() => handleSelectUser(u)}
                      className="w-full px-3 py-2 text-left text-sm text-slate-300 hover:bg-slate-700"
                    >
                      {(u.full_name ?? `${(u.first_name ?? '')} ${(u.last_name ?? '')}`.trim()) || u.email} — {u.email}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-300">Title *</label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Appointment title"
          required
          className="border-slate-600 bg-slate-700 text-white"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-300">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description"
          rows={2}
          className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-300">Date *</label>
          <Input
            type="date"
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
            required
            className="border-slate-600 bg-slate-700 text-white"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-300">Time *</label>
          <Input
            type="time"
            value={scheduledTime}
            onChange={(e) => setScheduledTime(e.target.value)}
            required
            className="border-slate-600 bg-slate-700 text-white"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-300">Duration</label>
          <Select value={String(duration_minutes)} onValueChange={(v) => setDurationMinutes(Number(v))}>
            <SelectTrigger className="border-slate-600 bg-slate-700 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DURATIONS.map((m) => (
                <SelectItem key={m} value={String(m)}>{m} min</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-300">Type</label>
          <Select value={type} onValueChange={(v) => setType(v as AppointmentType)}>
            <SelectTrigger className="border-slate-600 bg-slate-700 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPES.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-300">Meeting link</label>
        <Input
          value={meeting_link}
          onChange={(e) => setMeetingLink(e.target.value)}
          placeholder="https://..."
          type="url"
          className="border-slate-600 bg-slate-700 text-white"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-300">Location</label>
        <Input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Location"
          className="border-slate-600 bg-slate-700 text-white"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-300">Internal notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Admin-only notes"
          rows={2}
          className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-700 pt-4">
        <Button type="button" variant="outline" onClick={() => closeModal('create-apt')} className="border-slate-600 bg-slate-700 text-slate-300 hover:bg-slate-600">
          Cancel
        </Button>
        <Button type="submit" disabled={submitting || !selectedUser || !title.trim() || !scheduledDate || !scheduledTime} className="bg-blue-600 hover:bg-blue-700">
          {submitting ? 'Creating...' : 'Create appointment'}
        </Button>
      </div>
    </form>
  )
}
