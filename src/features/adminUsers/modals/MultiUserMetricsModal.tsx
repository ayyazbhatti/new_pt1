import { useState, useCallback, useEffect, useRef } from 'react'
import {
  Activity,
  AlertTriangle,
  User,
  X,
  Plus,
  Settings,
  ArrowUpDown,
  CheckSquare,
  Square,
  RefreshCw,
} from 'lucide-react'
import { listUsers, UserResponse } from '@/shared/api/users.api'
import { http } from '@/shared/api/http'
import { toast } from '@/shared/components/common'

const VISIBLE_METRICS_IDS = [
  'balance',
  'equity',
  'margin',
  'freeMargin',
  'marginLevel',
  'bonus',
  'realizedPnl',
  'unrealizedPnl',
] as const
const VISIBLE_METRICS_LABELS: Record<(typeof VISIBLE_METRICS_IDS)[number], string> = {
  balance: 'Balance',
  equity: 'Equity',
  margin: 'Margin',
  freeMargin: 'Free Margin',
  marginLevel: 'Margin Level',
  bonus: 'Bonus',
  realizedPnl: 'Realized P&L',
  unrealizedPnl: 'Unrealized P&L',
}

export interface UserMetrics {
  balance: number
  equity: number
  margin: number
  freeMargin: number
  marginLevel: number | null
  bonus: number
  realizedPnl: number
  unrealizedPnl: number
}

interface BoxState {
  id: string
  userId: string | null
  userName: string | null
  userEmail: string | null
  metrics: UserMetrics | null
  loading: boolean
}

function defaultMetrics(): UserMetrics {
  return {
    balance: 0,
    equity: 0,
    margin: 0,
    freeMargin: 0,
    marginLevel: null,
    bonus: 0,
    realizedPnl: 0,
    unrealizedPnl: 0,
  }
}

async function fetchUserMetrics(
  userId: string,
  onError?: (err: unknown) => void
): Promise<UserMetrics> {
  try {
    const r = await http<Record<string, unknown>>(`/api/admin/users/${userId}/account-summary`)
    return {
      balance: Number(r.balance ?? 0),
      equity: Number(r.equity ?? 0),
      margin: Number(r.marginUsed ?? r.margin ?? 0),
      freeMargin: Number(r.freeMargin ?? r.free_margin ?? 0),
      marginLevel: r.marginLevel != null && r.marginLevel !== 'inf' ? Number(r.marginLevel) : null,
      bonus: Number(r.bonus ?? 0),
      realizedPnl: Number(r.realizedPnl ?? r.realized_pnl ?? 0),
      unrealizedPnl: Number(r.unrealizedPnl ?? r.unrealized_pnl ?? 0),
    }
  } catch (err) {
    onError?.(err)
    return defaultMetrics()
  }
}

interface MultiUserMetricsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function MultiUserMetricsModal({ open, onOpenChange }: MultiUserMetricsModalProps) {
  const [boxes, setBoxes] = useState<BoxState[]>([])
  const [marginThreshold, setMarginThreshold] = useState('30')
  const [blinkLevel, setBlinkLevel] = useState('100')
  const [visibleMetrics, setVisibleMetrics] = useState<Set<string>>(
    () => new Set(VISIBLE_METRICS_IDS as unknown as string[])
  )
  const [autoSort, setAutoSort] = useState(false)
  const [confirmAddOpen, setConfirmAddOpen] = useState(false)
  const [metricsSettingsOpen, setMetricsSettingsOpen] = useState(false)
  const [findLoading, setFindLoading] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected'>('connected')
  const [confirmAddCount, setConfirmAddCount] = useState(0)
  const [dropdownBoxId, setDropdownBoxId] = useState<string | null>(null)
  const [userSearch, setUserSearch] = useState('')
  const [users, setUsers] = useState<UserResponse[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [refreshLoading, setRefreshLoading] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const loadUsers = useCallback(async () => {
    setUsersLoading(true)
    try {
      const list = await listUsers({ limit: 200 })
      setUsers(list.items)
    } catch {
      setUsers([])
    } finally {
      setUsersLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open && users.length === 0) loadUsers()
  }, [open, users.length, loadUsers])

  const addBox = useCallback(() => {
    setBoxes((prev) => [
      ...prev,
      {
        id: `box-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        userId: null,
        userName: null,
        userEmail: null,
        metrics: null,
        loading: false,
      },
    ])
  }, [])

  const removeBox = useCallback((boxId: string) => {
    setBoxes((prev) => prev.filter((b) => b.id !== boxId))
    setDropdownBoxId((id) => (id === boxId ? null : id))
  }, [])

  const setBoxUser = useCallback((boxId: string, user: UserResponse | null) => {
    if (!user) {
      setBoxes((prev) =>
        prev.map((b) =>
          b.id === boxId
            ? {
                ...b,
                userId: null,
                userName: null,
                userEmail: null,
                metrics: null,
                loading: false,
              }
            : b
        )
      )
      setDropdownBoxId(null)
      return
    }
    setBoxes((prev) =>
      prev.map((b) =>
        b.id === boxId
          ? {
              ...b,
              userId: user.id,
              userName: `${user.first_name} ${user.last_name}`.trim() || user.email,
              userEmail: user.email,
              metrics: null,
              loading: true,
            }
          : b
      )
    )
    setDropdownBoxId(null)
    fetchUserMetrics(user.id, () => toast.error('Failed to load account summary')).then((metrics) => {
      setBoxes((prev) =>
        prev.map((b) =>
          b.id === boxId ? { ...b, metrics, loading: false } : b
        )
      )
    })
  }, [])

  const openDropdown = useCallback((boxId: string) => {
    setDropdownBoxId(boxId)
    setUserSearch('')
  }, [])

  const handleRefreshAll = useCallback(() => {
    const withUser = boxes.filter((b): b is BoxState & { userId: string } => b.userId != null)
    if (withUser.length === 0) return
    setRefreshLoading(true)
    setBoxes((prev) =>
      prev.map((b) => (b.userId ? { ...b, loading: true } : b))
    )
    let hadError = false
    Promise.all(
      withUser.map((box) =>
        fetchUserMetrics(box.userId, () => {
          hadError = true
        }).then((metrics) => ({ boxId: box.id, metrics }))
      )
    ).then((results) => {
      setBoxes((prev) =>
        prev.map((b) => {
          const r = results.find((x) => x.boxId === b.id)
          return r ? { ...b, metrics: r.metrics, loading: false } : b
        })
      )
      if (hadError) toast.error('Failed to refresh some metrics')
    }).finally(() => {
      setRefreshLoading(false)
      setBoxes((prev) =>
        prev.map((b) => (b.userId ? { ...b, loading: false } : b))
      )
    })
  }, [boxes])

  const openOnceRef = useRef(false)
  useEffect(() => {
    if (!open) {
      openOnceRef.current = false
      return
    }
    if (openOnceRef.current) return
    openOnceRef.current = true
    const withUser = boxes.filter((b): b is BoxState & { userId: string } => b.userId != null)
    withUser.forEach((box) => {
      fetchUserMetrics(box.userId).then((metrics) => {
        setBoxes((p) => p.map((b) => (b.id === box.id ? { ...b, metrics } : b)))
      })
    })
  }, [open, boxes])

  const filteredUsers = userSearch.trim()
    ? users.filter(
        (u) =>
          `${u.first_name} ${u.last_name}`.toLowerCase().includes(userSearch.toLowerCase()) ||
          u.email.toLowerCase().includes(userSearch.toLowerCase())
      )
    : users

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownBoxId(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleFindAndAdd = useCallback(async () => {
    const threshold = parseFloat(marginThreshold) || 30
    setFindLoading(true)
    try {
      const summaries = await Promise.all(
        users.slice(0, 50).map((u) => fetchUserMetrics(u.id).then((m) => ({ userId: u.id, metrics: m })))
      )
      const below = summaries.filter(
        (s) => s.metrics.marginLevel != null && s.metrics.marginLevel < threshold
      )
      setConfirmAddCount(below.length)
      setConfirmAddOpen(true)
    } catch {
      setConfirmAddCount(0)
      setConfirmAddOpen(true)
    } finally {
      setFindLoading(false)
    }
  }, [marginThreshold, users])

  const confirmAddUsers = useCallback(() => {
    const threshold = parseFloat(marginThreshold) || 30
    setFindLoading(true)
    Promise.all(
      users.slice(0, 50).map((u) =>
        fetchUserMetrics(u.id).then((m) => ({
          user: u,
          metrics: m,
        }))
      )
    ).then((results) => {
      const below = results.filter(
        (r) => r.metrics.marginLevel != null && r.metrics.marginLevel < threshold
      )
      setBoxes(
        below.map((r, i) => ({
          id: `box-${Date.now()}-${i}`,
          userId: r.user.id,
          userName: `${r.user.first_name} ${r.user.last_name}`.trim() || r.user.email,
          userEmail: r.user.email,
          metrics: r.metrics,
          loading: false,
        }))
      )
      setConfirmAddOpen(false)
      setFindLoading(false)
    })
  }, [marginThreshold, users])

  const activeCount = boxes.filter((b) => b.userId != null).length
  const blinkNum = parseFloat(blinkLevel) || 100

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
        <div
          className="bg-slate-900 border border-slate-700 rounded-lg w-full max-w-7xl max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="p-4 border-b border-slate-700">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center space-x-2 flex-shrink-0">
                <Activity className="w-5 h-5 text-blue-400" />
                <h2 className="text-lg font-bold text-white whitespace-nowrap">Monitor Users</h2>
              </div>
              <div className="flex items-center space-x-3 px-3 py-2 flex-1 min-w-0 flex-wrap">
                <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                <span className="text-xs text-slate-300 whitespace-nowrap">
                  Add users with margin level &lt;
                </span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  placeholder="30"
                  className="w-16 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-xs placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  value={marginThreshold}
                  onChange={(e) => setMarginThreshold(e.target.value)}
                />
                <span className="text-xs text-slate-300">%</span>
                <button
                  type="button"
                  onClick={handleFindAndAdd}
                  disabled={findLoading}
                  className="flex items-center space-x-1.5 px-3 py-1 bg-yellow-600 hover:bg-yellow-700 disabled:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-xs"
                >
                  {findLoading ? (
                    <>
                      <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Searching...</span>
                    </>
                  ) : (
                    <span>Find & Add Users</span>
                  )}
                </button>
                <div className="border-l border-slate-600 pl-3 flex items-center space-x-2">
                  <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse flex-shrink-0" />
                  <span className="text-xs text-slate-300 whitespace-nowrap">
                    Blink if margin level &lt;
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="100"
                    className="w-16 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-xs placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-red-500"
                    value={blinkLevel}
                    onChange={(e) => setBlinkLevel(e.target.value)}
                  />
                  <span className="text-xs text-slate-300">%</span>
                </div>
              </div>
              <div className="flex items-center space-x-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setMetricsSettingsOpen(true)}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors text-xs"
                >
                  <Settings className="w-3.5 h-3.5" />
                  <span>Metrics</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAutoSort((a) => !a)}
                  className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg transition-colors text-xs ${
                    autoSort
                      ? 'bg-green-600 hover:bg-green-700 text-white'
                      : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
                  }`}
                >
                  <ArrowUpDown className="w-3.5 h-3.5" />
                  <span>Auto Sort</span>
                </button>
                <button
                  type="button"
                  onClick={handleRefreshAll}
                  disabled={refreshLoading || activeCount === 0}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-slate-300 rounded-lg transition-colors text-xs"
                  title="Refresh metrics for all boxes"
                >
                  {refreshLoading ? (
                    <span className="w-3.5 h-3.5 border-2 border-slate-300 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  <span>Refresh</span>
                </button>
                <button
                  type="button"
                  onClick={addBox}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Box</span>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="p-1.5 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white"
                  title="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="scrollbar-modal flex-1 overflow-y-auto p-6">
            {boxes.length === 0 ? (
              <div className="flex flex-col items-center justify-center min-h-[400px]">
                <User className="w-16 h-16 text-slate-600 mb-4" />
                <p className="text-slate-400 text-lg mb-2">No metrics boxes</p>
                <p className="text-slate-500 text-sm mb-4">
                  Click &quot;Add Box&quot; to start monitoring users
                </p>
                <button
                  type="button"
                  onClick={addBox}
                  className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add First Box</span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {boxes.map((box) => {
                  const marginLevel = box.metrics?.marginLevel ?? null
                  const shouldBlink =
                    marginLevel != null && marginLevel < blinkNum
                  return (
                    <div
                      key={box.id}
                      className={`relative rounded-lg border-2 p-2 min-h-[140px] transition-all ${
                        shouldBlink
                          ? 'border-red-500 bg-red-900/30 animate-pulse'
                          : 'border-slate-700 bg-slate-800'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => removeBox(box.id)}
                        className="absolute top-1 right-1 z-20 p-0.5 rounded-full hover:bg-slate-700 text-slate-400 hover:text-white"
                        title="Remove box"
                      >
                        <X className="w-3 h-3" />
                      </button>
                      {!box.userId ? (
                        <div
                          className="flex flex-col items-center justify-center min-h-[120px] cursor-pointer hover:bg-slate-700/50 rounded-lg transition-colors border-2 border-dashed border-slate-600"
                          onClick={() => openDropdown(box.id)}
                          ref={dropdownBoxId === box.id ? dropdownRef : undefined}
                        >
                          <User className="w-6 h-6 text-slate-500 mb-1.5" />
                          <span className="text-slate-400 text-xs font-medium">Click to select user</span>
                          <span className="text-slate-500 text-[10px] mt-0.5">
                            Select a user to view metrics
                          </span>
                          {dropdownBoxId === box.id && (
                            <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-50 max-h-64 overflow-hidden flex flex-col">
                              <div className="p-2 border-b border-slate-700 relative">
                                <input
                                  type="text"
                                  placeholder="Search users..."
                                  className="w-full px-3 py-1.5 pr-8 bg-slate-700 border border-slate-600 rounded text-white text-xs placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                  value={userSearch}
                                  onChange={(e) => setUserSearch(e.target.value)}
                                />
                                <button
                                  type="button"
                                  onClick={() => setDropdownBoxId(null)}
                                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-slate-600 rounded text-slate-400 hover:text-white"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                              <div className="scrollbar-modal flex-1 overflow-y-auto py-1">
                                {usersLoading ? (
                                  <div className="flex flex-col items-center p-4">
                                    <span className="w-4 h-4 border-2 border-slate-600 border-t-blue-500 rounded-full animate-spin" />
                                    <span className="text-xs text-slate-400 mt-2">Loading users...</span>
                                  </div>
                                ) : filteredUsers.length === 0 ? (
                                  <p className="text-xs text-slate-400 p-4 text-center">No users found</p>
                                ) : (
                                  filteredUsers.map((u) => (
                                    <button
                                      key={u.id}
                                      type="button"
                                      onClick={() =>
                                        setBoxUser(box.id, u)
                                      }
                                      className="w-full px-3 py-2 text-left hover:bg-slate-700 flex items-center space-x-2"
                                    >
                                      <User className="w-4 h-4 text-slate-400 flex-shrink-0" />
                                      <div className="min-w-0">
                                        <p className="text-xs text-white font-medium truncate">
                                          {`${u.first_name} ${u.last_name}`.trim() || u.email}
                                        </p>
                                        <p className="text-[10px] text-slate-400 truncate">{u.email}</p>
                                      </div>
                                    </button>
                                  ))
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div ref={dropdownBoxId === box.id ? dropdownRef : undefined} className="relative">
                          <div className="border-b border-slate-700 pb-1.5 pr-6 flex items-center justify-between">
                            <div className="min-w-0">
                              <User className="w-3 h-3 text-blue-400 inline mr-1 align-middle" />
                              <p className="text-white font-semibold text-xs leading-tight truncate inline">
                                {box.userName}
                              </p>
                              <p className="text-slate-400 text-[10px] leading-tight truncate block">
                                {box.userEmail}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => openDropdown(box.id)}
                              className="text-[10px] text-blue-400 hover:text-blue-300 flex-shrink-0"
                            >
                              Change
                            </button>
                          </div>
                          {dropdownBoxId === box.id && (
                            <div className="absolute top-full right-0 mt-1 w-64 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-50 max-h-64 overflow-hidden flex flex-col">
                              <div className="p-2 border-b border-slate-700 relative">
                                <input
                                  type="text"
                                  placeholder="Search users..."
                                  className="w-full px-3 py-1.5 pr-8 bg-slate-700 border border-slate-600 rounded text-white text-xs placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                  value={userSearch}
                                  onChange={(e) => setUserSearch(e.target.value)}
                                />
                                <button
                                  type="button"
                                  onClick={() => setDropdownBoxId(null)}
                                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-slate-600 rounded text-slate-400 hover:text-white"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                              <div className="scrollbar-modal flex-1 overflow-y-auto py-1">
                                {filteredUsers.map((u) => (
                                  <button
                                    key={u.id}
                                    type="button"
                                    onClick={() => setBoxUser(box.id, u)}
                                    className="w-full px-3 py-2 text-left hover:bg-slate-700 flex items-center space-x-2"
                                  >
                                    <User className="w-4 h-4 text-slate-400 flex-shrink-0" />
                                    <div className="min-w-0">
                                      <p className="text-xs text-white font-medium truncate">
                                        {`${u.first_name} ${u.last_name}`.trim() || u.email}
                                      </p>
                                      <p className="text-[10px] text-slate-400 truncate">{u.email}</p>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="grid grid-cols-2 gap-1.5 mt-1.5">
                            {box.loading && !box.metrics ? (
                              <div className="col-span-2 flex flex-col items-center py-4">
                                <span className="w-3 h-3 border-2 border-slate-600 border-t-blue-500 rounded-full animate-spin" />
                                <span className="text-xs text-slate-400 mt-1">Loading...</span>
                              </div>
                            ) : !box.metrics ? (
                              <p className="col-span-2 text-slate-500 text-xs py-4 text-center">
                                No metrics available
                              </p>
                            ) : (
                              (VISIBLE_METRICS_IDS as unknown as string[])
                                .filter((id) => visibleMetrics.has(id))
                                .map((id) => {
                                  const m = box.metrics!
                                  let value: string
                                  let valueClass = 'text-xs font-semibold text-white leading-tight'
                                  if (id === 'balance') {
                                    value = `$${m.balance.toFixed(2)}`
                                  } else if (id === 'equity') {
                                    value = `$${m.equity.toFixed(2)}`
                                  } else if (id === 'margin') {
                                    value = `$${m.margin.toFixed(2)}`
                                  } else if (id === 'freeMargin') {
                                    value = `$${m.freeMargin.toFixed(2)}`
                                    valueClass =
                                      m.freeMargin < 0
                                        ? 'text-xs font-semibold text-red-400 leading-tight'
                                        : 'text-xs font-semibold text-green-400 leading-tight'
                                  } else if (id === 'marginLevel') {
                                    value =
                                      m.marginLevel != null ? `${m.marginLevel.toFixed(2)}%` : 'N/A'
                                    if (m.marginLevel != null) {
                                      if (m.marginLevel < 100)
                                        valueClass = 'text-xs font-semibold text-red-400 leading-tight'
                                      else if (m.marginLevel < 200)
                                        valueClass = 'text-xs font-semibold text-yellow-400 leading-tight'
                                      else valueClass = 'text-xs font-semibold text-green-400 leading-tight'
                                    }
                                  } else if (id === 'bonus') {
                                    value = `$${m.bonus.toFixed(2)}`
                                  } else if (id === 'realizedPnl') {
                                    value = `$${m.realizedPnl.toFixed(2)}`
                                    valueClass =
                                      m.realizedPnl >= 0
                                        ? 'text-xs font-semibold text-green-400 leading-tight'
                                        : 'text-xs font-semibold text-red-400 leading-tight'
                                  } else {
                                    value = `$${m.unrealizedPnl.toFixed(2)}`
                                    valueClass =
                                      m.unrealizedPnl >= 0
                                        ? 'text-xs font-semibold text-green-400 leading-tight'
                                        : 'text-xs font-semibold text-red-400 leading-tight'
                                  }
                                  return (
                                    <div
                                      key={id}
                                      className="bg-slate-900/50 rounded p-1.5"
                                    >
                                      <p className="text-[10px] text-slate-400 mb-0.5">
                                        {VISIBLE_METRICS_LABELS[id as keyof typeof VISIBLE_METRICS_LABELS]}
                                      </p>
                                      <p className={valueClass}>{value}</p>
                                    </div>
                                  )
                                })
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-slate-700 p-4 bg-slate-800/50 flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${
                  connectionStatus === 'connected'
                    ? 'bg-green-400 animate-pulse'
                    : 'bg-red-400'
                }`}
              />
              <span
                className={
                  connectionStatus === 'connected' ? 'text-green-400' : 'text-red-400'
                }
              >
                {connectionStatus === 'connected' ? 'Connected' : 'Disconnected'}
              </span>
              <span className="text-slate-400">
                {activeCount} of {boxes.length} boxes active
              </span>
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      {/* Confirm Add Users */}
      {confirmAddOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
          <div
            className="bg-slate-800 rounded-lg border border-slate-700 p-6 max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center space-x-3 mb-4">
              <AlertTriangle className="w-6 h-6 text-yellow-400 flex-shrink-0" />
              <h3 className="text-lg font-semibold text-white">Confirm Add Users</h3>
            </div>
            <p className="text-sm text-slate-300 mb-1">
              Found <span className="font-bold text-yellow-400">{confirmAddCount}</span> users with
              margin level less than{' '}
              <span className="font-bold text-yellow-400">{marginThreshold}%</span>
            </p>
            <p className="text-xs text-slate-400 mb-6">
              This will replace all existing boxes with the matching users.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setConfirmAddOpen(false)}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmAddUsers}
                className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg"
              >
                Add {confirmAddCount} Users
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Visible Metrics settings */}
      {metricsSettingsOpen && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4"
          onClick={() => setMetricsSettingsOpen(false)}
        >
          <div
            className="bg-slate-800 rounded-lg border border-slate-700 p-6 max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <Settings className="w-5 h-5 text-blue-400" />
                <h3 className="text-lg font-semibold text-white">Visible Metrics</h3>
              </div>
              <button
                type="button"
                onClick={() => setMetricsSettingsOpen(false)}
                className="p-1 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-slate-400 mb-4">
              Select which metrics to display in the metrics boxes
            </p>
            <div className="scrollbar-modal max-h-96 space-y-2 overflow-y-auto">
              {(VISIBLE_METRICS_IDS as unknown as string[]).map((id) => {
                const selected = visibleMetrics.has(id)
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setVisibleMetrics((prev) => {
                        const next = new Set(prev)
                        if (selected) next.delete(id)
                        else next.add(id)
                        return next
                      })
                    }}
                    className={`flex items-center space-x-3 p-3 rounded-lg border cursor-pointer hover:bg-slate-700/50 w-full text-left ${
                      selected
                        ? 'border-blue-500 bg-blue-500/10'
                        : 'border-slate-600 bg-transparent'
                    }`}
                  >
                    {selected ? (
                      <CheckSquare className="w-5 h-5 text-blue-400 flex-shrink-0" />
                    ) : (
                      <Square className="w-5 h-5 text-slate-400 flex-shrink-0" />
                    )}
                    <span className="text-sm text-white font-medium">
                      {VISIBLE_METRICS_LABELS[id as keyof typeof VISIBLE_METRICS_LABELS]}
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="flex justify-end space-x-3 mt-6 pt-4 border-t border-slate-700">
              <button
                type="button"
                onClick={() =>
                  setVisibleMetrics(new Set(VISIBLE_METRICS_IDS as unknown as string[]))
                }
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm"
              >
                Reset to Default
              </button>
              <button
                type="button"
                onClick={() => setMetricsSettingsOpen(false)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
