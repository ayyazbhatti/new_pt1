import { X, ChevronDown, ChevronUp, TrendingUp, TrendingDown, Activity, Loader2, Clock, Gauge, ArrowRight, User, Search, Check } from 'lucide-react'
import { Button } from '@/shared/ui'
import { Input } from '@/shared/ui'
import { Segmented } from '@/shared/ui'
import { Checkbox } from '@/shared/ui'
import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { cn } from '@/shared/utils'
import { useTerminalStore } from '../store'
import { toast } from '@/shared/components/common'
import { SinglePriceDisplay } from './SinglePriceDisplay'
import { placeOrder, PlaceOrderRequest } from '../api/orders.api'
import { useAuthStore } from '@/shared/store/auth.store'
import { useQuery } from '@tanstack/react-query'
import { me, getSymbolLeverage, getEffectiveLeverage } from '@/shared/api/auth.api'
import { wsClient } from '@/shared/ws/wsClient'
import { WsInboundEvent } from '@/shared/ws/wsEvents'
import {
  calculatePipValuePerLot,
  calculateLotSizeFromPipPosition,
  calculateUnitsFromLots,
  calculateLotsFromUnits,
  calculatePipPositionFromLots,
  normalizeLotSize,
  formatLotSize,
  formatUnits,
} from '../utils/positionCalculations'
import { AdminSymbol } from '@/features/symbols/types/symbol'
import type { MockSymbol } from '@/shared/mock/terminalMock'
import { useSymbolsList } from '@/features/symbols/hooks/useSymbols'
import { useAccountSummary } from '@/features/wallet/hooks/useAccountSummary'
import { getPromotionSlides } from '../api/promotions.api'
import type { PromotionSlidePublic } from '../api/promotions.api'

// Local storage key for trading panel state
const TRADING_PANEL_STORAGE_KEY = 'trading-panel-state'

/** When true, only Units size mode is shown; Lots and Pip Position are hidden (set to false to show them again). */
const SHOW_ONLY_UNITS_SIZE_MODE = true

interface TradingPanelState {
  orderType: string
  sizeMode: 'units' | 'lots' | 'pipPosition'
  size: string
  lotSize: string
  pipPosition: string
  pipPositionCurrency: string
  currency: string
  marginPercent: number
  useSlTp: boolean
  stopLoss: string
  takeProfit: string
  limitPrice: string
  symbolDetailsOpen: boolean
  userDetailsOpen: boolean
  leverageDetailsOpen: boolean
  selectedSymbolCode: string
}

// Load state from localStorage
const loadTradingPanelState = (): Partial<TradingPanelState> => {
  try {
    const saved = localStorage.getItem(TRADING_PANEL_STORAGE_KEY)
    if (saved) {
      return JSON.parse(saved)
    }
  } catch (error) {
    console.error('Failed to load trading panel state:', error)
  }
  return {}
}

// Save state to localStorage
const saveTradingPanelState = (state: Partial<TradingPanelState>) => {
  try {
    localStorage.setItem(TRADING_PANEL_STORAGE_KEY, JSON.stringify(state))
  } catch (error) {
    console.error('Failed to save trading panel state:', error)
  }
}

function formatTierNotional(value: string): string {
  const n = parseFloat(value)
  return Number.isNaN(n) ? value : n.toFixed(2)
}

function isForexTerminalSymbol(s: MockSymbol): boolean {
  return s.assetClass === 'FX'
}

function quoteFractionDigits(bid?: string, ask?: string): number {
  const frac = (q?: string) => {
    if (!q?.includes('.')) return 0
    return q.split('.')[1]?.length ?? 0
  }
  return Math.max(frac(bid), frac(ask), 2)
}

/** Live Quote: show full WebSocket decimals for FX; otherwise use `pricePrecision`. */
function liveQuoteBidFormatted(s: MockSymbol): string {
  if (s.numericPrice <= 0) return ''
  if (isForexTerminalSymbol(s) && s.bidQuote !== undefined && s.bidQuote !== '') {
    return `$${s.bidQuote}`
  }
  const p = s.pricePrecision ?? 2
  const n = s.numericPrice
  return `$${n.toFixed(n % 1 === 0 ? 0 : p)}`
}

function liveQuoteAskFormatted(s: MockSymbol): string {
  if (s.numericPrice2 <= 0) return ''
  if (isForexTerminalSymbol(s) && s.askQuote !== undefined && s.askQuote !== '') {
    return `$${s.askQuote}`
  }
  const p = s.pricePrecision ?? 2
  const n = s.numericPrice2
  return `$${n.toFixed(n % 1 === 0 ? 0 : p)}`
}

function liveQuoteSpreadFormatted(s: MockSymbol): string {
  if (s.numericPrice <= 0 || s.numericPrice2 <= 0) return '0'
  if (
    isForexTerminalSymbol(s) &&
    s.bidQuote !== undefined &&
    s.bidQuote !== '' &&
    s.askQuote !== undefined &&
    s.askQuote !== ''
  ) {
    const diff = Math.abs(parseFloat(s.askQuote) - parseFloat(s.bidQuote))
    return diff.toFixed(quoteFractionDigits(s.bidQuote, s.askQuote))
  }
  const p = s.pricePrecision ?? 2
  return Math.abs(s.numericPrice2 - s.numericPrice).toFixed(p)
}

export function RightTradingPanel() {
  const { selectedSymbol, setSelectedSymbol, symbols } = useTerminalStore()
  const tradingAccess = useAuthStore((s) => s.user?.tradingAccess ?? 'full')
  const canPlaceOrder = tradingAccess === 'full'
  const { data: meData } = useQuery({ queryKey: ['auth', 'me'], queryFn: me })
  const {
    data: symbolLeverage,
    isLoading: symbolLeverageLoading,
    isFetched: symbolLeverageFetched,
  } = useQuery({
    queryKey: ['auth', 'symbolLeverage', selectedSymbol?.code],
    queryFn: () => getSymbolLeverage(selectedSymbol!.code),
    enabled: !!selectedSymbol?.code,
  })

  // Fetch AdminSymbol data to get tickSize, lotMin, lotMax
  const { data: symbolsData } = useSymbolsList({
    is_enabled: 'true',
    page_size: 100,
  })
  
  // Get AdminSymbol for selected symbol
  const adminSymbol = useMemo(() => {
    if (!selectedSymbol || !symbolsData?.items) return null
    return symbolsData.items.find(s => s.id === selectedSymbol.id) || null
  }, [selectedSymbol, symbolsData])

  const { accountSummary } = useAccountSummary()

  // Load initial state from localStorage only on mount (lazy init) so reload restores tab and values
  const [orderType, setOrderType] = useState(() => loadTradingPanelState().orderType || 'market')
  const [sizeMode, setSizeMode] = useState<'units' | 'lots' | 'pipPosition'>(() => loadTradingPanelState().sizeMode || 'units')
  const [size, setSize] = useState(() => loadTradingPanelState().size || '0.003457')
  const [lotSize, setLotSize] = useState(() => loadTradingPanelState().lotSize || '0.5')
  const [pipPosition, setPipPosition] = useState(() => loadTradingPanelState().pipPosition || '5')
  const [pipPositionCurrency, setPipPositionCurrency] = useState(() => loadTradingPanelState().pipPositionCurrency || 'USD')
  const [currency, setCurrency] = useState<string>(() => loadTradingPanelState().currency || '')
  const [marginPercent, setMarginPercent] = useState(() => loadTradingPanelState().marginPercent ?? 1.0)
  const [useSlTp, setUseSlTp] = useState(() => loadTradingPanelState().useSlTp || false)
  const [stopLoss, setStopLoss] = useState(() => loadTradingPanelState().stopLoss || '')
  const [takeProfit, setTakeProfit] = useState(() => loadTradingPanelState().takeProfit || '')
  const [stopLossAmount, setStopLossAmount] = useState('')
  const [takeProfitAmount, setTakeProfitAmount] = useState('')
  const [slTpSide, setSlTpSide] = useState<'LONG' | 'SHORT'>('LONG') // side used for SL/TP price↔amount calculation
  const [limitPrice, setLimitPrice] = useState(() => loadTradingPanelState().limitPrice || '')
  const [symbolDetailsOpen, setSymbolDetailsOpen] = useState(() => loadTradingPanelState().symbolDetailsOpen || false)
  const [userDetailsOpen, setUserDetailsOpen] = useState(() => loadTradingPanelState().userDetailsOpen || false)
  const [leverageDetailsOpen, setLeverageDetailsOpen] = useState(() => loadTradingPanelState().leverageDetailsOpen || false)
  const [symbolDropdownOpen, setSymbolDropdownOpen] = useState(false)
  const [symbolSearchQuery, setSymbolSearchQuery] = useState('')
  const symbolDropdownRef = useRef<HTMLDivElement>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pendingOrders, setPendingOrders] = useState<Set<string>>(new Set())

  // Filter symbols for dropdown by search (code or price)
  const filteredSymbolsForDropdown = useMemo(() => {
    if (!symbolSearchQuery.trim()) return symbols
    const q = symbolSearchQuery.toLowerCase().trim()
    return symbols.filter(
      (s) =>
        s.code.toLowerCase().includes(q) ||
        s.price.toLowerCase().includes(q)
    )
  }, [symbols, symbolSearchQuery])

  // Close symbol dropdown when clicking outside
  useEffect(() => {
    if (!symbolDropdownOpen) return
    const handleClick = (e: MouseEvent) => {
      if (symbolDropdownRef.current && !symbolDropdownRef.current.contains(e.target as Node)) {
        setSymbolDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('touchstart', handleClick, { passive: true })
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('touchstart', handleClick)
    }
  }, [symbolDropdownOpen])
  
  // Save state to localStorage whenever it changes (keeps tab and values after reload)
  useEffect(() => {
    saveTradingPanelState({
      orderType,
      sizeMode,
      size,
      lotSize,
      pipPosition,
      pipPositionCurrency,
      currency,
      marginPercent,
      useSlTp,
      stopLoss,
      takeProfit,
      limitPrice,
      symbolDetailsOpen,
      userDetailsOpen,
      leverageDetailsOpen,
      selectedSymbolCode: selectedSymbol?.code ?? '',
    })
  }, [orderType, sizeMode, size, lotSize, pipPosition, pipPositionCurrency, currency, marginPercent, useSlTp, stopLoss, takeProfit, limitPrice, symbolDetailsOpen, userDetailsOpen, leverageDetailsOpen, selectedSymbol?.code])

  // Restore selected symbol by code on load when store has symbols but no selection (e.g. after reload)
  useEffect(() => {
    const saved = loadTradingPanelState()
    const code = (saved.selectedSymbolCode as string) || ''
    if (!code || selectedSymbol || symbols.length === 0) return
    const match = symbols.find((s) => s.code === code)
    if (match) setSelectedSymbol(match)
  }, [symbols, selectedSymbol, setSelectedSymbol])

  // Update currency to base currency when symbol changes
  useEffect(() => {
    if (selectedSymbol?.baseCurrency) {
      // Only update if currency is not set or if it's not a valid currency for this symbol
      if (!currency || (currency !== selectedSymbol.baseCurrency && currency !== selectedSymbol.quoteCurrency)) {
        setCurrency(selectedSymbol.baseCurrency)
      }
    }
  }, [selectedSymbol?.baseCurrency, selectedSymbol?.quoteCurrency])

  // Helper to create AdminSymbol-like object from MockSymbol (with defaults)
  const getSymbolForCalculations = useCallback((): AdminSymbol | null => {
    if (!selectedSymbol) return null
    
    // If we have AdminSymbol data, use it
    if (adminSymbol) return adminSymbol
    
    // Otherwise, create a minimal AdminSymbol with defaults
    return {
      id: selectedSymbol.id,
      symbolCode: selectedSymbol.code,
      providerSymbol: null,
      assetClass: 'Crypto' as const,
      baseCurrency: selectedSymbol.baseCurrency,
      quoteCurrency: selectedSymbol.quoteCurrency,
      pricePrecision: 2,
      volumePrecision: 2,
      contractSize: '1',
      tickSize: 0.01,
      lotMin: 0.01,
      lotMax: 100,
      isEnabled: selectedSymbol.enabled,
      tradingEnabled: selectedSymbol.enabled,
      leverageProfileId: null,
      leverageProfileName: null,
      createdAt: '',
      updatedAt: '',
    }
  }, [selectedSymbol, adminSymbol])

  // Real-time calculations for different modes
  const sizeCalculations = useMemo(() => {
    const symbolForCalc = getSymbolForCalculations()
    if (!symbolForCalc || !selectedSymbol || selectedSymbol.numericPrice <= 0) {
      return {
        pipValuePerLot: 0,
        currentLotSize: 0,
        currentUnits: 0,
        currentPipPosition: 0,
      }
    }

    const price = selectedSymbol.numericPrice
    const pipValuePerLot = calculatePipValuePerLot(symbolForCalc, price, pipPositionCurrency)

    let currentLotSize = 0
    let currentUnits = 0
    let currentPipPosition = 0

    if (sizeMode === 'units') {
      const sizeNum = parseFloat(size) || 0
      currentUnits = sizeNum
      if (currency === selectedSymbol.quoteCurrency && price > 0) {
        currentUnits = sizeNum / price
      }
      currentLotSize = calculateLotsFromUnits(currentUnits, symbolForCalc)
      currentPipPosition = calculatePipPositionFromLots(currentLotSize, symbolForCalc, price, pipPositionCurrency)
    } else if (sizeMode === 'lots') {
      const lotSizeNum = parseFloat(lotSize) || 0
      currentLotSize = normalizeLotSize(lotSizeNum, symbolForCalc)
      currentUnits = calculateUnitsFromLots(currentLotSize, symbolForCalc)
      currentPipPosition = calculatePipPositionFromLots(currentLotSize, symbolForCalc, price, pipPositionCurrency)
    } else if (sizeMode === 'pipPosition') {
      const pipPosNum = parseFloat(pipPosition) || 0
      currentPipPosition = pipPosNum
      currentLotSize = calculateLotSizeFromPipPosition(pipPosNum, symbolForCalc, price, pipPositionCurrency)
      currentUnits = calculateUnitsFromLots(currentLotSize, symbolForCalc)
    }

    return {
      pipValuePerLot,
      currentLotSize,
      currentUnits,
      currentPipPosition,
    }
  }, [sizeMode, size, lotSize, pipPosition, selectedSymbol, currency, pipPositionCurrency, getSymbolForCalculations])

  // Target est. margin from Free Margin slider: (marginPercent / 100) * freeMargin (for display)
  const targetMarginFromSlider = useMemo(() => {
    const free = accountSummary?.freeMargin ?? 0
    return (marginPercent / 100) * free
  }, [marginPercent, accountSummary?.freeMargin])

  // When Free Margin slider moves: set size (Units mode) so est. margin equals target % of free margin
  const handleFreeMarginSliderChange = useCallback(
    (newPercent: number) => {
      setMarginPercent(newPercent)
      const freeMargin = accountSummary?.freeMargin ?? 0
      if (freeMargin <= 0 || !selectedSymbol) return
      const price = selectedSymbol.numericPrice || 0
      if (price <= 0) return
      const targetMargin = (newPercent / 100) * freeMargin
      const guessNotional = targetMargin * 50
      const leverage = getEffectiveLeverage(
        guessNotional,
        symbolLeverage?.tiers ?? null,
        meData?.minLeverage,
        meData?.maxLeverage,
        50
      )
      const notional = targetMargin * leverage
      const symbolForCalc = getSymbolForCalculations()
      const volPrecision = symbolForCalc?.volumePrecision ?? 8
      setSizeMode('units')
      if (currency === selectedSymbol.quoteCurrency) {
        setSize(notional.toFixed(2))
      } else {
        setSize((notional / price).toFixed(volPrecision))
      }
    },
    [
      accountSummary?.freeMargin,
      selectedSymbol,
      currency,
      symbolLeverage?.tiers,
      meData?.minLeverage,
      meData?.maxLeverage,
      getSymbolForCalculations,
    ]
  )

  // Handle size mode change with conversion
  const handleSizeModeChange = useCallback((newMode: 'units' | 'lots' | 'pipPosition') => {
    if (newMode === sizeMode) return

    const symbolForCalc = getSymbolForCalculations()
    if (!symbolForCalc || !selectedSymbol || selectedSymbol.numericPrice <= 0) {
      setSizeMode(newMode)
      return
    }

    const price = selectedSymbol.numericPrice
    const { currentLotSize, currentUnits, currentPipPosition } = sizeCalculations

    // Convert current size to new mode
    if (newMode === 'units') {
      setSize(currentUnits.toFixed(symbolForCalc.volumePrecision || 2))
    } else if (newMode === 'lots') {
      setLotSize(formatLotSize(currentLotSize, symbolForCalc))
    } else if (newMode === 'pipPosition') {
      setPipPosition(currentPipPosition.toFixed(2))
    }

    setSizeMode(newMode)
  }, [sizeMode, sizeCalculations, selectedSymbol, getSymbolForCalculations])

  // Calculate costs based on size and selected symbol
  // Size is always stored in the current currency mode (base or quote)
  // We need to convert to base currency for calculations
  const costBreakdown = useMemo(() => {
    if (!selectedSymbol) {
      return {
        spread: '0.00',
        fees: '0.00',
        margin: '0.00',
        liquidation: '-',
        usdValue: '0.00',
        baseSize: '0.00',
        quoteValue: '0.00',
      }
    }

    const sizeNum = parseFloat(size) || 0
    const price = selectedSymbol.numericPrice || 0
    const askPrice = selectedSymbol.numericPrice2 || price
    
    // Convert size to base currency for calculations
    let baseSize = sizeNum
    let quoteValue = sizeNum * price
    
    if (currency === selectedSymbol.quoteCurrency && price > 0) {
      // Size is in quote currency, convert to base
      baseSize = sizeNum / price
      quoteValue = sizeNum
    } else {
      // Size is in base currency
      quoteValue = sizeNum * price
    }
    
    const spread = Math.abs(askPrice - price)
    const fees = 0
    const effectiveLeverage = getEffectiveLeverage(
      quoteValue,
      symbolLeverage?.tiers ?? null,
      meData?.minLeverage,
      meData?.maxLeverage,
      50
    )
    const margin = effectiveLeverage > 0 ? quoteValue / effectiveLeverage : quoteValue * 0.02
    const liquidation = '-'

    return {
      spread: spread.toFixed(2),
      fees: fees.toFixed(2),
      margin: margin.toFixed(2),
      liquidation,
      usdValue: quoteValue.toFixed(2),
      baseSize: baseSize.toFixed(8),
      quoteValue: quoteValue.toFixed(2),
    }
  }, [size, selectedSymbol, currency, meData?.minLeverage, meData?.maxLeverage, symbolLeverage?.tiers])

  // Current order notional (exposure) for "active tier" indicator in Leverage card
  const currentOrderNotional = useMemo(() => {
    if (!selectedSymbol) return 0
    const sizeNum = parseFloat(size) || 0
    const price = selectedSymbol.numericPrice || 0
    if (price <= 0) return 0
    if (currency === selectedSymbol.quoteCurrency) return sizeNum
    return sizeNum * price
  }, [size, currency, selectedSymbol])

  // Effective leverage for current order (used to show "active" on user min/max when clamped)
  const effectiveLeverageForCard = useMemo(
    () => getEffectiveLeverage(currentOrderNotional, symbolLeverage?.tiers ?? null, meData?.minLeverage, meData?.maxLeverage, 50),
    [currentOrderNotional, symbolLeverage?.tiers, meData?.minLeverage, meData?.maxLeverage]
  )
  const isUserLimitActive =
    meData &&
    ((meData.minLeverage != null && effectiveLeverageForCard === meData.minLeverage) ||
      (meData.maxLeverage != null && effectiveLeverageForCard === meData.maxLeverage))

  // Block Buy/Sell when estimated margin exceeds free margin (server also enforces)
  const insufficientFreeMargin = (parseFloat(costBreakdown.margin) || 0) > (accountSummary?.freeMargin ?? 0)

  // Format live price for limit price placeholder
  const livePricePlaceholder = useMemo(() => {
    if (!selectedSymbol || selectedSymbol.numericPrice <= 0) {
      return 'Enter limit price'
    }
    // Use bid price (numericPrice) as the reference
    const price = selectedSymbol.numericPrice
    // Determine precision based on price value
    if (price >= 1000) {
      return `Current: ${price.toFixed(2)}`
    } else if (price >= 1) {
      return `Current: ${price.toFixed(4)}`
    } else {
      return `Current: ${price.toFixed(8)}`
    }
  }, [selectedSymbol])

  // Format live price for market size placeholder
  const marketSizePlaceholder = useMemo(() => {
    if (!selectedSymbol || selectedSymbol.numericPrice <= 0) {
      return 'Enter size'
    }
    // Show current market price as reference
    const price = selectedSymbol.numericPrice
    const formattedPrice = price >= 1000 
      ? price.toFixed(2) 
      : price >= 1 
        ? price.toFixed(4) 
        : price.toFixed(8)
    
    if (currency === selectedSymbol.quoteCurrency) {
      // In quote currency mode, show example value
      return `e.g., 100 (Current: ${formattedPrice})`
    } else {
      // In base currency mode, show example quantity
      return `e.g., 0.1 (Current: ${formattedPrice})`
    }
  }, [selectedSymbol, currency])

  const handleMaxSize = () => {
    if (!selectedSymbol || !selectedSymbol.numericPrice) {
      toast.error('Please select a symbol')
      return
    }
    // Set to 1% of balance (in quote currency)
    const maxQuoteValue = 2495.56 * 0.01
    if (currency === selectedSymbol.quoteCurrency) {
      // If in quote currency mode, set directly
      setSize(maxQuoteValue.toFixed(2))
    } else {
      // If in base currency mode, convert to base
      const maxBaseSize = maxQuoteValue / selectedSymbol.numericPrice
      setSize(maxBaseSize.toFixed(8))
    }
    toast.success('Size set to maximum')
  }

  // Handle currency change with conversion
  const handleCurrencyChange = (newCurrency: string) => {
    if (!selectedSymbol || !selectedSymbol.numericPrice || currency === newCurrency) {
      setCurrency(newCurrency)
      return
    }

    const sizeNum = parseFloat(size) || 0
    if (sizeNum <= 0) {
      setCurrency(newCurrency)
      return
    }

    const price = selectedSymbol.numericPrice || 0
    if (price <= 0) {
      setCurrency(newCurrency)
      return
    }

    let newSize = sizeNum

    if (currency === selectedSymbol.baseCurrency && newCurrency === selectedSymbol.quoteCurrency) {
      // Converting from base to quote: baseSize * price = quoteValue
      newSize = sizeNum * price
    } else if (currency === selectedSymbol.quoteCurrency && newCurrency === selectedSymbol.baseCurrency) {
      // Converting from quote to base: quoteValue / price = baseSize
      newSize = sizeNum / price
    }

    // Format based on currency type
    if (newCurrency === selectedSymbol.quoteCurrency) {
      setSize(newSize.toFixed(2))
    } else {
      setSize(newSize.toFixed(8))
    }

    setCurrency(newCurrency)
  }

  // Use shared WebSocket client for order updates
  const [wsConnected, setWsConnected] = useState(false)
  // Real-time ping (RTT to WS server health endpoint)
  const [pingMs, setPingMs] = useState<number | null>(null)
  // Promo carousel: fetch once on mount (no polling)
  const [promoSlides, setPromoSlides] = useState<PromotionSlidePublic[]>([])
  const [promoLoading, setPromoLoading] = useState(true)
  const [promoError, setPromoError] = useState(false)
  const [promoSlideIndex, setPromoSlideIndex] = useState(0)
  useEffect(() => {
    let cancelled = false
    getPromotionSlides()
      .then((data) => {
        if (!cancelled) setPromoSlides(Array.isArray(data) ? data : [])
      })
      .catch(() => {
        if (!cancelled) setPromoError(true)
      })
      .finally(() => {
        if (!cancelled) setPromoLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])
  useEffect(() => {
    setPromoSlideIndex((i) => (promoSlides.length ? Math.min(i, promoSlides.length - 1) : 0))
  }, [promoSlides.length])
  useEffect(() => {
    if (promoSlides.length <= 1) return
    const t = setInterval(() => {
      setPromoSlideIndex((i) => (i + 1) % promoSlides.length)
    }, 4000)
    return () => clearInterval(t)
  }, [promoSlides.length])

  // Live current time (local timezone)
  const [currentTimeLabel, setCurrentTimeLabel] = useState(() => {
    const now = new Date()
    const offsetMin = -now.getTimezoneOffset()
    const sign = offsetMin >= 0 ? '+' : '-'
    const absHours = Math.floor(Math.abs(offsetMin) / 60)
    const utcLabel = `UTC${sign}${absHours}`
    const time = now.toTimeString().slice(0, 8)
    const day = String(now.getDate()).padStart(2, '0')
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const year = now.getFullYear()
    return `${utcLabel} ▼ ${time} ${day}.${month}.${year}`
  })

  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date()
      const offsetMin = -now.getTimezoneOffset()
      const sign = offsetMin >= 0 ? '+' : '-'
      const absHours = Math.floor(Math.abs(offsetMin) / 60)
      const utcLabel = `UTC${sign}${absHours}`
      const time = now.toTimeString().slice(0, 8)
      const day = String(now.getDate()).padStart(2, '0')
      const month = String(now.getMonth() + 1).padStart(2, '0')
      const year = now.getFullYear()
      setCurrentTimeLabel(`${utcLabel} ▼ ${time} ${day}.${month}.${year}`)
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  // Measure ping by fetching WS gateway health (proxied in dev via /ws-health)
  useEffect(() => {
    const wsUrl =
      import.meta.env?.VITE_WS_URL ||
      (typeof location !== 'undefined'
        ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?group=default`
        : 'ws://localhost:3003/ws?group=default')
    const healthUrl = import.meta.env.DEV
      ? '/ws-health'
      : wsUrl.replace(/^wss?/, (m) => (m === 'wss' ? 'https' : 'http')).replace(/\/ws.*$/, '') + '/health'

    const measurePing = async () => {
      const start = performance.now()
      try {
        const res = await fetch(healthUrl, { method: 'GET', cache: 'no-store' })
        const end = performance.now()
        if (res.ok) setPingMs(Math.round(end - start))
        else setPingMs(null)
      } catch {
        setPingMs(null)
      }
    }

    measurePing()
    const interval = setInterval(measurePing, 5000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    // Ensure WebSocket is connected
    if (wsClient.getState() === 'disconnected') {
      wsClient.connect()
    }
    
    // Update connection status
    const updateStatus = () => {
      const state = wsClient.getState()
      setWsConnected(state === 'authenticated')
    }
    updateStatus()
    
    // Subscribe to state changes
    const unsubscribeState = wsClient.onStateChange((state) => {
      setWsConnected(state === 'authenticated')
    })

    // Subscribe to order update events
    const unsubscribe = wsClient.subscribe((event: WsInboundEvent) => {
      // Handle order update events (when backend sends them via WebSocket)
      if (event.type === 'admin.order.updated' || event.type === 'admin.order.filled' || event.type === 'admin.order.canceled' || event.type === 'admin.order.rejected') {
        const order = (event as any).payload.order || (event as any).payload
        const orderId = order?.orderId || order?.id || (event as any).payload.orderId
        
        if (orderId && typeof orderId === 'string' && pendingOrders.has(orderId)) {
          setPendingOrders(prev => {
            const next = new Set(prev)
            next.delete(orderId)
            return next
          })
          
          const status = order?.status || (event as any).payload.status
          if (status === 'Filled' || status === 'FILLED' || status === 'filled') {
            toast.success(`Order ${orderId.slice(0, 8)}... filled successfully`, { duration: 4000 })
          } else if (status === 'Rejected' || status === 'REJECTED' || status === 'rejected') {
            toast.error(
              `Order ${orderId.slice(0, 8)}... rejected: ${order?.reason || (event as any).payload.reason || 'Unknown reason'}`,
              { duration: 5000 }
            )
          } else if (status === 'Cancelled' || status === 'CANCELLED' || status === 'cancelled') {
            toast(`Order ${orderId.slice(0, 8)}... cancelled`, { duration: 3000 })
          }
        }
      }
    })

    return () => {
      unsubscribe()
      unsubscribeState()
    }
  }, [pendingOrders])

  const handlePlaceOrder = async (side: 'BUY' | 'SELL') => {
    if (!selectedSymbol) {
      toast.error('Please select a symbol')
      return
    }

    const symbolForCalc = getSymbolForCalculations()
    if (!symbolForCalc) {
      toast.error('Symbol data not available')
      return
    }

    // Get base size in units based on current mode (when only Units is shown, always use units)
    const effectiveSizeMode = SHOW_ONLY_UNITS_SIZE_MODE ? 'units' : sizeMode
    let baseSize = 0
    let displaySize = ''

    if (effectiveSizeMode === 'units') {
      const sizeNum = parseFloat(size)
      if (!sizeNum || sizeNum <= 0) {
        toast.error('Please enter a valid size')
        return
      }
      baseSize = sizeNum
      if (currency === selectedSymbol.quoteCurrency && selectedSymbol.numericPrice > 0) {
        baseSize = sizeNum / selectedSymbol.numericPrice
      }
      displaySize = currency === selectedSymbol.quoteCurrency 
        ? `${size} ${selectedSymbol.quoteCurrency} (${baseSize.toFixed(8)} ${selectedSymbol.baseCurrency})`
        : `${size} ${selectedSymbol.baseCurrency}`
    } else if (effectiveSizeMode === 'lots') {
      const lotSizeNum = parseFloat(lotSize)
      if (!lotSizeNum || lotSizeNum <= 0) {
        toast.error('Please enter a valid lot size')
        return
      }
      const normalizedLots = normalizeLotSize(lotSizeNum, symbolForCalc)
      baseSize = calculateUnitsFromLots(normalizedLots, symbolForCalc)
      displaySize = `${formatLotSize(normalizedLots, symbolForCalc)} lots (${formatUnits(baseSize, symbolForCalc)} units)`
    } else if (effectiveSizeMode === 'pipPosition') {
      const pipPosNum = parseFloat(pipPosition)
      if (!pipPosNum || pipPosNum <= 0) {
        toast.error('Please enter a valid pip position')
        return
      }
      const price = selectedSymbol.numericPrice || 0
      if (price <= 0) {
        toast.error('Price not available')
        return
      }
      const calculatedLots = calculateLotSizeFromPipPosition(pipPosNum, symbolForCalc, price, pipPositionCurrency)
      baseSize = calculateUnitsFromLots(calculatedLots, symbolForCalc)
      displaySize = `$${pipPosNum.toFixed(2)}/pip (${formatLotSize(calculatedLots, symbolForCalc)} lots, ${formatUnits(baseSize, symbolForCalc)} units)`
    }

    if (baseSize <= 0) {
      toast.error('Invalid position size')
      return
    }

    if (orderType === 'limit' && !limitPrice) {
      toast.error('Please enter a limit price for limit orders')
      return
    }

    setIsSubmitting(true)

    try {
      const payload: PlaceOrderRequest = {
        symbol: selectedSymbol.code,
        side,
        order_type: orderType.toUpperCase() as 'MARKET' | 'LIMIT',
        size: baseSize.toString(),
        limit_price: orderType === 'limit' && limitPrice ? limitPrice : undefined,
        sl: useSlTp && stopLoss ? stopLoss : undefined,
        tp: useSlTp && takeProfit ? takeProfit : undefined,
        tif: 'GTC',
        idempotency_key: `${Date.now()}-${Math.random().toString(36).substring(7)}`,
      }

      const response = await placeOrder(payload)
      
      // Handle both camelCase (API) and snake_case (legacy) for compatibility
      const orderId = response.orderId || (response as any).order_id
      
      if (!orderId) {
        throw new Error('Order ID not returned from server')
      }
      
      setPendingOrders(prev => new Set(prev).add(orderId))
      
      // Show "submitted" message - actual execution happens asynchronously
      toast.success(
        `${side} order submitted: ${displaySize} @ ${selectedSymbol.code} (Order ID: ${orderId.slice(0, 8)}...)`,
        { duration: 3000 }
      )

      // Reset form for market orders (keep limit orders for potential modifications)
      if (orderType === 'market') {
        if (effectiveSizeMode === 'units') {
          setSize('0.003457')
        } else if (effectiveSizeMode === 'lots') {
          setLotSize('0.5')
        } else if (effectiveSizeMode === 'pipPosition') {
          setPipPosition('5')
        }
        setStopLoss('')
        setTakeProfit('')
        setUseSlTp(false)
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string | { code?: string; message?: string }; message?: string }; status?: number }; message?: string }
      const data = err?.response?.data
      const status = err?.response?.status
      const apiMessage = typeof data?.error === 'object' && data?.error?.message
        ? data.error.message
        : data?.message ?? (typeof data?.error === 'object' ? (data.error as { message?: string }).message : undefined)
      const is403 = status === 403 || (typeof err?.message === 'string' && err.message.includes('403'))
      const errorMessage =
        apiMessage ||
        (is403 ? 'Trading is disabled. You cannot open new positions.' : null) ||
        (error instanceof Error ? error.message : 'Failed to place order')
      const showPlain = data?.error === 'INSUFFICIENT_FREE_MARGIN' || is403 || apiMessage
      toast.error(showPlain ? errorMessage : `Order failed: ${errorMessage}`)
      console.error('Order placement error:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleBuy = () => {
    handlePlaceOrder('BUY')
  }

  const handleSell = () => {
    handlePlaceOrder('SELL')
  }

  return (
    <div className="h-full min-h-0 overflow-hidden bg-gradient-to-b from-[#0f172a] to-[#0b1220] flex flex-col border-l border-white/5">
      {/* Header */}
      <div className="shrink-0 h-12 border-b border-white/5 flex items-center justify-between px-4 bg-gradient-to-r from-white/[0.02] to-transparent">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-text tracking-tight">Trading Panel</h2>
          <div className="h-1.5 w-1.5 rounded-full bg-success animate-pulse shadow-sm shadow-success/50"></div>
        </div>
        <button
          onClick={() => toast('Panel close feature coming soon')}
          className="p-1.5 hover:bg-surface-2 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95"
          title="Close Panel"
        >
          <X className="h-4 w-4 text-muted" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        {/* Order Ticket */}
        <div className="p-4 border-b border-white/5">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-1 w-1 rounded-full bg-accent"></div>
            <div className="text-xs font-bold text-text uppercase tracking-wider">Order Ticket</div>
          </div>

          {/* Symbol */}
          <div className="mb-4 relative" ref={symbolDropdownRef}>
            <label className="text-xs font-semibold text-muted mb-2 block uppercase tracking-wider">Symbol</label>
            <button
              type="button"
              onClick={() => setSymbolDropdownOpen((o) => !o)}
              className={cn(
                'w-full rounded-lg bg-surface-2 border px-3 py-2.5 text-sm font-medium text-text focus:outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20 focus:ring-offset-0 transition-all duration-200 hover:border-accent/30 flex items-center justify-between gap-2',
                symbolDropdownOpen ? 'border-accent/50' : 'border-white/5'
              )}
            >
              <span className="truncate">{selectedSymbol?.code || 'Select symbol'}</span>
              <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted transition-transform', symbolDropdownOpen && 'rotate-180')} />
            </button>
            {symbolDropdownOpen && (
              <div
                className="absolute left-0 right-0 top-full mt-1 z-50 rounded-lg bg-surface-2 border border-white/10 shadow-xl shadow-black/40 overflow-hidden flex flex-col"
                style={{ maxHeight: 'min(60vh, 320px)' }}
              >
                <div className="shrink-0 p-2 border-b border-white/5">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted pointer-events-none" />
                    <Input
                      placeholder="Search symbols..."
                      value={symbolSearchQuery}
                      onChange={(e) => setSymbolSearchQuery(e.target.value)}
                      className={cn(
                        'pl-8 h-9 text-sm bg-white/5 border-white/10 text-text placeholder:text-muted',
                        'focus:border-accent/50 focus:ring-1 focus:ring-accent/20'
                      )}
                      autoFocus
                    />
                  </div>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto">
                  {filteredSymbolsForDropdown.length === 0 ? (
                    <div className="px-3 py-4 text-center text-muted text-sm">No symbols match</div>
                  ) : (
                    filteredSymbolsForDropdown.map((symbol) => (
                      <button
                        key={symbol.id}
                        type="button"
                        onClick={() => {
                          setSelectedSymbol(symbol)
                          setSymbolDropdownOpen(false)
                          setSymbolSearchQuery('')
                        }}
                        className={cn(
                          'w-full px-3 py-2.5 text-left text-sm font-medium flex items-center justify-between gap-2 transition-colors',
                          selectedSymbol?.id === symbol.id
                            ? 'bg-accent/15 text-accent'
                            : 'text-text hover:bg-white/5'
                        )}
                      >
                        <span className="truncate">{symbol.code}</span>
                        {selectedSymbol?.id === symbol.id ? <Check className="h-4 w-4 shrink-0 text-accent" /> : null}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Live Quote - Enhanced Professional Design */}
          {selectedSymbol && (
            <div className="mb-4 p-4 rounded-xl bg-gradient-to-br from-surface-2/80 to-surface-2/40 border border-white/5 shadow-lg shadow-black/20 relative overflow-hidden">
              {/* Live indicator */}
              <div className="absolute top-2 right-2 flex items-center gap-1.5">
                <Activity className="h-3 w-3 text-success animate-pulse" />
                <span className="text-[10px] font-semibold text-success uppercase tracking-wider">Live</span>
              </div>
              
              <div className="text-[10px] font-bold text-muted uppercase tracking-widest mb-3">Live Quote</div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <div className="text-[10px] text-muted/70 uppercase tracking-wider">Bid</div>
                  {selectedSymbol.numericPrice > 0 ? (
                    <SinglePriceDisplay
                      price={selectedSymbol.numericPrice}
                      formatted={liveQuoteBidFormatted(selectedSymbol)}
                    />
                  ) : (
                    <div className="text-lg font-bold text-text-muted">—</div>
                  )}
                </div>
                <div className="space-y-1.5 text-right">
                  <div className="text-[10px] text-muted/70 uppercase tracking-wider">Ask</div>
                  {selectedSymbol.numericPrice2 > 0 ? (
                    <div className="flex justify-end">
                      <SinglePriceDisplay
                        price={selectedSymbol.numericPrice2}
                        formatted={liveQuoteAskFormatted(selectedSymbol)}
                      />
                    </div>
                  ) : (
                    <div className="text-lg font-bold text-text-muted">—</div>
                  )}
                </div>
              </div>
              
              {/* Spread indicator */}
              {selectedSymbol.numericPrice > 0 && selectedSymbol.numericPrice2 > 0 && (
                <div className="mt-3 pt-3 border-t border-white/5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted/70">Spread</span>
                    <span className="text-xs font-semibold text-text">
                      {liveQuoteSpreadFormatted(selectedSymbol)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Order Type */}
          <div className="mb-4">
            <label className="text-xs font-semibold text-muted mb-2 block uppercase tracking-wider">Order Type</label>
            <Segmented
              options={[
                { value: 'market', label: 'Market' },
                { value: 'limit', label: 'Limit' },
              ]}
              value={orderType}
              onChange={setOrderType}
              className="w-full"
            />
          </div>

          {/* Limit Price Input */}
          {orderType === 'limit' && (
            <div className="mb-3">
              <label className="text-xs text-muted mb-1 block">Limit Price</label>
              <Input
                type="number"
                step="0.01"
                value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
                placeholder={livePricePlaceholder}
                className="w-full"
              />
            </div>
          )}

          {/* Size Mode Selector - hidden when only Units is shown */}
          {!SHOW_ONLY_UNITS_SIZE_MODE && (
          <div className="mb-3">
            <label className="text-xs font-semibold text-muted uppercase tracking-wider mb-2 block">Size Mode</label>
            <Segmented
              options={[
                { value: 'units', label: 'Units' },
                { value: 'lots', label: 'Lots' },
                { value: 'pipPosition', label: 'Pip Position' },
              ]}
              value={sizeMode}
              onChange={(value) => handleSizeModeChange(value as 'units' | 'lots' | 'pipPosition')}
              className="w-full"
            />
          </div>
          )}

          {/* Size Input - Conditional based on mode */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-muted uppercase tracking-wider">
                {SHOW_ONLY_UNITS_SIZE_MODE || sizeMode === 'units' ? 'Size' : sizeMode === 'lots' ? 'Lot Size' : 'Pip Position'}
              </label>
              {(SHOW_ONLY_UNITS_SIZE_MODE || sizeMode === 'units') && (
                <button
                  onClick={handleMaxSize}
                  className="text-xs font-bold text-accent hover:text-accent/80 transition-colors px-2 py-0.5 rounded hover:bg-accent/10"
                  title="Set maximum size (1% of balance)"
                >
                  MAX
                </button>
              )}
            </div>

            {/* Units Mode */}
            {(SHOW_ONLY_UNITS_SIZE_MODE || sizeMode === 'units') && (
              <>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    step="0.000001"
                    value={size}
                    onChange={(e) => setSize(e.target.value)}
                    placeholder={orderType === 'market' ? marketSizePlaceholder : 'Enter size'}
                    className="flex-1"
                  />
                  <select
                    value={currency}
                    onChange={(e) => handleCurrencyChange(e.target.value)}
                    className="rounded-lg bg-surface-2 border border-white/5 px-3 py-2 text-sm text-text focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/20 focus:ring-offset-0 transition-all duration-200"
                    disabled={!selectedSymbol}
                  >
                    {selectedSymbol ? (
                      <>
                        <option value={selectedSymbol.baseCurrency}>{selectedSymbol.baseCurrency}</option>
                        <option value={selectedSymbol.quoteCurrency}>{selectedSymbol.quoteCurrency}</option>
                      </>
                    ) : (
                      <option value="">Select Symbol</option>
                    )}
                  </select>
                </div>
                <div className="text-xs text-muted mt-1">
                  {selectedSymbol && currency ? (
                    currency === selectedSymbol.baseCurrency ? (
                      <>≈ {costBreakdown.quoteValue} {selectedSymbol.quoteCurrency}</>
                    ) : (
                      <>≈ {costBreakdown.baseSize} {selectedSymbol.baseCurrency}</>
                    )
                  ) : (
                    <>≈ 0.00 USD</>
                  )}
                  {sizeCalculations.currentLotSize > 0 && (
                    <span className="ml-2">
                      • {formatLotSize(sizeCalculations.currentLotSize, getSymbolForCalculations() || {} as AdminSymbol)} lots
                    </span>
                  )}
                  {sizeCalculations.currentPipPosition > 0 && (
                    <span className="ml-2">
                      • ${sizeCalculations.currentPipPosition.toFixed(2)}/pip
                    </span>
                  )}
                </div>
              </>
            )}

            {/* Lots Mode - hidden when SHOW_ONLY_UNITS_SIZE_MODE */}
            {!SHOW_ONLY_UNITS_SIZE_MODE && sizeMode === 'lots' && (
              <>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    step="0.01"
                    value={lotSize}
                    onChange={(e) => setLotSize(e.target.value)}
                    placeholder="0.5"
                    className="flex-1"
                  />
                  <div className="rounded-lg bg-surface-2 border border-white/5 px-3 py-2 text-sm text-text">
                    Lots
                  </div>
                </div>
                <div className="text-xs text-muted mt-1">
                  {sizeCalculations.currentUnits > 0 && (
                    <>
                      {formatUnits(sizeCalculations.currentUnits, getSymbolForCalculations() || {} as AdminSymbol)} units
                    </>
                  )}
                  {sizeCalculations.currentPipPosition > 0 && (
                    <span className="ml-2">
                      • ${sizeCalculations.currentPipPosition.toFixed(2)}/pip
                    </span>
                  )}
                  {getSymbolForCalculations() && (
                    <span className="ml-2 text-muted/70">
                      (Min: {getSymbolForCalculations()?.lotMin || 0.01}, Max: {getSymbolForCalculations()?.lotMax || 100})
                    </span>
                  )}
                </div>
              </>
            )}

            {/* Pip Position Mode - hidden when SHOW_ONLY_UNITS_SIZE_MODE */}
            {!SHOW_ONLY_UNITS_SIZE_MODE && sizeMode === 'pipPosition' && (
              <>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    step="0.01"
                    value={pipPosition}
                    onChange={(e) => setPipPosition(e.target.value)}
                    placeholder="5.00"
                    className="flex-1"
                  />
                  <select
                    value={pipPositionCurrency}
                    onChange={(e) => setPipPositionCurrency(e.target.value)}
                    className="rounded-lg bg-surface-2 border border-white/5 px-3 py-2 text-sm text-text focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/20 focus:ring-offset-0 transition-all duration-200"
                  >
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                  </select>
                </div>
                <div className="text-xs text-muted mt-1">
                  {sizeCalculations.currentLotSize > 0 && (
                    <>
                      {formatLotSize(sizeCalculations.currentLotSize, getSymbolForCalculations() || {} as AdminSymbol)} lots
                    </>
                  )}
                  {sizeCalculations.currentUnits > 0 && (
                    <span className="ml-2">
                      • {formatUnits(sizeCalculations.currentUnits, getSymbolForCalculations() || {} as AdminSymbol)} units
                    </span>
                  )}
                  {sizeCalculations.pipValuePerLot > 0 && (
                    <span className="ml-2 text-muted/70">
                      (Pip value: ${sizeCalculations.pipValuePerLot.toFixed(2)}/lot)
                    </span>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Free Margin */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-muted uppercase tracking-wider">Free Margin: {marginPercent.toFixed(1)}%</span>
              <span className="text-xs font-bold text-text">
                {accountSummary?.freeMargin != null ? `$${targetMarginFromSlider.toFixed(2)}` : '—'}
              </span>
            </div>
            <div className="relative">
              <input
                type="range"
                min="0.1"
                max="100"
                step="0.1"
                value={marginPercent}
                onChange={(e) => handleFreeMarginSliderChange(Number(e.target.value))}
                className="w-full h-2 bg-surface-2 rounded-lg appearance-none cursor-pointer accent-accent
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5
                  [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:cursor-pointer
                  [&::-webkit-slider-thumb]:shadow [&::-webkit-slider-thumb]:border-0
                  [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full
                  [&::-moz-range-thumb]:bg-accent [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
              />
              <div className="flex justify-between text-xs text-muted mt-1">
                <span>0.1%</span>
                <span>100%</span>
              </div>
            </div>
          </div>

          {/* Stop Loss / Take Profit - Price and Amount (same as Edit Position popup) */}
          <div className="mb-3">
            <div className="flex items-center mb-2">
              <Checkbox
                checked={useSlTp}
                onChange={(e) => setUseSlTp(e.target.checked)}
              />
              <span className="text-xs text-muted ml-2">Use Stop Loss / Take Profit</span>
            </div>
            {useSlTp && (
              <div className="space-y-3 mt-2">
                {/* Side for SL/TP calculation (entry price = ask for LONG, bid for SHORT) */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted">For:</span>
                  <div className="flex rounded-lg overflow-hidden border border-white/10">
                    <button
                      type="button"
                      onClick={() => setSlTpSide('LONG')}
                      className={cn(
                        'px-2 py-1 text-[10px] font-medium transition-colors',
                        slTpSide === 'LONG' ? 'bg-accent text-white' : 'bg-surface-2 text-muted hover:text-text'
                      )}
                    >
                      Buy
                    </button>
                    <button
                      type="button"
                      onClick={() => setSlTpSide('SHORT')}
                      className={cn(
                        'px-2 py-1 text-[10px] font-medium transition-colors',
                        slTpSide === 'SHORT' ? 'bg-accent text-white' : 'bg-surface-2 text-muted hover:text-text'
                      )}
                    >
                      Sell
                    </button>
                  </div>
                </div>
                {/* Stop Loss: Price ($) and Amount ($) */}
                <div className="space-y-1.5">
                  <label className="text-[10px] text-muted font-semibold block">Stop Loss</label>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-muted/80 mb-0.5 block">Price ($)</label>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="SL Price"
                        className="w-full"
                        value={stopLoss}
                        onChange={(e) => {
                          const price = e.target.value
                          setStopLoss(price)
                          if (selectedSymbol && price) {
                            const entryPrice = slTpSide === 'LONG'
                              ? (selectedSymbol.numericPrice2 || selectedSymbol.numericPrice)
                              : selectedSymbol.numericPrice
                            const sizeNum = sizeCalculations.currentUnits
                            const slPriceNum = parseFloat(price)
                            if (!isNaN(slPriceNum) && sizeNum > 0) {
                              const slAmount = slTpSide === 'LONG'
                                ? (entryPrice - slPriceNum) * sizeNum
                                : (slPriceNum - entryPrice) * sizeNum
                              setStopLossAmount(slAmount > 0 ? slAmount.toFixed(2) : '')
                            } else setStopLossAmount('')
                          } else setStopLossAmount('')
                        }}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted/80 mb-0.5 block">Amount ($)</label>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="Loss Amount"
                        className="w-full"
                        value={stopLossAmount}
                        onChange={(e) => {
                          const amount = e.target.value
                          setStopLossAmount(amount)
                          if (selectedSymbol && amount) {
                            const entryPrice = slTpSide === 'LONG'
                              ? (selectedSymbol.numericPrice2 || selectedSymbol.numericPrice)
                              : selectedSymbol.numericPrice
                            const sizeNum = sizeCalculations.currentUnits
                            const lossAmount = parseFloat(amount)
                            if (!isNaN(lossAmount) && sizeNum > 0) {
                              const slPrice = slTpSide === 'LONG'
                                ? entryPrice - (lossAmount / sizeNum)
                                : entryPrice + (lossAmount / sizeNum)
                              setStopLoss(slPrice > 0 ? slPrice.toFixed(2) : '')
                            } else setStopLoss('')
                          } else setStopLoss('')
                        }}
                      />
                    </div>
                  </div>
                </div>
                {/* Take Profit: Price ($) and Amount ($) */}
                <div className="space-y-1.5">
                  <label className="text-[10px] text-muted font-semibold block">Take Profit</label>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-muted/80 mb-0.5 block">Price ($)</label>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="TP Price"
                        className="w-full"
                        value={takeProfit}
                        onChange={(e) => {
                          const price = e.target.value
                          setTakeProfit(price)
                          if (selectedSymbol && price) {
                            const entryPrice = slTpSide === 'LONG'
                              ? (selectedSymbol.numericPrice2 || selectedSymbol.numericPrice)
                              : selectedSymbol.numericPrice
                            const sizeNum = sizeCalculations.currentUnits
                            const tpPriceNum = parseFloat(price)
                            if (!isNaN(tpPriceNum) && sizeNum > 0) {
                              const tpAmount = slTpSide === 'LONG'
                                ? (tpPriceNum - entryPrice) * sizeNum
                                : (entryPrice - tpPriceNum) * sizeNum
                              setTakeProfitAmount(tpAmount > 0 ? tpAmount.toFixed(2) : '')
                            } else setTakeProfitAmount('')
                          } else setTakeProfitAmount('')
                        }}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted/80 mb-0.5 block">Amount ($)</label>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="Profit Amount"
                        className="w-full"
                        value={takeProfitAmount}
                        onChange={(e) => {
                          const amount = e.target.value
                          setTakeProfitAmount(amount)
                          if (selectedSymbol && amount) {
                            const entryPrice = slTpSide === 'LONG'
                              ? (selectedSymbol.numericPrice2 || selectedSymbol.numericPrice)
                              : selectedSymbol.numericPrice
                            const sizeNum = sizeCalculations.currentUnits
                            const profitAmount = parseFloat(amount)
                            if (!isNaN(profitAmount) && sizeNum > 0) {
                              const tpPrice = slTpSide === 'LONG'
                                ? entryPrice + (profitAmount / sizeNum)
                                : entryPrice - (profitAmount / sizeNum)
                              setTakeProfit(tpPrice > 0 ? tpPrice.toFixed(2) : '')
                            } else setTakeProfit('')
                          } else setTakeProfit('')
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Cost Breakdown - Enhanced */}
          <div className="mb-4 p-4 rounded-xl bg-gradient-to-br from-surface-2/60 to-surface-2/30 border border-white/5 shadow-md">
            <div className="text-[10px] font-bold text-muted uppercase tracking-widest mb-3">Cost Breakdown</div>
            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between items-center py-1 border-b border-white/5">
                <span className="text-muted/80">Spread</span>
                <span className="font-semibold text-text">{costBreakdown.spread}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-white/5">
                <span className="text-muted/80">Fees</span>
                <span className="font-semibold text-text">${costBreakdown.fees}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-white/5">
                <span className="text-muted/80">Est. Margin</span>
                <span className="font-semibold text-accent">${costBreakdown.margin}</span>
              </div>
              <div className="flex justify-between items-center py-1">
                <span className="text-muted/80">Est. Liquidation</span>
                <span className="font-semibold text-text">{costBreakdown.liquidation}</span>
              </div>
            </div>
          </div>

          {!canPlaceOrder && (
            <div className="mb-2 text-xs text-warning text-center py-2 px-2 rounded bg-warning/10">
              {tradingAccess === 'close_only'
                ? 'Opening new positions is disabled. You can only close existing positions.'
                : 'Trading is disabled. You cannot open or close positions.'}
            </div>
          )}
          {/* Action Buttons - Enhanced */}
          <div className="grid grid-cols-2 gap-3">
            <Button 
              variant="success" 
              className="w-full py-3.5 font-bold text-sm shadow-lg shadow-success/20 hover:shadow-success/30 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]" 
              onClick={handleBuy}
              disabled={isSubmitting || !selectedSymbol || !wsConnected || insufficientFreeMargin || !canPlaceOrder}
            >
              <div className="flex items-center justify-center gap-2">
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <TrendingUp className="h-4 w-4" />
                )}
                <span>Buy / Long</span>
              </div>
            </Button>
            <Button 
              variant="danger" 
              className="w-full py-3.5 font-bold text-sm shadow-lg shadow-danger/20 hover:shadow-danger/30 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]" 
              onClick={handleSell}
              disabled={isSubmitting || !selectedSymbol || !wsConnected || insufficientFreeMargin || !canPlaceOrder}
            >
              <div className="flex items-center justify-center gap-2">
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <TrendingDown className="h-4 w-4" />
                )}
                <span>Sell / Short</span>
              </div>
            </Button>
          </div>
          {insufficientFreeMargin && (parseFloat(costBreakdown.margin) || 0) > 0 && (
            <div className="mt-2 text-xs text-danger text-center">
              Insufficient free margin (Est. margin &gt; Free margin)
            </div>
          )}
          {!wsConnected && (
            <div className="mt-2 text-xs text-warning text-center">
              ⚠️ WebSocket disconnected - order updates may be delayed
            </div>
          )}
        </div>

        {/* Leverage, Symbol Details, User - collapsibles */}
        <div className="border-b border-white/5">
          {/* Leverage - collapsible (first); hidden when user's group has hide_leverage_in_terminal */}
          {!meData?.hideLeverageInTerminal && (
          <div className="border-b border-white/5">
            <button
              onClick={() => setLeverageDetailsOpen(!leverageDetailsOpen)}
              className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-surface-2/30 transition-all duration-200 group"
            >
              <div className="flex items-center gap-2">
                <div className="h-1 w-1 rounded-full bg-accent"></div>
                <span className="text-xs font-bold text-text uppercase tracking-wider">Leverage</span>
              </div>
              {leverageDetailsOpen ? (
                <ChevronUp className="h-4 w-4 text-muted group-hover:text-text transition-colors" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted group-hover:text-text transition-colors" />
              )}
            </button>
            {leverageDetailsOpen && (
              <div className="px-4 pb-4 space-y-2.5 text-xs bg-surface-2/20">
                {meData ? (
                  <>
                    {selectedSymbol && (
                      <div className="flex justify-between items-center py-2 border-b border-white/5">
                        <span className="text-muted/80">Symbol</span>
                        <span className="font-mono font-medium text-text">{selectedSymbol.code}</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center py-2 border-b border-white/5">
                      <span className="text-muted/80">Leverage profile{selectedSymbol ? ` (${selectedSymbol.code})` : ''}</span>
                      <span className="font-medium text-text">
                        {selectedSymbol
                          ? symbolLeverageLoading
                            ? 'Loading…'
                            : symbolLeverageFetched
                              ? (symbolLeverage?.leverage_profile_name ?? '—')
                              : '—'
                          : (meData.leverageProfileName ?? '—')}
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-2">
                      <span className="flex items-center gap-1.5">
                        {isUserLimitActive && (
                          <span
                            className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0 ring-2 ring-green-500/40"
                            title="Currently using this limit (min or max)"
                            aria-hidden
                          />
                        )}
                        <span className={isUserLimitActive ? 'text-text' : 'text-muted/80'}>Your min – max</span>
                      </span>
                      <span className="font-semibold text-accent">
                        {meData.minLeverage != null && meData.maxLeverage != null
                          ? `${meData.minLeverage} – ${meData.maxLeverage}×`
                          : meData.minLeverage != null
                            ? `≥ ${meData.minLeverage}×`
                            : meData.maxLeverage != null
                              ? `≤ ${meData.maxLeverage}×`
                              : '—'}
                      </span>
                    </div>
                    {(meData.minLeverage == null && meData.maxLeverage == null) && (
                      <p className="text-[10px] text-muted/80 pt-1">
                        Set in Admin → Users (leverage column)
                      </p>
                    )}
                    {selectedSymbol && symbolLeverage?.tiers && symbolLeverage.tiers.length > 0 && (
                      <div className="pt-2 border-t border-white/5 space-y-1.5">
                        <span className="text-muted/80 text-[10px] uppercase tracking-wider block mb-1.5">Profile tiers</span>
                        <ul className="space-y-1">
                          {symbolLeverage.tiers.map((tier, idx) => {
                            const from = parseFloat(tier.notional_from) || 0
                            const to = tier.notional_to != null ? parseFloat(tier.notional_to) : Infinity
                            const isActive = currentOrderNotional >= from && currentOrderNotional < to
                            return (
                              <li key={idx} className="text-[11px] text-text/90 flex justify-between items-center gap-2">
                                <span className="flex items-center gap-1.5 min-w-0">
                                  {isActive && (
                                    <span
                                      className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0 ring-2 ring-green-500/40"
                                      title="Currently using this tier"
                                      aria-hidden
                                    />
                                  )}
                                  <span className={isActive ? 'text-text' : 'text-muted/80 truncate'}>
                                    {formatTierNotional(tier.notional_from)} – {tier.notional_to != null ? formatTierNotional(tier.notional_to) : '∞'} USD
                                  </span>
                                </span>
                                <span className="font-medium text-accent shrink-0">≤ {tier.max_leverage}×</span>
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex items-center gap-2 text-muted py-2">
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                    <span>Loading…</span>
                  </div>
                )}
              </div>
            )}
          </div>
          )}

          {/* Symbol Details - collapsible (second) */}
          <div className="border-t border-white/5">
            <button
              onClick={() => setSymbolDetailsOpen(!symbolDetailsOpen)}
              className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-surface-2/30 transition-all duration-200 group"
            >
              <div className="flex items-center gap-2">
                <div className="h-1 w-1 rounded-full bg-accent"></div>
                <span className="text-xs font-bold text-text uppercase tracking-wider">Symbol Details</span>
              </div>
              {symbolDetailsOpen ? (
                <ChevronUp className="h-4 w-4 text-muted group-hover:text-text transition-colors" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted group-hover:text-text transition-colors" />
              )}
            </button>
            {symbolDetailsOpen && selectedSymbol && (
              <div className="px-4 pb-4 space-y-3 text-xs bg-surface-2/20">
                <div className="flex justify-between items-center py-2 border-b border-white/5">
                  <span className="text-muted/80">Price</span>
                  <span className="font-semibold text-text">
                    {selectedSymbol.numericPrice > 0 ? liveQuoteBidFormatted(selectedSymbol) : '—'}
                  </span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-white/5">
                  <span className="text-muted/80">24h Change</span>
                  <div className={cn(
                    "flex items-center gap-1.5 font-semibold",
                    selectedSymbol.change24h >= 0 ? 'text-success' : 'text-danger'
                  )}>
                    {selectedSymbol.change24h >= 0 ? (
                      <TrendingUp className="h-3.5 w-3.5" />
                    ) : (
                      <TrendingDown className="h-3.5 w-3.5" />
                    )}
                    <span>{selectedSymbol.change24h >= 0 ? '+' : ''}{selectedSymbol.change24h.toFixed(4)}%</span>
                  </div>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-muted/80">24h Volume</span>
                  <span className="font-semibold text-text">${(selectedSymbol.volume24h / 1000000).toFixed(2)}M</span>
                </div>
              </div>
            )}
          </div>

          {/* User - collapsible (third) */}
          <div className="border-t border-white/5">
            <button
              onClick={() => setUserDetailsOpen(!userDetailsOpen)}
              className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-surface-2/30 transition-all duration-200 group"
            >
              <div className="flex items-center gap-2">
                <div className="h-1 w-1 rounded-full bg-accent"></div>
                <span className="text-xs font-bold text-text uppercase tracking-wider">User</span>
              </div>
              {userDetailsOpen ? (
                <ChevronUp className="h-4 w-4 text-muted group-hover:text-text transition-colors" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted group-hover:text-text transition-colors" />
              )}
            </button>
            {userDetailsOpen && (
              <div className="px-4 pb-4 space-y-2.5 text-xs bg-surface-2/20">
                {meData ? (
                  <>
                    <div className="flex items-center gap-2 pb-2 border-b border-white/5">
                      <User className="h-4 w-4 text-accent shrink-0" />
                      <span className="font-semibold text-text truncate">{meData.email}</span>
                    </div>
                    {meData.groupName != null && (
                      <div className="flex justify-between items-center py-2 border-b border-white/5">
                        <span className="text-muted/80">Group</span>
                        <span className="font-medium text-text">{meData.groupName}</span>
                      </div>
                    )}
                    {meData.priceProfileName != null && (
                      <div className="flex justify-between items-center py-2 border-b border-white/5">
                        <span className="text-muted/80">Price stream</span>
                        <span className="font-medium text-text">{meData.priceProfileName}</span>
                      </div>
                    )}
                    {meData.leverageProfileName != null && (
                      <div className="flex justify-between items-center py-2 border-b border-white/5">
                        <span className="text-muted/80">Leverage profile</span>
                        <span className="font-medium text-text">{meData.leverageProfileName}</span>
                      </div>
                    )}
                    {(meData.minLeverage != null || meData.maxLeverage != null) && (
                      <div className="flex justify-between items-center py-2">
                        <span className="text-muted/80">Leverage range</span>
                        <span className="font-medium text-text">
                          {meData.minLeverage != null && meData.maxLeverage != null
                            ? `${meData.minLeverage}–${meData.maxLeverage}x`
                            : meData.minLeverage != null
                              ? `≥${meData.minLeverage}x`
                              : `≤${meData.maxLeverage}x`}
                        </span>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex items-center gap-2 text-muted py-2">
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                    <span>Loading user…</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Promo carousel - from API (fetch once on mount, no polling) */}
          {promoLoading && (
            <div className="p-4">
              <div className="relative rounded-xl border border-white/10 bg-surface-2/60 overflow-hidden shadow-lg shadow-black/10">
                <div className="aspect-[400/180] w-full animate-pulse bg-slate-800 rounded-xl" />
              </div>
            </div>
          )}
          {!promoLoading && !promoError && promoSlides.length > 0 && (
            <div className="p-4">
              <div className="relative rounded-xl border border-white/10 bg-surface-2/60 overflow-hidden shadow-lg shadow-black/10">
                <div className="absolute top-0 right-0 z-10 flex items-center gap-1.5 px-2 py-1.5">
                  <span className="text-[10px] font-bold text-white/70 uppercase tracking-widest">Promoted</span>
                  <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-semibold text-accent">New</span>
                </div>
                <div className="relative aspect-[400/180] w-full overflow-hidden bg-slate-800">
                  {promoSlides.map((slide, idx) => (
                    <div
                      key={slide.id}
                      className={cn(
                        'absolute inset-0 transition-opacity duration-500',
                        idx === promoSlideIndex ? 'opacity-100 z-0' : 'opacity-0 z-0 pointer-events-none'
                      )}
                    >
                      <img
                        src={slide.image_url}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
                      <div className="absolute bottom-0 left-0 right-0 p-3 text-left">
                        <h3 className="text-sm font-bold text-white drop-shadow-sm">{slide.title}</h3>
                        <p className="text-[11px] text-white/80 mt-0.5">{slide.subtitle ?? ''}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-surface-2/40 border-t border-white/5">
                  <div className="flex items-center gap-1.5">
                    {promoSlides.map((_, idx) => (
                      <button
                        key={promoSlides[idx]?.id ?? idx}
                        type="button"
                        aria-label={`Go to slide ${idx + 1}`}
                        onClick={() => setPromoSlideIndex(idx)}
                        className={cn(
                          'h-1.5 rounded-full transition-all',
                          idx === promoSlideIndex ? 'w-4 bg-accent' : 'w-1.5 bg-white/30 hover:bg-white/50'
                        )}
                      />
                    ))}
                  </div>
                  {promoSlides[promoSlideIndex]?.link_url ? (
                    <a
                      href={promoSlides[promoSlideIndex].link_url!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 rounded-lg bg-accent/15 hover:bg-accent/25 border border-accent/30 px-2.5 py-1.5 text-xs font-semibold text-accent transition-colors"
                    >
                      {promoSlides[promoSlideIndex].link_label || 'Learn more'}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </a>
                  ) : (
                    <button
                      type="button"
                      className="flex items-center gap-1.5 rounded-lg bg-accent/15 hover:bg-accent/25 border border-accent/30 px-2.5 py-1.5 text-xs font-semibold text-accent transition-colors"
                      onClick={() => toast('Coming soon')}
                    >
                      Learn more
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer - status strip */}
      <div className="shrink-0 border-t border-white/5 px-3 py-3">
        <div className="rounded-lg bg-surface-2/40 border border-white/5 p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-muted-foreground">
              <Clock className="h-3.5 w-3.5 shrink-0" />
            </span>
            <span className="font-mono text-[11px] font-medium tabular-nums text-slate-100">{currentTimeLabel}</span>
          </div>
          <div className="h-px bg-white/5" />
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-muted-foreground">
              <Gauge className="h-3.5 w-3.5 shrink-0" />
              <span>Ping</span>
            </span>
            <span
              className={cn(
                'font-mono text-[11px] font-medium tabular-nums',
                pingMs == null
                  ? 'text-muted-foreground'
                  : pingMs <= 100
                    ? 'text-success'
                    : 'text-danger'
              )}
            >
              {pingMs != null ? `${pingMs} ms` : '— ms'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

