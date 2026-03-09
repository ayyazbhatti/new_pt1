import { useState, useRef, useEffect } from 'react'
import { ChartTopBar } from './ChartTopBar'
import { ChartPlaceholder, type ChartPlaceholderHandle } from './ChartPlaceholder'
import { ChartSettingsModal } from './ChartSettingsModal'
import { ChartTradingStrip } from './ChartTradingStrip'
import { BottomDock } from './BottomDock'
import type { ChartTypeKey, TimeframeKey } from '../utils/chartOptions'
import { DEFAULT_CHART_SETTINGS, type ChartSettings, type DrawingMagnetMode } from '../utils/chartOptions'
import { loadChartToolbarState, saveChartToolbarState, type PersistedChartToolbar } from '../utils/chartToolbarPersistence'
import { getDefaultIndicatorParams, type ChartIndicator } from '../utils/indicatorParams'

let initialToolbarState: PersistedChartToolbar | null = null
function getInitialToolbarState(): PersistedChartToolbar {
  if (!initialToolbarState) {
    initialToolbarState = loadChartToolbarState() ?? {
      chartType: 'candles',
      timeframe: '1m',
      indicators: [],
      drawingTool: null,
      drawingMagnetMode: 'normal',
      chartSettings: DEFAULT_CHART_SETTINGS,
    }
  }
  return initialToolbarState
}

export interface CenterWorkspaceProps {
  /** When true (e.g. mobile Chart tab), hide BottomDock so chart gets full height. */
  hideBottomDock?: boolean
  /** When true (e.g. mobile Positions tab), render only BottomDock in a full-height container. */
  mobileShowOnlyBottomDock?: boolean
}

export function CenterWorkspace({ hideBottomDock = false, mobileShowOnlyBottomDock = false }: CenterWorkspaceProps = {}) {
  const [chartType, setChartType] = useState<ChartTypeKey>(() => getInitialToolbarState().chartType)
  const [timeframe, setTimeframe] = useState<TimeframeKey>(() => getInitialToolbarState().timeframe)
  const [indicators, setIndicators] = useState<ChartIndicator[]>(() => getInitialToolbarState().indicators)
  const [drawingTool, setDrawingTool] = useState<string | null>(() => getInitialToolbarState().drawingTool)
  const [drawingMagnetMode, setDrawingMagnetMode] = useState<DrawingMagnetMode>(() => getInitialToolbarState().drawingMagnetMode)
  const [chartSettings, setChartSettings] = useState<ChartSettings>(() => getInitialToolbarState().chartSettings)
  const [chartSettingsOpen, setChartSettingsOpen] = useState(false)
  const [isChartFullscreen, setIsChartFullscreen] = useState(false)
  const chartFullscreenRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ChartPlaceholderHandle>(null)

  useEffect(() => {
    saveChartToolbarState({
      chartType,
      timeframe,
      indicators,
      drawingTool,
      drawingMagnetMode,
      chartSettings,
    })
  }, [chartType, timeframe, indicators, drawingTool, drawingMagnetMode, chartSettings])

  useEffect(() => {
    const el = chartFullscreenRef.current
    if (!el) return
    const onFullscreenChange = () => setIsChartFullscreen(!!document.fullscreenElement && document.fullscreenElement === el)
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  const toggleChartFullscreen = async () => {
    const el = chartFullscreenRef.current
    if (!el) return
    if (document.fullscreenElement) {
      await document.exitFullscreen()
    } else {
      await el.requestFullscreen()
    }
  }

  const downloadChartAs = (type: 'png' | 'jpeg') => {
    const url = chartRef.current?.getPictureUrl(type)
    if (!url) return
    const ext = type === 'jpeg' ? 'jpg' : 'png'
    const a = document.createElement('a')
    a.href = url
    a.download = `chart-${Date.now()}.${ext}`
    a.click()
  }

  if (mobileShowOnlyBottomDock) {
    return (
      <div className="h-full min-h-0 overflow-hidden flex flex-col bg-background">
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <BottomDock fullHeight />
        </div>
      </div>
    )
  }

  return (
    <div className="h-full min-h-0 overflow-hidden flex flex-col">
      <div ref={chartFullscreenRef} className="flex flex-1 min-h-0 flex-col overflow-hidden bg-background">
        <div className="shrink-0">
          <ChartTopBar
            chartType={chartType}
            timeframe={timeframe}
            indicators={indicators}
            drawingTool={drawingTool}
            drawingMagnetMode={drawingMagnetMode}
            onDrawingMagnetModeChange={setDrawingMagnetMode}
            isChartFullscreen={isChartFullscreen}
            onChartTypeChange={setChartType}
            onTimeframeChange={setTimeframe}
            onIndicatorAdd={(name) =>
              setIndicators((prev) =>
                prev.some((i) => i.name === name) ? prev : [...prev, { name, params: getDefaultIndicatorParams(name) }]
              )
            }
            onIndicatorRemove={(name) => setIndicators((prev) => prev.filter((i) => i.name !== name))}
            onIndicatorParamsChange={(name, params) =>
              setIndicators((prev) => prev.map((i) => (i.name === name ? { ...i, params } : i)))
            }
            onDrawingToolChange={setDrawingTool}
            onClearDrawings={() => chartRef.current?.clearOverlays()}
            onZoomIn={() => chartRef.current?.zoomIn()}
            onZoomOut={() => chartRef.current?.zoomOut()}
            onResetZoom={() => chartRef.current?.resetZoom()}
            onScrollToLatest={() => chartRef.current?.resetZoom()}
            onDownloadChart={downloadChartAs}
            onToggleFullscreen={toggleChartFullscreen}
            onOpenSettings={() => setChartSettingsOpen(true)}
          />
        </div>
        <div className="flex-1 min-h-0 overflow-hidden min-h-[200px]">
          <ChartPlaceholder
            ref={chartRef}
            chartType={chartType}
            timeframe={timeframe}
            indicators={indicators}
            drawingTool={drawingTool}
            drawingMagnetMode={drawingMagnetMode}
            chartSettings={chartSettings}
          />
        </div>
        {!isChartFullscreen && hideBottomDock && <ChartTradingStrip />}
      </div>
      <ChartSettingsModal
        open={chartSettingsOpen}
        onOpenChange={setChartSettingsOpen}
        settings={chartSettings}
        onSettingsChange={setChartSettings}
      />
      {!isChartFullscreen && !hideBottomDock && (
        <div className="shrink-0">
          <BottomDock />
        </div>
      )}
    </div>
  )
}

