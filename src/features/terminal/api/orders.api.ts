import { http } from '@/shared/api/http'
import type { SymbolLeverageTier } from '@/shared/api/auth.api'

/**
 * Same tier selection as `risk::effective_leverage` / `effectiveLeverageFromTiers` in auth.api,
 * but returns `null` when leverage cannot be resolved (no silent defaults — fail closed for terminal margin fallback).
 */
export function resolveEffectiveLeverageFromTiersOrNull(
  notional: number,
  tiers: SymbolLeverageTier[] | null | undefined,
  userMin: number | null | undefined,
  userMax: number | null | undefined
): number | null {
  if (!tiers?.length) return null
  const userMinN = userMin != null ? userMin : 1
  const userMaxN = userMax != null ? userMax : 500
  if (userMinN < 1 || userMaxN < 1 || userMinN > userMaxN) return null
  if (!Number.isFinite(notional) || notional < 0) return null
  if (notional === 0) return null

  const parseBound = (s: string) => {
    const v = parseFloat(String(s).trim())
    return Number.isFinite(v) ? v : Number.NaN
  }

  let bestLev: number | null = null
  let bestFrom: number | null = null
  for (const t of tiers) {
    const from = parseBound(t.notional_from)
    if (Number.isNaN(from) || notional < from) continue
    const toRaw = t.notional_to
    let inTier: boolean
    if (toRaw == null || String(toRaw).trim() === '') {
      inTier = true
    } else {
      const to = parseBound(String(toRaw))
      if (Number.isNaN(to)) continue
      inTier = notional < to
    }
    if (inTier) {
      if (bestFrom == null || from > bestFrom) {
        bestFrom = from
        bestLev = t.max_leverage
      }
    }
  }

  let symbolLev = bestLev

  if (symbolLev == null) {
    for (let i = tiers.length - 1; i >= 0; i--) {
      const t = tiers[i]
      if (t.notional_to != null && String(t.notional_to).trim() !== '') continue
      const from = parseBound(t.notional_from)
      if (Number.isNaN(from)) continue
      if (notional >= from) {
        symbolLev = t.max_leverage
        break
      }
    }
  }

  if (symbolLev == null && notional > 0) {
    let bestFloor: { from: number; lev: number } | null = null
    for (const t of tiers) {
      const from = parseBound(t.notional_from)
      if (Number.isNaN(from)) continue
      if (bestFloor == null || from < bestFloor.from) {
        bestFloor = { from, lev: t.max_leverage }
      }
    }
    if (bestFloor != null && notional < bestFloor.from) {
      symbolLev = bestFloor.lev
    }
  }

  if (symbolLev == null || symbolLev < 1) return null
  return Math.max(userMinN, Math.min(userMaxN, symbolLev))
}

/** Client-only margin fallback: MARKET uses BUY→ask / SELL→bid; LIMIT uses `limitExecutionPrice` when provided (>0). */
export function clientMarketFallbackMarginUsdOrNull(args: {
  bid: number
  ask: number
  side: 'BUY' | 'SELL'
  baseUnits: number
  tiers: SymbolLeverageTier[] | null | undefined
  userMin: number | null | undefined
  userMax: number | null | undefined
  orderType?: 'MARKET' | 'LIMIT'
  /** For LIMIT orders: same value as server `compute_order_margin_details` (limit price). Ignored for MARKET. */
  limitExecutionPrice?: number | null
}): number | null {
  const {
    bid,
    ask,
    side,
    baseUnits,
    tiers,
    userMin,
    userMax,
    orderType = 'MARKET',
    limitExecutionPrice,
  } = args
  if (!Number.isFinite(baseUnits) || baseUnits <= 0) return null
  let exec: number
  if (orderType === 'LIMIT' && limitExecutionPrice != null && Number.isFinite(limitExecutionPrice) && limitExecutionPrice > 0) {
    exec = limitExecutionPrice
  } else {
    exec = side === 'SELL' ? bid : ask
  }
  if (!Number.isFinite(exec) || exec <= 0) return null
  const notional = baseUnits * exec
  const lev = resolveEffectiveLeverageFromTiersOrNull(notional, tiers, userMin, userMax)
  if (lev == null || lev <= 0) return null
  return notional / lev
}

export interface PlaceOrderRequest {
  symbol: string
  side: 'BUY' | 'SELL'
  order_type: 'MARKET' | 'LIMIT'
  size: string
  limit_price?: string
  sl?: string
  tp?: string
  tif?: 'GTC' | 'IOC' | 'FOK'
  client_order_id?: string
  idempotency_key: string
  /** Optional override in basis points (sent only when user changes Advanced slippage). */
  slippage_bps?: number
}

export interface PlaceOrderResponse {
  orderId: string  // API returns camelCase
  status: string
}

/** Known `error.code` values from POST `/v1/orders` (non-exhaustive). */
export type PlaceOrderErrorCode =
  | 'INSUFFICIENT_FREE_MARGIN'
  | 'MIN_REQUIRED_MARGIN_NOT_MET'
  | 'MARKET_CLOSED'
  | 'TRADING_DISABLED'
  | 'CLOSE_ONLY'
  | 'NEW_ORDERS_DISABLED'
  /** Engine-side rejection; place-order HTTP may still be 200 — surfaced via WebSocket. */
  | 'SLIPPAGE_EXCEEDED'
  | string

/** Nested `error` object on failed place-order responses (shape varies by code). */
export interface PlaceOrderErrorBody {
  code: PlaceOrderErrorCode
  message: string
  templateName?: string
  timezone?: string
  nextOpenAt?: string | null
  nextCloseAt?: string | null
}

export async function placeOrder(payload: PlaceOrderRequest): Promise<PlaceOrderResponse> {
  return http<PlaceOrderResponse>('/v1/orders', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** Same margin math as the server for place_order (POST /v1/orders) — for Cost Breakdown UI. */
export interface EstimateOrderMarginRequest {
  symbol: string
  side: 'BUY' | 'SELL'
  orderType: 'MARKET' | 'LIMIT'
  size: string
  limitPrice?: string
}

export interface EstimateOrderMarginResponse {
  notional: string
  effectiveLeverage: string
  requiredMargin: string
  executionPrice: string
  /** Pre-pay trading fee in USD (same rules as place_order); "0" when fees disabled or no rule. */
  estimatedFeeUsd: string
}

export async function estimateOrderMargin(
  payload: EstimateOrderMarginRequest
): Promise<EstimateOrderMarginResponse> {
  return http<EstimateOrderMarginResponse>('/v1/orders/estimate', {
    method: 'POST',
    body: JSON.stringify({
      symbol: payload.symbol,
      side: payload.side,
      orderType: payload.orderType,
      size: payload.size,
      limitPrice: payload.limitPrice,
    }),
  })
}

export async function cancelOrder(orderId: string): Promise<void> {
  return http(`/v1/orders/${orderId}/cancel`, {
    method: 'POST',
  })
}

export interface Order {
  id: string
  symbol: string
  side: string
  order_type: string
  size: string
  price?: string
  stop_price?: string
  filled_size?: string
  average_price?: string
  avg_fill_price?: string
  status: string
  created_at: string
  updated_at: string
  filled_at?: string
  cancelled_at?: string
}

export interface ListOrdersResponse {
  items: Order[]
  total: number
}

export interface ListOrdersParams {
  status?: string // "pending", "cancelling", "filled", "cancelled", etc.
  limit?: number
  offset?: number
}

export async function listOrders(params?: ListOrdersParams): Promise<ListOrdersResponse> {
  const queryParams = new URLSearchParams()
  if (params?.status) queryParams.append('status', params.status)
  if (params?.limit) queryParams.append('limit', params.limit.toString())
  if (params?.offset) queryParams.append('offset', params.offset.toString())

  const queryString = queryParams.toString()
  const endpoint = `/v1/orders${queryString ? `?${queryString}` : ''}`

  return http<ListOrdersResponse>(endpoint, {
    method: 'GET',
  })
}

