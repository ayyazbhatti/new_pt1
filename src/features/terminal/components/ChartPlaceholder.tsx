import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { init, dispose } from 'klinecharts'
import type { KLineData } from 'klinecharts'
import { useTerminalStore } from '../store'
import { fetchBinanceKlines, toBinanceSymbol, toBinanceInterval, type KLineBar } from '../api/binanceKlines'
import { timeframeToPeriod, chartTypeToCandleType } from '../utils/chartOptions'
import type { ChartTypeKey, TimeframeKey } from '../utils/chartOptions'
import type { ChartSettings, DrawingMagnetMode } from '../utils/chartOptions'
import type { ChartIndicator } from '../utils/indicatorParams'
import { Spinner } from '@/shared/ui/loading'

const CHART_CONTAINER_ID = 'terminal-kline-chart'

const ZOOM_IN_SCALE = 1.2
const ZOOM_OUT_SCALE = 1 / ZOOM_IN_SCALE

export interface ChartPlaceholderProps {
  chartType: ChartTypeKey
  timeframe: TimeframeKey
  indicators: ChartIndicator[]
  drawingTool: string | null
  drawingMagnetMode: DrawingMagnetMode
  chartSettings: ChartSettings
}

export interface ChartPlaceholderHandle {
  clearOverlays: () => void
  zoomIn: () => void
  zoomOut: () => void
  resetZoom: () => void
  getPictureUrl: (type: 'png' | 'jpeg', includeOverlay?: boolean) => string | null
}

/** Chart styles aligned with app theme (background comes from wrapper; these are crosshair/tooltip) */
const APP_THEME_CHART_STYLES = {
  crosshair: {
    horizontal: {
      text: {
        borderColor: 'rgba(26, 35, 50, 0.95)',
        backgroundColor: 'rgba(26, 35, 50, 0.95)',
      },
    },
    vertical: {
      text: {
        borderColor: 'rgba(26, 35, 50, 0.95)',
        backgroundColor: 'rgba(26, 35, 50, 0.95)',
      },
    },
  },
  candle: {
    tooltip: {
      title: { show: false },
      rect: {
        color: 'rgba(17, 26, 43, 0.95)',
        borderColor: 'rgba(255, 255, 255, 0.08)',
      },
    },
  },
  indicator: {
    tooltip: {
      title: { color: '#94a3b8' },
      legend: { color: '#94a3b8' },
    },
  },
}

export const ChartPlaceholder = forwardRef<ChartPlaceholderHandle, ChartPlaceholderProps>(function ChartPlaceholder(
  { chartType, timeframe, indicators, drawingTool, drawingMagnetMode, chartSettings },
  ref
) {
  const { selectedSymbol } = useTerminalStore()
  const chartRef = useRef<ReturnType<typeof init> | null>(null)
  const subscribeBarCallbackRef = useRef<((data: KLineData) => void) | null>(null)
  const lastBarRef = useRef<KLineBar | null>(null)
  const currentBarRef = useRef<KLineBar | null>(null)
  const binanceSymbolRef = useRef<string>('BTCUSDT')
  const [isLoading, setIsLoading] = useState(true)
  const setLoadingRef = useRef<(loading: boolean) => void>(() => {})

  useImperativeHandle(
    ref,
    () => ({
      clearOverlays: () => chartRef.current?.removeOverlay(),
      zoomIn: () => chartRef.current?.zoomAtCoordinate(ZOOM_IN_SCALE),
      zoomOut: () => chartRef.current?.zoomAtCoordinate(ZOOM_OUT_SCALE),
      resetZoom: () => chartRef.current?.scrollToRealTime(200),
      getPictureUrl: (type: 'png' | 'jpeg', includeOverlay = true) =>
        chartRef.current?.getConvertPictureUrl(includeOverlay, type) ?? null,
    }),
    []
  )

  useEffect(() => {
    setLoadingRef.current = setIsLoading
    setIsLoading(true)

    const container = document.getElementById(CHART_CONTAINER_ID)
    if (!container) return

    const chart = init(CHART_CONTAINER_ID)
    chartRef.current = chart

    chart.setStyles('dark')
    chart.setStyles(APP_THEME_CHART_STYLES)
    chart.setStyles({ candle: { type: chartTypeToCandleType(chartType) } })
    const ticker = selectedSymbol?.code ?? 'BTC-USD'
    const name = selectedSymbol?.code?.replace('-', '/') ?? 'BTC/USD'
    const pricePrecision = selectedSymbol?.pricePrecision ?? 2
    const volumePrecision = selectedSymbol?.volumePrecision ?? 2
    binanceSymbolRef.current = toBinanceSymbol(ticker, selectedSymbol?.quoteCurrency)
    chart.setSymbol({ ticker, exchange: '', name, pricePrecision, volumePrecision })
    chart.setPeriod(timeframeToPeriod(timeframe))

    chart.setDataLoader({
      getBars: async ({ callback, period }) => {
        setLoadingRef.current?.(true)
        const symbol = binanceSymbolRef.current
        const interval = toBinanceInterval(period.span, period.type)
        try {
          const bars = await fetchBinanceKlines(symbol, interval, 500)
          const klineData: KLineData[] = bars.map((b) => ({
            timestamp: b.timestamp,
            open: b.open,
            high: b.high,
            low: b.low,
            close: b.close,
            volume: b.volume,
          }))
          if (klineData.length > 0) {
            lastBarRef.current = bars[bars.length - 1]
            currentBarRef.current = { ...lastBarRef.current }
          }
          callback(klineData)
        } catch (err) {
          console.warn('Binance klines failed, using empty data:', err)
          lastBarRef.current = null
          currentBarRef.current = null
          callback([])
        }
        // Hide loader only after chart has painted: force layout then wait for paint + short delay
        const hideLoader = () => setLoadingRef.current?.(false)
        chartRef.current?.resize()
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setTimeout(hideLoader, 250)
          })
        })
      },
      subscribeBar: ({ callback }) => {
        subscribeBarCallbackRef.current = callback
        const cur = currentBarRef.current
        if (cur) {
          callback({
            timestamp: cur.timestamp,
            open: cur.open,
            high: cur.high,
            low: cur.low,
            close: cur.close,
            volume: cur.volume,
          })
        }
      },
      unsubscribeBar: () => {
        subscribeBarCallbackRef.current = null
      },
    })

    return () => {
      subscribeBarCallbackRef.current = null
      lastBarRef.current = null
      currentBarRef.current = null
      dispose(CHART_CONTAINER_ID)
      chartRef.current = null
    }
  }, [selectedSymbol?.id, selectedSymbol?.code, selectedSymbol?.quoteCurrency])

  // When symbol precision changes, update chart so axes/tooltips match
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const pricePrecision = selectedSymbol?.pricePrecision ?? 2
    const volumePrecision = selectedSymbol?.volumePrecision ?? 2
    chart.setSymbol({ pricePrecision, volumePrecision })
  }, [selectedSymbol?.pricePrecision, selectedSymbol?.volumePrecision])

  // When timeframe or chartType changes, update the existing chart
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    chart.setPeriod(timeframeToPeriod(timeframe))
    chart.setStyles({ candle: { type: chartTypeToCandleType(chartType) } })
  }, [timeframe, chartType])

  // When indicators change, sync chart: remove all then add each with calcParams
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    chart.removeIndicator()
    indicators.forEach((ind) =>
      chart.createIndicator(ind.params.length > 0 ? { name: ind.name, calcParams: ind.params } : ind.name)
    )
  }, [indicators])

  // When drawing tool is selected, create overlay to enter drawing mode (built-in overlays only, with magnet mode)
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !drawingTool || drawingTool.length === 0) return
    chart.createOverlay({ name: drawingTool, mode: drawingMagnetMode })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- drawingMagnetMode applied when tool is chosen
  }, [drawingTool])

  // Apply chart settings (grid, crosshair, tooltip, candle colors)
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    chart.setStyles({
      grid: { show: chartSettings.grid },
      crosshair: { show: chartSettings.crosshair },
      candle: {
        tooltip: { showRule: chartSettings.tooltipShowRule },
        bar: {
          upColor: chartSettings.candleUpColor,
          downColor: chartSettings.candleDownColor,
        },
      },
    })
  }, [chartSettings])

  // Resize chart when entering or exiting fullscreen so it fills the new size
  useEffect(() => {
    const onFullscreenChange = () => {
      chartRef.current?.resize()
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  // Live candle update: use bid from data-provider WebSocket (terminal store updates from same WS)
  useEffect(() => {
    const bid = selectedSymbol?.numericPrice
    if (bid == null || bid <= 0) return

    const cb = subscribeBarCallbackRef.current
    let bar = currentBarRef.current

    if (!bar) {
      const now = Date.now()
      const dayMs = 24 * 60 * 60 * 1000
      const timestamp = Math.floor(now / dayMs) * dayMs
      bar = {
        timestamp,
        open: bid,
        high: bid,
        low: bid,
        close: bid,
        volume: 0,
      }
      currentBarRef.current = bar
    } else {
      bar.close = bid
      bar.high = Math.max(bar.high, bid)
      bar.low = Math.min(bar.low, bid)
    }

    if (cb) cb({ ...bar })
  }, [selectedSymbol?.numericPrice])

  return (
    <div className="h-full w-full flex-1 min-h-0 relative overflow-hidden border-b border-border bg-background">
      <div id={CHART_CONTAINER_ID} className="h-full w-full" />
      {isLoading && (
        <div
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-background/95 backdrop-blur-sm"
          aria-busy="true"
          aria-live="polite"
        >
          <Spinner size="lg" className="text-accent" />
          <p className="text-sm font-medium text-muted-foreground">Loading chart…</p>
        </div>
      )}
    </div>
  )
})
