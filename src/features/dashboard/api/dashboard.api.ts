/**
 * Dashboard data using existing APIs. No dedicated backend dashboard endpoint.
 * All of these endpoints are scoped on the backend: super_admin sees all data;
 * other admins/managers see only users they have access to (same scope as Admin Users,
 * Finance, and Trading pages).
 */
import { listUsers } from '@/shared/api/users.api'
import {
  fetchFinanceOverview,
  fetchTransactions,
  type Transaction,
} from '@/features/adminFinance/api/finance.api'
import { fetchAdminPositions } from '@/features/adminTrading/api/positions'

/** Series point for deposit/withdrawal flow chart (YYYY-MM-DD). */
export interface DailyFlow {
  date: string
  deposits: number
  withdrawals: number
}

/** Series point for net fees chart (YYYY-MM-DD). */
export interface DailyFee {
  date: string
  fees: number
}

export const DASHBOARD_QUERY_KEYS = {
  users: ['dashboard', 'users'] as const,
  finance: ['dashboard', 'finance'] as const,
  transactions: ['dashboard', 'transactions'] as const,
  positions: ['dashboard', 'positions'] as const,
  chartTransactions: (daysBack: number) => ['dashboard', 'chart-transactions', daysBack] as const,
}

function formatYmdLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Loads transactions in [today - (daysBack-1), today] (local calendar dates), for chart aggregation.
 * Paginates at pageSize 100 (backend max per request).
 */
export async function fetchDashboardTransactionsForCharts(daysBack: number = 30): Promise<Transaction[]> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = new Date(today)
  start.setDate(start.getDate() - (daysBack - 1))

  const dateFrom = formatYmdLocal(start)
  const dateTo = formatYmdLocal(today)

  const pageSize = 100
  const all: Transaction[] = []
  let page = 1
  for (;;) {
    const { items, total } = await fetchTransactions({
      dateFrom,
      dateTo,
      page,
      pageSize,
    })
    all.push(...items)
    if (items.length < pageSize || all.length >= total) break
    page += 1
    if (page > 500) break
  }
  return all
}

/** First page of users: total count + recent items (for stats and recent registrations). */
export async function fetchDashboardUsers() {
  return listUsers({ page: 1, page_size: 5 })
}

export async function fetchDashboardFinance() {
  return fetchFinanceOverview()
}

/** Recent transactions for "Recent activity" table. */
export async function fetchDashboardRecentTransactions() {
  return fetchTransactions({ page: 1, pageSize: 10 })
}

/** Open positions count for "Active Trades" stat. */
export async function fetchDashboardPositions() {
  return fetchAdminPositions({ limit: 1 })
}
