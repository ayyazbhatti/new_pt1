import { http } from '@/shared/api/http'
import { LookupSymbol, LookupUser, LookupGroup } from '../types'

interface PaginatedResponse<T> {
  items: T[]
  page?: number
  page_size?: number
  total?: number
}

export async function fetchAdminSymbols(): Promise<LookupSymbol[]> {
  const response = await http<PaginatedResponse<LookupSymbol> | LookupSymbol[]>('/api/admin/symbols')
  // Handle both paginated and direct array responses
  if (Array.isArray(response)) {
    return response
  }
  return response.items || []
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

