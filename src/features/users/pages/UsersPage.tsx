import { ContentShell, PageHeader } from '@/shared/layout'
import { UsersTable } from '../components/UsersTable'
import { UserFilters } from '../components/UserFilters'
import { mockUsers } from '../mocks/users.mock'
import { Button } from '@/shared/ui/button'
import { Plus } from 'lucide-react'

export function UsersPage() {
  return (
    <ContentShell>
      <PageHeader
        title="Users"
        description="Manage platform users and their permissions"
        actions={
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Add User
          </Button>
        }
      />
      <UserFilters />
      <UsersTable users={mockUsers} />
    </ContentShell>
  )
}

