import { ContentShell, PageHeader } from '@/shared/layout'
import { Button } from '@/shared/ui/button'
import { ProfilesTable } from '../components/ProfilesTable'
import { CreateProfileModal } from '../modals/CreateProfileModal'
import { useModalStore } from '@/app/store'
import { useMarkupProfiles } from '../hooks/useMarkup'
import { Plus, RefreshCw } from 'lucide-react'
import { Spinner } from '@/shared/ui/loading'
import { EmptyState } from '@/shared/ui/empty'

export function AdminMarkupPage() {
  const openModal = useModalStore((state) => state.openModal)
  const { data: profiles, isLoading, error, refetch } = useMarkupProfiles()

  const handleCreateProfile = () => {
    openModal('create-profile', <CreateProfileModal />, {
      title: 'Create Markup Profile',
      size: 'md',
    })
  }

  return (
    <ContentShell>
      <PageHeader
        title="Price Markup Profiles"
        description="Configure real-time bid/ask markup profiles. Click on a profile to edit symbol markups."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => refetch()} disabled={isLoading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button onClick={handleCreateProfile}>
              <Plus className="h-4 w-4 mr-2" />
              Create Profile
            </Button>
          </div>
        }
      />
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner className="h-8 w-8" />
        </div>
      ) : error ? (
        <div className="text-center py-12">
          <p className="text-danger">Failed to load profiles</p>
          <Button variant="outline" onClick={() => refetch()} className="mt-4">
            Retry
          </Button>
        </div>
      ) : !profiles || profiles.length === 0 ? (
        <EmptyState
          title="No profiles found"
          description="Create your first markup profile to get started"
          action={
            <Button onClick={handleCreateProfile}>
              <Plus className="h-4 w-4 mr-2" />
              Create Profile
            </Button>
          }
        />
      ) : (
        <ProfilesTable profiles={profiles} isLoading={isLoading} />
      )}
    </ContentShell>
  )
}

