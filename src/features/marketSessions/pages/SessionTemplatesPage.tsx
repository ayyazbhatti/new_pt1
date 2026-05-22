import { ContentShell, PageHeader } from '@/shared/layout'
import { SessionTemplatesTable } from '../components/SessionTemplatesTable'
import { Button } from '@/shared/ui/button'
import { useCanAccess } from '@/shared/utils/permissions'
import { useModalStore } from '@/app/store'
import { Plus } from 'lucide-react'
import { Card } from '@/shared/ui/card'
import { useSessionTemplatesList } from '../hooks/useSessionTemplates'
import { SessionTemplateForm } from '../components/SessionTemplateForm'

export function SessionTemplatesPage() {
  const openModal = useModalStore((state) => state.openModal)
  const closeModal = useModalStore((state) => state.closeModal)
  const canEdit = useCanAccess('sessions:edit')
  const { data: templates = [], isLoading, error } = useSessionTemplatesList()

  const handleCreate = () => {
    openModal('create-session-template', <SessionTemplateForm mode="create" onDone={() => closeModal('create-session-template')} />, {
      title: 'Create session template',
      size: 'lg',
    })
  }

  return (
    <ContentShell>
      <PageHeader
        title="Market sessions"
        description="Weekly recurring market hours per template. Symbols can override the default template for their market. Holidays and enforcement ship in later phases."
        actions={
          canEdit ? (
            <Button onClick={handleCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Create template
            </Button>
          ) : null
        }
      />

      {error ? (
        <Card className="p-4 text-sm text-danger">Failed to load templates. Ensure you have sessions:view permission.</Card>
      ) : (
        <Card className="p-4">
          <SessionTemplatesTable templates={templates} isLoading={isLoading} />
        </Card>
      )}
    </ContentShell>
  )
}
