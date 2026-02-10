import { User } from '../types/user'
import { Card } from '@/shared/ui/card'
import { Badge } from '@/shared/ui/badge'

interface UserDetailsModalProps {
  user: User
}

export function UserDetailsModal({ user }: UserDetailsModalProps) {
  const statusVariant = user.status === 'active' ? 'success' : user.status === 'suspended' ? 'danger' : 'neutral'

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-text-muted">Name</label>
            <p className="mt-1 text-text">{user.name}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-text-muted">Email</label>
            <p className="mt-1 text-text">{user.email}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-text-muted">Role</label>
            <p className="mt-1 text-text">{user.role}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-text-muted">Status</label>
            <div className="mt-1">
              <Badge variant={statusVariant}>{user.status}</Badge>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-text-muted">Created At</label>
            <p className="mt-1 text-text">{user.createdAt}</p>
          </div>
          {user.lastLogin && (
            <div>
              <label className="text-sm font-medium text-text-muted">Last Login</label>
              <p className="mt-1 text-text">{user.lastLogin}</p>
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}

