import { Badge } from '@/shared/ui/badge'
import { Wifi, WifiOff } from 'lucide-react'

export function AdminTradingHeader() {
  return (
    <div className="flex items-center justify-between mb-4 p-3 bg-surface-2 rounded-lg border border-border">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Wifi className="h-4 w-4 text-success" />
          <span className="text-sm font-medium text-text">Realtime:</span>
          <Badge variant="success" className="text-xs">
            ON
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-muted">Last update:</span>
          <span className="text-sm font-mono text-text">—</span>
        </div>
      </div>
      <Badge variant="danger" className="text-xs">
        LIVE
      </Badge>
    </div>
  )
}

