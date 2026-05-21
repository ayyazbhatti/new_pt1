import { ContentShell, PageHeader } from '@/shared/layout'
import { FeeRulesTable } from '../components/FeeRulesTable'
import { Button } from '@/shared/ui/button'
import { useCanAccess } from '@/shared/utils/permissions'
import { useModalStore } from '@/app/store'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Card } from '@/shared/ui/card'
import { useFeeRulesList } from '../hooks/useFeeRules'
import type { ListFeeRulesParams } from '../types/feeRule'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Label } from '@/shared/ui/label'
import { Input } from '@/shared/ui/input'
import { FeeRuleForm } from '../components/FeeRuleForm'
import { useGroupsList } from '@/features/groups/hooks/useGroups'

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

      <Card className="mb-6 p-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Group</Label>
            <Select value={filters.group} onValueChange={(v) => setFilters((f) => ({ ...f, group: v }))}>
              <SelectTrigger>
                <SelectValue />
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
          </div>
          <div className="space-y-2">
            <Label htmlFor="fee_filter_symbol">Symbol contains</Label>
            <Input
              id="fee_filter_symbol"
              value={filters.symbol}
              onChange={(e) => setFilters((f) => ({ ...f, symbol: e.target.value }))}
              placeholder="e.g. BTC"
            />
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={filters.status} onValueChange={(v) => setFilters((f) => ({ ...f, status: v }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="disabled">Disabled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {error && (
        <p className="mb-4 text-sm text-danger">
          {(error as Error).message || 'Failed to load fee rules'}
        </p>
      )}

      <FeeRulesTable rules={rules} isLoading={isLoading} />
    </ContentShell>
  )
}
