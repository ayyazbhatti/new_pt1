import { ChartTopBar } from './ChartTopBar'
import { ChartPlaceholder } from './ChartPlaceholder'
import { BottomDock } from './BottomDock'

export function CenterWorkspace() {
  return (
    <div className="h-full min-h-0 overflow-hidden flex flex-col">
      <div className="shrink-0">
        <ChartTopBar />
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <ChartPlaceholder />
      </div>
      <div className="shrink-0">
        <BottomDock />
      </div>
    </div>
  )
}

