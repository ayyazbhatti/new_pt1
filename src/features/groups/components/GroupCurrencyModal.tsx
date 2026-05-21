import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ModalShell } from '@/shared/ui/modal'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import { CurrencySelect } from '@/shared/components/CurrencySelect'
import { getGeneralSettings } from '@/features/settings/api/generalSettings.api'
import type { UserGroup } from '../types/group'
import { useUpdateGroup } from '../hooks/useGroups'
import { Spinner } from '@/shared/ui/loading'

interface GroupCurrencyModalProps {
  group: UserGroup | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Optimistic / local list patch after a successful save */
  onUpdated?: (groupId: string, displayCurrency: string | null) => void
}

export function GroupCurrencyModal({
  group,
  open,
  onOpenChange,
  onUpdated,
}: GroupCurrencyModalProps) {
  const [code, setCode] = useState('')
  const updateGroup = useUpdateGroup()

  useEffect(() => {
    if (open && group) {
      setCode(group.displayCurrency?.trim() ?? '')
    }
  }, [open, group])

  const { data: generalSettings } = useQuery({
    queryKey: ['admin', 'settings', 'general'],
    queryFn: getGeneralSettings,
    enabled: open,
    staleTime: 60_000,
  })
  const platformDefaultCurrency = generalSettings?.currency ?? 'USD'

  if (!group) {
    return null
  }

  const isPending = updateGroup.isPending && updateGroup.variables?.id === group.id

  const handleSave = async () => {
    const trimmed = code.trim().toUpperCase()
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
          display_currency: trimmed ? trimmed : null,
        },
      })
      onUpdated?.(group.id, trimmed ? trimmed : null)
      onOpenChange(false)
    } catch {
      // Mutation hook shows toast
    }
  }

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      title="Group display currency"
      description={`${group.name} · members use this default unless they have a personal override. Platform default: ${platformDefaultCurrency}.`}
      size="sm"
    >
      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="group-currency-quick-edit">ISO 4217 currency</Label>
          <CurrencySelect
            id="group-currency-quick-edit"
            variant="list"
            autoFocusSearch
            value={code}
            onChange={setCode}
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
