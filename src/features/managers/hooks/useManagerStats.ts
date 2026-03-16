import { useQueries, useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/shared/store/auth.store'
import { listUsers } from '@/shared/api/users.api'
import { listGroups } from '@/features/groups/api/groups.api'
import { fetchFinanceOverview, fetchTransactions } from '@/features/adminFinance/api/finance.api'
import { fetchAdminPositions } from '@/features/adminTrading/api/positions'
import { fetchAdminOrders } from '@/features/adminTrading/api/orders'
import { listLeads } from '@/features/adminLeads/api/leads.api'
import {
  getManager,
  listManagers,
  fetchManagerStatistics,
  type Manager,
  type ManagerStatisticsResponse,
} from '../api/managers.api'
import type { Transaction } from '@/features/adminFinance/api/finance.api'
import type { AdminPosition, AdminOrder } from '@/features/adminTrading/types'

const MANAGER_STATS_QUERY_KEY = ['manager-stats'] as const

export interface ManagerStats {
  manager: Manager | null
  /** True when viewing another manager (super_admin) and dedicated stats endpoint is not available */
  isOtherManagerUnsupported: boolean
  overview: {
    totalUsers: number
    totalGroups: number
    activeUsers: number
    assignedLeads: number
  }
  deposits: {
    totalCount: number
    totalVolume: number
    todayCount: number
    todayVolume: number
    pendingCount: number
  }
  withdrawals: {
    totalCount: number
    totalVolume: number
    todayCount: number
    todayVolume: number
    pendingCount: number
  }
  positions: {
    openCount: number
    totalExposure: number
    closedToday: number
    livePnl: number
    items: Array<{
      id: string
      symbol: string
      side: string
      size: number
      entry: number
      mark: number
      livePnl: number
      user: string
    }>
  }
  orders: {
    activeCount: number
    filledToday: number
    cancelledToday: number
    items: Array<{ id: string; user: string; symbol: string; side: string; type: string; status: string }>
  }
  recentDeposits: Array<{ id: string; user: string; amount: number; currency: string; status: string; time: string }>
  recentWithdrawals: Array<{ id: string; user: string; amount: number; currency: string; status: string; time: string }>
  topTraders: Array<{ rank: number; user: string; pnl: number; winRate: number; volume: number }>
  topLosers: Array<{ rank: number; user: string; pnl: number; winRate: number; volume: number }>
}

function formatRelativeTime(iso: string): string {
  try {
    const date = new Date(iso)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)
    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins} min ago`
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`
    if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`
    return date.toLocaleDateString()
  } catch {
    return iso
  }
}

function txToRecent(
  tx: Transaction
): { id: string; user: string; amount: number; currency: string; status: string; time: string } {
  const name = [tx.userFirstName, tx.userLastName].filter(Boolean).join(' ') || tx.userEmail
  return {
    id: tx.id,
    user: name || tx.userEmail,
    amount: Math.abs(tx.netAmount ?? tx.amount ?? 0),
    currency: tx.currency ?? 'USD',
    status: tx.status,
    time: formatRelativeTime(tx.createdAt),
  }
}

function buildStatsFromApis(
  usersTotal: number,
  groupsTotal: number,
  usersActive: number,
  leadsTotal: number,
  overview: Awaited<ReturnType<typeof fetchFinanceOverview>>,
  transactions: Transaction[],
  positions: AdminPosition[],
  orders: AdminOrder[]
): Omit<ManagerStats, 'manager' | 'isOtherManagerUnsupported'> {
  const deposits = transactions.filter((t) => t.type === 'deposit')
  const withdrawals = transactions.filter((t) => t.type === 'withdrawal')
  const depositVolume = deposits.reduce((s, t) => s + Math.abs(t.netAmount ?? t.amount ?? 0), 0)
  const withdrawalVolume = withdrawals.reduce((s, t) => s + Math.abs(t.netAmount ?? t.amount ?? 0), 0)

  const openPositions = positions.filter((p) => p.status === 'OPEN' || p.status === 'open')
  const totalExposure = openPositions.reduce((s, p) => s + p.size * p.markPrice, 0)
  const livePnl = openPositions.reduce((s, p) => s + (p.pnl ?? 0), 0)
  const today = new Date().toDateString()
  const closedToday = positions.filter((p) => {
    const closed = p.closedAt ?? (p as any).closed_at
    return closed && new Date(closed).toDateString() === today
  }).length

  const activeOrders = orders.filter((o) => o.status === 'pending' || o.status === 'PENDING' || o.status === 'open')
  const filledToday = orders.filter((o) => {
    const filled = o.filledAt ?? (o as any).filled_at
    return filled && new Date(filled).toDateString() === today
  }).length
  const cancelledToday = orders.filter((o) => {
    const cancelled = o.cancelledAt ?? (o as any).cancelled_at
    return cancelled && new Date(cancelled).toDateString() === today
  }).length

  const positionItems = openPositions.slice(0, 10).map((p) => ({
    id: p.id,
    symbol: p.symbol,
    side: p.side ?? '',
    size: p.size,
    entry: p.entryPrice,
    mark: p.markPrice,
    livePnl: p.pnl ?? 0,
    user: p.userEmail ?? p.userName ?? p.userId,
  }))

  const orderItems = orders.slice(0, 10).map((o) => ({
    id: o.id,
    user: o.userEmail ?? o.userName ?? o.userId,
    symbol: o.symbol,
    side: o.side ?? '',
    type: (o.orderType ?? (o as any).type ?? 'Market').replace('_', ' '),
    status: o.status,
  }))

  const recentDepositsList = deposits.slice(0, 10).map(txToRecent)
  const recentWithdrawalsList = withdrawals.slice(0, 10).map(txToRecent)

  // Top traders / losers: aggregate by user from positions (realized we don't have per-user PnL from positions alone; use open position PnL as proxy or leave placeholder)
  const pnlByUser = new Map<string, { pnl: number; volume: number }>()
  for (const p of openPositions) {
    const u = p.userEmail ?? p.userName ?? p.userId
    const cur = pnlByUser.get(u) ?? { pnl: 0, volume: 0 }
    cur.pnl += p.pnl ?? 0
    cur.volume += p.size * p.entryPrice
    pnlByUser.set(u, cur)
  }
  const byPnl = [...pnlByUser.entries()]
    .map(([user, data]) => ({ user, pnl: data.pnl, volume: data.volume }))
    .sort((a, b) => b.pnl - a.pnl)
  const topTraders = byPnl.filter((x) => x.pnl > 0).slice(0, 5).map((x, i) => ({ rank: i + 1, user: x.user, pnl: x.pnl, winRate: 0, volume: x.volume }))
  const topLosers = byPnl.filter((x) => x.pnl < 0).slice(0, 5).map((x, i) => ({ rank: i + 1, user: x.user, pnl: x.pnl, winRate: 0, volume: x.volume }))

  return {
    overview: {
      totalUsers: usersTotal,
      totalGroups: groupsTotal,
      activeUsers: usersActive,
      assignedLeads: leadsTotal,
    },
    deposits: {
      totalCount: deposits.length,
      totalVolume: depositVolume,
      todayCount: overview.depositsToday?.count ?? 0,
      todayVolume: overview.depositsToday?.amount ?? 0,
      pendingCount: overview.pendingDeposits ?? 0,
    },
    withdrawals: {
      totalCount: withdrawals.length,
      totalVolume: withdrawalVolume,
      todayCount: overview.withdrawalsToday?.count ?? 0,
      todayVolume: overview.withdrawalsToday?.amount ?? 0,
      pendingCount: overview.pendingWithdrawals ?? 0,
    },
    positions: {
      openCount: openPositions.length,
      totalExposure,
      closedToday,
      livePnl,
      items: positionItems,
    },
    orders: {
      activeCount: activeOrders.length,
      filledToday,
      cancelledToday,
      items: orderItems,
    },
    recentDeposits: recentDepositsList,
    recentWithdrawals: recentWithdrawalsList,
    topTraders,
    topLosers,
  }
}

function mapApiStatsToStats(r: ManagerStatisticsResponse): Omit<ManagerStats, 'manager' | 'isOtherManagerUnsupported'> {
  return {
    overview: r.overview ?? { totalUsers: 0, totalGroups: 0, activeUsers: 0, assignedLeads: 0 },
    deposits: r.deposits ?? { totalCount: 0, totalVolume: 0, todayCount: 0, todayVolume: 0, pendingCount: 0 },
    withdrawals: r.withdrawals ?? { totalCount: 0, totalVolume: 0, todayCount: 0, todayVolume: 0, pendingCount: 0 },
    positions: {
      openCount: r.positions?.openCount ?? 0,
      totalExposure: r.positions?.totalExposure ?? 0,
      closedToday: r.positions?.closedToday ?? 0,
      livePnl: r.positions?.livePnl ?? 0,
      items: r.openPositions ?? [],
    },
    orders: {
      activeCount: r.orders?.activeCount ?? 0,
      filledToday: r.orders?.filledToday ?? 0,
      cancelledToday: r.orders?.cancelledToday ?? 0,
      items: r.recentOrders ?? [],
    },
    recentDeposits: r.recentDeposits ?? [],
    recentWithdrawals: r.recentWithdrawals ?? [],
    topTraders: r.topTraders ?? [],
    topLosers: r.topLosers ?? [],
  }
}

const EMPTY_STATS: Omit<ManagerStats, 'manager' | 'isOtherManagerUnsupported'> = {
  overview: { totalUsers: 0, totalGroups: 0, activeUsers: 0, assignedLeads: 0 },
  deposits: { totalCount: 0, totalVolume: 0, todayCount: 0, todayVolume: 0, pendingCount: 0 },
  withdrawals: { totalCount: 0, totalVolume: 0, todayCount: 0, todayVolume: 0, pendingCount: 0 },
  positions: { openCount: 0, totalExposure: 0, closedToday: 0, livePnl: 0, items: [] },
  orders: { activeCount: 0, filledToday: 0, cancelledToday: 0, items: [] },
  recentDeposits: [],
  recentWithdrawals: [],
  topTraders: [],
  topLosers: [],
}

export function useManagerStats(managerId: string | undefined) {
  const currentUser = useAuthStore((s) => s.user)
  const isSuperAdmin = currentUser?.role?.toLowerCase() === 'super_admin'

  const managerQuery = useQuery({
    queryKey: [...MANAGER_STATS_QUERY_KEY, 'manager', managerId],
    queryFn: async () => {
      const m = await getManager(managerId!)
      if (m) return m
      const list = await listManagers()
      return list.find((x) => x.id === managerId) ?? null
    },
    enabled: !!managerId,
  })

  const manager = managerQuery.data ?? null
  const managerUserId = manager?.userId
  const isViewingSelf = !!managerId && !!currentUser && managerUserId === currentUser.id

  const otherManagerStatsQuery = useQuery({
    queryKey: [...MANAGER_STATS_QUERY_KEY, 'other-stats', managerId],
    queryFn: () => fetchManagerStatistics(managerId!),
    enabled: !!managerId && !!manager && !isViewingSelf && isSuperAdmin,
  })

  const selfQueries = useQueries({
    queries: [
      {
        queryKey: ['users', { page: 1, page_size: 1 }],
        queryFn: () => listUsers({ page: 1, page_size: 1 }),
        enabled: isViewingSelf,
      },
      {
        queryKey: ['groups', { page: 1, page_size: 1 }],
        queryFn: () => listGroups({ page: 1, page_size: 1 }),
        enabled: isViewingSelf,
      },
      {
        queryKey: ['users-active-count'],
        queryFn: () => listUsers({ page: 1, page_size: 1, status: 'active' }),
        enabled: isViewingSelf,
      },
      {
        queryKey: ['leads', managerUserId],
        queryFn: () => listLeads({ owner_id: managerUserId!, page: 1, page_size: 1 }),
        enabled: isViewingSelf && !!managerUserId,
      },
      {
        queryKey: ['finance-overview'],
        queryFn: fetchFinanceOverview,
        enabled: isViewingSelf,
      },
      {
        queryKey: ['finance-transactions'],
        queryFn: () => fetchTransactions({ pageSize: 500 }),
        enabled: isViewingSelf,
      },
      {
        queryKey: ['positions'],
        queryFn: () => fetchAdminPositions({ limit: 200 }),
        enabled: isViewingSelf,
      },
      {
        queryKey: ['orders'],
        queryFn: () => fetchAdminOrders({ limit: 200 }),
        enabled: isViewingSelf,
      },
    ],
  })

  const [
    usersRes,
    groupsRes,
    usersActiveCountRes,
    leadsRes,
    overviewRes,
    transactionsRes,
    positionsRes,
    ordersRes,
  ] = selfQueries

  const isLoadingManager = managerQuery.isLoading
  const managerError = managerQuery.error
  const isLoadingSelf =
    isViewingSelf &&
    selfQueries.some((q) => q.isLoading)
  const selfDataReady =
    !isViewingSelf ||
    (usersRes?.isSuccess &&
      groupsRes?.isSuccess &&
      overviewRes?.isSuccess &&
      transactionsRes?.isSuccess &&
      positionsRes?.isSuccess &&
      ordersRes?.isSuccess)

  let stats: ManagerStats | null = null
  let isOtherManagerUnsupported = false

  if (managerQuery.data === null && managerQuery.isSuccess) {
    stats = null
  } else if (isViewingSelf && selfDataReady) {
    const usersTotal = usersRes?.data?.total ?? 0
    const groupsTotal = groupsRes?.data?.total ?? 0
    const usersActive = usersActiveCountRes?.data?.total ?? 0
    const leadsTotal = leadsRes?.data?.total ?? 0
    const overview = overviewRes?.data
    const transactions = transactionsRes?.data ?? []
    const positions = (positionsRes?.data?.items ?? []) as AdminPosition[]
    const orders = (ordersRes?.data?.items ?? []) as AdminOrder[]

    if (overview) {
      const built = buildStatsFromApis(
        usersTotal,
        groupsTotal,
        usersActive,
        leadsTotal,
        overview,
        transactions,
        positions,
        orders
      )
      stats = { manager: manager!, isOtherManagerUnsupported: false, ...built }
    } else {
      stats = { manager: manager!, isOtherManagerUnsupported: false, ...EMPTY_STATS }
    }
  } else if (manager && !isViewingSelf && isSuperAdmin) {
    if (otherManagerStatsQuery.isLoading) {
      stats = null
    } else if (otherManagerStatsQuery.isSuccess) {
      const apiStats = otherManagerStatsQuery.data
      if (apiStats) {
        stats = { manager, isOtherManagerUnsupported: false, ...mapApiStatsToStats(apiStats) }
      } else {
        isOtherManagerUnsupported = true
        stats = { manager, isOtherManagerUnsupported: true, ...EMPTY_STATS }
      }
    } else {
      stats = null
    }
  } else if (manager && !isViewingSelf && !isSuperAdmin) {
    isOtherManagerUnsupported = true
    stats = { manager, isOtherManagerUnsupported: true, ...EMPTY_STATS }
  }

  const isLoadingOther = !!manager && !isViewingSelf && isSuperAdmin && otherManagerStatsQuery.isLoading

  return {
    manager: manager ?? null,
    stats,
    isLoading: isLoadingManager || (isViewingSelf && isLoadingSelf) || isLoadingOther,
    error: managerError,
    isViewingSelf,
    isOtherManagerUnsupported,
  }
}
