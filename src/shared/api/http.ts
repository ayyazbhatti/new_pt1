import { useAuthStore } from '../store/auth.store'

export interface ApiError {
  error: {
    code: string
    message: string
  }
}

/** Extract a string message from an API error (thrown by http()). Use for toasts / UI. */
export function getApiErrorMessage(err: unknown): string {
  const data = (err as { response?: { data?: unknown } })?.response?.data
  if (data != null && typeof data === 'object') {
    const inner = (data as { error?: unknown }).error
    if (inner != null && typeof inner === 'object' && typeof (inner as { message?: string }).message === 'string') {
      return (inner as { message: string }).message
    }
    if (typeof inner === 'string') return inner
    const topLevel = (data as { message?: string }).message
    if (typeof topLevel === 'string') return topLevel
  }
  return err instanceof Error ? err.message : 'Request failed'
}

// In dev: same-origin so Vite's custom api-proxy middleware forwards /api and /v1 to auth-service.
// Set VITE_API_URL=http://localhost:3000 to bypass and call auth-service directly (CORS must allow your origin).
const API_BASE_URL =
  import.meta.env.VITE_API_URL !== undefined && import.meta.env.VITE_API_URL !== ''
    ? import.meta.env.VITE_API_URL
    : import.meta.env.DEV
      ? ''
      : 'http://localhost:3000'

export function getApiBaseUrl(): string {
  return API_BASE_URL || (typeof location !== 'undefined' ? `${location.origin}` : '')
}

const REQUEST_TIMEOUT_MS = 30_000 // 30s — avoid indefinite hang if proxy/network stalls

function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  return fetch(url, {
    ...options,
    signal: controller.signal,
  }).finally(() => clearTimeout(timeoutId))
}

let refreshPromise: Promise<string> | null = null

async function refreshAccessToken(): Promise<string> {
  if (refreshPromise) {
    return refreshPromise
  }

  const state = useAuthStore.getState()
  const refreshToken = state.refreshToken

  if (!refreshToken) {
    throw new Error('No refresh token available')
  }

  refreshPromise = (async () => {
    try {
      const response = await fetchWithTimeout(`${API_BASE_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })

      if (!response.ok) {
        const error: ApiError = await response.json()
        throw new Error(error.error.message || 'Failed to refresh token')
      }

      const data = await response.json()
      useAuthStore.getState().setTokens(data.access_token, refreshToken)
      // Refresh user (and permissions) in background; do not await so retry is not delayed (no polling)
      useAuthStore.getState().refreshUser().catch((e) => console.error('Failed to refresh user after token refresh', e))
      return data.access_token
    } finally {
      refreshPromise = null
    }
  })()

  return refreshPromise
}

// Endpoints where 401 means "invalid credentials" or "already logged out" — do not try token refresh
const SKIP_REFRESH_ON_401 = ['/api/auth/login', '/api/auth/register', '/api/auth/logout']

export async function http<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const state = useAuthStore.getState()
  const accessToken = state.accessToken
  const isAuthEndpoint = SKIP_REFRESH_ON_401.some((path) => endpoint.startsWith(path) || endpoint.endsWith(path))

  // Build headers (omit Content-Type for FormData so browser sets multipart boundary)
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  }
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }

  // Add auth header if token exists (skip for login/register so we don't send stale token)
  if (accessToken && !isAuthEndpoint) {
    headers['Authorization'] = `Bearer ${accessToken}`
  }

  // Make request (direct to auth-service in dev to avoid Vite proxy hanging)
  let response: Response
  try {
    response = await fetchWithTimeout(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error && err.name === 'AbortError'
      ? 'Request timed out. Is the auth server running on port 3000?'
      : err instanceof Error ? err.message : 'Network error'
    throw new Error(msg)
  }

  // If 401, try to refresh token once (except for login/register where 401 = invalid credentials)
  if (response.status === 401 && accessToken && !isAuthEndpoint) {
    try {
      const newAccessToken = await refreshAccessToken()
      ;(headers as Record<string, string>)['Authorization'] = `Bearer ${newAccessToken}`

      // Retry original request
      try {
        response = await fetchWithTimeout(`${API_BASE_URL}${endpoint}`, {
          ...options,
          headers,
        })
      } catch (retryErr: unknown) {
        const msg = retryErr instanceof Error && retryErr.name === 'AbortError'
          ? 'Request timed out. Is the auth server running on port 3000?'
          : retryErr instanceof Error ? retryErr.message : 'Network error'
        throw new Error(msg)
      }
    } catch (error) {
      // Refresh failed, logout user
      useAuthStore.getState().logout()
      throw error
    }
  }

  // Handle errors
  if (!response.ok) {
    let error: ApiError
    try {
      const text = await response.text()
      if (text) {
        error = JSON.parse(text)
      } else {
        throw new Error('Empty response')
      }
    } catch {
      const code = response.status === 401 ? 'UNAUTHORIZED' : response.status === 400 ? 'BAD_REQUEST' : response.status === 404 ? 'NOT_FOUND' : 'UNKNOWN_ERROR'
      const message = response.status === 500
        ? 'Server error. If this persists, ensure auth-service is running and DATABASE_URL is set (check server logs).'
        : `HTTP ${response.status}: ${response.statusText}`
      error = { error: { code, message } }
    }
    
    // Create error object with response data for better error handling
    const errorObj = new Error(error.error.message || 'Request failed') as any
    errorObj.response = { data: error, status: response.status }
    throw errorObj
  }

  // Handle 204 No Content (logout, reopen position, etc.)
  if (response.status === 204) {
    return null as T
  }

  // Parse JSON; treat empty body as null (e.g. 200 with no content)
  const text = await response.text()
  if (!text || text.trim() === '') {
    return null as T
  }
  return JSON.parse(text) as T
}

