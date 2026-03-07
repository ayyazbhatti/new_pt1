import { useState, useEffect, useMemo } from 'react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { useModalStore } from '@/app/store'
import { useQuery } from '@tanstack/react-query'
import { listPermissionProfiles } from '@/features/permissions/api/permissionProfiles.api'
import type { Manager } from '../types/manager'
import type { UpdateManagerPayload } from '../api/managers.api'
import { toast } from '@/shared/components/common'

interface EditManagerModalProps {
  manager: Manager
  onSave?: (updates: UpdateManagerPayload) => void | Promise<unknown>
}

export function EditManagerModal({ manager, onSave }: EditManagerModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const [profileId, setProfileId] = useState(manager.permissionProfileId)
  const [profileSearch, setProfileSearch] = useState('')
  const [notes, setNotes] = useState(manager.notes ?? '')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const { data: profiles = [] } = useQuery({
    queryKey: ['permission-profiles'],
    queryFn: listPermissionProfiles,
  })

  useEffect(() => {
    setProfileId(manager.permissionProfileId)
    setNotes(manager.notes ?? '')
  }, [manager])

  const filteredProfiles = useMemo(() => {
    if (!profileSearch.trim()) return profiles
    const q = profileSearch.trim().toLowerCase()
    return profiles.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description ?? '').toLowerCase().includes(q)
    )
  }, [profiles, profileSearch])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const profile = profiles.find((p) => p.id === profileId)
    if (!profile) {
      toast.error('Please select a permission profile.')
      return
    }
    setIsSubmitting(true)
    try {
      const payload: UpdateManagerPayload = {
        permission_profile_id: profile.id,
        notes: notes.trim() || null,
      }
      await onSave?.(payload)
      // Parent closes modal on success
    } catch {
      // Error toast handled by parent
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-surface-2/50 p-3 text-sm">
        <div className="font-medium text-text">{manager.userName}</div>
        <div className="text-text-muted">{manager.userEmail}</div>
      </div>
      <div>
        <label className="block text-sm font-medium text-text mb-1.5">Permission profile</label>
        <Select
          value={profileId}
          onValueChange={setProfileId}
          onOpenChange={(open) => !open && setProfileSearch('')}
          required
        >
          <SelectTrigger>
            <SelectValue placeholder="Select profile" />
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
          placeholder="Internal notes"
          className="w-full"
        />
      </div>
      <div className="flex justify-end gap-2 pt-4 border-t border-border">
        <Button type="button" variant="outline" onClick={() => closeModal(`edit-manager-${manager.id}`)}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}
