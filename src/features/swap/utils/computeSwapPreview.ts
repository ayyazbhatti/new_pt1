import { SwapRule, SwapPreviewInput, SwapPreviewResult } from '../types/swap'

export function computeSwapPreview(
  rule: SwapRule,
  input: SwapPreviewInput
): SwapPreviewResult {
  const breakdown: string[] = []
  const rate = input.side === 'long' ? rule.longRate : rule.shortRate
  const rateLabel = input.side === 'long' ? 'Long' : 'Short'

  breakdown.push(`Side: ${rateLabel}`)
  breakdown.push(`Rate: ${rate}${rule.unit === 'percent' ? '%' : ' ' + input.quoteCurrency}`)

  // Calculate periods based on calc mode
  let periods = 0
  if (rule.calcMode === 'daily') {
    periods = input.holdingHours / 24
    breakdown.push(`Calculation: Daily (${input.holdingHours} hours = ${periods.toFixed(2)} days)`)
  } else if (rule.calcMode === 'hourly') {
    periods = input.holdingHours
    breakdown.push(`Calculation: Hourly (${periods.toFixed(2)} hours)`)
  } else if (rule.calcMode === 'funding_8h') {
    periods = input.holdingHours / 8
    breakdown.push(`Calculation: 8-hour funding (${periods.toFixed(2)} periods)`)
  }

  // Calculate accrual (USD) for preview — wallet settles on position close in production
  let charge = 0
  if (rule.unit === 'percent') {
    // Use notional: positionSize * currentPrice
    const notional = input.positionSize * input.currentPrice
    breakdown.push(`Notional: ${notional.toFixed(2)} ${input.quoteCurrency}`)
    charge = notional * (rate / 100) * periods
    breakdown.push(`Formula: ${notional.toFixed(2)} × (${rate}% / 100) × ${periods.toFixed(2)} = ${charge.toFixed(4)} (accrual)`)
  } else {
    // Fixed per period
    charge = rate * periods
    breakdown.push(`Formula: ${rate} ${input.quoteCurrency} × ${periods.toFixed(2)} = ${charge.toFixed(4)} (accrual)`)
  }

  // Apply clamps
  if (rule.minCharge !== undefined && charge < rule.minCharge) {
    breakdown.push(`Min accrual clamp: ${charge.toFixed(4)} → ${rule.minCharge.toFixed(4)}`)
    charge = rule.minCharge
  }
  if (rule.maxCharge !== undefined && charge > rule.maxCharge) {
    breakdown.push(`Max accrual clamp: ${charge.toFixed(4)} → ${rule.maxCharge.toFixed(4)}`)
    charge = rule.maxCharge
  }

  // Weekend/triple day handling (informational)
  if (rule.weekendRule === 'triple_day' && rule.tripleDay) {
    breakdown.push(`Triple swap day: ${rule.tripleDay} (3× accrual that day when applicable)`)
  } else if (rule.weekendRule === 'fri_triple') {
    breakdown.push('Friday triple swap (3× accrual when applicable)')
  }

  breakdown.push(`Rollover time: ${rule.rolloverTimeUtc} UTC`)

  const unitLabel = rule.unit === 'percent' ? '%' : input.quoteCurrency

  return {
    estimatedCharge: charge,
    unitLabel,
    breakdown,
  }
}

