import { ContentShell, PageHeader } from '@/shared/layout'
import { SymbolsTable } from '../components/SymbolsTable'
import { SymbolsFilters } from '../components/SymbolsFilters'
import { Button } from '@/shared/ui/button'
import { useCanAccess } from '@/shared/utils/permissions'
import { AddSymbolModal } from '../modals/AddSymbolModal'
import { useModalStore } from '@/app/store'
import { Loader2, Plus, Upload } from 'lucide-react'
import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAdminSymbolsList, useSyncMmdpsSymbols } from '../hooks/useSymbols'
import { useLeverageProfilesList } from '@/features/leverageProfiles/hooks/useLeverageProfiles'
import { Skeleton } from '@/shared/ui/loading'
import { EmptyState } from '@/shared/ui/empty'

// Simple debounce implementation
function debounce<T extends (...args: any[]) => void>(func: T, wait: number) {
  let timeout: NodeJS.Timeout | null = null
  const debounced = (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }
  debounced.cancel = () => {
    if (timeout) clearTimeout(timeout)
  }
  return debounced
}

export function SymbolsPage() {
  const canCreateSymbol = useCanAccess('symbols:create')
  const openModal = useModalStore((state) => state.openModal)
  const [searchParams, setSearchParams] = useSearchParams()

  // Get params from URL
  const search = searchParams.get('search') || ''
  const assetClass = searchParams.get('asset_class') || 'all'
  const isEnabled = searchParams.get('is_enabled') || 'all'
  const page = parseInt(searchParams.get('page') || '1', 10)
  const pageSize = parseInt(searchParams.get('page_size') || '20', 10)
  const sort = searchParams.get('sort') || 'updated_desc'

  // Prefetch leverage profiles so dropdown has data when table renders (same query key = cache shared with table)
  useLeverageProfilesList({ page_size: 500 })

  // Fetch symbols
  const syncMmdps = useSyncMmdpsSymbols()
  const [mmdpsPruneOffListStocks, setMmdpsPruneOffListStocks] = useState(false)

  const { data, isLoading, error, refetch } = useAdminSymbolsList({
    search: search || undefined,
    asset_class: assetClass !== 'all' ? assetClass : undefined,
    is_enabled: isEnabled !== 'all' ? isEnabled : undefined,
    page,
    page_size: pageSize,
    sort,
  })

  // Debounced search
  const [searchInput, setSearchInput] = useState(search)
  const debouncedSetSearch = useMemo(
    () =>
      debounce((value: string) => {
        setSearchParams((prev) => {
          const newParams = new URLSearchParams(prev)
          if (value) {
            newParams.set('search', value)
          } else {
            newParams.delete('search')
          }
          newParams.set('page', '1')
          return newParams
        })
      }, 300),
    [setSearchParams]
  )

  useEffect(() => {
    debouncedSetSearch(searchInput)
    return () => {
      debouncedSetSearch.cancel()
    }
  }, [searchInput, debouncedSetSearch])

  const handleAddSymbol = () => {
    openModal('add-symbol', <AddSymbolModal />, {
      title: 'Add Symbol',
      size: 'lg',
    })
  }

  const handleFilterChange = (key: string, value: string) => {
    setSearchParams((prev) => {
      const newParams = new URLSearchParams(prev)
      if (value && value !== 'all') {
        newParams.set(key, value)
      } else {
        newParams.delete(key)
      }
      newParams.set('page', '1')
      return newParams
    })
  }

  return (
    <ContentShell>
      <PageHeader
        title="Symbols"
        description="Manage tradable instruments, leverage profiles, and group markups"
        actions={
          <div className="flex items-center gap-2">
            {canCreateSymbol && (
              <label className="flex items-center gap-2 text-sm text-muted-foreground mr-2">
                <input
                  type="checkbox"
                  checked={mmdpsPruneOffListStocks}
                  onChange={(e) => setMmdpsPruneOffListStocks(e.target.checked)}
                />
                Prune off-list stocks/indices
              </label>
            )}
            {canCreateSymbol && (
              <Button
                variant="outline"
                disabled={syncMmdps.isPending}
                onClick={() =>
                  syncMmdps.mutate({
                    prune_stocks_not_in_mmdps_feed: mmdpsPruneOffListStocks,
                  })
                }
                title="Fetches symbols from MMDPS /feed/symbols and upserts. Optional: disable stocks/indices not in that feed (never touches Crypto)."
              >
                {syncMmdps.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                Sync from MMDPS
              </Button>
            )}
            {canCreateSymbol && (
              <Button onClick={handleAddSymbol}>
                <Plus className="h-4 w-4 mr-2" />
                Add Symbol
              </Button>
            )}
          </div>
        }
      />
      <SymbolsFilters
        search={searchInput}
        onSearchChange={setSearchInput}
        assetClass={assetClass}
        isEnabled={isEnabled}
        onFilterChange={handleFilterChange}
      />
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : error ? (
        <div className="text-center py-12">
          <p className="text-danger">Failed to load symbols</p>
          <Button variant="outline" onClick={() => refetch()} className="mt-4">
            Retry
          </Button>
        </div>
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          title="No symbols found"
          description="Create your first symbol to get started"
          action={
            canCreateSymbol ? (
              <Button onClick={handleAddSymbol}>
                <Plus className="h-4 w-4 mr-2" />
                Add Symbol
              </Button>
            ) : undefined
          }
        />
      ) : (
        <SymbolsTable
          symbols={data.items}
          total={data.total}
          page={data.page}
          pageSize={data.page_size}
          onPageChange={(newPage) => {
            setSearchParams((prev) => {
              const newParams = new URLSearchParams(prev)
              newParams.set('page', newPage.toString())
              return newParams
            })
          }}
          onPageSizeChange={(newSize) => {
            setSearchParams((prev) => {
              const newParams = new URLSearchParams(prev)
              newParams.set('page_size', newSize.toString())
              newParams.set('page', '1')
              return newParams
            })
          }}
        />
      )}
    </ContentShell>
  )
}

