/**
 * Param schemas for KLineChart built-in indicators (labels + default calcParams).
 * Used for "Add indicator" defaults and for the params edit UI.
 */

export interface IndicatorParamSchema {
  paramLabels: string[]
  defaults: number[]
}

/** Known built-in indicator param schemas (KLineChart defaults) */
export const INDICATOR_PARAM_SCHEMAS: Record<string, IndicatorParamSchema> = {
  MA: { paramLabels: ['Period 1', 'Period 2', 'Period 3', 'Period 4'], defaults: [5, 10, 30, 60] },
  EMA: { paramLabels: ['Period 1', 'Period 2', 'Period 3'], defaults: [6, 12, 20] },
  SMA: { paramLabels: ['Period 1', 'Period 2', 'Period 3'], defaults: [6, 12, 20] },
  RSI: { paramLabels: ['Period 1', 'Period 2', 'Period 3'], defaults: [6, 12, 24] },
  MACD: { paramLabels: ['Fast', 'Slow', 'Signal'], defaults: [12, 26, 9] },
  BOLL: { paramLabels: ['Period', 'Std Dev'], defaults: [20, 2] },
  KDJ: { paramLabels: ['K', 'D', 'J'], defaults: [9, 3, 3] },
  VOL: { paramLabels: ['MA1', 'MA2', 'MA3'], defaults: [5, 10, 20] },
  CCI: { paramLabels: ['Period'], defaults: [14] },
  DMI: { paramLabels: ['Period'], defaults: [14] },
  OBV: { paramLabels: [], defaults: [] },
  SAR: { paramLabels: ['Step', 'Max'], defaults: [0.02, 0.2] },
  WR: { paramLabels: ['Period 1', 'Period 2'], defaults: [6, 10] },
  DMA: { paramLabels: ['Short', 'Long', 'Period'], defaults: [10, 50, 10] },
  TRIX: { paramLabels: ['Period'], defaults: [12] },
  CR: { paramLabels: ['Period'], defaults: [26] },
  PSY: { paramLabels: ['Period'], defaults: [12] },
  BRAR: { paramLabels: ['Period'], defaults: [26] },
  EMV: { paramLabels: ['Period'], defaults: [14] },
  ROC: { paramLabels: ['Period'], defaults: [12] },
  MTM: { paramLabels: ['Period', 'MA'], defaults: [6, 6] },
  VRSI: { paramLabels: ['Period'], defaults: [6] },
  BBI: { paramLabels: ['P1', 'P2', 'P3', 'P4'], defaults: [3, 6, 12, 24] },
  ATR: { paramLabels: ['Period'], defaults: [14] },
  STOCHRSI: { paramLabels: ['RSI', 'Stoch', 'K', 'D'], defaults: [14, 14, 3, 3] },
}

const FALLBACK_SCHEMA: IndicatorParamSchema = { paramLabels: ['Period'], defaults: [14] }

export function getIndicatorParamSchema(name: string): IndicatorParamSchema {
  return INDICATOR_PARAM_SCHEMAS[name] ?? FALLBACK_SCHEMA
}

/** Default calcParams for an indicator (for new adds). */
export function getDefaultIndicatorParams(name: string): number[] {
  const schema = getIndicatorParamSchema(name)
  return [...schema.defaults]
}

/** Clamp param to a sane range and ensure integer where needed. */
export function clampIndicatorParam(name: string, paramIndex: number, value: number): number {
  const schema = INDICATOR_PARAM_SCHEMAS[name]
  const isDecimal = name === 'SAR' && paramIndex <= 1
  const v = isDecimal ? Math.max(0.001, Math.min(10, value)) : Math.round(Math.max(1, Math.min(999, value)))
  return isDecimal ? Number(v.toFixed(3)) : v
}

/** One indicator instance on the chart (name + calcParams for KLineChart). */
export interface ChartIndicator {
  name: string
  params: number[]
}
