import { ContentShell, PageHeader } from '@/shared/layout'
import { SymbolsTable } from '../components/SymbolsTable'
import { SymbolsFilters } from '../components/SymbolsFilters'
import { mockSymbols } from '../mocks/symbols.mock'
import { Button } from '@/shared/ui/button'
import { AddSymbolModal } from '../modals/AddSymbolModal'
import { useModalStore } from '@/app/store'
import { Plus, Upload } from 'lucide-react'
import { useState } from 'react'

export function SymbolsPage() {
  const openModal = useModalStore((state) => state.openModal)
  const [filters, setFilters] = useState<{
    search: string
    market: string
    status: string
  }>({
    search: '',
    market: 'all',
    status: 'all',
  })

  const handleAddSymbol = () => {
    openModal('add-symbol', <AddSymbolModal />, {
      title: 'Add Symbol',
      size: 'lg',
    })
  }

  return (
    <ContentShell>
      <PageHeader
        title="Symbols"
        description="Manage tradable instruments, leverage profiles, and group markups"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" disabled>
              <Upload className="h-4 w-4 mr-2" />
              Import
            </Button>
            <Button onClick={handleAddSymbol}>
              <Plus className="h-4 w-4 mr-2" />
              Add Symbol
            </Button>
          </div>
        }
      />
      <SymbolsFilters onFilterChange={setFilters} />
      <SymbolsTable symbols={mockSymbols} filters={filters} />
    </ContentShell>
  )
}

