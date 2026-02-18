/**
 * Registers a klinecharts overlay that draws a dot (circle) at each "position closed"
 * point: (timestamp, exit price) where the user closed a position (position history).
 */
import { registerOverlay } from 'klinecharts'

const MARKER_RADIUS = 3
const MARKER_COLOR = 'rgba(249, 115, 22, 0.95)' // orange
const MARKER_BORDER = 'rgba(255, 255, 255, 0.9)'

registerOverlay({
  name: 'closedPositionMarker',
  totalStep: 0,
  needDefaultPointFigure: false,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: false,
  createPointFigures: ({ coordinates }) => {
    if (coordinates.length === 0) return []
    return coordinates.map((coord) => ({
      type: 'circle',
      attrs: {
        x: coord.x,
        y: coord.y,
        r: MARKER_RADIUS,
      },
      styles: {
        color: MARKER_COLOR,
        borderColor: MARKER_BORDER,
        borderSize: 1,
      },
      ignoreEvent: true,
    }))
  },
})
