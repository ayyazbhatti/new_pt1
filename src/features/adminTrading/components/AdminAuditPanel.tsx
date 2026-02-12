import { useEffect, useMemo } from 'react'
import { useAdminTradingStore } from '../store/adminTrading.store'
import { fetchAdminAudit } from '../api/audit'
import { format } from 'date-fns'
import { Skeleton } from '@/shared/ui/loading'

export function AdminAuditPanel() {
  const { auditLogs, auditLoading, setAuditLogs, setAuditLoading } = useAdminTradingStore()

  useEffect(() => {
    setAuditLoading(true)
    fetchAdminAudit({ limit: 100 })
      .then((response) => {
        setAuditLogs(response.items, response.cursor, response.hasMore)
      })
      .catch((error) => {
        console.error('Failed to fetch audit logs:', error)
      })
      .finally(() => {
        setAuditLoading(false)
      })
  }, [setAuditLogs, setAuditLoading])

  const sortedLogs = useMemo(() => {
    return [...auditLogs].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  }, [auditLogs])

  if (auditLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  }

  if (sortedLogs.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-text-muted">
        <p>No audit logs found</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="bg-surface-2 border-b border-border">
        <table className="w-full">
          <thead>
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
                Time
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
                Admin
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
                Action
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
                Target
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
                Details
              </th>
            </tr>
          </thead>
        </table>
      </div>
      <div className="max-h-[600px] overflow-y-auto">
        <table className="w-full">
          <tbody>
            {sortedLogs.map((log) => (
              <tr key={log.id} className="border-b border-border hover:bg-surface-2/50">
                <td className="px-4 py-3 text-sm text-text-muted">
                  {format(new Date(log.timestamp), 'PPpp')}
                </td>
                <td className="px-4 py-3 text-sm text-text">{log.adminEmail}</td>
                <td className="px-4 py-3 text-sm text-text">{log.action}</td>
                <td className="px-4 py-3 text-sm font-mono text-text">{log.targetId.slice(0, 8)}...</td>
                <td className="px-4 py-3 text-sm text-text-muted">
                  {log.details ? JSON.stringify(log.details) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

