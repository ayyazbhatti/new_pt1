import { cn } from '@/shared/utils'

interface OwnerDisplayProps {
  ownerName?: string | null
  className?: string
}

export function OwnerDisplay({ ownerName, className }: OwnerDisplayProps) {
  if (!ownerName?.trim()) {
    return <span className={cn('text-text-muted text-sm', className)}>—</span>
  }
  const initials = ownerName
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm text-text', className)} title={ownerName}>
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-medium text-text-muted">
        {initials}
      </span>
      {ownerName}
    </span>
  )
}
