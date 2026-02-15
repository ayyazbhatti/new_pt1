/**
 * Map UI timeframe and chart type to KLineChart/Binance values.
 */

import type { Period } from 'klinecharts'

export type TimeframeKey = '1m' | '5m' | '15m' | '1H' | '4H' | '1D' | '1W'

export const TIMEFRAMES: TimeframeKey[] = ['1m', '5m', '15m', '1H', '4H', '1D', '1W']

/** UI timeframe string -> KLineChart Period */
export function timeframeToPeriod(tf: string): Period {
  const map: Record<string, Period> = {
    '1m':  { span: 1,  type: 'minute' },
    '5m':  { span: 5,  type: 'minute' },
    '15m': { span: 15, type: 'minute' },
    '1H':  { span: 1,  type: 'hour' },
    '4H':  { span: 4,  type: 'hour' },
    '1D':  { span: 1,  type: 'day' },
    '1W':  { span: 1,  type: 'week' },
  }
  return map[tf] ?? { span: 1, type: 'day' }
}

export type ChartTypeKey = 'candles' | 'line' | 'area'

/** KLineChart candle type: candle_solid | candle_stroke | area */
export type KLineCandleType = 'candle_solid' | 'candle_stroke' | 'area'

/** UI chart type -> KLineChart candle type */
export function chartTypeToCandleType(type: string): KLineCandleType {
  if (type === 'line') return 'candle_stroke'
  if (type === 'area') return 'area'
  return 'candle_solid'
}

/** Chart settings for grid, crosshair, candle colors, tooltip (KLineChart styles) */
export interface ChartSettings {
  grid: boolean
  crosshair: boolean
  tooltipShowRule: 'always' | 'follow_cross' | 'none'
  candleUpColor: string
  candleDownColor: string
}

/** Drawing overlay magnet mode (KLineChart OverlayMode) */
export type DrawingMagnetMode = 'normal' | 'weak_magnet' | 'strong_magnet'

export const DRAWING_MAGNET_OPTIONS: { value: DrawingMagnetMode; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'weak_magnet', label: 'Weak magnet' },
  { value: 'strong_magnet', label: 'Strong magnet' },
]

export const DEFAULT_CHART_SETTINGS: ChartSettings = {
  grid: true,
  crosshair: true,
  tooltipShowRule: 'follow_cross',
  candleUpColor: '#22c55e',
  candleDownColor: '#ef4444',
}
