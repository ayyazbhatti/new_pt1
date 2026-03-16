/**
 * Read exp (expiry) claim from a JWT without full verification (client-side only).
 * Used to decide when to refresh before WebSocket auth; no security validation.
 */
export function getAccessTokenExp(accessToken: string): number | null {
  try {
    const raw = accessToken.replace(/^\s*Bearer\s+/i, '').trim()
    const parts = raw.split('.')
    if (parts.length !== 3) return null
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const pad = base64.length % 4
    const padded = pad ? base64 + '='.repeat(4 - pad) : base64
    const json = atob(padded)
    const payload = JSON.parse(json) as { exp?: number }
    return typeof payload.exp === 'number' ? payload.exp : null
  } catch {
    return null
  }
}

/** Consider token expiring within this many seconds; refresh before WebSocket auth. */
export const EXPIRY_BUFFER_SEC = 60
