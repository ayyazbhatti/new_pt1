import { http } from '@/shared/api/http'
import { LookupSymbol, LookupUser, LookupGroup } from '../types'

interface PaginatedResponse<T> {
  items: T[]
  page?: number
  page_size?: number
  total?: number
}

/** Normalize API symbol item (backend may send symbol_code, asset_class) to LookupSymbol */
function normalizeSymbolItem(item: Record<string, unknown>): LookupSymbol {
  const code = (item.symbol_code ?? item.code ?? '') as string
  return {
    id: (item.id ?? '') as string,
    code,
    name: (item.name ?? item.symbol_code ?? item.code ?? '') as string,
    assetClass: (item.asset_class ?? item.assetClass ?? '') as string,
  }
}

export async function fetchAdminSymbols(): Promise<LookupSymbol[]> {
  const response = await http<PaginatedResponse<Record<string, unknown>> | Record<string, unknown>[]>(
    '/api/admin/symbols?page=1&page_size=500'
  )
  const rawItems = Array.isArray(response) ? response : response?.items ?? []
  const normalized = rawItems.map((item) => normalizeSymbolItem(item as Record<string, unknown>))
  return normalized.filter((s) => s.id && s.code)
}

export async function searchAdminUsers(search: string): Promise<LookupUser[]> {
  const params = new URLSearchParams({ search })
  const response = await http<PaginatedResponse<LookupUser> | LookupUser[]>(`/api/admin/users?${params.toString()}`)
  // Handle both paginated and direct array responses
  if (Array.isArray(response)) {
    return response
  }
  return response.items || []
}

export async function fetchAdminGroups(): Promise<LookupGroup[]> {
  const response = await http<PaginatedResponse<LookupGroup> | LookupGroup[]>('/api/admin/groups')
  // Handle both paginated and direct array responses
  if (Array.isArray(response)) {
    return response
  }
  return response.items || []
}

