import { http } from '@/shared/api/http'
import type {
  FeeRule,
  FeeRuleMarket,
  ListFeeRulesParams,
  ListFeeRulesResponse,
  CreateFeeRulePayload,
  UpdateFeeRulePayload,
} from '../types/feeRule'

function toCamelCaseRule(obj: Record<string, unknown>): FeeRule {
  return {
    id: String(obj.id ?? ''),
    groupId: String(obj.group_id ?? ''),
    groupName: String(obj.group_name ?? ''),
    symbol: (obj.symbol as string | null | undefined) ?? undefined,
    market: (obj.market as FeeRuleMarket | null | undefined) ?? undefined,
    feePercent: Number(obj.fee_percent ?? 0),
    minFee: Number(obj.min_fee ?? 0),
    maxFee: obj.max_fee != null ? Number(obj.max_fee) : undefined,
    status: obj.status === 'disabled' ? 'disabled' : 'active',
    notes: (obj.notes as string | null | undefined) ?? undefined,
    createdAt: String(obj.created_at ?? ''),
    updatedAt: String(obj.updated_at ?? ''),
    updatedBy: (obj.updated_by as string | null | undefined) ?? undefined,
    createdByUserId: obj.created_by_user_id != null ? String(obj.created_by_user_id) : undefined,
    createdByEmail: (obj.created_by_email as string | null | undefined) ?? undefined,
  }
}

function toSnakeCaseCreate(payload: CreateFeeRulePayload): Record<string, unknown> {
  return {
    group_id: payload.groupId,
    symbol: payload.symbol?.trim() ? payload.symbol.trim() : null,
    market: payload.market ?? null,
    fee_percent: payload.feePercent,
    min_fee: payload.minFee,
    max_fee: payload.maxFee ?? null,
    status: payload.status,
    notes: payload.notes?.trim() ? payload.notes.trim() : null,
  }
}

function toSnakeCaseUpdate(payload: UpdateFeeRulePayload): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (payload.groupId !== undefined) out.group_id = payload.groupId
  if (payload.symbol !== undefined) out.symbol = payload.symbol?.trim() ? payload.symbol.trim() : null
  if (payload.market !== undefined) out.market = payload.market ?? null
  if (payload.feePercent !== undefined) out.fee_percent = payload.feePercent
  if (payload.minFee !== undefined) out.min_fee = payload.minFee
  if (payload.maxFee !== undefined) out.max_fee = payload.maxFee
  if (payload.status !== undefined) out.status = payload.status
  if (payload.notes !== undefined) out.notes = payload.notes?.trim() ? payload.notes.trim() : null
  return out
}

export async function listFeeRules(params?: ListFeeRulesParams): Promise<ListFeeRulesResponse> {
  const queryParams = new URLSearchParams()
  if (params?.groupId) queryParams.append('group_id', params.groupId)
  if (params?.symbol) queryParams.append('symbol', params.symbol)
  if (params?.status) queryParams.append('status', params.status)
  if (params?.page != null) queryParams.append('page', String(params.page))
  if (params?.pageSize != null) queryParams.append('page_size', String(params.pageSize))
  const qs = queryParams.toString()
  const res = await http<{ items: Record<string, unknown>[]; page: number; page_size: number; total: number }>(
    `/api/admin/fees${qs ? `?${qs}` : ''}`,
    { method: 'GET' }
  )
  return {
    items: (res.items ?? []).map(toCamelCaseRule),
    page: res.page ?? 1,
    page_size: res.page_size ?? 20,
    total: res.total ?? 0,
  }
}

export async function getFeeRule(id: string): Promise<FeeRule> {
  const res = await http<Record<string, unknown>>(`/api/admin/fees/${id}`, { method: 'GET' })
  return toCamelCaseRule(res)
}

export async function createFeeRule(payload: CreateFeeRulePayload): Promise<FeeRule> {
  const res = await http<Record<string, unknown>>('/api/admin/fees', {
    method: 'POST',
    body: JSON.stringify(toSnakeCaseCreate(payload)),
  })
  return toCamelCaseRule(res)
}

export async function updateFeeRule(id: string, payload: UpdateFeeRulePayload): Promise<FeeRule> {
  const res = await http<Record<string, unknown>>(`/api/admin/fees/${id}`, {
    method: 'PUT',
    body: JSON.stringify(toSnakeCaseUpdate(payload)),
  })
  return toCamelCaseRule(res)
}

export async function deleteFeeRule(id: string): Promise<void> {
  await http(`/api/admin/fees/${id}`, { method: 'DELETE' })
}
