import { http } from '@/shared/api/http'
import {
  AdminSymbol,
  CreateSymbolPayload,
  UpdateSymbolPayload,
  ListSymbolsParams,
  ListSymbolsResponse,
} from '../types/symbol'

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
    leverageProfileId: obj.leverage_profile_id,
    leverageProfileName: obj.leverage_profile_name,
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

