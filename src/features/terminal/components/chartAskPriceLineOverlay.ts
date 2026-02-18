/**
 * Registers a klinecharts overlay that draws an "ask price" line and Y-axis label
 * (same style as the built-in last price mark but for ask, with distinct color).
 * Used together with the built-in bid last-price mark.
 */
import { registerOverlay } from 'klinecharts'

const ASK_LINE_COLOR = 'rgba(34, 197, 94, 0.9)' // green, distinct from typical bid (red)

registerOverlay({
  name: 'askPriceLine',
  totalStep: 0,
  needDefaultPointFigure: false,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: false,
  styles: {
    line: {
      style: 'dashed',
      size: 1,
      color: ASK_LINE_COLOR,
      dashedValue: [4, 4],
    },
  },
  createPointFigures: ({ coordinates, bounding }) => {
    if (coordinates.length === 0) return []
    return [
      {
        type: 'line',
        attrs: {
          coordinates: [
            { x: 0, y: coordinates[0].y },
            { x: bounding.width, y: coordinates[0].y },
          ],
        },
        styles: {
          style: 'dashed',
          size: 1,
          color: ASK_LINE_COLOR,
          dashedValue: [4, 4],
        },
        ignoreEvent: true,
      },
    ]
  },
  createYAxisFigures: ({ chart, overlay, coordinates, bounding, yAxis }) => {
    if (coordinates.length === 0 || !yAxis) return []
    const precision =
      (chart.getSymbol()?.pricePrecision ?? 2) as number
    const value = overlay.points[0]?.value
    if (value == null || typeof value !== 'number') return []
    const raw = value.toFixed(precision)
    const formatted =
      (chart.getThousandsSeparator?.()?.format?.(raw) ?? raw) as string
    const text = (chart.getDecimalFold?.()?.format?.(formatted) ?? formatted) as string
    const isFromZero = yAxis.isFromZero?.() ?? false
    const x = isFromZero ? 0 : bounding.width
    const align = isFromZero ? 'left' : 'right'
    // Same as bid: label in front of the dotted line (on the line)
    return [
      {
        type: 'text',
        attrs: {
          x,
          y: coordinates[0].y,
          text,
          align,
          baseline: 'middle',
        },
        styles: {
          color: '#ffffff',
          size: 12,
          family: 'sans-serif',
          weight: '500',
          backgroundColor: 'rgba(34, 197, 94, 0.9)',
          borderColor: 'rgba(34, 197, 94, 0.9)',
          borderSize: 1,
          borderRadius: 2,
          paddingLeft: 4,
          paddingRight: 4,
          paddingTop: 2,
          paddingBottom: 2,
        },
        ignoreEvent: true,
      },
    ]
  },
})
