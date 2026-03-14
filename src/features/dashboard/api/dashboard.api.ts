/**
 * Dashboard data using existing APIs. No dedicated backend dashboard endpoint.
 * All of these endpoints are scoped on the backend: super_admin sees all data;
 * other admins/managers see only users they have access to (same scope as Admin Users,
 * Finance, and Trading pages).
 */
import { listUsers } from '@/shared/api/users.api'
import { fetchFinanceOverview } from '@/features/adminFinance/api/finance.api'
import { fetchTransactions } from '@/features/adminFinance/api/finance.api'
import { fetchAdminPositions } from '@/features/adminTrading/api/positions'

export const DASHBOARD_QUERY_KEYS = {
  users: ['dashboard', 'users'] as const,
  finance: ['dashboard', 'finance'] as const,
  transactions: ['dashboard', 'transactions'] as const,
  positions: ['dashboard', 'positions'] as const,
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
