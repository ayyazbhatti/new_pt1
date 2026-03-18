import { useState, useEffect, useCallback, useRef } from 'react'
import { Search, User as UserIcon } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/dialog'
import { Input } from '@/shared/ui/input'
import { cn } from '@/shared/utils'
import { useDebouncedValue } from '@/shared/hooks/useDebounce'
import { useModalStore } from '@/app/store'
import { toast } from '@/shared/components/common'
import { listUsers, type UserResponse } from '@/shared/api/users.api'
import { UserDetailsModal } from '@/features/adminUsers/modals'
import type { User } from '@/features/adminUsers/types/users'

interface UserSearchPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When true, render the trigger button (for Topbar). */
  showTrigger?: boolean
}

function mapUserResponseToAdminUser(user: UserResponse): User {
  return {
    id: user.id,
    name: `${user.first_name} ${user.last_name}`,
    email: user.email,
    phone: user.phone || undefined,
    country: user.country || 'Unknown',
    group: user.group_id || '',
    groupName: user.group_name || 'No Group',
    accountType: (user.account_type === 'netting' ? 'netting' : 'hedging') as 'hedging' | 'netting',
    marginCalculationType: (user.margin_calculation_type === 'net' ? 'net' : 'hedged') as 'hedged' | 'net',
    tradingAccess: (user.trading_access === 'close_only'
      ? 'close_only'
      : user.trading_access === 'disabled'
        ? 'disabled'
        : 'full') as 'full' | 'close_only' | 'disabled',
    openPositionsCount: user.open_positions_count ?? 0,
    balance: 0,
    marginLevel: 0,
    status: user.status as 'active' | 'disabled' | 'suspended',
    kycStatus: 'none',
    riskFlag: 'normal',
    createdAt: user.created_at ? new Date(user.created_at).toISOString() : new Date().toISOString(),
    lastLogin: user.last_login_at ? new Date(user.last_login_at).toISOString() : undefined,
    affiliateCode: user.referral_code || undefined,
    leverageLimitMin: user.min_leverage ?? 1,
    leverageLimitMax: user.max_leverage ?? 500,
    currentExposure: 0,
    openPositions: user.open_positions_count ?? 0,
    ordersCount: 0,
    priceStreamProfile: 'Default',
    tradingEnabled: true,
    closeOnlyMode: false,
    withdrawalsEnabled: true,
    depositsEnabled: true,
    maxLeverageCap: 500,
    maxPositionSize: 0,
    maxDailyLoss: 0,
    permissionProfileId: user.permission_profile_id ?? undefined,
    permissionProfileName: user.permission_profile_name ?? undefined,
    role: user.role,
  }
}

export function UserSearchPalette({ open, onOpenChange, showTrigger = false }: UserSearchPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [results, setResults] = useState<UserResponse[]>([])
  const [loading, setLoading] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const debouncedQuery = useDebouncedValue(query, 300)
  const openModal = useModalStore((state) => state.openModal)

  const resetState = useCallback(() => {
    setQuery('')
    setSelectedIndex(0)
    setResults([])
    setLoading(false)
  }, [])

  const selectUser = useCallback(
    (user: UserResponse) => {
      const adminUser = mapUserResponseToAdminUser(user)
      openModal(`user-details-${adminUser.id}`, <UserDetailsModal user={adminUser} />, {
        variant: 'drawer',
      })
      onOpenChange(false)
      resetState()
    },
    [onOpenChange, openModal, resetState]
  )

  useEffect(() => {
    if (!open) {
      resetState()
      return
    }
  }, [open, resetState])

  const minSearchLength = 2
  const shouldSearch = debouncedQuery.trim().length >= minSearchLength

  useEffect(() => {
    if (!shouldSearch) {
      setResults([])
      setSelectedIndex(0)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    listUsers({ search: debouncedQuery.trim(), page: 1, page_size: 25 })
      .then((res) => {
        if (cancelled) return
        setResults(res.items)
        setSelectedIndex(0)
      })
      .catch((error) => {
        if (cancelled) return
        console.error('Failed to search users for UserSearchPalette', error)
        setResults([])
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [debouncedQuery, shouldSearch])

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const item = el.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`)
    item?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedIndex])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'u') {
        e.preventDefault()
        onOpenChange(!open)
        return
      }
      if (!open) return
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((i) => Math.min(i + 1, Math.max(results.length - 1, 0)))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((i) => Math.max(i - 1, 0))
          break
        case 'Enter':
          e.preventDefault()
          if (results[selectedIndex]) selectUser(results[selectedIndex])
          break
        case 'Escape':
          e.preventDefault()
          onOpenChange(false)
          resetState()
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, results, selectedIndex, onOpenChange, resetState, selectUser])

  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)

  return (
    <>
      {showTrigger && (
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          className={cn(
            'flex h-9 min-w-0 w-full items-center gap-2 rounded-lg border border-border bg-surface-2/50 px-3 text-sm text-text-muted',
            'hover:bg-surface-2 hover:text-text focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-background',
            'sm:h-10'
          )}
          aria-label="Open user search palette"
        >
          <UserIcon className="h-4 w-4 shrink-0" />
          <span className="truncate">Search users…</span>
          <kbd className="ml-auto hidden shrink-0 rounded border border-border bg-surface-1 px-1.5 py-0.5 font-mono text-[10px] sm:inline">
            {isMac ? '⌘' : 'Ctrl'}U
          </kbd>
        </button>
      )}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="top-[20%] w-full max-w-2xl max-h-[70vh] translate-y-0 p-0 gap-0 overflow-hidden"
          showClose={true}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogTitle className="sr-only">User search palette</DialogTitle>
          <div className="flex items-center border-b border-border px-3">
            <Search className="h-4 w-4 shrink-0 text-text-muted" />
            <Input
              placeholder="Search users (min 2 characters)..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-12 border-0 bg-transparent pl-2 focus-visible:ring-0 focus-visible:ring-offset-0"
              autoFocus
              aria-label="Search users"
            />
          </div>
          <div
            ref={listRef}
            className="max-h-[min(60vh,400px)] overflow-y-auto py-2"
            role="listbox"
            aria-label="Users"
          >
            {loading && !results.length ? (
              <div className="px-4 py-8 text-center text-sm text-text-muted">Searching users…</div>
            ) : !query.trim() ? (
              <div className="px-4 py-8 text-center text-sm text-text-muted">
                Type at least 2 characters to search users.
              </div>
            ) : query.trim().length < minSearchLength ? (
              <div className="px-4 py-8 text-center text-sm text-text-muted">
                Type at least {minSearchLength} characters to search.
              </div>
            ) : results.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-text-muted">
                No users match &quot;{query}&quot;
              </div>
            ) : (
              results.map((u, index) => {
                const label =
                  [u.first_name, u.last_name].filter(Boolean).join(' ').trim() ||
                  u.email ||
                  u.id
                return (
                  <button
                    key={u.id}
                    type="button"
                    data-index={index}
                    role="option"
                    aria-selected={index === selectedIndex}
                    onClick={() => selectUser(u)}
                    className={cn(
                      'flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors',
                      index === selectedIndex
                        ? 'bg-accent/15 text-accent'
                        : 'text-text hover:bg-surface-2'
                    )}
                  >
                    <UserIcon className="h-4 w-4 shrink-0 text-text-muted" />
                    <div className="flex flex-col min-w-0">
                      <span className="truncate">{label}</span>
                      <span className="truncate text-xs text-text-muted">
                        {u.email} {u.group_name ? `• ${u.group_name}` : ''}
                      </span>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

