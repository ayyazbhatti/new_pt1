/**
 * Captures and formats PerformanceResourceTiming for fetch requests
 * that occur during an async operation (e.g. API call + token refresh).
 */

export interface RequestTimingBreakdown {
  url: string
  label: string
  totalMs: number
  dnsMs: number
  connectMs: number
  ttfbMs: number // Time to first byte (server processing + network)
  downloadMs: number
}

export interface TimingSummary {
  totalMs: number
  requests: RequestTimingBreakdown[]
}

function formatMs(ms: number): string {
  if (ms < 1) return '<1ms'
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms)}ms`
}

function getRequestLabel(url: string): string {
  if (url.includes('/deposits/request')) return 'Deposit API'
  if (url.includes('/withdrawals/request')) return 'Withdrawal API'
  if (url.includes('/auth/refresh')) return 'Token refresh'
  try {
    const path = new URL(url).pathname
    return path || 'API'
  } catch {
    return 'Request'
  }
}

function parseResourceTiming(entry: PerformanceResourceTiming): RequestTimingBreakdown | null {
  const totalMs = entry.duration

  // DNS lookup (0 if cached)
  const dnsMs = entry.domainLookupEnd > 0 ? entry.domainLookupEnd - entry.domainLookupStart : 0

  // TCP + TLS connection
  const connectMs = entry.connectEnd > 0 ? entry.connectEnd - entry.connectStart : 0

  // Time to first byte (request sent → first byte received) = server processing + network RTT
  const ttfbMs = entry.responseStart > 0 ? entry.responseStart - entry.requestStart : 0

  // Response body download
  const downloadMs = entry.responseEnd > 0 ? entry.responseEnd - entry.responseStart : 0

  return {
    url: entry.name,
    label: getRequestLabel(entry.name),
    totalMs,
    dnsMs,
    connectMs,
    ttfbMs,
    downloadMs,
  }
}

/**
 * Get resource timing entries that were added after the given count.
 * Filters to only API requests (our backend).
 */
function getNewResourceEntries(
  apiBaseUrl: string,
  previousCount: number
): RequestTimingBreakdown[] {
  const entries = performance.getEntriesByType('resource')
  const newEntries = entries.slice(previousCount)
  let baseOrigin: string
  try {
    baseOrigin = apiBaseUrl ? new URL(apiBaseUrl).origin : location.origin
  } catch {
    baseOrigin = location.origin
  }

  return newEntries
    .filter((e) => e.name.startsWith(baseOrigin) || e.name.includes('/api/') || e.name.includes('/v1/'))
    .map((e) => parseResourceTiming(e as PerformanceResourceTiming))
    .filter((r): r is RequestTimingBreakdown => r !== null)
}

/**
 * Build a human-readable timing breakdown string for toasts.
 */
export function formatTimingForToast(summary: TimingSummary): string {
  const parts: string[] = []

  for (const req of summary.requests) {
    const segments: string[] = []
    if (req.dnsMs > 0) segments.push(`DNS ${formatMs(req.dnsMs)}`)
    if (req.connectMs > 0) segments.push(`Connect ${formatMs(req.connectMs)}`)
    if (req.ttfbMs > 0) segments.push(`Server ${formatMs(req.ttfbMs)}`)
    if (req.downloadMs > 0) segments.push(`Download ${formatMs(req.downloadMs)}`)
    if (segments.length === 0) segments.push(`Total ${formatMs(req.totalMs)}`)

    parts.push(`${req.label}: ${segments.join(' • ')}`)
  }

  return parts.join('\n')
}

/**
 * Capture timing for requests during an async operation.
 * Call before the operation, pass the result to captureAfter.
 */
export function captureBefore(): number {
  return performance.getEntriesByType('resource').length
}

/**
 * Capture timing after an async operation.
 * apiBaseUrl should match the API base (e.g. '' for relative, or full origin).
 */
export function captureAfter(previousCount: number, apiBaseUrl: string = ''): TimingSummary {
  const requests = getNewResourceEntries(apiBaseUrl || location.origin, previousCount)
  const totalMs = requests.reduce((sum, r) => sum + r.totalMs, 0)

  return { totalMs, requests }
}
