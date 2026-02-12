import { http } from '@/shared/api/http'
import { AdminAuditLog, PaginatedResponse } from '../types'

export interface AuditFilters {
  type?: string
  limit?: number
  cursor?: string
}

export async function fetchAdminAudit(
  filters: AuditFilters = {}
): Promise<PaginatedResponse<AdminAuditLog>> {
  const params = new URLSearchParams()
  
  if (filters.type) params.append('type', filters.type)
  if (filters.limit) params.append('limit', String(filters.limit))
  if (filters.cursor) params.append('cursor', filters.cursor)

  const query = params.toString()
  return http<PaginatedResponse<AdminAuditLog>>(`/api/admin/audit${query ? `?${query}` : ''}`)
}

