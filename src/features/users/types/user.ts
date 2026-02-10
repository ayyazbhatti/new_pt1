export interface User {
  id: string
  email: string
  name: string
  status: 'active' | 'inactive' | 'suspended'
  role: string
  createdAt: string
  lastLogin?: string
}

