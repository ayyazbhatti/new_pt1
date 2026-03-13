import { useState, useEffect, useCallback } from 'react'
import { Copy, Eye, EyeOff, RefreshCw } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import { Input } from '@/shared/ui/input'
import { useModalStore } from '@/app/store'
import { toast } from '@/shared/components/common'
import { listUsers, type UserResponse } from '@/shared/api/users.api'
import { createUser } from '@/features/adminUsers/api/users.api'
import type { Lead } from '../types/leads'
import { convertLead } from '../api/leads.api'

const DEBOUNCE_MS = 300
const PASSWORD_LENGTH = 14
const PASSWORD_CHARS = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function generateRandomPassword(): string {
  const arr = new Uint8Array(PASSWORD_LENGTH)
  crypto.getRandomValues(arr)
  return Array.from(arr, (b) => PASSWORD_CHARS[b % PASSWORD_CHARS.length]).join('')
}

/** Split lead name into first and last (first space). */
function nameParts(name: string | null | undefined): { first: string; last: string } {
  const n = (name ?? '').trim()
  const i = n.indexOf(' ')
  if (i <= 0) return { first: n, last: '' }
  return { first: n.slice(0, i), last: n.slice(i + 1).trim() }
}

interface ConvertLeadModalProps {
  lead: Lead
  onSuccess: () => void
  modalKey: string
}

export function ConvertLeadModal({ lead, onSuccess, modalKey }: ConvertLeadModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const [option, setOption] = useState<'new' | 'link'>('new')
  const [submitting, setSubmitting] = useState(false)

  // Link to existing user
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<UserResponse[]>([])
  const [selectedUser, setSelectedUser] = useState<UserResponse | null>(null)
  const [searching, setSearching] = useState(false)

  // Create new user
  const parts = nameParts(lead.name)
  const [email, setEmail] = useState(lead.email ?? '')
  const [firstName, setFirstName] = useState(parts.first)
  const [lastName, setLastName] = useState(parts.last)
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const runSearch = useCallback(async (q: string) => {
    const s = q.trim()
    if (!s) {
      setSearchResults([])
      return
    }
    setSearching(true)
    try {
      const res = await listUsers({ search: s, page_size: 15 })
      setSearchResults(res.items)
    } catch {
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => runSearch(searchQuery), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [searchQuery, runSearch])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      if (option === 'link') {
        if (!selectedUser) {
          toast.error('Please select an existing user to link.')
          setSubmitting(false)
          return
        }
        await convertLead(lead.id, selectedUser.id)
        toast.success('Lead converted and linked to user.')
      } else {
        if (!email.trim() || !firstName.trim() || !lastName.trim()) {
          toast.error('Email, first name, and last name are required.')
          setSubmitting(false)
          return
        }
        if (password.length < 8) {
          toast.error('Password must be at least 8 characters.')
          setSubmitting(false)
          return
        }
        if (password !== passwordConfirm) {
          toast.error('Passwords do not match.')
          setSubmitting(false)
          return
        }
        const newUser = await createUser({
          email: email.trim(),
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          password,
        })
        await convertLead(lead.id, newUser.id)
        toast.success('User created and lead converted. They can log in with the email and password you set.')
      }
      closeModal(modalKey)
      onSuccess()
    } catch (err) {
      toast.error((err as Error)?.message ?? 'Failed to convert')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">
        This will mark the lead as <strong className="text-text">Converted</strong> and optionally link to a user account.
      </p>
      <div className="rounded-lg border border-border bg-surface-2/40 p-3">
        <p className="text-sm font-medium text-text">{lead.name || '—'}</p>
        <p className="text-xs text-text-muted">{lead.email}</p>
      </div>
      <div className="space-y-2">
        <label className="flex items-center gap-2">
          <input type="radio" name="convert-option" checked={option === 'new'} onChange={() => setOption('new')} className="rounded border-border" />
          <span className="text-sm">Create new user and convert</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="convert-option" checked={option === 'link'} onChange={() => setOption('link')} className="rounded border-border" />
          <span className="text-sm">Link to existing user</span>
        </label>
      </div>

      {option === 'link' && (
        <div className="space-y-2">
          <Label>Search user</Label>
          <Input
            type="text"
            placeholder="Search by email or name..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              setSelectedUser(null)
            }}
            className="w-full"
          />
          {searching && <p className="text-xs text-text-muted">Searching...</p>}
          {!searching && searchQuery.trim() && searchResults.length === 0 && (
            <p className="text-xs text-text-muted">No users found.</p>
          )}
          {!searching && searchResults.length > 0 && (
            <ul className="max-h-40 overflow-auto rounded border border-border bg-surface-2/40 divide-y divide-border">
              {searchResults.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedUser(u)}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-3/60 ${selectedUser?.id === u.id ? 'bg-primary/15 text-primary' : ''}`}
                  >
                    {u.first_name} {u.last_name} — {u.email}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {selectedUser && (
            <p className="text-xs text-text-muted">
              Linked to: {selectedUser.first_name} {selectedUser.last_name} ({selectedUser.email})
            </p>
          )}
        </div>
      )}

      {option === 'new' && (
        <div className="space-y-3">
          <div>
            <Label htmlFor="convert-email">Email</Label>
            <Input id="convert-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="mt-1 w-full" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="convert-first">First name</Label>
              <Input id="convert-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} required className="mt-1 w-full" />
            </div>
            <div>
              <Label htmlFor="convert-last">Last name</Label>
              <Input id="convert-last" value={lastName} onChange={(e) => setLastName(e.target.value)} required className="mt-1 w-full" />
            </div>
          </div>
          <div>
            <Label htmlFor="convert-password">Password</Label>
            <div className="relative mt-1">
              <Input
                id="convert-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="w-full pr-20"
                placeholder="Min 8 characters"
              />
              <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="rounded p-1 text-text-muted hover:bg-surface-3 hover:text-text focus:outline-none focus:ring-2 focus:ring-accent"
                  title={showPassword ? 'Hide password' : 'Show password'}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const p = generateRandomPassword()
                    setPassword(p)
                    setPasswordConfirm(p)
                  }}
                  className="rounded p-1 text-text-muted hover:bg-surface-3 hover:text-text focus:outline-none focus:ring-2 focus:ring-accent"
                  title="Generate random password"
                  aria-label="Generate random password"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (password) {
                      void navigator.clipboard.writeText(password)
                      toast.success('Password copied to clipboard')
                    }
                  }}
                  disabled={!password}
                  className="rounded p-1 text-text-muted hover:bg-surface-3 hover:text-text focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-40 disabled:pointer-events-none"
                  title="Copy password"
                  aria-label="Copy password"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
          <div>
            <Label htmlFor="convert-password-confirm">Confirm password</Label>
            <Input id="convert-password-confirm" type={showPassword ? 'text' : 'password'} value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} required minLength={8} className="mt-1 w-full" />
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={() => closeModal(modalKey)}>Cancel</Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Converting...' : 'Convert'}
        </Button>
      </div>
    </form>
  )
}
