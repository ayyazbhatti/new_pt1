import { Percent, CalendarClock } from 'lucide-react'
import { cn } from '@/shared/utils'
import { feeSwapSubtitle, transactionPrimaryLabel, type FeeSwapMethodDetails } from '@/shared/finance/transactionPresentation'

type Props = {
  type: string
  amount: number
  methodDetails?: unknown
  className?: string
}

export function TradingTransactionTypeDisplay({ type, amount, methodDetails, className }: Props) {
  const t = type.toLowerCase()
  const meta = (methodDetails ?? {}) as FeeSwapMethodDetails
  const subtitle = feeSwapSubtitle(t, amount, meta)

  if (t === 'fee') {
    return (
      <div className={cn('flex flex-col gap-0.5 min-w-0', className)}>
        <span className="inline-flex items-center gap-1.5 font-medium capitalize">
          <Percent className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
          {transactionPrimaryLabel(type)}
        </span>
        {subtitle ? <span className="text-[11px] text-text-muted truncate">{subtitle}</span> : null}
      </div>
    )
  }
  if (t === 'swap') {
    const label = meta.kind === 'swap_settlement' ? 'Swap settlement' : 'Swap'
    return (
      <div className={cn('flex flex-col gap-0.5 min-w-0', className)}>
        <span className="inline-flex items-center gap-1.5 font-medium capitalize">
          <CalendarClock className="h-3.5 w-3.5 shrink-0 text-amber-500/90" aria-hidden />
          {label}
        </span>
        {subtitle ? <span className="text-[11px] text-text-muted truncate">{subtitle}</span> : null}
      </div>
    )
  }

  return <span className={cn('capitalize', className)}>{transactionPrimaryLabel(type)}</span>
}
