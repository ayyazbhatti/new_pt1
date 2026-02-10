import { http } from './http'
import { RegisterData } from '../store/auth.store'

export interface AuthResponse {
  access_token: string
  refresh_token: string
  user: {
    id: string
    email: string
    first_name: string
    last_name: string
    role: string
    status: string
  }
}

export interface RefreshResponse {
  access_token: string
}

export interface UserResponse {
  id: string
  email: string
  first_name: string
  last_name: string
  role: string
  status: string
}

export async function login(email: string, password: string): Promise<{
  accessToken: string
  refreshToken: string
  user: {
    id: string
    email: string
    firstName: string
    lastName: string
    role: string
    status: string
  }
}> {
  const response = await http<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })

  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    user: {
      id: response.user.id,
      email: response.user.email,
      firstName: response.user.first_name,
      lastName: response.user.last_name,
      role: response.user.role,
      status: response.user.status,
    },
  }
}

export async function register(data: RegisterData): Promise<{
  accessToken: string
  refreshToken: string
  user: {
    id: string
    email: string
    firstName: string
    lastName: string
    role: string
    status: string
  }
}> {
  const response = await http<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      first_name: data.firstName,
      last_name: data.lastName,
      email: data.email,
      password: data.password,
      country: data.country,
      referral_code: data.referralCode,
    }),
  })

  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    user: {
      id: response.user.id,
      email: response.user.email,
      firstName: response.user.first_name,
      lastName: response.user.last_name,
      role: response.user.role,
      status: response.user.status,
    },
  }
}

export async function refresh(refreshToken: string): Promise<string> {
  const response = await http<RefreshResponse>('/api/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: refreshToken }),
  })

  return response.access_token
}

export async function logout(refreshToken: string): Promise<void> {
  // Logout requires auth token and returns 204 No Content
  // The http client will handle 204 responses
  await http('/api/auth/logout', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: refreshToken }),
  })
}

export async function me(): Promise<{
  id: string
  email: string
  firstName: string
  lastName: string
  role: string
  status: string
}> {
  const response = await http<UserResponse>('/api/auth/me', {
    method: 'GET',
  })

  return {
    id: response.id,
    email: response.email,
    firstName: response.first_name,
    lastName: response.last_name,
    role: response.role,
    status: response.status,
  }
}

