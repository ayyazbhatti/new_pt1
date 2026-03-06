import { http } from '@/shared/api/http'

/** Server config for bulk user creation (from GET /api/admin/bulk/config) */
export interface BulkUserCreationConfigResponse {
  bulk_user_creation: {
    enabled: boolean
    max_users_per_run: number
    max_users_per_run_per_admin_per_day: number
    batch_size: number
    async_threshold: number
    fields: Record<string, unknown>
    defaults: {
      first_name_prefix: string
      last_name: string
      starting_number: number
      account_mode: string
    }
  }
}

/** Request body for POST /api/admin/bulk/users (snake_case) */
export interface BulkCreateUsersRequest {
  count: number
  username_prefix: string
  email_domain: string
  password: string
  first_name_prefix?: string
  last_name?: string
  starting_number?: number
  group_id?: string | null
  account_mode?: string
  initial_balance_enabled?: boolean
  initial_balance_amount?: number | null
  initial_balance_fee?: number | null
  initial_balance_reference?: string | null
}

/** One result row from bulk create response */
export interface BulkUserResultRow {
  username: string
  email: string
  success: boolean
  user_id: string | null
  account_id: string | null
  error: string | null
}

/** Response from POST /api/admin/bulk/users (sync) */
export interface BulkCreateUsersResponse {
  job_id: string | null
  sync: boolean
  total: number
  success_count: number
  failed_count: number
  results: BulkUserResultRow[]
}

export async function getBulkConfig(): Promise<BulkUserCreationConfigResponse> {
  return http<BulkUserCreationConfigResponse>('/api/admin/bulk/config')
}

export async function createBulkUsers(
  payload: BulkCreateUsersRequest
): Promise<BulkCreateUsersResponse> {
  return http<BulkCreateUsersResponse>('/api/admin/bulk/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
