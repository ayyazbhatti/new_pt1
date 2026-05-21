/**
 * Relative age / duration labels from wall times (not IANA calendar formatting).
 */
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
