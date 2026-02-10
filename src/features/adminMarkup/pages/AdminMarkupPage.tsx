import { ContentShell, PageHeader } from '@/shared/layout'
import { Button } from '@/shared/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/ui/tabs'
import {
  PriceStreamProfilesPanel,
  GroupPriceProfilePanel,
  SymbolPriceOverridePanel,
} from '../components'
import { useModalStore } from '@/app/store'
import { CreateEditProfileModal } from '../modals/CreateEditProfileModal'
import { Plus } from 'lucide-react'

export function AdminMarkupPage() {
  const openModal = useModalStore((state) => state.openModal)

  const handleCreateProfile = () => {
    openModal('create-profile', <CreateEditProfileModal />, {
      title: 'Create Price Stream Profile',
      size: 'md',
    })
  }

  return (
    <ContentShell>
      <PageHeader
        title="Price Stream Profiles"
        description="Configure bid/ask markups and assign pricing profiles to groups and symbols."
        actions={
          <Button onClick={handleCreateProfile}>
            <Plus className="h-4 w-4 mr-2" />
            Create Profile
          </Button>
        }
      />
      <Tabs defaultValue="profiles" className="w-full">
        <TabsList>
          <TabsTrigger value="profiles">Profiles</TabsTrigger>
          <TabsTrigger value="group-assignment">Group Assignment</TabsTrigger>
          <TabsTrigger value="symbol-overrides">Symbol Overrides</TabsTrigger>
        </TabsList>
        <TabsContent value="profiles">
          <PriceStreamProfilesPanel />
        </TabsContent>
        <TabsContent value="group-assignment">
          <GroupPriceProfilePanel />
        </TabsContent>
        <TabsContent value="symbol-overrides">
          <SymbolPriceOverridePanel />
        </TabsContent>
      </Tabs>
    </ContentShell>
  )
}

