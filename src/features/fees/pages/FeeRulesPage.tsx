import { ContentShell, PageHeader } from '@/shared/layout'
import { FeeRulesTable } from '../components/FeeRulesTable'
import { Button } from '@/shared/ui/button'
import { useCanAccess } from '@/shared/utils/permissions'
import { useModalStore } from '@/app/store'
import { Plus, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useFeeRulesList } from '../hooks/useFeeRules'
import type { ListFeeRulesParams } from '../types/feeRule'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Input } from '@/shared/ui/input'
import { FeeRuleForm } from '../components/FeeRuleForm'
import { useGroupsList } from '@/features/groups/hooks/useGroups'
import { cn } from '@/shared/utils'

export function FeeRulesPage() {
  const openModal = useModalStore((state) => state.openModal)
  const closeModal = useModalStore((state) => state.closeModal)
  const canEdit = useCanAccess('fees:edit')
  const { data: groupsData } = useGroupsList()
  const groups = groupsData?.items ?? []
  const [filters, setFilters] = useState<{ group: string; symbol: string; status: string }>({
    group: 'all',
    symbol: '',
    status: 'all',
  })

  const listParams: ListFeeRulesParams = useMemo(
    () => ({
      groupId: filters.group === 'all' ? undefined : filters.group,
      symbol: filters.symbol.trim() || undefined,
      status: filters.status === 'all' ? undefined : filters.status,
    }),
    [filters]
  )

  const { data, isLoading, error } = useFeeRulesList(listParams)
  const rules = data?.items ?? []

  const hasActiveFilters =
    filters.symbol.trim() !== '' || filters.group !== 'all' || filters.status !== 'all'

  const handleClearFilters = () => {
    setFilters({ group: 'all', symbol: '', status: 'all' })
  }

  const handleCreate = () => {
    openModal('create-fee-rule', <FeeRuleForm mode="create" onDone={() => closeModal('create-fee-rule')} />, {
      title: 'Create fee rule',
      size: 'md',
    })
  }

  return (
    <ContentShell>
      <PageHeader
        title="Trading fees"
        description="Configure per-group fee rules as a percentage of notional with optional min/max (USD). Charges apply only when fees are enabled for the group and the Phase 2 engine is active."
        actions={
          canEdit ? (
            <Button onClick={handleCreate}>
              <Plus className="h-4 w-4 mr-2" />
              Create rule
            </Button>
          ) : null
        }
      />

      <div className="mb-6 flex min-w-0 flex-wrap items-end gap-x-3 gap-y-2">
        <div className="relative min-h-10 min-w-[min(100%,220px)] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <Input
            id="fee_filter_symbol"
            type="search"
            placeholder="Symbol contains (e.g. BTC)"
            value={filters.symbol}
            onChange={(e) => setFilters((f) => ({ ...f, symbol: e.target.value }))}
            className={cn('w-full min-w-0 pl-9', filters.symbol.trim() && 'pr-9')}
          />
          {filters.symbol.trim() ? (
            <button
              type="button"
              onClick={() => setFilters((f) => ({ ...f, symbol: '' }))}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-text-muted hover:bg-surface-2 hover:text-text"
              aria-label="Clear symbol filter"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        <Select value={filters.group} onValueChange={(v) => setFilters((f) => ({ ...f, group: v }))}>
          <SelectTrigger className="h-10 w-fit min-w-[13rem] max-w-[min(100%,26rem)] shrink-0">
            <SelectValue placeholder="Group" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All groups</SelectItem>
            {groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.status} onValueChange={(v) => setFilters((f) => ({ ...f, status: v }))}>
          <SelectTrigger className="h-10 w-fit min-w-[10.5rem] max-w-[min(100%,15rem)] shrink-0">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="disabled">Disabled</SelectItem>
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={!hasActiveFilters}
          onClick={handleClearFilters}
        >
          Clear
        </Button>
      </div>

      {error && (
        <p className="mb-4 text-sm text-danger">
          {(error as Error).message || 'Failed to load fee rules'}
        </p>
      )}

      <FeeRulesTable rules={rules} isLoading={isLoading} />
    </ContentShell>
  )
}
