/**
 * Persist chart toolbar state (chart type, timeframe, indicators, draw tool, magnet, settings)
 * to localStorage so it survives page reload.
 */

import {
  type ChartTypeKey,
  type TimeframeKey,
  type DrawingMagnetMode,
  type ChartSettings,
  TIMEFRAMES,
  DEFAULT_CHART_SETTINGS,
} from './chartOptions'
import { getDefaultIndicatorParams, type ChartIndicator } from './indicatorParams'

const STORAGE_KEY = 'terminal-chart-toolbar'

const VALID_CHART_TYPES: ChartTypeKey[] = ['candles', 'line', 'area']
const VALID_MAGNET_MODES: DrawingMagnetMode[] = ['normal', 'weak_magnet', 'strong_magnet']
const VALID_TOOLTIP_RULES: ChartSettings['tooltipShowRule'][] = ['always', 'follow_cross', 'none']

export interface PersistedChartToolbar {
  chartType: ChartTypeKey
  timeframe: TimeframeKey
  indicators: ChartIndicator[]
  drawingTool: string | null
  drawingMagnetMode: DrawingMagnetMode
  chartSettings: ChartSettings
}

function isChartType(v: unknown): v is ChartTypeKey {
  return typeof v === 'string' && VALID_CHART_TYPES.includes(v as ChartTypeKey)
}

function isTimeframe(v: unknown): v is TimeframeKey {
  return typeof v === 'string' && (TIMEFRAMES as readonly string[]).includes(v)
}

function isDrawingMagnetMode(v: unknown): v is DrawingMagnetMode {
  return typeof v === 'string' && VALID_MAGNET_MODES.includes(v as DrawingMagnetMode)
}

function isChartIndicator(v: unknown): v is ChartIndicator {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.name === 'string' &&
    Array.isArray(o.params) &&
    o.params.every((p: unknown) => typeof p === 'number')
  )
}

function isChartSettings(v: unknown): v is ChartSettings {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.grid === 'boolean' &&
    typeof o.crosshair === 'boolean' &&
    typeof o.tooltipShowRule === 'string' &&
    VALID_TOOLTIP_RULES.includes(o.tooltipShowRule as ChartSettings['tooltipShowRule']) &&
    typeof o.candleUpColor === 'string' &&
    typeof o.candleDownColor === 'string'
  )
}

/** Load and validate toolbar state from localStorage. Returns null if missing or invalid. */
export function loadChartToolbarState(): PersistedChartToolbar | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as Record<string, unknown>
    if (!data || typeof data !== 'object') return null

    const chartType = isChartType(data.chartType) ? data.chartType : 'candles'
    const timeframe = isTimeframe(data.timeframe) ? data.timeframe : '15m'
    const drawingMagnetMode = isDrawingMagnetMode(data.drawingMagnetMode) ? data.drawingMagnetMode : 'normal'
    const drawingTool =
      data.drawingTool === null || (typeof data.drawingTool === 'string' && data.drawingTool.length > 0)
        ? (data.drawingTool as string | null)
        : null

    let indicators: ChartIndicator[] = []
    if (Array.isArray(data.indicators)) {
      indicators = data.indicators.filter(isChartIndicator).map((ind) => ({
        name: ind.name,
        params: ind.params.length > 0 ? ind.params : getDefaultIndicatorParams(ind.name),
      }))
    }

    const chartSettings: ChartSettings = isChartSettings(data.chartSettings)
      ? (data.chartSettings as ChartSettings)
      : { ...DEFAULT_CHART_SETTINGS }

    return {
      chartType,
      timeframe,
      indicators,
      drawingTool,
      drawingMagnetMode,
      chartSettings,
    }
  } catch {
    return null
  }
}

/** Save toolbar state to localStorage. */
export function saveChartToolbarState(state: PersistedChartToolbar): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // ignore quota / private mode
  }
}
