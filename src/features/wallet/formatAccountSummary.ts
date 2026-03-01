import type { AccountSummaryResponse } from './api'

/** Minimal shape for display; compatible with AccountSummaryResponse and AdminAccountSummaryResponse. */
export type AccountSummaryLike =
  | Pick<
      AccountSummaryResponse,
      'balance' | 'equity' | 'marginUsed' | 'freeMargin' | 'marginLevel' | 'realizedPnl' | 'unrealizedPnl'
    >
  | null
  | undefined

/** Same display logic as terminal BottomDock; reuse for admin table and anywhere we show account summary. */

export function formatBalance(s: AccountSummaryLike): string {
  if (s == null) return '—'
  return `$${s.balance.toFixed(2)}`
}

export function formatEquity(s: AccountSummaryLike): string {
  if (s == null) return '—'
  return `$${s.equity.toFixed(2)}`
}

export function formatMargin(s: AccountSummaryLike): string {
  if (s == null) return '—'
  const used = s.marginLevel === 'inf' ? 0 : (s.marginUsed ?? 0)
  return `$${used.toFixed(2)}`
}

export function formatFreeMargin(s: AccountSummaryLike): string {
  if (s == null) return '—'
  return `$${s.freeMargin.toFixed(2)}`
}

export function formatMarginLevel(s: AccountSummaryLike): string {
  if (s == null) return '—'
  return s.marginLevel === 'inf' ? '∞' : `${s.marginLevel}%`
}

export function formatRealizedPnl(s: AccountSummaryLike): string {
  if (s == null) return '—'
  const v = s.realizedPnl ?? 0
  return v >= 0 ? `$${v.toFixed(2)}` : `-$${Math.abs(v).toFixed(2)}`
}

export function formatUnrealizedPnl(s: AccountSummaryLike): string {
  if (s == null) return '—'
  const v = s.unrealizedPnl ?? 0
  return v >= 0 ? `$${v.toFixed(2)}` : `-$${Math.abs(v).toFixed(2)}`
}

export function isRealizedPnlNegative(s: AccountSummaryLike): boolean {
  return (s?.realizedPnl ?? 0) < 0
}

export function isUnrealizedPnlNegative(s: AccountSummaryLike): boolean {
  return (s?.unrealizedPnl ?? 0) < 0
}
