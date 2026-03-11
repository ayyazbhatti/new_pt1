import { http } from '@/shared/api/http'
import type {
  SwapRule,
  ListSwapRulesParams,
  ListSwapRulesResponse,
  CreateSwapRulePayload,
  UpdateSwapRulePayload,
} from '../types/swap'

function toCamelCaseRule(obj: any): SwapRule {
  return {
    id: String(obj.id ?? ''),
    groupId: String(obj.group_id ?? ''),
    groupName: String(obj.group_name ?? ''),
    symbol: String(obj.symbol ?? ''),
    market: obj.market ?? 'forex',
    calcMode: obj.calc_mode ?? 'daily',
    unit: obj.unit ?? 'percent',
    longRate: Number(obj.long_rate ?? 0),
    shortRate: Number(obj.short_rate ?? 0),
    rolloverTimeUtc: String(obj.rollover_time_utc ?? '00:00'),
    tripleDay: obj.triple_day ?? undefined,
    weekendRule: obj.weekend_rule ?? 'none',
    minCharge: obj.min_charge != null ? Number(obj.min_charge) : undefined,
    maxCharge: obj.max_charge != null ? Number(obj.max_charge) : undefined,
    status: obj.status === 'disabled' ? 'disabled' : 'active',
    updatedAt: obj.updated_at ?? new Date().toISOString(),
    updatedBy: String(obj.updated_by ?? ''),
    createdByUserId: obj.created_by_user_id != null ? String(obj.created_by_user_id) : undefined,
    createdByEmail: obj.created_by_email != null ? String(obj.created_by_email) : undefined,
    notes: obj.notes ?? undefined,
    tagIds: obj.tag_ids ?? [],
  }
}

function toSnakeCaseCreate(payload: CreateSwapRulePayload): Record<string, unknown> {
  return {
    group_id: payload.groupId,
    symbol: payload.symbol,
    market: payload.market,
    calc_mode: payload.calcMode,
    unit: payload.unit,
    long_rate: payload.longRate,
    short_rate: payload.shortRate,
    rollover_time_utc: payload.rolloverTimeUtc,
    weekend_rule: payload.weekendRule,
    status: payload.status,
    triple_day: payload.tripleDay ?? null,
    min_charge: payload.minCharge ?? null,
    max_charge: payload.maxCharge ?? null,
    notes: payload.notes ?? null,
  }
}

function toSnakeCaseUpdate(payload: UpdateSwapRulePayload): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (payload.groupId !== undefined) out.group_id = payload.groupId
  if (payload.symbol !== undefined) out.symbol = payload.symbol
  if (payload.market !== undefined) out.market = payload.market
  if (payload.calcMode !== undefined) out.calc_mode = payload.calcMode
  if (payload.unit !== undefined) out.unit = payload.unit
  if (payload.longRate !== undefined) out.long_rate = payload.longRate
  if (payload.shortRate !== undefined) out.short_rate = payload.shortRate
  if (payload.rolloverTimeUtc !== undefined) out.rollover_time_utc = payload.rolloverTimeUtc
  if (payload.weekendRule !== undefined) out.weekend_rule = payload.weekendRule
  if (payload.tripleDay !== undefined) out.triple_day = payload.tripleDay
  if (payload.minCharge !== undefined) out.min_charge = payload.minCharge
  if (payload.maxCharge !== undefined) out.max_charge = payload.maxCharge
  if (payload.status !== undefined) out.status = payload.status
  if (payload.notes !== undefined) out.notes = payload.notes
  return out
}

export async function listSwapRules(
  params?: ListSwapRulesParams
): Promise<ListSwapRulesResponse> {
  const queryParams = new URLSearchParams()
  if (params?.groupId) queryParams.append('group_id', params.groupId)
  if (params?.market) queryParams.append('market', params.market)
  if (params?.symbol) queryParams.append('symbol', params.symbol)
  if (params?.status) queryParams.append('status', params.status)
  if (params?.calcMode) queryParams.append('calc_mode', params.calcMode)
  if (params?.page != null) queryParams.append('page', String(params.page))
  if (params?.pageSize != null) queryParams.append('page_size', String(params.pageSize))
  const queryString = queryParams.toString()
  const endpoint = `/api/admin/swap/rules${queryString ? `?${queryString}` : ''}`

  const response = await http<{
    items: any[]
    page: number
    page_size: number
    total: number
  }>(endpoint, { method: 'GET' })

  return {
    items: (response.items ?? []).map(toCamelCaseRule),
    page: response.page ?? 1,
    pageSize: response.page_size ?? 20,
    total: response.total ?? 0,
  }
}

export async function getSwapRule(id: string): Promise<SwapRule> {
  const response = await http<any>(`/api/admin/swap/rules/${id}`, { method: 'GET' })
  return toCamelCaseRule(response)
}

export async function createSwapRule(
  payload: CreateSwapRulePayload
): Promise<SwapRule> {
  const response = await http<any>(`/api/admin/swap/rules`, {
    method: 'POST',
    body: JSON.stringify(toSnakeCaseCreate(payload)),
  })
  return toCamelCaseRule(response)
}

export async function updateSwapRule(
  id: string,
  payload: UpdateSwapRulePayload
): Promise<SwapRule> {
  const body = toSnakeCaseUpdate(payload)
  if (Object.keys(body).length === 0) {
    return getSwapRule(id)
  }
  const response = await http<any>(`/api/admin/swap/rules/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
  return toCamelCaseRule(response)
}

export async function deleteSwapRule(id: string): Promise<void> {
  await http(`/api/admin/swap/rules/${id}`, { method: 'DELETE' })
}

/** Get tag IDs assigned to a swap rule. Uses /api/admin/swap-rule-tags/:id */
export async function getSwapRuleTags(ruleId: string): Promise<string[]> {
  const res = await http<{ tag_ids: string[] }>(`/api/admin/swap-rule-tags/${ruleId}`, {
    method: 'GET',
  })
  return res.tag_ids ?? []
}

/** Assign tags to a swap rule (replaces existing). */
export async function setSwapRuleTags(ruleId: string, tagIds: string[]): Promise<void> {
  await http(`/api/admin/swap-rule-tags/${ruleId}`, {
    method: 'PUT',
    body: JSON.stringify({ tag_ids: tagIds }),
  })
}
