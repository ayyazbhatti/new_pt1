import { useMemo } from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/shared/ui/table'
import { Button } from '@/shared/ui/button'
import type { Tag } from '../types/tag'
import { formatDateTime } from '@/shared/utils/time'
import { Pencil, Trash2 } from 'lucide-react'
import { useCanAccess } from '@/shared/utils/permissions'

interface TagsTableProps {
  tags: Tag[]
  onEdit?: (tag: Tag) => void
  onDelete?: (tag: Tag) => void
  /** When true, empty state suggests clearing filters instead of creating first tag */
  hasActiveFilters?: boolean
}

export function TagsTable({ tags, onEdit, onDelete, hasActiveFilters }: TagsTableProps) {
  const canEdit = useCanAccess('tags:edit')
  const canDelete = useCanAccess('tags:delete')

  const columns: ColumnDef<Tag>[] = useMemo(() => [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => {
        const tag = row.original
        return (
          <div className="flex items-center gap-2">
            <span
              className="h-3 w-3 rounded-full shrink-0"
              style={{ backgroundColor: tag.color }}
              aria-hidden
            />
            <span className="font-medium text-text whitespace-nowrap">{tag.name}</span>
          </div>
        )
      },
    },
    {
      accessorKey: 'slug',
      header: 'Slug',
      cell: ({ row }) => (
        <span className="text-sm text-text-muted font-mono whitespace-nowrap">
          {row.original.slug}
        </span>
      ),
    },
    {
      accessorKey: 'color',
      header: 'Color',
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <span
            className="h-4 w-4 rounded border border-border"
            style={{ backgroundColor: row.original.color }}
          />
          <span className="text-sm font-mono text-text-muted">{row.original.color}</span>
        </div>
      ),
    },
    {
      accessorKey: 'description',
      header: 'Description',
      cell: ({ row }) => {
        const d = row.original.description
        return d ? (
          <span className="text-sm text-text-muted max-w-[200px] truncate block" title={d}>
            {d}
          </span>
        ) : (
          <span className="text-sm text-text-muted">—</span>
        )
      },
    },
    {
      id: 'assigned',
      header: 'Assigned',
      cell: ({ row }) => {
        const tag = row.original
        const total = (tag.userCount ?? 0) + (tag.managerCount ?? 0)
        if (total === 0) return <span className="text-sm text-text-muted">—</span>
        return (
          <span className="text-sm text-text-muted whitespace-nowrap">
            {tag.userCount ?? 0} users, {tag.managerCount ?? 0} managers
          </span>
        )
      },
    },
    {
      id: 'createdBy',
      header: 'Created by',
      cell: ({ row }) => {
        const email = row.original.createdByEmail
        return (
          <span className="text-sm text-text-muted whitespace-nowrap" title={email ?? undefined}>
            {email ?? '—'}
          </span>
        )
      },
    },
    {
      accessorKey: 'createdAt',
      header: 'Created',
      cell: ({ row }) => (
        <span className="text-sm text-text-muted whitespace-nowrap">
          {formatDateTime(row.original.createdAt)}
        </span>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const tag = row.original
        return (
          <div className="flex items-center gap-1">
            {canEdit && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onEdit?.(tag)}
                title="Edit tag"
              >
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {canDelete && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onDelete?.(tag)}
                title="Delete tag"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        )
      },
    },
  ], [canEdit, canDelete, onEdit, onDelete])

  if (tags.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface-2/50 p-12 text-center">
        <p className="text-text-muted mb-1">No tags found</p>
        <p className="text-sm text-text-muted">
          {hasActiveFilters
            ? 'Try adjusting your search or clear filters.'
            : 'Create your first tag to get started.'}
        </p>
      </div>
    )
  }

  return <DataTable data={tags} columns={columns} />
}
