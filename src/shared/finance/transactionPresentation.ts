/** `method_details` / `methodDetails` from auth-service for fee & swap rows. */
export type FeeSwapMethodDetails = {
  kind?: string
  order_id?: string
  symbol?: string
  position_id?: string
  refund?: boolean
  accumulated_swap_usd?: string
}

export function transactionPrimaryLabel(type: string): string {
  const t = type.toLowerCase()
  if (t === 'fee') return 'Trading fee'
  if (t === 'swap') return 'Swap'
  if (t === 'margin_lock') return 'Margin lock (cash)'
  if (t === 'margin_unlock') return 'Margin unlock (cash)'
  if (t === 'bonus_margin_lock') return 'Margin lock (bonus)'
  if (t === 'bonus_margin_release') return 'Margin release (bonus)'
  if (t === 'affiliate_commission') return 'Affiliate commission'
  if (t === 'pnl_credit') return 'Realized profit'
  if (t === 'pnl_debit') return 'Realized loss'
  if (t === 'bonus_grant') return 'Bonus grant'
  if (t === 'bonus_revoke') return 'Bonus revoke'
  if (t === 'bonus_loss_absorb') return 'Bonus loss absorb'
  return t.charAt(0).toUpperCase() + t.slice(1)
}

export function feeSwapSubtitle(
  type: string,
  amount: number,
  methodDetails: FeeSwapMethodDetails | null | undefined,
): string {
  const t = type.toLowerCase()
  const meta = methodDetails ?? {}
  if (t === 'fee') {
    if (meta.refund) return 'Fee refund'
    const sym = meta.symbol
    if (sym) return `On ${sym} order`
    return 'Order fee'
  }
  if (t === 'swap') {
    if (meta.kind === 'swap_settlement') {
      const sym = meta.symbol
      if (sym) return `On closed ${sym} position`
      return 'Swap settlement on closed position'
    }
    return 'Financing / swap'
  }
  return ''
}
