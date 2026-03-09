import { useEffect, useState, useRef } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Settings, Maximize2, Minimize2, Pencil, X, SlidersHorizontal, ZoomIn, ZoomOut, SkipForward, Trash2, Download, BarChart2, BarChart3, Magnet, Minus, ArrowUpRight, Square, Tag, Type, DollarSign, Layers, Hash, CircleOff, TrendingUp, Activity, Gauge, Percent, Move, Anchor } from 'lucide-react'
import { Segmented } from '@/shared/ui'
import { useTerminalStore } from '../store'
import { cn } from '@/shared/utils'
import { TIMEFRAMES, DRAWING_MAGNET_OPTIONS } from '../utils/chartOptions'
import type { ChartTypeKey, TimeframeKey, DrawingMagnetMode } from '../utils/chartOptions'

/** Icons for magnet mode options */
const MAGNET_ICONS: Record<DrawingMagnetMode, LucideIcon> = {
  normal: Move,
  weak_magnet: Magnet,
  strong_magnet: Anchor,
}
import type { ChartIndicator } from '../utils/indicatorParams'
import { getSupportedIndicators, getSupportedOverlays } from 'klinecharts'
import { IndicatorParamsModal } from './IndicatorParamsModal'

/** Icons for drawing overlay tools in the Draw dropdown */
const OVERLAY_ICONS: Record<string, LucideIcon> = {
  segment: Minus,
  rayLine: ArrowUpRight,
  straightLine: Minus,
  horizontalRayLine: Minus,
  horizontalSegment: Minus,
  horizontalStraightLine: Minus,
  verticalRayLine: Square,
  verticalSegment: Square,
  verticalStraightLine: Square,
  priceLine: DollarSign,
  priceChannelLine: Layers,
  parallelLine: Layers,
  fibonacci: Hash,
  polygon: Square,
  simpleAnnotation: Type,
  simpleTag: Tag,
}

function getOverlayIcon(name: string): LucideIcon {
  return OVERLAY_ICONS[name] ?? Pencil
}

/** Icons for technical indicators in the Add indicator dropdown */
const INDICATOR_ICONS: Record<string, LucideIcon> = {
  MA: TrendingUp,
  EMA: TrendingUp,
  SMA: TrendingUp,
  RSI: Activity,
  MACD: Layers,
  BOLL: Layers,
  KDJ: Activity,
  VOL: BarChart3,
  CCI: Gauge,
  DMI: Move,
  OBV: BarChart2,
  SAR: Move,
  WR: Percent,
  DMA: TrendingUp,
  TRIX: TrendingUp,
  CR: BarChart2,
  PSY: Percent,
  BRAR: BarChart2,
  EMV: Move,
  ROC: TrendingUp,
  MTM: Gauge,
  VRSI: Activity,
  BBI: Layers,
  ATR: Gauge,
  STOCHRSI: Activity,
}

function getIndicatorIcon(name: string): LucideIcon {
  return INDICATOR_ICONS[name] ?? BarChart2
}

export interface ChartTopBarProps {
  chartType: ChartTypeKey
  timeframe: TimeframeKey
  indicators: ChartIndicator[]
  drawingTool: string | null
  drawingMagnetMode?: DrawingMagnetMode
  onDrawingMagnetModeChange?: (mode: DrawingMagnetMode) => void
  isChartFullscreen?: boolean
  onChartTypeChange: (type: ChartTypeKey) => void
  onTimeframeChange: (tf: TimeframeKey) => void
  onIndicatorAdd: (name: string) => void
  onIndicatorRemove: (name: string) => void
  onIndicatorParamsChange: (name: string, params: number[]) => void
  onDrawingToolChange: (name: string | null) => void
  onClearDrawings?: () => void
  onZoomIn?: () => void
  onZoomOut?: () => void
  onResetZoom?: () => void
  onScrollToLatest?: () => void
  onDownloadChart?: (type: 'png' | 'jpeg') => void
  onToggleFullscreen?: () => void
  onOpenSettings?: () => void
}

export function ChartTopBar({ chartType, timeframe, indicators, drawingTool, drawingMagnetMode = 'normal', onDrawingMagnetModeChange, isChartFullscreen, onChartTypeChange, onTimeframeChange, onIndicatorAdd, onIndicatorRemove, onIndicatorParamsChange, onDrawingToolChange, onClearDrawings, onZoomIn, onZoomOut, onResetZoom, onScrollToLatest, onDownloadChart, onToggleFullscreen, onOpenSettings }: ChartTopBarProps) {
  const { selectedSymbol } = useTerminalStore()
  const [indicatorList, setIndicatorList] = useState<string[]>([])
  const [overlayList, setOverlayList] = useState<string[]>([])
  const [editingIndicator, setEditingIndicator] = useState<ChartIndicator | null>(null)
  const [downloadOpen, setDownloadOpen] = useState(false)
  const [indicatorOpen, setIndicatorOpen] = useState(false)
  const [drawOpen, setDrawOpen] = useState(false)
  const [magnetOpen, setMagnetOpen] = useState(false)
  const downloadRef = useRef<HTMLDivElement>(null)
  const indicatorRef = useRef<HTMLDivElement>(null)
  const drawRef = useRef<HTMLDivElement>(null)
  const magnetRef = useRef<HTMLDivElement>(null)
  const availableIndicators = indicatorList.filter((n) => !indicators.some((i) => i.name === n))

  const closeAllDropdowns = () => {
    setDownloadOpen(false)
    setIndicatorOpen(false)
    setDrawOpen(false)
    setMagnetOpen(false)
  }

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        downloadRef.current?.contains(target) ||
        indicatorRef.current?.contains(target) ||
        drawRef.current?.contains(target) ||
        magnetRef.current?.contains(target)
      ) return
      closeAllDropdowns()
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [])

  useEffect(() => {
    try {
      setIndicatorList(getSupportedIndicators().sort((a, b) => a.localeCompare(b)))
    } catch {
      setIndicatorList([])
    }
  }, [])

  useEffect(() => {
    try {
      setOverlayList(getSupportedOverlays().sort((a, b) => a.localeCompare(b)))
    } catch {
      setOverlayList([])
    }
  }, [])

  if (!selectedSymbol) {
    return (
      <div className="shrink-0 h-14 bg-gradient-to-r from-surface via-surface to-surface-2 border-b border-white/5 flex items-center overflow-x-auto scrollbar-thin shadow-sm">
        <div className="flex items-center gap-3 flex-nowrap min-w-max px-4 py-2">
          <Segmented
            options={[
              { value: 'candles', label: 'Candles' },
              { value: 'line', label: 'Line' },
              { value: 'area', label: 'Area' },
            ]}
            value={chartType}
            onChange={(v) => onChartTypeChange(v as ChartTypeKey)}
          />
          <div className="flex items-center gap-1 bg-surface-2/50 rounded-lg p-1">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                onClick={() => onTimeframeChange(tf)}
                className={cn(
                  'px-2.5 py-1 text-xs font-bold rounded transition-all duration-200',
                  timeframe === tf
                    ? 'bg-accent text-white shadow-md shadow-accent/20'
                    : 'text-muted hover:text-text hover:bg-surface-2/50'
                )}
              >
                {tf}
              </button>
            ))}
          </div>
          <div className="relative" ref={indicatorRef}>
            <button
              type="button"
              onClick={() => setIndicatorOpen((v) => !v)}
              className="p-2 hover:bg-surface-2 rounded-lg transition-all duration-200"
              title="Add indicator"
            >
              <BarChart2 className="h-4 w-4 text-muted hover:text-text" />
            </button>
            {indicatorOpen && (
              <div className="absolute left-0 top-full z-50 mt-1 w-max min-w-[7rem] max-w-[10rem] max-h-[280px] overflow-y-auto rounded-lg border border-border bg-surface-1 py-1 shadow-lg">
                <div className="px-2.5 py-1 text-xs text-muted-foreground border-b border-border/50">Add indicator</div>
                {availableIndicators.length === 0 ? (
                  <div className="px-2.5 py-1.5 text-xs text-muted-foreground">None</div>
                ) : (
                  availableIndicators.map((name) => {
                    const Icon = getIndicatorIcon(name)
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() => { onIndicatorAdd(name); setIndicatorOpen(false) }}
                        className="flex w-full items-center gap-2 px-2.5 py-1 text-left text-xs text-text hover:bg-surface-2"
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{name}</span>
                      </button>
                    )
                  })
                )}
              </div>
            )}
          </div>
          {indicators.length > 0 && (
            <div className="flex items-center gap-1 flex-nowrap shrink-0">
              {indicators.map((ind) => (
                <span
                  key={ind.name}
                  className="inline-flex items-center gap-1 rounded-md bg-surface-2/80 px-2 py-0.5 text-xs text-text shrink-0"
                >
                  {ind.name}
                  <button
                    type="button"
                    onClick={() => setEditingIndicator(ind)}
                    className="rounded p-0.5 hover:bg-surface-2 text-muted hover:text-text"
                    title={`Edit ${ind.name} parameters`}
                    aria-label={`Edit ${ind.name} parameters`}
                  >
                    <SlidersHorizontal className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onIndicatorRemove(ind.name)}
                    className="rounded p-0.5 hover:bg-surface-2 text-muted hover:text-text"
                    title={`Remove ${ind.name}`}
                    aria-label={`Remove ${ind.name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <IndicatorParamsModal
            open={!!editingIndicator}
            onOpenChange={(open) => !open && setEditingIndicator(null)}
            indicator={editingIndicator}
            onSave={onIndicatorParamsChange}
          />
          <div className="relative" ref={drawRef}>
            <button
              type="button"
              onClick={() => setDrawOpen((v) => !v)}
              className={cn('p-2 hover:bg-surface-2 rounded-lg transition-all duration-200', drawingTool && 'text-accent')}
              title="Draw"
            >
              <Pencil className="h-4 w-4 text-muted hover:text-text" />
            </button>
            {drawOpen && (
              <div className="absolute left-0 top-full z-50 mt-1 w-max min-w-[7rem] max-w-[10rem] max-h-[280px] overflow-y-auto rounded-lg border border-border bg-surface-1 py-1 shadow-lg">
                <div className="px-2.5 py-1 text-xs text-muted-foreground border-b border-border/50">Draw</div>
                <button type="button" onClick={() => { onDrawingToolChange(null); setDrawOpen(false) }} className={cn('flex w-full items-center gap-2 px-2.5 py-1 text-left text-xs hover:bg-surface-2', !drawingTool ? 'text-accent' : 'text-text')}>
                  <CircleOff className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">None</span>
                </button>
                {overlayList.map((name) => {
                  const Icon = getOverlayIcon(name)
                  return (
                    <button key={name} type="button" onClick={() => { onDrawingToolChange(name); setDrawOpen(false) }} className={cn('flex w-full items-center gap-2 px-2.5 py-1 text-left text-xs hover:bg-surface-2', drawingTool === name ? 'text-accent' : 'text-text')}>
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{name}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          {onDrawingMagnetModeChange && (
            <div className="relative" ref={magnetRef}>
              <button type="button" onClick={() => setMagnetOpen((v) => !v)} className="p-2 hover:bg-surface-2 rounded-lg transition-all duration-200" title="Magnet mode">
                <Magnet className="h-4 w-4 text-muted hover:text-text" />
              </button>
              {magnetOpen && (
                <div className="absolute left-0 top-full z-50 mt-1 w-max min-w-[7rem] max-w-[10rem] rounded-lg border border-border bg-surface-1 py-1 shadow-lg">
                  <div className="px-2.5 py-1 text-xs text-muted-foreground border-b border-border/50">Magnet</div>
                  {DRAWING_MAGNET_OPTIONS.map((opt) => {
                    const Icon = MAGNET_ICONS[opt.value]
                    return (
                      <button key={opt.value} type="button" onClick={() => { onDrawingMagnetModeChange(opt.value); setMagnetOpen(false) }} className={cn('flex w-full items-center gap-2 px-2.5 py-1 text-left text-xs hover:bg-surface-2', drawingMagnetMode === opt.value ? 'text-accent' : 'text-text')}>
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{opt.label}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
          <div className="flex items-center gap-1 bg-surface-2/30 rounded-lg p-1">
            <button onClick={onZoomOut} className="p-2 hover:bg-surface-2 rounded-lg transition-all duration-200" title="Zoom out">
              <ZoomOut className="h-4 w-4 text-muted hover:text-text" />
            </button>
            <button onClick={onZoomIn} className="p-2 hover:bg-surface-2 rounded-lg transition-all duration-200" title="Zoom in">
              <ZoomIn className="h-4 w-4 text-muted hover:text-text" />
            </button>
            <button onClick={onScrollToLatest ?? onResetZoom} className="p-2 hover:bg-surface-2 rounded-lg transition-all duration-200" title="Scroll to latest (real-time)">
              <SkipForward className="h-4 w-4 text-muted hover:text-text" />
            </button>
            {onDownloadChart && (
              <div className="relative" ref={downloadRef}>
                <button onClick={() => setDownloadOpen((v) => !v)} className="p-2 hover:bg-surface-2 rounded-lg transition-all duration-200" title="Download chart">
                  <Download className="h-4 w-4 text-muted hover:text-text" />
                </button>
                {downloadOpen && (
                  <div className="absolute right-0 top-full z-50 mt-1 min-w-[140px] rounded-lg border border-border bg-surface-1 py-1 shadow-lg">
                    <button type="button" onClick={() => { onDownloadChart('png'); setDownloadOpen(false) }} className="w-full px-3 py-1.5 text-left text-sm text-text hover:bg-surface-2">Download as PNG</button>
                    <button type="button" onClick={() => { onDownloadChart('jpeg'); setDownloadOpen(false) }} className="w-full px-3 py-1.5 text-left text-sm text-text hover:bg-surface-2">Download as JPEG</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="shrink-0 h-14 bg-gradient-to-r from-surface via-surface to-surface-2 border-b border-border/50 flex items-center overflow-x-auto scrollbar-thin shadow-sm">
      <div className="flex items-center gap-3 flex-nowrap min-w-max px-4 py-2">
        <Segmented
          options={[
            { value: 'candles', label: 'Candles' },
            { value: 'line', label: 'Line' },
            { value: 'area', label: 'Area' },
          ]}
          value={chartType}
          onChange={(v) => onChartTypeChange(v as ChartTypeKey)}
        />
        <div className="flex items-center gap-1 bg-surface-2/50 rounded-lg p-1">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              onClick={() => onTimeframeChange(tf)}
              className={cn(
                "px-2.5 py-1 text-xs font-bold rounded transition-all duration-200",
                timeframe === tf
                  ? 'bg-accent text-white shadow-md shadow-accent/20'
                  : 'text-muted hover:text-text hover:bg-surface-2/50'
              )}
            >
              {tf}
            </button>
            ))}
        </div>
        <div className="relative" ref={indicatorRef}>
          <button type="button" onClick={() => setIndicatorOpen((v) => !v)} className="p-2 hover:bg-surface-2 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95" title="Add indicator">
            <BarChart2 className="h-4 w-4 text-muted hover:text-text" />
          </button>
          {indicatorOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 w-max min-w-[7rem] max-w-[10rem] max-h-[280px] overflow-y-auto rounded-lg border border-border bg-surface-1 py-1 shadow-lg">
              <div className="px-2.5 py-1 text-xs text-muted-foreground border-b border-border/50">Add indicator</div>
              {availableIndicators.length === 0 ? (
                <div className="px-2.5 py-1.5 text-xs text-muted-foreground">None</div>
              ) : (
                availableIndicators.map((name) => {
                  const Icon = getIndicatorIcon(name)
                  return (
                    <button key={name} type="button" onClick={() => { onIndicatorAdd(name); setIndicatorOpen(false) }} className="flex w-full items-center gap-2 px-2.5 py-1 text-left text-xs text-text hover:bg-surface-2">
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{name}</span>
                    </button>
                  )
                })
              )}
            </div>
          )}
        </div>
        {indicators.length > 0 && (
          <div className="flex items-center gap-1 flex-nowrap shrink-0">
            {indicators.map((ind) => (
              <span key={ind.name} className="inline-flex items-center gap-1 rounded-md bg-surface-2/80 px-2 py-0.5 text-xs text-text shrink-0">
                {ind.name}
                <button type="button" onClick={() => setEditingIndicator(ind)} className="rounded p-0.5 hover:bg-surface-2 text-muted hover:text-text" title={`Edit ${ind.name} parameters`} aria-label={`Edit ${ind.name} parameters`}>
                  <SlidersHorizontal className="h-3 w-3" />
                </button>
                <button type="button" onClick={() => onIndicatorRemove(ind.name)} className="rounded p-0.5 hover:bg-surface-2 text-muted hover:text-text" title={`Remove ${ind.name}`} aria-label={`Remove ${ind.name}`}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <IndicatorParamsModal open={!!editingIndicator} onOpenChange={(open) => !open && setEditingIndicator(null)} indicator={editingIndicator} onSave={onIndicatorParamsChange} />
        <div className="relative" ref={drawRef}>
          <button type="button" onClick={() => setDrawOpen((v) => !v)} className={cn('p-2 hover:bg-surface-2 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95', drawingTool && 'text-accent')} title="Draw">
            <Pencil className="h-4 w-4 text-muted hover:text-text" />
          </button>
          {drawOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 w-max min-w-[7rem] max-w-[10rem] max-h-[280px] overflow-y-auto rounded-lg border border-border bg-surface-1 py-1 shadow-lg">
              <div className="px-2.5 py-1 text-xs text-muted-foreground border-b border-border/50">Draw</div>
              <button type="button" onClick={() => { onDrawingToolChange(null); setDrawOpen(false) }} className={cn('flex w-full items-center gap-2 px-2.5 py-1 text-left text-xs hover:bg-surface-2', !drawingTool ? 'text-accent' : 'text-text')}>
                <CircleOff className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">None</span>
              </button>
              {overlayList.map((name) => {
                const Icon = getOverlayIcon(name)
                return (
                  <button key={name} type="button" onClick={() => { onDrawingToolChange(name); setDrawOpen(false) }} className={cn('flex w-full items-center gap-2 px-2.5 py-1 text-left text-xs hover:bg-surface-2', drawingTool === name ? 'text-accent' : 'text-text')}>
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{name}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
        {onDrawingMagnetModeChange && (
          <div className="relative" ref={magnetRef}>
            <button type="button" onClick={() => setMagnetOpen((v) => !v)} className="p-2 hover:bg-surface-2 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95" title="Magnet mode">
              <Magnet className="h-4 w-4 text-muted hover:text-text" />
            </button>
            {magnetOpen && (
              <div className="absolute left-0 top-full z-50 mt-1 w-max min-w-[7rem] max-w-[10rem] rounded-lg border border-border bg-surface-1 py-1 shadow-lg">
                <div className="px-2.5 py-1 text-xs text-muted-foreground border-b border-border/50">Magnet</div>
                {DRAWING_MAGNET_OPTIONS.map((opt) => {
                  const Icon = MAGNET_ICONS[opt.value]
                  return (
                    <button key={opt.value} type="button" onClick={() => { onDrawingMagnetModeChange(opt.value); setMagnetOpen(false) }} className={cn('flex w-full items-center gap-2 px-2.5 py-1 text-left text-xs hover:bg-surface-2', drawingMagnetMode === opt.value ? 'text-accent' : 'text-text')}>
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{opt.label}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
        <div className="flex items-center gap-1 bg-surface-2/30 rounded-lg p-1">
          <button
            onClick={onClearDrawings}
            className="p-2 hover:bg-surface-2 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95"
            title="Clear all drawings"
          >
            <Trash2 className="h-4 w-4 text-muted hover:text-text" />
          </button>
          <button
            onClick={onZoomOut}
            className="p-2 hover:bg-surface-2 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95"
            title="Zoom out"
          >
            <ZoomOut className="h-4 w-4 text-muted hover:text-text" />
          </button>
          <button
            onClick={onZoomIn}
            className="p-2 hover:bg-surface-2 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95"
            title="Zoom in"
          >
            <ZoomIn className="h-4 w-4 text-muted hover:text-text" />
          </button>
          <button
            onClick={onScrollToLatest ?? onResetZoom}
            className="p-2 hover:bg-surface-2 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95"
            title="Scroll to latest (real-time)"
          >
            <SkipForward className="h-4 w-4 text-muted hover:text-text" />
          </button>
          <div className="relative" ref={downloadRef}>
            <button
              onClick={() => setDownloadOpen((v) => !v)}
              className="p-2 hover:bg-surface-2 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95"
              title="Download chart"
            >
              <Download className="h-4 w-4 text-muted hover:text-text" />
            </button>
            {downloadOpen && onDownloadChart && (
              <div className="absolute right-0 top-full z-50 mt-1 min-w-[140px] rounded-lg border border-border bg-surface-1 py-1 shadow-lg">
                <button
                  type="button"
                  onClick={() => { onDownloadChart('png'); setDownloadOpen(false) }}
                  className="w-full px-3 py-1.5 text-left text-sm text-text hover:bg-surface-2"
                >
                  Download as PNG
                </button>
                <button
                  type="button"
                  onClick={() => { onDownloadChart('jpeg'); setDownloadOpen(false) }}
                  className="w-full px-3 py-1.5 text-left text-sm text-text hover:bg-surface-2"
                >
                  Download as JPEG
                </button>
              </div>
            )}
          </div>
          <button
            onClick={onOpenSettings}
            className="p-2 hover:bg-surface-2 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95"
            title="Chart Settings"
          >
            <Settings className="h-4 w-4 text-muted hover:text-text" />
          </button>
        </div>
      </div>
      {onToggleFullscreen && (
        <button
          onClick={onToggleFullscreen}
          className="p-2 hover:bg-surface-2 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95 shrink-0 mx-2"
          title={isChartFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {isChartFullscreen ? (
            <Minimize2 className="h-4 w-4 text-muted hover:text-text" />
          ) : (
            <Maximize2 className="h-4 w-4 text-muted hover:text-text" />
          )}
        </button>
      )}
    </div>
  )
}

