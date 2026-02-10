import { Card } from '@/shared/ui/card'
import { cn } from '@/shared/utils'

interface StatCardProps {
  title: string
  value: string
  change?: string
  className?: string
}

export function StatCard({ title, value, change, className }: StatCardProps) {
  const isPositive = change?.startsWith('+')
  const isNegative = change?.startsWith('-')

  return (
    <Card className={cn('p-6', className)}>
      <div className="text-sm font-medium text-text-muted mb-1">{title}</div>
      <div className="text-2xl font-bold text-text mb-2">{value}</div>
      {change && (
        <div
          className={cn(
            'text-sm',
            isPositive && 'text-success',
            isNegative && 'text-danger'
          )}
        >
          {change} from last month
        </div>
      )}
    </Card>
  )
}

