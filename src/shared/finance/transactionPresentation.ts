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
