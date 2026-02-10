import { User } from '../types/user'

export const mockUsers: User[] = [
  {
    id: '1',
    email: 'john.doe@example.com',
    name: 'John Doe',
    status: 'active',
    role: 'Trader',
    createdAt: '2024-01-15',
    lastLogin: '2024-01-20',
  },
  {
    id: '2',
    email: 'jane.smith@example.com',
    name: 'Jane Smith',
    status: 'active',
    role: 'Admin',
    createdAt: '2024-01-10',
    lastLogin: '2024-01-19',
  },
  {
    id: '3',
    email: 'bob.wilson@example.com',
    name: 'Bob Wilson',
    status: 'inactive',
    role: 'Trader',
    createdAt: '2023-12-20',
    lastLogin: '2024-01-05',
  },
  {
    id: '4',
    email: 'alice.brown@example.com',
    name: 'Alice Brown',
    status: 'suspended',
    role: 'Trader',
    createdAt: '2023-11-15',
    lastLogin: '2024-01-10',
  },
  {
    id: '5',
    email: 'charlie.davis@example.com',
    name: 'Charlie Davis',
    status: 'active',
    role: 'Manager',
    createdAt: '2024-01-01',
    lastLogin: '2024-01-20',
  },
]

