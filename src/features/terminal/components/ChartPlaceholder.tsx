import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { init, dispose } from 'klinecharts'
import type { KLineData, Period } from 'klinecharts'
import { useTerminalStore } from '../store'
import {
  fetchChartKlines,
  toChartFeedSymbol,
  toBinanceInterval,
  BARS_PER_CHUNK,
  type KLineBar,
} from '../api/binanceKlines'
import { timeframeToPeriod, chartTypeToCandleType } from '../utils/chartOptions'
import type { ChartTypeKey, TimeframeKey } from '../utils/chartOptions'
import type { ChartSettings, DrawingMagnetMode } from '../utils/chartOptions'
import type { ChartIndicator } from '../utils/indicatorParams'
import { Spinner } from '@/shared/ui/loading'
import { priceStreamClient } from '@/shared/ws/priceStreamClient'
import { normalizeSymbolKey } from '@/features/symbols/hooks/usePriceStream'
import { getPositions } from '../api/positions.api'
import type { Position } from '../api/positions.api'
import './chartAskPriceLineOverlay'
import './chartPositionOpenMarkerOverlay'
import './chartPositionClosedMarkerOverlay'

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

/** Chart styles aligned with app theme (background from wrapper; grid slightly more visible than panel borders) */
const APP_THEME_CHART_STYLES = {
  grid: {
    show: true,
    horizontal: {
      show: true,
      size: 0.5,
      color: 'rgba(255, 255, 255, 0.12)',
      style: 'dashed',
      dashedValue: [4, 4],
    },
    vertical: {
      show: true,
      size: 0.5,
      color: 'rgba(255, 255, 255, 0.12)',
      style: 'dashed',
      dashedValue: [4, 4],
    },
  },
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
  const { selectedSymbol, chartShowAskPrice, chartShowPositionMarker, chartShowClosedPositionMarker } = useTerminalStore()
  const chartRef = useRef<ReturnType<typeof init> | null>(null)
  const subscribeBarCallbackRef = useRef<((data: KLineData) => void) | null>(null)
  const lastBarRef = useRef<KLineBar | null>(null)
  const currentBarRef = useRef<KLineBar | null>(null)
  const lastBarDataIndexRef = useRef<number>(0)
  const chartFeedSymbolRef = useRef<string>('BTCUSDT')
  const selectedSymbolKeyRef = useRef<string>('')
  const chartShowAskPriceRef = useRef(chartShowAskPrice)
  const chartShowPositionMarkerRef = useRef(chartShowPositionMarker)
  const lastAppliedPeriodRef = useRef<Period | null>(null)
  const lastAppliedCandleTypeRef = useRef<string | null>(null)
  const chartDataRef = useRef<KLineData[]>([])
  const setChartDataLengthRef = useRef<((n: number) => void) | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [chartDataLength, setChartDataLength] = useState(0)
  const [positions, setPositions] = useState<Position[]>([])
  const setLoadingRef = useRef<(loading: boolean) => void>(() => {})

  setChartDataLengthRef.current = setChartDataLength
  selectedSymbolKeyRef.current =
    selectedSymbol?.priceLookupKey?.trim() ||
    (selectedSymbol?.code ? normalizeSymbolKey(selectedSymbol.code) : '')
  chartShowAskPriceRef.current = chartShowAskPrice
  chartShowPositionMarkerRef.current = chartShowPositionMarker

  useImperativeHandle(
    ref,
    () => ({
      clearOverlays: () => {
        const chart = chartRef.current
        if (!chart) return
        chart.getOverlays()?.forEach((o) => {
          if (o.name !== 'askPriceLine' && o.name !== 'positionOpenMarker' && o.name !== 'closedPositionMarker') chart.removeOverlay({ id: o.id })
        })
      },
      zoomIn: () => chartRef.current?.zoomAtCoordinate(ZOOM_IN_SCALE),
      zoomOut: () => chartRef.current?.zoomAtCoordinate(ZOOM_OUT_SCALE),
      resetZoom: () => chartRef.current?.scrollToRealTime(200),
      getPictureUrl: (type: 'png' | 'jpeg', includeOverlay = true) =>
        chartRef.current?.getConvertPictureUrl(includeOverlay, type) ?? null,
    }),
    []
  )

  useEffect(() => {
    // Wait for real terminal selection to avoid loading fallback BTC chart, then immediately reloading.
    if (!selectedSymbol?.code) return

    setLoadingRef.current = setIsLoading
    setIsLoading(true)

    const container = document.getElementById(CHART_CONTAINER_ID)
    if (!container) return

    const chart = init(CHART_CONTAINER_ID)
    chartRef.current = chart

    chart.setStyles('dark')
    chart.setStyles(APP_THEME_CHART_STYLES as any)
    const candleType = chartTypeToCandleType(chartType)
    chart.setStyles({ candle: { type: candleType } })
    const ticker = selectedSymbol?.code ?? 'BTC-USD'
    const name = selectedSymbol?.code?.replace('-', '/') ?? 'BTC/USD'
    const pricePrecision = selectedSymbol?.pricePrecision ?? 2
    const volumePrecision = selectedSymbol?.volumePrecision ?? 2
    chartFeedSymbolRef.current = toChartFeedSymbol(ticker, selectedSymbol?.quoteCurrency)
    chart.setSymbol({ ticker, exchange: '', name, pricePrecision, volumePrecision })
    const period = timeframeToPeriod(timeframe)
    chart.setPeriod(period)
    lastAppliedPeriodRef.current = period
    lastAppliedCandleTypeRef.current = candleType

    chart.setDataLoader({
      getBars: async (params: { type: string; callback: (data: KLineData[], more?: { backward?: boolean; forward?: boolean }) => void; period: { span: number; type: string } }) => {
        const { type, callback, period } = params
        const timestamp = (params as { timestamp?: number }).timestamp ?? null
        setLoadingRef.current?.(true)
        const symbol = chartFeedSymbolRef.current
        const interval = toBinanceInterval(period.span, period.type)
        const hideLoader = () => setLoadingRef.current?.(false)
        const done = () => {
          chartRef.current?.resize()
          requestAnimationFrame(() => {
            requestAnimationFrame(() => setTimeout(hideLoader, 250))
          })
        }
        try {
          let bars: KLineBar[]
          // Library: 'forward' = user at LEFT edge → load OLDER data (prepended, so it appears on the left).
          // Library: 'backward' = user at RIGHT edge → load NEWER data (appended).
          if (type === 'init') {
            bars = await fetchChartKlines(symbol, interval, BARS_PER_CHUNK)
          } else if (type === 'forward' && timestamp != null) {
            // Oldest bar timestamp: fetch bars before it (older), library will prepend → correct left-side history
            bars = await fetchChartKlines(symbol, interval, BARS_PER_CHUNK, timestamp - 1)
          } else if (type === 'backward' && timestamp != null) {
            // Newest bar timestamp: fetch bars after it (newer), library will append
            bars = await fetchChartKlines(symbol, interval, BARS_PER_CHUNK, undefined, timestamp + 1)
          } else {
            callback([], { backward: false, forward: false })
            done()
            return
          }
          const klineData: KLineData[] = bars.map((b) => ({
            timestamp: b.timestamp,
            open: b.open,
            high: b.high,
            low: b.low,
            close: b.close,
            volume: b.volume,
          }))
          if (type === 'init' && klineData.length > 0) {
            lastBarRef.current = bars[bars.length - 1]
            currentBarRef.current = { ...lastBarRef.current }
            lastBarDataIndexRef.current = klineData.length - 1
            chartDataRef.current = klineData
            setChartDataLengthRef.current?.(klineData.length)
          }
          const hasMoreForward = type === 'forward' ? bars.length >= BARS_PER_CHUNK : type === 'init'
          const hasMoreBackward = type === 'backward' ? bars.length >= BARS_PER_CHUNK : true
          callback(klineData, { backward: hasMoreBackward, forward: hasMoreForward })
        } catch (err) {
          console.warn('Chart klines failed:', err)
          if (type === 'init') {
            lastBarRef.current = null
            currentBarRef.current = null
            chartDataRef.current = []
            setChartDataLengthRef.current?.(0)
          }
          callback([], { backward: false, forward: false })
        }
        done()
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

    // ResizeObserver: keep chart in sync with container size (fixes mobile tab switch / flex layout)
    const resizeObserver = new ResizeObserver(() => {
      chartRef.current?.resize()
    })
    resizeObserver.observe(container)

    // One-time resize after first paint so chart gets correct dimensions on mobile
    const rafId = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        chartRef.current?.resize()
      })
    })

    return () => {
      resizeObserver.disconnect()
      cancelAnimationFrame(rafId)
      subscribeBarCallbackRef.current = null
      lastBarRef.current = null
      currentBarRef.current = null
      chartDataRef.current = []
      setChartDataLengthRef.current?.(0)
      dispose(CHART_CONTAINER_ID)
      chartRef.current = null
    }
  }, [selectedSymbol?.id, selectedSymbol?.code, selectedSymbol?.quoteCurrency])

  // Fetch positions when symbol changes (for position-open markers)
  useEffect(() => {
    if (!selectedSymbol?.code) {
      setPositions([])
      return
    }
    getPositions()
      .then(setPositions)
      .catch(() => setPositions([]))
  }, [selectedSymbol?.code])

  // When position markers are disabled, remove overlays immediately
  useEffect(() => {
    if (!chartShowPositionMarker) chartRef.current?.removeOverlay({ name: 'positionOpenMarker' })
  }, [chartShowPositionMarker])
  useEffect(() => {
    if (!chartShowClosedPositionMarker) chartRef.current?.removeOverlay({ name: 'closedPositionMarker' })
  }, [chartShowClosedPositionMarker])

  // Update position-open markers when chart data + positions are ready (and setting enabled)
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !selectedSymbol?.code || chartDataLength === 0 || !chartShowPositionMarker) {
      chart?.removeOverlay({ name: 'positionOpenMarker' })
      return
    }
    const symbolKey = normalizeSymbolKey(selectedSymbol.code)
    const openForSymbol = positions.filter(
      (p) => p.status === 'OPEN' && normalizeSymbolKey(p.symbol) === symbolKey
    )
    if (openForSymbol.length === 0) {
      chart.removeOverlay({ name: 'positionOpenMarker' })
      return
    }
    const data = chartDataRef.current
    if (!data || data.length === 0) return
    const points = openForSymbol.map((p) => {
      // API may return opened_at in seconds; chart uses ms
      const openedAt = p.opened_at < 1e12 ? p.opened_at * 1000 : p.opened_at
      const entryPrice = parseFloat(p.avg_price || p.entry_price || '0')
      let dataIndex = 0
      for (let i = data.length - 1; i >= 0; i--) {
        if (data[i].timestamp <= openedAt) {
          dataIndex = i
          break
        }
      }
      const bar = data[dataIndex]
      // Place dot on candle head (high) so it sits right on top of the candle, no gap
      const value = bar != null ? bar.high : entryPrice
      return { timestamp: openedAt, value, dataIndex }
    })
    chart.removeOverlay({ name: 'positionOpenMarker' })
    chart.createOverlay({ name: 'positionOpenMarker', points })
  }, [selectedSymbol?.code, positions, chartDataLength, chartShowPositionMarker])

  // Update closed position (position history) markers when chart data + positions ready (and setting enabled)
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !selectedSymbol?.code || chartDataLength === 0 || !chartShowClosedPositionMarker) {
      chart?.removeOverlay({ name: 'closedPositionMarker' })
      return
    }
    const symbolKey = normalizeSymbolKey(selectedSymbol.code)
    const closedForSymbol = positions.filter(
      (p) => p.status === 'CLOSED' && normalizeSymbolKey(p.symbol) === symbolKey
    )
    if (closedForSymbol.length === 0) {
      chart.removeOverlay({ name: 'closedPositionMarker' })
      return
    }
    const data = chartDataRef.current
    if (!data || data.length === 0) return
    const points = closedForSymbol.map((p) => {
      const closedAt = (p.closed_at ?? p.updated_at) ?? 0
      const closedAtMs = closedAt < 1e12 ? closedAt * 1000 : closedAt
      const exitPriceRaw = p.exit_price ?? (p as { exitPrice?: string }).exitPrice
      const exitPrice = exitPriceRaw && exitPriceRaw !== 'null' && exitPriceRaw !== ''
        ? parseFloat(String(exitPriceRaw))
        : parseFloat(p.avg_price || p.entry_price || '0')
      let dataIndex = 0
      for (let i = data.length - 1; i >= 0; i--) {
        if (data[i].timestamp <= closedAtMs) {
          dataIndex = i
          break
        }
      }
      const bar = data[dataIndex]
      const value = bar != null ? bar.high : exitPrice
      return { timestamp: closedAtMs, value, dataIndex }
    })
    chart.removeOverlay({ name: 'closedPositionMarker' })
    chart.createOverlay({ name: 'closedPositionMarker', points })
  }, [selectedSymbol?.code, positions, chartDataLength, chartShowClosedPositionMarker])

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
    const nextPeriod = timeframeToPeriod(timeframe)
    const nextCandleType = chartTypeToCandleType(chartType)

    // Prevent duplicate startup reloads when values are already applied during chart init.
    const periodUnchanged =
      lastAppliedPeriodRef.current != null &&
      lastAppliedPeriodRef.current.span === nextPeriod.span &&
      lastAppliedPeriodRef.current.type === nextPeriod.type
    if (!periodUnchanged) {
      chart.setPeriod(nextPeriod)
      lastAppliedPeriodRef.current = nextPeriod
    }
    if (lastAppliedCandleTypeRef.current !== nextCandleType) {
      chart.setStyles({ candle: { type: nextCandleType } })
      lastAppliedCandleTypeRef.current = nextCandleType
    }
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

  // When ask price line is disabled, remove overlay immediately
  useEffect(() => {
    if (!chartShowAskPrice) chartRef.current?.removeOverlay({ name: 'askPriceLine' })
  }, [chartShowAskPrice])

  // Resize chart when entering or exiting fullscreen so it fills the new size
  useEffect(() => {
    const onFullscreenChange = () => {
      chartRef.current?.resize()
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  // Live candle: subscribe directly to price stream so chart updates on every bid tick;
  // also draw ask price line (duplicate of last-price mark) via custom overlay.
  useEffect(() => {
    const unsub = priceStreamClient.onTick((tick) => {
      const tickKey = normalizeSymbolKey(tick.symbol)
      if (tickKey !== selectedSymbolKeyRef.current) return

      const bid = typeof tick.bid === 'string' ? parseFloat(tick.bid) : Number(tick.bid)
      if (Number.isNaN(bid) || bid <= 0) return

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

      if (cb) cb({ timestamp: bar.timestamp, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume })

      // Ask price line: only show when setting enabled; remove or update overlay
      const chart = chartRef.current
      if (!chartShowAskPriceRef.current) {
        chart?.removeOverlay({ name: 'askPriceLine' })
        return
      }
      const ask = typeof tick.ask === 'string' ? parseFloat(tick.ask) : Number(tick.ask)
      if (!Number.isNaN(ask) && ask > 0 && currentBarRef.current) {
        chart?.removeOverlay({ name: 'askPriceLine' })
        chart?.createOverlay({
          name: 'askPriceLine',
          points: [
            {
              value: ask,
              timestamp: currentBarRef.current.timestamp,
              dataIndex: lastBarDataIndexRef.current,
            },
          ],
        })
      }
    })
    return unsub
  }, [])

  // Sync live price from store when symbol/price first loads (e.g. after symbol switch)
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

  // Ask line must update when bid/ask come from the store alone (tick.symbol used to mismatch catalog code).
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !chartShowAskPrice) {
      chart?.removeOverlay({ name: 'askPriceLine' })
      return
    }
    const ask = selectedSymbol?.numericPrice2
    if (ask == null || ask <= 0 || !currentBarRef.current) {
      chart.removeOverlay({ name: 'askPriceLine' })
      return
    }
    chart.removeOverlay({ name: 'askPriceLine' })
    chart.createOverlay({
      name: 'askPriceLine',
      points: [
        {
          value: ask,
          timestamp: currentBarRef.current.timestamp,
          dataIndex: lastBarDataIndexRef.current,
        },
      ],
    })
  }, [chartShowAskPrice, selectedSymbol?.numericPrice2, selectedSymbol?.code, chartDataLength])

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
