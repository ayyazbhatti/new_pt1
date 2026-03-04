export function formatCurrency(value: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatDateTime(dateString: string): string {
  const date = new Date(dateString)
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date)
}

/** Human-readable account age (e.g. "Today", "5 days", "2 months", "1 year"). */
export function formatAccountAge(createdAt: string): string {
  const created = new Date(createdAt)
  const now = new Date()
  const diffMs = now.getTime() - created.getTime()
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000))
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return '1 day'
  if (diffDays < 30) return `${diffDays} days`
  const diffMonths = Math.floor(diffDays / 30)
  if (diffMonths === 1) return '1 month'
  if (diffMonths < 12) return `${diffMonths} months`
  const diffYears = Math.floor(diffMonths / 12)
  return diffYears === 1 ? '1 year' : `${diffYears} years`
}

