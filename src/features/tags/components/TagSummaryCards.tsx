import { Card } from '@/shared/ui/card'
import { Badge } from '@/shared/ui/badge'
import { Tag, Users, Layers } from 'lucide-react'
import type { Tag as TagType } from '../types/tag'

interface TagSummaryCardsProps {
  tags: TagType[]
}

export function TagSummaryCards({ tags }: TagSummaryCardsProps) {
  const totalTags = tags.length
  const totalAssigned = tags.reduce(
    (sum, t) => sum + (t.userCount ?? 0) + (t.managerCount ?? 0),
    0
  )
  const unusedCount = tags.filter(
    (t) => (t.userCount ?? 0) + (t.managerCount ?? 0) === 0
  ).length

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      <Card className="p-4 bg-surface-2">
        <div className="flex items-center gap-2 text-sm text-text-muted mb-1">
          <Tag className="h-4 w-4" />
          Total Tags
        </div>
        <div className="text-2xl font-bold text-text">{totalTags}</div>
        <Badge variant="neutral" className="text-xs mt-2">
          All tags
        </Badge>
      </Card>
      <Card className="p-4 bg-surface-2">
        <div className="flex items-center gap-2 text-sm text-text-muted mb-1">
          <Layers className="h-4 w-4" />
          Total Assignments
        </div>
        <div className="text-2xl font-bold text-text">{totalAssigned}</div>
        <Badge variant="neutral" className="text-xs mt-2">
          Users + managers
        </Badge>
      </Card>
      <Card className="p-4 bg-surface-2">
        <div className="flex items-center gap-2 text-sm text-text-muted mb-1">
          <Users className="h-4 w-4" />
          Unused Tags
        </div>
        <div className="text-2xl font-bold text-text">{unusedCount}</div>
        <Badge variant="neutral" className="text-xs mt-2">
          Not assigned yet
        </Badge>
      </Card>
    </div>
  )
}
