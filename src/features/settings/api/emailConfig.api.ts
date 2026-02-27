import { http } from '@/shared/api/http'

export interface EmailConfigDto {
  id: string
  smtp_host: string
  smtp_port: number
  smtp_encryption: string
  smtp_username: string
  from_email: string
  from_name: string
  created_at: string
  updated_at: string
}

export interface UpdateEmailConfigPayload {
  smtp_host?: string
  smtp_port?: number
  smtp_encryption?: string
  smtp_username?: string
  smtp_password?: string
  from_email?: string
  from_name?: string
}

export async function getEmailConfig(): Promise<EmailConfigDto> {
  return http<EmailConfigDto>('/api/admin/settings/email-config', { method: 'GET' })
}

export async function updateEmailConfig(payload: UpdateEmailConfigPayload): Promise<EmailConfigDto> {
  return http<EmailConfigDto>('/api/admin/settings/email-config', {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export async function sendTestEmail(to: string): Promise<{ success: boolean; message?: string }> {
  return http<{ success: boolean; message?: string }>('/api/admin/settings/email-config/test', {
    method: 'POST',
    body: JSON.stringify({ to: to.trim() }),
  })
}
