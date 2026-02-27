import { http } from '@/shared/api/http'

export type EmailTemplatesMap = Record<string, { subject: string; body: string }>

export async function getEmailTemplates(): Promise<EmailTemplatesMap> {
  return http<EmailTemplatesMap>('/api/admin/settings/email-templates', { method: 'GET' })
}

export async function updateEmailTemplate(
  id: string,
  payload: { subject: string; body: string }
): Promise<{ subject: string; body: string }> {
  return http<{ subject: string; body: string }>(`/api/admin/settings/email-templates/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}
