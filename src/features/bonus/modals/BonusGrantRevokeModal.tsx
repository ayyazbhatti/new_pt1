import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from '@/shared/components/common'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { getApiErrorMessage } from '@/shared/api/http'
import { listUsers, type UserResponse } from '@/shared/api/users.api'
import {
  fetchAdminBonusUser,
  postAdminBonusGrant,
  postAdminBonusRevoke,
} from '@/features/bonus/api/bonusAdmin.api'
import { cn } from '@/shared/utils'
import { useAuthStore } from '@/shared/store/auth.store'

type ActionTab = 'grant' | 'revoke'

function parseRevokable(s: string): number {
  const n = Number.parseFloat(s)
  return Number.isFinite(n) ? n : 0
}

export interface BonusGrantRevokeModalProps {
  onSuccess?: () => void
}

export function BonusGrantRevokeModal({ onSuccess }: BonusGrantRevokeModalProps) {
  const permissions = useAuthStore((s) => s.user?.permissions ?? [])
  const canEdit = permissions.includes('bonus:edit')

  const [tab, setTab] = useState<ActionTab>('grant')
  const [userSearch, setUserSearch] = useState('')
  const [userHits, setUserHits] = useState<UserResponse[]>([])
  const [selectedUser, setSelectedUser] = useState<UserResponse | null>(null)
  const [bonusState, setBonusState] = useState<{ balance: string; locked: string; revokable: string } | null>(null)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')

  const loadBonus = useCallback(async (userId: string) => {
    const r = await fetchAdminBonusUser(userId)
    setBonusState({ balance: r.balance, locked: r.locked, revokable: r.revokable })
  }, [])

  useEffect(() => {
    if (!userSearch.trim()) {
      setUserHits([])
      return
    }
    const t = window.setTimeout(() => {
      listUsers({ search: userSearch.trim(), limit: 20 })
        .then((r) => setUserHits(r.items))
        .catch(() => setUserHits([]))
    }, 300)
    return () => window.clearTimeout(t)
  }, [userSearch])

  const selectUser = async (u: UserResponse) => {
    setSelectedUser(u)
    setUserSearch(`${u.email} (${u.id})`)
    setUserHits([])
    try {
      await loadBonus(u.id)
    } catch {
      toast.error('Could not load bonus state')
      setBonusState(null)
    }
  }

  const revokableNum = useMemo(() => (bonusState ? parseRevokable(bonusState.revokable) : 0), [bonusState])

  const grant = async () => {
    if (!selectedUser) {
      toast.error('Select a user')
      return
    }
    const a = amount.trim()
    if (!a || Number.parseFloat(a) <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    try {
      await postAdminBonusGrant({ userId: selectedUser.id, amount: a, note: note.trim() || undefined })
      toast.success('Bonus granted')
      setAmount('')
      setNote('')
      await loadBonus(selectedUser.id)
      onSuccess?.()
    } catch (e: unknown) {
      toast.error(getApiErrorMessage(e))
    }
  }

  const revoke = async () => {
    if (!selectedUser) {
      toast.error('Select a user')
      return
    }
    const a = amount.trim()
    const n = Number.parseFloat(a)
    if (!a || n <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    if (n > revokableNum) {
      toast.error(`Amount exceeds revokable ($${revokableNum.toFixed(2)})`)
      return
    }
    try {
      await postAdminBonusRevoke({ userId: selectedUser.id, amount: a, note: note.trim() || undefined })
      toast.success('Bonus revoked')
      setAmount('')
      setNote('')
      await loadBonus(selectedUser.id)
      onSuccess?.()
    } catch (e: unknown) {
      const data = (e as { response?: { data?: { message?: string; revokable?: string } } })?.response?.data
      const rev =
        data && typeof data === 'object' && 'revokable' in data ? String((data as { revokable?: string }).revokable) : ''
      const base = getApiErrorMessage(e)
      toast.error(rev ? `${base} (revokable: ${rev})` : base)
    }
  }

  if (!canEdit) {
    return <p className="text-sm text-text-muted">You do not have bonus:edit permission.</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(['grant', 'revoke'] as const).map((k) => (
          <Button
            key={k}
            type="button"
            variant={tab === k ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setTab(k)}
          >
            {k === 'grant' ? 'Grant' : 'Revoke'}
          </Button>
        ))}
      </div>

      <div className="relative">
        <label className="text-sm font-medium text-text">User</label>
        <Input
          value={userSearch}
          onChange={(e) => {
            setUserSearch(e.target.value)
            setSelectedUser(null)
            setBonusState(null)
          }}
          placeholder="Search by email or name…"
          className="mt-1"
        />
        {userHits.length > 0 && (
          <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border border-border bg-surface-1 py-1 text-sm shadow-lg">
            {userHits.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left hover:bg-surface-2"
                  onClick={() => void selectUser(u)}
                >
                  {u.email}{' '}
                  <span className="text-text-muted">
                    ({u.first_name} {u.last_name})
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {bonusState && selectedUser && (
        <div className="rounded-md bg-surface-2/50 p-3 text-sm">
          <p>
            <span className="text-text-muted">Balance</span>{' '}
            <span className="font-semibold">${bonusState.balance}</span>
          </p>
          <p>
            <span className="text-text-muted">Locked</span>{' '}
            <span className="font-semibold">${bonusState.locked}</span>
          </p>
          <p>
            <span className="text-text-muted">Revokable</span>{' '}
            <span className="font-semibold">${bonusState.revokable}</span>
          </p>
        </div>
      )}

      <div>
        <label className="text-sm font-medium text-text">Amount (USD)</label>
        <Input value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1" placeholder="0.00" />
        {tab === 'revoke' && bonusState && (
          <p className="mt-1 text-xs text-text-muted">Revokable: ${bonusState.revokable}</p>
        )}
      </div>

      <div>
        <label className="text-sm font-medium text-text">Note (optional, max 500 chars)</label>
        <textarea
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          className={cn(
            'mt-1 flex min-h-[80px] w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-sm text-text'
          )}
        />
      </div>

      <div className="flex gap-2">
        {tab === 'grant' ? (
          <Button type="button" onClick={() => void grant()}>
            Grant
          </Button>
        ) : (
          <Button type="button" variant="danger" onClick={() => void revoke()}>
            Revoke
          </Button>
        )}
      </div>
    </div>
  )
}
