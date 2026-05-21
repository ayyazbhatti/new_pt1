import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ModalShell } from '@/shared/ui/modal'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import { TimezoneSelect } from '@/shared/components/TimezoneSelect'
import { getGeneralSettings } from '@/features/settings/api/generalSettings.api'
import type { UserGroup } from '../types/group'
import { useUpdateGroup } from '../hooks/useGroups'
import { Spinner } from '@/shared/ui/loading'

interface GroupTimezoneModalProps {
  group: UserGroup | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Optimistic / local list patch after a successful save */
  onUpdated?: (groupId: string, timezone: string | null) => void
}

export function GroupTimezoneModal({
  group,
  open,
  onOpenChange,
  onUpdated,
}: GroupTimezoneModalProps) {
  const [tz, setTz] = useState('')
  const updateGroup = useUpdateGroup()

  useEffect(() => {
    if (open && group) {
      setTz(group.timezone?.trim() ?? '')
    }
  }, [open, group])

  const { data: generalSettings } = useQuery({
    queryKey: ['admin', 'settings', 'general'],
    queryFn: getGeneralSettings,
    enabled: open,
    staleTime: 60_000,
  })
  const platformDefaultTimezone = generalSettings?.timezone ?? 'UTC'

  if (!group) {
    return null
  }

  const isPending = updateGroup.isPending && updateGroup.variables?.id === group.id

  const handleSave = async () => {
    try {
      await updateGroup.mutateAsync({
        id: group.id,
        payload: {
          name: group.name,
          description: group.description ?? null,
          status: group.status,
          margin_call_level: group.marginCallLevel ?? null,
          stop_out_level: group.stopOutLevel ?? null,
          signup_slug: group.signupSlug ?? null,
          hide_leverage_in_terminal: group.hideLeverageInTerminal ?? null,
          timezone: tz.trim() ? tz.trim() : null,
        },
      })
      onUpdated?.(group.id, tz.trim() ? tz.trim() : null)
      onOpenChange(false)
    } catch {
      // Mutation hook shows toast
    }
  }

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      title="Group timezone"
      description={`${group.name} · members use this default unless they have a personal override. Platform default: ${platformDefaultTimezone}.`}
      size="sm"
    >
      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="group-tz-quick-edit">IANA timezone</Label>
          <TimezoneSelect
            id="group-tz-quick-edit"
            variant="list"
            autoFocusSearch
            value={tz}
            onChange={setTz}
            allowClear
            placeholder="Use platform default"
            disabled={isPending}
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={isPending}>
            {isPending ? (
              <>
                <Spinner className="mr-2 h-4 w-4" />
                Saving…
              </>
            ) : (
              'Save'
            )}
          </Button>
        </div>
      </div>
    </ModalShell>
  )
}
