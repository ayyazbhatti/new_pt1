import { useState, useCallback, useEffect } from 'react'
import { toast } from 'react-hot-toast'
import { DepositRequest } from '../types'
import { approveDepositRequest, fetchPendingDeposits } from '../api'
import { DepositRequestRow } from './DepositRequestRow'
import { useWebSocketSubscription } from '@/shared/ws/wsHooks'
import { wsClient } from '@/shared/ws/wsClient'
import { WsInboundEvent } from '@/shared/ws/wsEvents'
import { useNotificationsStore } from '@/shared/store/notificationsStore'
import { useAuthStore } from '@/shared/store/auth.store'
import { Loader2 } from 'lucide-react'

export function DepositRequestsPanel() {
  const [requests, setRequests] = useState<DepositRequest[]>([])
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const { push: pushNotification } = useNotificationsStore()
  const { user } = useAuthStore()

  // Load initial pending deposits on mount
  useEffect(() => {
    const loadDeposits = async () => {
      setIsLoading(true)
      try {
        const pendingDeposits = await fetchPendingDeposits()
        setRequests(pendingDeposits)
      } catch (error: any) {
        // Gracefully handle 404 - endpoint not implemented yet
        if (error?.response?.status === 404) {
          console.warn('Deposits endpoint not available yet (404). Backend implementation pending.')
          // Initialize with empty state - requests will come via WebSocket
          setRequests([])
        } else {
          console.error('Failed to load deposits:', error)
          toast.error(
            error?.response?.data?.error?.message ||
              'Failed to load deposit requests',
            { duration: 5000 }
          )
        }
      } finally {
        setIsLoading(false)
      }
    }

    loadDeposits()
  }, [])

  // Subscribe to WebSocket events
  useWebSocketSubscription(
    useCallback(
      (event: WsInboundEvent) => {
        if (event.type === 'deposit.request.created') {
          const { payload } = event
          const newRequest: DepositRequest = {
            requestId: payload.requestId,
            userId: payload.userId,
            amount: payload.amount,
            currency: payload.currency,
            note: payload.note,
            status: 'PENDING',
            createdAt: payload.createdAt,
          }

          setRequests((prev) => {
            // Check if request already exists (avoid duplicates)
            const exists = prev.some((r) => r.requestId === payload.requestId)
            if (exists) return prev
            return [newRequest, ...prev]
          })

          // Push notification
          pushNotification({
            id: crypto.randomUUID(),
            kind: 'DEPOSIT_REQUEST',
            title: 'New Deposit Request',
            message: `User ${payload.userId.slice(0, 8)}... requested $${payload.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            createdAt: payload.createdAt,
            read: false,
            meta: {
              requestId: payload.requestId,
              userId: payload.userId,
              amount: payload.amount,
            },
          })

          toast(`New deposit request received (ID: ${payload.requestId.slice(0, 8)}...)`, {
            icon: '💰',
            duration: 5000,
          })
        } else if (event.type === 'deposit.request.approved') {
          const { payload } = event
          // Update request status when approved
          setRequests((prev) =>
            prev.map((r) =>
              r.requestId === payload.requestId
                ? {
                    ...r,
                    status: 'APPROVED' as const,
                    approvedAt: payload.approvedAt,
                  }
                : r
            )
          )
        }
      },
      [pushNotification]
    )
  )

  const handleApprove = useCallback(
    async (requestId: string) => {
      const request = requests.find((r) => r.requestId === requestId)
      if (!request) {
        toast.error('Request not found')
        return
      }

      setApprovingId(requestId)

      try {
        // Call backend API - server will handle WebSocket broadcasting
        await approveDepositRequest(requestId)

        // Don't update state manually - wait for deposit.request.approved event
        // The WebSocket subscription above will handle the update
        toast.success(
          `Deposit request approved (ID: ${requestId.slice(0, 8)}...)`,
          { duration: 5000 }
        )
      } catch (error: any) {
        const errorMessage =
          error?.response?.data?.error?.message ||
          error?.message ||
          'Failed to approve deposit request'
        toast.error(errorMessage, { duration: 5000 })
      } finally {
        setApprovingId(null)
      }
    },
    [requests]
  )

  const pendingCount = requests.filter((r) => r.status === 'PENDING').length
  const approvedToday = requests.filter(
    (r) =>
      r.status === 'APPROVED' &&
      r.approvedAt &&
      new Date(r.approvedAt).toDateString() === new Date().toDateString()
  ).length

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
        <span className="ml-3 text-text-muted">Loading deposit requests...</span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-border bg-surface-2/50 p-4">
          <div className="text-sm text-text-muted mb-1">Pending Requests</div>
          <div className="text-2xl font-bold text-text">{pendingCount}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface-2/50 p-4">
          <div className="text-sm text-text-muted mb-1">Approved Today</div>
          <div className="text-2xl font-bold text-success">{approvedToday}</div>
        </div>
      </div>

      {/* Table */}
      {requests.length === 0 ? (
        <div className="text-center py-12 text-text-muted">
          <p className="text-sm">No deposit requests yet</p>
          <p className="text-xs mt-1">Requests will appear here in real-time</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-surface-1 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-surface-2 border-b border-border">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
                    User ID
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
                    Amount
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
                    Note
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
                    Created At
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <DepositRequestRow
                    key={request.requestId}
                    request={request}
                    onApprove={handleApprove}
                    isApproving={approvingId === request.requestId}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
