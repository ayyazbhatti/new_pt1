import { useState, useCallback } from 'react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'
import { useGroupsList } from '@/features/groups/hooks/useGroups'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from '@/shared/components/common'
import type { BulkUserRow } from '../types'

function createEmptyRow(): BulkUserRow {
  return {
    id: crypto.randomUUID(),
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    country: '',
    groupId: '',
    status: 'active',
    minLeverage: 1,
    maxLeverage: 500,
  }
}

export function BulkCreateUsersSection() {
  const [rows, setRows] = useState<BulkUserRow[]>(() => [createEmptyRow()])
  const { data: groupsData, isLoading: groupsLoading } = useGroupsList({
    page_size: 100,
  })
  const groups = groupsData?.items ?? []

  const addRow = useCallback(() => {
    setRows((prev) => [...prev, createEmptyRow()])
  }, [])

  const removeRow = useCallback((id: string) => {
    setRows((prev) => {
      const next = prev.filter((r) => r.id !== id)
      return next.length === 0 ? [createEmptyRow()] : next
    })
  }, [])

  const updateRow = useCallback((id: string, updates: Partial<BulkUserRow>) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...updates } : r))
    )
  }, [])

  const handleCreateUsers = useCallback(() => {
    const valid = rows.filter(
      (r) =>
        r.firstName.trim() &&
        r.lastName.trim() &&
        r.email.trim() &&
        r.country.trim() &&
        r.groupId &&
        r.minLeverage >= 1 &&
        r.maxLeverage >= 1 &&
        r.minLeverage <= r.maxLeverage
    )
    if (valid.length === 0) {
      toast.error('Add at least one user with First name, Last name, Email, Country, Group, and valid leverage.')
      return
    }
    // TODO: call bulk create API
    toast.info(`Bulk create: ${valid.length} user(s) — integration coming soon.`)
  }, [rows])

  return (
    <section className="rounded-lg border border-border bg-surface-2/50 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-text">Bulk create users</h2>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            <Plus className="h-4 w-4 mr-1.5" />
            Add user
          </Button>
        </div>
      </div>
      <p className="text-sm text-text-muted mb-4">
        Add one or more users below. All fields in a row are required except Phone.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-text-muted">
              <th className="pb-2 pr-2 font-medium">First name</th>
              <th className="pb-2 pr-2 font-medium">Last name</th>
              <th className="pb-2 pr-2 font-medium">Email</th>
              <th className="pb-2 pr-2 font-medium">Phone</th>
              <th className="pb-2 pr-2 font-medium">Country</th>
              <th className="pb-2 pr-2 font-medium">Group</th>
              <th className="pb-2 pr-2 font-medium">Status</th>
              <th className="pb-2 pr-2 font-medium">Min lev</th>
              <th className="pb-2 pr-2 font-medium">Max lev</th>
              <th className="pb-2 w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border/70 align-top">
                <td className="py-2 pr-2">
                  <Input
                    placeholder="First name"
                    value={row.firstName}
                    onChange={(e) =>
                      updateRow(row.id, { firstName: e.target.value })
                    }
                    className="h-8"
                  />
                </td>
                <td className="py-2 pr-2">
                  <Input
                    placeholder="Last name"
                    value={row.lastName}
                    onChange={(e) =>
                      updateRow(row.id, { lastName: e.target.value })
                    }
                    className="h-8"
                  />
                </td>
                <td className="py-2 pr-2">
                  <Input
                    type="email"
                    placeholder="email@example.com"
                    value={row.email}
                    onChange={(e) =>
                      updateRow(row.id, { email: e.target.value })
                    }
                    className="h-8"
                  />
                </td>
                <td className="py-2 pr-2">
                  <Input
                    placeholder="Phone"
                    value={row.phone}
                    onChange={(e) =>
                      updateRow(row.id, { phone: e.target.value })
                    }
                    className="h-8"
                  />
                </td>
                <td className="py-2 pr-2">
                  <Input
                    placeholder="US"
                    value={row.country}
                    onChange={(e) =>
                      updateRow(row.id, { country: e.target.value })
                    }
                    className="h-8"
                  />
                </td>
                <td className="py-2 pr-2">
                  <Select
                    value={row.groupId || '_'}
                    onValueChange={(v) =>
                      updateRow(row.id, {
                        groupId: v === '_' ? '' : v,
                      })
                    }
                    disabled={groupsLoading}
                  >
                    <SelectTrigger className="h-8 min-w-[120px]">
                      <SelectValue
                        placeholder={
                          groupsLoading ? 'Loading…' : 'Select group'
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_">
                        {groupsLoading ? 'Loading…' : 'Select group'}
                      </SelectItem>
                      {groups.map((g) => (
                        <SelectItem key={g.id} value={g.id}>
                          {g.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="py-2 pr-2">
                  <Select
                    value={row.status}
                    onValueChange={(v) =>
                      updateRow(row.id, {
                        status: v as 'active' | 'disabled',
                      })
                    }
                  >
                    <SelectTrigger className="h-8 min-w-[90px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="disabled">Disabled</SelectItem>
                    </SelectContent>
                  </Select>
                </td>
                <td className="py-2 pr-2">
                  <Input
                    type="number"
                    min={1}
                    max={1000}
                    className="h-8 w-20"
                    value={row.minLeverage || ''}
                    onChange={(e) =>
                      updateRow(row.id, {
                        minLeverage: e.target.value
                          ? parseInt(e.target.value, 10) || 1
                          : 1,
                      })
                    }
                  />
                </td>
                <td className="py-2 pr-2">
                  <Input
                    type="number"
                    min={1}
                    max={1000}
                    className="h-8 w-20"
                    value={row.maxLeverage || ''}
                    onChange={(e) =>
                      updateRow(row.id, {
                        maxLeverage: e.target.value
                          ? parseInt(e.target.value, 10) || 500
                          : 500,
                      })
                    }
                  />
                </td>
                <td className="py-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-text-muted hover:text-danger"
                    onClick={() => removeRow(row.id)}
                    title="Remove row"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex justify-end border-t border-border pt-4">
        <Button onClick={handleCreateUsers}>
          Create {rows.length} user{rows.length !== 1 ? 's' : ''}
        </Button>
      </div>
    </section>
  )
}
