import { http } from '@/shared/api/http'
import {
  AdminSymbol,
  CreateSymbolPayload,
  UpdateSymbolPayload,
  ListSymbolsParams,
  ListSymbolsResponse,
} from '../types/symbol'

export type { CreateSymbolPayload, UpdateSymbolPayload, ListSymbolsParams }

// Helper to convert snake_case to camelCase
function toCamelCaseSymbol(obj: any): AdminSymbol {
  return {
    id: obj.id,
    symbolCode: obj.symbol_code,
    providerSymbol: obj.provider_symbol,
    assetClass: obj.asset_class,
    baseCurrency: obj.base_currency,
    quoteCurrency: obj.quote_currency,
    pricePrecision: obj.price_precision,
    volumePrecision: obj.volume_precision,
    contractSize: obj.contract_size,
    tickSize: obj.tick_size ? parseFloat(obj.tick_size) : null,
    lotMin: obj.lot_min ? parseFloat(obj.lot_min) : null,
    lotMax: obj.lot_max ? parseFloat(obj.lot_max) : null,
    defaultPipPosition: obj.default_pip_position ? parseFloat(obj.default_pip_position) : null,
    pipPositionMin: obj.pip_position_min ? parseFloat(obj.pip_position_min) : null,
    pipPositionMax: obj.pip_position_max ? parseFloat(obj.pip_position_max) : null,
    isEnabled: obj.is_enabled,
    tradingEnabled: obj.trading_enabled,
    leverageProfileId: obj.leverage_profile_id != null ? String(obj.leverage_profile_id) : null,
    leverageProfileName: obj.leverage_profile_name != null ? String(obj.leverage_profile_name) : null,
    createdAt: obj.created_at,
    updatedAt: obj.updated_at,
  }
}

export async function listSymbols(params?: ListSymbolsParams): Promise<ListSymbolsResponse> {
  const queryParams = new URLSearchParams()
  if (params?.search) queryParams.append('search', params.search)
  if (params?.asset_class) queryParams.append('asset_class', params.asset_class)
  if (params?.is_enabled) queryParams.append('is_enabled', params.is_enabled)
  if (params?.page) queryParams.append('page', params.page.toString())
  if (params?.page_size) queryParams.append('page_size', params.page_size.toString())
  if (params?.sort) queryParams.append('sort', params.sort)

  const queryString = queryParams.toString()
  // Use public endpoint for listing symbols (no admin role required)
  const endpoint = `/api/symbols${queryString ? `?${queryString}` : ''}`

  const response = await http<ListSymbolsResponse>(endpoint, {
    method: 'GET',
  })

  return {
    ...response,
    items: response.items.map(toCamelCaseSymbol),
  }
}

/** Safety cap for one-shot terminal loads (avoids runaway memory if counts are wrong). */
const MAX_SYMBOLS_TERMINAL_FETCH = 25_000

const TERMINAL_SYMBOL_PAGE = 2000

/**
 * Loads every row matching `params` by paging the public symbols API (no arbitrary page_size limit).
 * Use for the trading terminal so enabled forex (and other classes) are not truncated.
 */
export async function listAllSymbolsMatching(
  params?: Omit<ListSymbolsParams, 'page' | 'page_size'>
): Promise<AdminSymbol[]> {
  const probe = await listSymbols({ ...params, page: 1, page_size: 1 })
  const total = probe.total
  if (total === 0) return []
  const cap = Math.min(total, MAX_SYMBOLS_TERMINAL_FETCH)
  const out: AdminSymbol[] = []
  for (let offset = 0; offset < cap; offset += TERMINAL_SYMBOL_PAGE) {
    const page = Math.floor(offset / TERMINAL_SYMBOL_PAGE) + 1
    const page_size = Math.min(TERMINAL_SYMBOL_PAGE, cap - offset)
    const chunk = await listSymbols({ ...params, page, page_size })
    out.push(...chunk.items)
    if (chunk.items.length < page_size) break
  }
  return out
}

/** Admin list: includes tick_size, lot_min, lot_max, pip position fields. Requires admin auth. */
export async function listAdminSymbols(params?: ListSymbolsParams): Promise<ListSymbolsResponse> {
  const queryParams = new URLSearchParams()
  if (params?.search) queryParams.append('search', params.search)
  if (params?.asset_class) queryParams.append('asset_class', params.asset_class)
  if (params?.is_enabled) queryParams.append('is_enabled', params.is_enabled)
  if (params?.page) queryParams.append('page', params.page.toString())
  if (params?.page_size) queryParams.append('page_size', params.page_size.toString())
  if (params?.sort) queryParams.append('sort', params.sort)

  const queryString = queryParams.toString()
  const endpoint = `/api/admin/symbols${queryString ? `?${queryString}` : ''}`

  const response = await http<ListSymbolsResponse>(endpoint, {
    method: 'GET',
  })

  return {
    ...response,
    items: response.items.map(toCamelCaseSymbol),
  }
}

export async function getSymbol(id: string): Promise<AdminSymbol> {
  const response = await http<any>(`/api/admin/symbols/${id}`, {
    method: 'GET',
  })
  return toCamelCaseSymbol(response)
}

export async function createSymbol(payload: CreateSymbolPayload): Promise<AdminSymbol> {
  const response = await http<any>(`/api/admin/symbols`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return toCamelCaseSymbol(response)
}

export async function updateSymbol(id: string, payload: UpdateSymbolPayload): Promise<AdminSymbol> {
  const response = await http<any>(`/api/admin/symbols/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
  return toCamelCaseSymbol(response)
}

export async function deleteSymbol(id: string): Promise<void> {
  await http(`/api/admin/symbols/${id}`, {
    method: 'DELETE',
  })
}

export async function toggleSymbolEnabled(id: string, isEnabled: boolean): Promise<AdminSymbol> {
  const response = await http<any>(`/api/admin/symbols/${id}/toggle-enabled`, {
    method: 'PUT',
    body: JSON.stringify({ is_enabled: isEnabled }),
  })
  return toCamelCaseSymbol(response)
}

/** Bulk import from MMDPS `/feed/symbols` (auth-service; can take several minutes). */
export type SyncMmdpsPayload = {
  enable_forex?: boolean
  enable_metals?: boolean
  enable_stocks?: boolean
  enable_crypto?: boolean
  /** When true: disable stocks/indices rows not returned by MMDPS /feed/symbols; never touches Crypto. */
  prune_stocks_not_in_mmdps_feed?: boolean
}

export type SyncMmdpsResponse = {
  fetched: number
  upserted: number
  skipped: number
  db_symbol_count: number
  categories_seen: Record<string, number>
  disabled_stocks_not_in_feed?: number | null
}

export async function syncMmdpsSymbols(payload?: SyncMmdpsPayload): Promise<SyncMmdpsResponse> {
  return http<SyncMmdpsResponse>('/api/admin/symbols/sync-mmdps', {
    method: 'POST',
    body: JSON.stringify(payload ?? {}),
    timeoutMs: 600_000,
  })
}

