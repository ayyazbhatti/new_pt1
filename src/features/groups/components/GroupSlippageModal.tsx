import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ModalShell } from '@/shared/ui/modal'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import { Input } from '@/shared/ui/input'
import { getGeneralSettings } from '@/features/settings/api/generalSettings.api'
import type { UserGroup } from '../types/group'
import { useUpdateGroup } from '../hooks/useGroups'
import { Spinner } from '@/shared/ui/loading'
import { toast } from '@/shared/components/common'

interface GroupSlippageModalProps {
  group: UserGroup | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdated?: (groupId: string, defaultSlippageBps: number | null) => void
}

function parseBps(raw: string): { ok: true; value: number } | { ok: false; message: string } {
  const t = raw.trim()
  if (t === '') return { ok: true, value: -1 } // sentinel: clear → null (handled by caller)

  if (!/^\d+$/.test(t)) {
    return { ok: false, message: 'Enter a whole number (basis points), or leave empty for platform default.' }
  }
  const n = Number.parseInt(t, 10)
  if (n < 0) return { ok: false, message: 'Slippage must be zero or greater.' }
  if (!Number.isSafeInteger(n)) return { ok: false, message: 'Value is too large.' }
  return { ok: true, value: n }
}

export function GroupSlippageModal({ group, open, onOpenChange, onUpdated }: GroupSlippageModalProps) {
  const [bpsInput, setBpsInput] = useState('')
  const updateGroup = useUpdateGroup()

  useEffect(() => {
    if (open && group) {
      setBpsInput(group.defaultSlippageBps != null && Number.isFinite(group.defaultSlippageBps) ? String(group.defaultSlippageBps) : '')
    }
  }, [open, group])

  const { data: generalSettings } = useQuery({
    queryKey: ['admin', 'settings', 'general'],
    queryFn: getGeneralSettings,
    enabled: open,
    staleTime: 60_000,
  })
  const platformBps =
    typeof generalSettings?.defaultSlippageBps === 'number' && Number.isFinite(generalSettings.defaultSlippageBps)
      ? generalSettings.defaultSlippageBps
      : 50

  if (!group) {
    return null
  }

  const isPending = updateGroup.isPending && updateGroup.variables?.id === group.id

  const handleSave = async () => {
    const parsed = parseBps(bpsInput)
    if (parsed.ok === false) {
      toast.error(parsed.message)
      return
    }
    const default_slippage_bps = parsed.value === -1 ? null : parsed.value

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
          default_slippage_bps,
        },
      })
      onUpdated?.(group.id, default_slippage_bps)
      onOpenChange(false)
    } catch {
      // Mutation hook shows toast
    }
  }

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      title="Group default slippage"
      description={`${group.name} · max slippage for market orders (basis points). Platform default when unset: ${platformBps} bps (${(platformBps / 100).toFixed(2)}%).`}
      size="sm"
    >
      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="group-slippage-bps">Slippage (bps)</Label>
          <Input
            id="group-slippage-bps"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder={`Use platform default (${platformBps} bps)`}
            value={bpsInput}
            onChange={(e) => setBpsInput(e.target.value)}
            disabled={isPending}
            className="font-mono tabular-nums"
          />
          <p className="text-xs text-text-muted">
            Leave empty to clear the group override and use the platform default from Admin → Settings → General.
          </p>
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
