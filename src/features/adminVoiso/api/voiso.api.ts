import { http } from '@/shared/api/http'

export interface Click2CallRequest {
  /** Voiso agent extension (e.g. "1007"). */
  agent: string
  /** Destination number in E.164 without leading + (e.g. "393511775043"). */
  number: string
}

/** Initiate a Voiso Click2Call. Requires call:view. API key is used server-side. */
export async function click2call(body: Click2CallRequest): Promise<void> {
  await http<null>('/api/admin/voiso/click2call', {
    method: 'POST',
    body: JSON.stringify({
      agent: body.agent.trim(),
      number: body.number.replace(/\D/g, ''), // strip +, spaces, dashes
    }),
  })
}
