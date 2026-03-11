import { ColumnDef } from '@tanstack/react-table'
import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { DataTable } from '@/shared/ui/table'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { SwapRule } from '../types/swap'
import { useModalStore } from '@/app/store'
import { useCanAccess } from '@/shared/utils/permissions'
import { EditSwapRuleModal } from '../modals/EditSwapRuleModal'
import { PreviewSwapModal } from '../modals/PreviewSwapModal'
import { ConfirmDeleteModal } from '../modals/ConfirmDeleteModal'
import { Eye, Edit, X, Trash2, Tag, ChevronDown } from 'lucide-react'
import { Checkbox } from '@/shared/ui/Checkbox'
import { setSwapRuleTags } from '../api/swap.api'
import { toast } from '@/shared/components/common'
import { cn } from '@/shared/utils'
import { Spinner } from '@/shared/ui/loading'

interface SwapRulesTableProps {
  rules: SwapRule[]
  isLoading?: boolean
  onDisable?: (rule: SwapRule) => void
  allTags?: { id: string; name: string }[]
  onRefresh?: () => void
}

export function SwapRulesTable({ rules, isLoading, onDisable, allTags = [], onRefresh }: SwapRulesTableProps) {
  const openModal = useModalStore((state) => state.openModal)
  const canEdit = useCanAccess('swap:edit')
  const canDelete = useCanAccess('swap:delete')
  const canTags = useCanAccess('swap:edit')
  const [openTagsRuleId, setOpenTagsRuleId] = useState<string | null>(null)
  const [openTagsAnchorRect, setOpenTagsAnchorRect] = useState<DOMRect | null>(null)
  const [updatingTagsRuleId, setUpdatingTagsRuleId] = useState<string | null>(null)
  const tagsDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (openTagsRuleId == null) return
    const handleClickOutside = (e: MouseEvent) => {
      if (tagsDropdownRef.current && !tagsDropdownRef.current.contains(e.target as Node)) {
        setOpenTagsRuleId(null)
        setOpenTagsAnchorRect(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [openTagsRuleId])

  const handlePreview = (rule: SwapRule) => {
    openModal(`preview-swap-${rule.id}`, <PreviewSwapModal rule={rule} />, {
      title: `Swap Preview - ${rule.symbol}`,
      size: 'lg',
    })
  }

  const handleEdit = (rule: SwapRule) => {
    openModal(`edit-swap-${rule.id}`, <EditSwapRuleModal rule={rule} />, {
      title: 'Edit Swap Rule',
      size: 'md',
    })
  }

  const handleDelete = (rule: SwapRule) => {
    openModal(`delete-swap-${rule.id}`, <ConfirmDeleteModal rule={rule} />, {
      title: 'Confirm Delete',
      size: 'sm',
    })
  }

  const handleDisable = (rule: SwapRule) => {
    onDisable?.(rule)
  }

  const getCalcModeLabel = (mode: string) => {
    switch (mode) {
      case 'daily':
        return 'Daily'
      case 'hourly':
        return 'Hourly'
      case 'funding_8h':
        return '8H'
      default:
        return mode
    }
  }

  const getWeekendRuleLabel = (rule: SwapRule) => {
    if (rule.weekendRule === 'triple_day' && rule.tripleDay) {
      return `Triple ${rule.tripleDay}`
    } else if (rule.weekendRule === 'fri_triple') {
      return 'Fri Triple'
    } else if (rule.weekendRule === 'custom') {
      return 'Custom'
    }
    return 'None'
  }

  const columns: ColumnDef<SwapRule>[] = [
    {
      accessorKey: 'groupName',
      header: 'Group',
    },
    {
      accessorKey: 'symbol',
      header: 'Symbol',
      cell: ({ row }) => {
        return <span className="font-mono font-semibold">{row.getValue('symbol')}</span>
      },
    },
    {
      accessorKey: 'market',
      header: 'Market',
      cell: ({ row }) => {
        const market = row.getValue('market') as string
        return <span className="capitalize">{market}</span>
      },
    },
    {
      accessorKey: 'calcMode',
      header: 'Calc Mode',
      cell: ({ row }) => {
        const mode = row.getValue('calcMode') as string
        return <Badge variant="neutral">{getCalcModeLabel(mode)}</Badge>
      },
    },
    {
      accessorKey: 'unit',
      header: 'Unit',
      cell: ({ row }) => {
        const unit = row.getValue('unit') as string
        return <span className="capitalize">{unit}</span>
      },
    },
    {
      accessorKey: 'longRate',
      header: 'Long Rate',
      cell: ({ row }) => {
        const rule = row.original
        const suffix = rule.unit === 'percent' ? '%' : ''
        return (
          <span className="font-mono text-success">
            {rule.longRate >= 0 ? '+' : ''}
            {rule.longRate.toFixed(rule.unit === 'percent' ? 3 : 2)}
            {suffix}
          </span>
        )
      },
    },
    {
      accessorKey: 'shortRate',
      header: 'Short Rate',
      cell: ({ row }) => {
        const rule = row.original
        const suffix = rule.unit === 'percent' ? '%' : ''
        return (
          <span className="font-mono text-danger">
            {rule.shortRate >= 0 ? '+' : ''}
            {rule.shortRate.toFixed(rule.unit === 'percent' ? 3 : 2)}
            {suffix}
          </span>
        )
      },
    },
    {
      accessorKey: 'rolloverTimeUtc',
      header: 'Rollover Time',
      cell: ({ row }) => {
        return <span className="font-mono text-sm">{row.getValue('rolloverTimeUtc')} UTC</span>
      },
    },
    {
      id: 'weekendRule',
      header: 'Weekend / Triple',
      cell: ({ row }) => {
        const rule = row.original
        return <span className="text-sm">{getWeekendRuleLabel(rule)}</span>
      },
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const status = row.getValue('status') as string
        const variant = status === 'active' ? 'success' : 'danger'
        return <Badge variant={variant}>{status}</Badge>
      },
    },
    {
      accessorKey: 'createdByEmail',
      header: 'Created by',
      cell: ({ row }) => {
        const email = row.original.createdByEmail
        return <span className="text-muted-foreground text-sm">{email ?? '—'}</span>
      },
    },
    ...(canTags
      ? [
          {
            id: 'tags',
            header: 'Tags',
            cell: ({ row }: { row: { original: SwapRule } }) => {
              const rule = row.original
              const tagIds = rule.tagIds ?? []
              const isOpen = openTagsRuleId === rule.id
              const isUpdating = updatingTagsRuleId === rule.id
              const label =
                tagIds.length > 0
                  ? `${tagIds.length} tag${tagIds.length === 1 ? '' : 's'}`
                  : 'Assign tags'
              return (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-text"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (isOpen) {
                      setOpenTagsRuleId(null)
                      setOpenTagsAnchorRect(null)
                    } else {
                      setOpenTagsRuleId(rule.id)
                      setOpenTagsAnchorRect((e.currentTarget as HTMLElement).getBoundingClientRect())
                    }
                  }}
                  disabled={isUpdating}
                >
                  {isUpdating && <Spinner className="h-3.5 w-3.5 shrink-0" />}
                  <Tag className="h-4 w-4 shrink-0" />
                  <span className="max-w-[80px] truncate">{label}</span>
                  <ChevronDown
                    className={cn('h-4 w-4 shrink-0 transition-transform', isOpen && 'rotate-180')}
                  />
                </Button>
              )
            },
          } as ColumnDef<SwapRule>,
        ]
      : []),
    {
      accessorKey: 'updatedAt',
      header: 'Updated',
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const rule = row.original
        return (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handlePreview(rule)}
              title="Preview"
            >
              <Eye className="h-4 w-4" />
            </Button>
            {canEdit && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleEdit(rule)}
                  title="Edit"
                >
                  <Edit className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDisable(rule)}
                  title={rule.status === 'active' ? 'Disable' : 'Enable'}
                >
                  <X className="h-4 w-4" />
                </Button>
              </>
            )}
            {canDelete && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDelete(rule)}
                className="text-danger hover:text-danger hover:bg-danger/10"
                title="Delete"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        )
      },
    },
  ]

  const openTagsRule = openTagsRuleId ? rules.find((r) => r.id === openTagsRuleId) : null
  const openTagsTagIds = openTagsRule?.tagIds ?? []

  const tagsDropdownPanel =
    openTagsRuleId && openTagsAnchorRect
      ? createPortal(
          <div
            ref={tagsDropdownRef}
            className="fixed z-[100] min-w-[180px] rounded-lg border border-border bg-surface-1 py-1 shadow-lg"
            style={{
              left: openTagsAnchorRect.left,
              top: openTagsAnchorRect.bottom + 4,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {allTags.length === 0 ? (
              <div className="px-3 py-2 text-sm text-text-muted">No tags defined</div>
            ) : (
              <div className="max-h-[220px] overflow-y-auto">
                {allTags.map((tag) => (
                  <label
                    key={tag.id}
                    className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-surface-2"
                  >
                    <Checkbox
                      checked={openTagsTagIds.includes(tag.id)}
                      onChange={(e) => {
                        const checked = e.target.checked
                        const next = checked
                          ? [...openTagsTagIds, tag.id]
                          : openTagsTagIds.filter((id) => id !== tag.id)
                        setUpdatingTagsRuleId(openTagsRuleId)
                        setSwapRuleTags(openTagsRuleId, next)
                          .then(() => {
                            onRefresh?.()
                            toast.success('Tags updated')
                          })
                          .catch(() => toast.error('Failed to update tags'))
                          .finally(() => setUpdatingTagsRuleId(null))
                      }}
                    />
                    <span className="text-text">{tag.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>,
          document.body
        )
      : null

  if (isLoading) {
    return (
      <div className="text-sm text-text-muted py-8 text-center">
        Loading swap rules...
      </div>
    )
  }
  return (
    <>
      <DataTable data={rules} columns={columns} />
      {tagsDropdownPanel}
    </>
  )
}

