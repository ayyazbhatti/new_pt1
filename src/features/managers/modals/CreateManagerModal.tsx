import { useState, useMemo } from 'react'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { useModalStore } from '@/app/store'
import { useQuery } from '@tanstack/react-query'
import { useDebouncedValue } from '@/shared/hooks/useDebounce'
import { listPermissionProfiles } from '@/features/permissions/api/permissionProfiles.api'
import { listUsers } from '@/shared/api/users.api'
import { listManagers } from '../api/managers.api'
import type { CreateManagerPayload } from '../api/managers.api'
import { toast } from '@/shared/components/common'

const USER_PAGE_SIZE = 100

interface CreateManagerModalProps {
  onCreated?: (payload: CreateManagerPayload) => void | Promise<void>
}

export function CreateManagerModal({ onCreated }: CreateManagerModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const [selectedUserId, setSelectedUserId] = useState<string>('')
  const [selectedUserLabel, setSelectedUserLabel] = useState<string>('')
  const [selectedProfileId, setSelectedProfileId] = useState<string>('')
  const [selectedRole, setSelectedRole] = useState<string>('manager')
  const [userSearch, setUserSearch] = useState('')
  const [profileSearch, setProfileSearch] = useState('')
  const [notes, setNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const roleOptions = [
    { value: 'manager', label: 'Manager' },
    { value: 'agent', label: 'Agent' },
    { value: 'admin', label: 'Admin' },
  ]

  const { data: profiles = [] } = useQuery({
    queryKey: ['permission-profiles'],
    queryFn: listPermissionProfiles,
  })

  const debouncedUserSearch = useDebouncedValue(userSearch.trim(), 300)

  const { data: usersResponse, isLoading: usersLoading } = useQuery({
    queryKey: ['users', 'manager-dropdown', debouncedUserSearch],
    queryFn: () =>
      listUsers({
        search: debouncedUserSearch || undefined,
        page: 1,
        page_size: USER_PAGE_SIZE,
      }),
  })

  const { data: managers = [] } = useQuery({
    queryKey: ['managers'],
    queryFn: () => listManagers({}),
  })

  const managerUserIds = useMemo(() => new Set(managers.map((m) => m.userId)), [managers])

  const userOptions = useMemo(() => {
    const items = usersResponse?.items ?? []
    return items
      .filter((u) => !managerUserIds.has(u.id))
      .map((u) => ({
        id: u.id,
        name: `${u.first_name} ${u.last_name}`.trim() || u.email,
        email: u.email,
      }))
  }, [usersResponse?.items, managerUserIds])

  const filteredProfiles = useMemo(() => {
    if (!profileSearch.trim()) return profiles
    const q = profileSearch.trim().toLowerCase()
    return profiles.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description ?? '').toLowerCase().includes(q)
    )
  }, [profiles, profileSearch])

  const selectedProfile = profiles.find((p) => p.id === selectedProfileId)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedUserId || !selectedProfileId) {
      toast.error('Please select a user and a permission profile.')
      return
    }
    if (!selectedProfile) return
    setIsSubmitting(true)
    try {
      const payload: CreateManagerPayload = {
        user_id: selectedUserId,
        permission_profile_id: selectedProfileId,
        role: selectedRole,
        notes: notes.trim() || null,
      }
      await onCreated?.(payload)
    } catch {
      // Error toast handled by parent mutation onError
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">
        Select a user from the users table and assign a permission profile. They will get admin access according to the profile.
      </p>
      <div>
        <label className="block text-sm font-medium text-text mb-1.5">User</label>
        <Select
          value={selectedUserId}
          onValueChange={(id) => {
            setSelectedUserId(id)
            const opt = userOptions.find((o) => o.id === id)
            setSelectedUserLabel(opt ? `${opt.name} — ${opt.email}` : '')
          }}
          onOpenChange={(open) => !open && setUserSearch('')}
          required
        >
          <SelectTrigger>
            <SelectValue placeholder="Select user to promote to manager">
              {selectedUserId ? selectedUserLabel : null}
            </SelectValue>
          </SelectTrigger>
          <SelectContent
            onCloseAutoFocus={() => setUserSearch('')}
            position="popper"
            className="max-h-[320px]"
          >
            <div
              className="sticky top-0 z-10 border-b border-border bg-surface-1 p-2"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <Input
                type="search"
                placeholder="Search by name or email..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                className="h-8 text-sm"
                autoFocus
              />
            </div>
            <div className="max-h-[240px] overflow-y-auto p-1">
              {usersLoading ? (
                <div className="py-4 text-center text-sm text-text-muted">
                  Searching...
                </div>
              ) : userOptions.length === 0 ? (
                <div className="py-4 text-center text-sm text-text-muted">
                  {debouncedUserSearch ? 'No users match your search.' : 'Type to search users.'}
                </div>
              ) : (
                userOptions.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name} — {u.email}
                  </SelectItem>
                ))
              )}
            </div>
          </SelectContent>
        </Select>
        <p className="text-xs text-text-muted mt-1">Only users not already managers are listed.</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-text mb-1.5">Role</label>
        <Select
          value={selectedRole}
          onValueChange={setSelectedRole}
          required
        >
          <SelectTrigger>
            <SelectValue placeholder="Select role" />
          </SelectTrigger>
          <SelectContent>
            {roleOptions.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-text-muted mt-1">Admin: full access. Manager: admin access. Agent: limited access (e.g. leads).</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-text mb-1.5">Permission profile</label>
        <Select
          value={selectedProfileId}
          onValueChange={setSelectedProfileId}
          onOpenChange={(open) => !open && setProfileSearch('')}
          required
        >
          <SelectTrigger>
            <SelectValue placeholder="Select permission profile" />
          </SelectTrigger>
          <SelectContent
            onCloseAutoFocus={() => setProfileSearch('')}
            position="popper"
            className="max-h-[320px]"
          >
            <div
              className="sticky top-0 z-10 border-b border-border bg-surface-1 p-2"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <Input
                type="search"
                placeholder="Search by name or description..."
                value={profileSearch}
                onChange={(e) => setProfileSearch(e.target.value)}
                className="h-8 text-sm"
                autoFocus
              />
            </div>
            <div className="max-h-[240px] overflow-y-auto p-1">
              {filteredProfiles.length === 0 ? (
                <div className="py-4 text-center text-sm text-text-muted">
                  {profileSearch.trim() ? 'No profiles match your search.' : 'No profiles available.'}
                </div>
              ) : (
                filteredProfiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                    {p.description ? ` — ${p.description}` : ''}
                  </SelectItem>
                ))
              )}
            </div>
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="block text-sm font-medium text-text mb-1.5">Notes (optional)</label>
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Regional lead for EU"
          className="w-full"
        />
      </div>
      <div className="flex justify-end gap-2 pt-4 border-t border-border">
        <Button type="button" variant="outline" onClick={() => closeModal('create-manager')}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Creating...' : 'Create manager'}
        </Button>
      </div>
    </form>
  )
}
