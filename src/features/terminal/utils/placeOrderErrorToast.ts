import { formatTimeUntil } from './sessionCountdown'

type ToastModule = { error: (msg: string, opts?: { duration?: number }) => void }

const DURATION_MS = 5000

function readPlaceOrderErrorPayload(err: unknown): Record<string, unknown> | null {
  const data = (err as { response?: { data?: unknown } })?.response?.data
  if (!data || typeof data !== 'object') return null
  const inner = (data as { error?: unknown }).error
  if (!inner || typeof inner !== 'object' || Array.isArray(inner)) return null
  return inner as Record<string, unknown>
}

/**
 * Shows specific toasts for session / symbol trading `OrderForbidden` codes.
 * @returns true when a known code was handled (caller should skip generic error toast).
 */
export function tryToastPlaceOrderForbiddenError(
  err: unknown,
  toast: ToastModule,
  nowMs: number = Date.now()
): boolean {
  const o = readPlaceOrderErrorPayload(err)
  if (!o) return false

  const code = typeof o.code === 'string' ? o.code : null
  if (!code) return false

  const nextOpenAt = typeof o.nextOpenAt === 'string' ? o.nextOpenAt : null
  const timezone = typeof o.timezone === 'string' ? o.timezone : undefined

  if (code === 'MARKET_CLOSED') {
    const until = formatTimeUntil(nextOpenAt, timezone, nowMs)
    const suffix =
      nextOpenAt && until
        ? until === 'now'
          ? 'Opens now.'
          : `Opens in ${until}.`
        : 'No upcoming session.'
    toast.error(`Market is closed. ${suffix}`, { duration: DURATION_MS })
    return true
  }

  if (code === 'TRADING_DISABLED') {
    toast.error(
      'Trading is disabled for this symbol. Contact support if you believe this is an error.',
      { duration: DURATION_MS }
    )
    return true
  }

  if (code === 'CLOSE_ONLY') {
    toast.error(
      'This symbol is in close-only mode. You can only reduce existing positions, not open new ones.',
      { duration: DURATION_MS }
    )
    return true
  }

  if (code === 'NEW_ORDERS_DISABLED') {
    toast.error(
      'New positions on this symbol are temporarily disabled. Existing positions can still be closed.',
      { duration: DURATION_MS }
    )
    return true
  }

  return false
}
