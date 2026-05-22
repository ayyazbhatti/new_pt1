import { X, ChevronDown, ChevronUp, TrendingUp, TrendingDown, Activity, Loader2, Clock, Gauge, ArrowRight, User, Search, Check } from 'lucide-react'
import { Button } from '@/shared/ui'
import { Input } from '@/shared/ui'
import { Segmented } from '@/shared/ui'
import { Checkbox } from '@/shared/ui'
import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { cn } from '@/shared/utils'
import { useTerminalStore } from '../store'
import { SlippageInput } from './SlippageInput'
import { toast } from '@/shared/components/common'
import { SinglePriceDisplay } from './SinglePriceDisplay'
import {
  placeOrder,
  PlaceOrderRequest,
  estimateOrderMargin,
  clientMarketFallbackMarginUsdOrNull,
} from '../api/orders.api'
import { useAuthStore } from '@/shared/store/auth.store'
import { useFormatFromUsd, useFormatAmount } from '@/shared/currency'
import type { CurrencyCode } from '@/shared/currency/types'
import { useQuery } from '@tanstack/react-query'
import { me, getSymbolLeverage, getEffectiveLeverage, type SlippageSource } from '@/shared/api/auth.api'
import { wsClient } from '@/shared/ws/wsClient'
import { getWsGatewayUrl } from '@/shared/ws/wsGatewayUrl'
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
import { useSymbolPrice } from '@/features/symbols/hooks/usePriceStream'
import { useAccountSummary } from '@/features/wallet/hooks/useAccountSummary'
import { useSessionStatus, useSessionStatusBatch } from '../hooks/useSessionStatus'
import { formatOpensInLabel, formatClosesInLabel } from '../utils/sessionCountdown'
import { tryToastPlaceOrderForbiddenError } from '../utils/placeOrderErrorToast'
import { getPromotionSlides } from '../api/promotions.api'
import type { PromotionSlidePublic } from '../api/promotions.api'
import { useEffectiveTimezone, useTimezoneOffsetLabel } from '@/shared/datetime'

// Local storage key for trading panel state
const TRADING_PANEL_STORAGE_KEY = 'trading-panel-state'

const WS_WARNING_INITIAL_GRACE_MS = 5000
const WS_WARNING_STABLE_MS = 2000
const MIN_EST_MARGIN_DOLLARS = 10
type WsConnectionState = 'disconnected' | 'connecting' | 'connected' | 'authenticated'

interface TradingPanelState {
  orderType: string
  sizeMode: 'units' | 'lots' | 'pipPosition'
  /** When true, do not auto-snap size mode to the symbol's asset-class default on symbol change or reload. */
  sizeModeUserExplicit?: boolean
  size: string
  lotSize: string
  pipPosition: string
  pipPositionCurrency: string
  currency: string
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

function liveQuoteSpreadFormatted(
  s: MockSymbol,
  bidNum: number,
  askNum: number,
  bidStr?: string,
  askStr?: string,
): string {
  if (bidNum <= 0 || askNum <= 0) return '0'
  if (
    isForexTerminalSymbol(s) &&
    bidStr !== undefined &&
    bidStr !== '' &&
    askStr !== undefined &&
    askStr !== ''
  ) {
    const diff = Math.abs(parseFloat(askStr) - parseFloat(bidStr))
    return diff.toFixed(quoteFractionDigits(bidStr, askStr))
  }
  const p = s.pricePrecision ?? 2
  return Math.abs(askNum - bidNum).toFixed(p)
}

/**
 * Default ticket size mode by asset class (lots for FX / contract-style symbols; units for crypto & stocks).
 * Uses admin symbol when loaded; falls back to terminal `MockSymbol.assetClass` only.
 */
function getDefaultSizeModeForSymbol(
  terminalSymbol: MockSymbol | null,
  admin: AdminSymbol | null,
): 'units' | 'lots' | 'pipPosition' {
  if (!terminalSymbol && !admin) return 'units'
  const ac = (admin?.assetClass ?? terminalSymbol?.assetClass ?? '').toString().trim().toUpperCase()
  const market = (admin?.market ?? '').toString().trim().toLowerCase()
  const contractSize = Math.max(0, parseFloat(String(admin?.contractSize ?? '1')) || 0) || 1

  if (ac === 'FX' || market === 'forex') return 'lots'

  if (
    contractSize > 1 &&
    (ac === 'INDICES' ||
      ac === 'INDEX' ||
      market === 'indices' ||
      ac === 'METALS' ||
      ac === 'METAL' ||
      market === 'metals' ||
      ac === 'COMMODITIES' ||
      ac === 'COMMODITY' ||
      market === 'commodities')
  ) {
    return 'lots'
  }

  return 'units'
}

/** Interpret `getDefaultSizeForMinMargin()` string (quote or base per active `currency`) as base units. */
function defaultSizeStringToBaseUnits(
  sizeStr: string,
  sym: MockSymbol,
  currency: string,
  executionPrice: number,
): number | null {
  const n = parseFloat(sizeStr)
  if (!Number.isFinite(n) || n <= 0 || executionPrice <= 0) return null
  if (currency === sym.quoteCurrency) return n / executionPrice
  return n
}

export function RightTradingPanel() {
  const selectedSymbol = useTerminalStore((s) => s.selectedSymbol)
  const setSelectedSymbol = useTerminalStore((s) => s.setSelectedSymbol)
  const symbols = useTerminalStore((s) => s.symbols)
  const tradingAccess = useAuthStore((s) => s.user?.tradingAccess ?? 'full')
  const canPlaceOrder = tradingAccess === 'full'
  const { data: meData } = useQuery({ queryKey: ['auth', 'me'], queryFn: me })
  const defaultSlippageBps = useMemo(() => meData?.effectiveSlippageBps ?? 50, [meData?.effectiveSlippageBps])
  const defaultSlippageSource: SlippageSource = useMemo(
    () => meData?.effectiveSlippageSource ?? 'platformDefault',
    [meData?.effectiveSlippageSource],
  )
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

  const selectedLiveKey = selectedSymbol?.priceLookupKey || selectedSymbol?.code || null
  const selectedLivePrice = useSymbolPrice(selectedLiveKey)
  const liveBidNum = useMemo(() => {
    const b = selectedLivePrice?.bid
    if (b == null || b === '') return 0
    const n = parseFloat(b)
    return Number.isFinite(n) ? n : 0
  }, [selectedLivePrice?.bid, selectedLivePrice?.ts])
  const liveAskNum = useMemo(() => {
    const a = selectedLivePrice?.ask
    if (a == null || a === '') return 0
    const n = parseFloat(a)
    return Number.isFinite(n) ? n : 0
  }, [selectedLivePrice?.ask, selectedLivePrice?.ts])
  const liveBidStr = selectedLivePrice?.bid
  const liveAskStr = selectedLivePrice?.ask

  const { accountSummary } = useAccountSummary()
  const formatMoney = useFormatFromUsd()
  const formatAmount = useFormatAmount()
  const formatLiveQuoteBid = useCallback(
    (s: MockSymbol) => {
      if (liveBidNum <= 0) return ''
      const qc = (s.quoteCurrency || 'USD') as CurrencyCode
      if (isForexTerminalSymbol(s) && liveBidStr) {
        const n = parseFloat(liveBidStr)
        if (!Number.isFinite(n)) return ''
        return formatAmount(n, qc)
      }
      return formatAmount(liveBidNum, qc)
    },
    [formatAmount, liveBidNum, liveBidStr],
  )
  const formatLiveQuoteAsk = useCallback(
    (s: MockSymbol) => {
      if (liveAskNum <= 0) return ''
      const qc = (s.quoteCurrency || 'USD') as CurrencyCode
      if (isForexTerminalSymbol(s) && liveAskStr) {
        const n = parseFloat(liveAskStr)
        if (!Number.isFinite(n)) return ''
        return formatAmount(n, qc)
      }
      return formatAmount(liveAskNum, qc)
    },
    [formatAmount, liveAskNum, liveAskStr],
  )
  const tz = useEffectiveTimezone()
  const offsetLabel = useTimezoneOffsetLabel()
  const [clockNow, setClockNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setClockNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // Load initial state from localStorage only on mount (lazy init) so reload restores tab and values
  const [orderType, setOrderType] = useState(() => loadTradingPanelState().orderType || 'market')
  const [sizeModeUserExplicit, setSizeModeUserExplicit] = useState(
    () => loadTradingPanelState().sizeModeUserExplicit === true,
  )
  const [sizeMode, setSizeMode] = useState<'units' | 'lots' | 'pipPosition'>(() => {
    const p = loadTradingPanelState()
    const validMode =
      p.sizeMode === 'units' || p.sizeMode === 'lots' || p.sizeMode === 'pipPosition' ? p.sizeMode : null
    if (p.sizeModeUserExplicit === true && validMode) return validMode
    return getDefaultSizeModeForSymbol(useTerminalStore.getState().selectedSymbol, null)
  })
  const [size, setSize] = useState(() => loadTradingPanelState().size || '0.003457')
  const [lotSize, setLotSize] = useState(() => loadTradingPanelState().lotSize || '0.5')
  const [pipPosition, setPipPosition] = useState(() => loadTradingPanelState().pipPosition || '5')
  const [pipPositionCurrency, setPipPositionCurrency] = useState(() => loadTradingPanelState().pipPositionCurrency || 'USD')
  const [currency, setCurrency] = useState<string>(() => loadTradingPanelState().currency || '')
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
  const autoSizeSeedKeyRef = useRef('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pendingOrders, setPendingOrders] = useState<Set<string>>(new Set())
  /** Which side market/limit preview uses for margin estimate (BUY→ask, SELL→bid). Updated on Buy/Sell hover/focus and click. */
  const [previewOrderSide, setPreviewOrderSide] = useState<'BUY' | 'SELL'>('BUY')
  const [slippageBps, setSlippageBps] = useState(50)
  const [slippageOverridden, setSlippageOverridden] = useState(false)

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

  const { data: session } = useSessionStatus(selectedSymbol?.code)
  const dropdownCodes = useMemo(
    () => (symbolDropdownOpen ? filteredSymbolsForDropdown.map((s) => s.code) : []),
    [symbolDropdownOpen, filteredSymbolsForDropdown]
  )
  const { data: dropdownSessionMap = {} } = useSessionStatusBatch(dropdownCodes)

  const isSessionClosed = session != null && !session.isOpen
  const isSymbolTradingOff = selectedSymbol != null && !selectedSymbol.enabled
  const sessionBlocksOrders = isSessionClosed || isSymbolTradingOff

  useEffect(() => {
    if (!slippageOverridden) {
      setSlippageBps(defaultSlippageBps)
    }
  }, [defaultSlippageBps, slippageOverridden])

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
      sizeModeUserExplicit,
      size,
      lotSize,
      pipPosition,
      pipPositionCurrency,
      currency,
      useSlTp,
      stopLoss,
      takeProfit,
      limitPrice,
      symbolDetailsOpen,
      userDetailsOpen,
      leverageDetailsOpen,
      selectedSymbolCode: selectedSymbol?.code ?? '',
    })
  }, [orderType, sizeMode, sizeModeUserExplicit, size, lotSize, pipPosition, pipPositionCurrency, currency, useSlTp, stopLoss, takeProfit, limitPrice, symbolDetailsOpen, userDetailsOpen, leverageDetailsOpen, selectedSymbol?.code])

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

  // When the user has not locked size mode (Segmented or prior explicit save), follow symbol-class default (e.g. FX → lots).
  useEffect(() => {
    if (sizeModeUserExplicit) return
    if (!selectedSymbol) return
    const next = getDefaultSizeModeForSymbol(selectedSymbol, adminSymbol)
    setSizeMode((prev) => (prev === next ? prev : next))
  }, [
    sizeModeUserExplicit,
    selectedSymbol?.id,
    selectedSymbol?.code,
    selectedSymbol?.assetClass,
    adminSymbol?.id,
    adminSymbol?.assetClass,
    adminSymbol?.market,
    adminSymbol?.contractSize,
  ])

  // Real-time calculations for different modes
  const sizeCalculations = useMemo(() => {
    const symbolForCalc = getSymbolForCalculations()
    if (!symbolForCalc || !selectedSymbol || liveBidNum <= 0) {
      return {
        pipValuePerLot: 0,
        currentLotSize: 0,
        currentUnits: 0,
        currentPipPosition: 0,
      }
    }

    const price = liveBidNum
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

    const safePipValuePerLot = Number.isFinite(pipValuePerLot) ? pipValuePerLot : 0
    const safeCurrentLotSize = Number.isFinite(currentLotSize) ? currentLotSize : 0
    const safeCurrentUnits = Number.isFinite(currentUnits) ? currentUnits : 0
    const safeCurrentPipPosition = Number.isFinite(currentPipPosition) ? currentPipPosition : 0

    return {
      pipValuePerLot: safePipValuePerLot,
      currentLotSize: safeCurrentLotSize,
      currentUnits: safeCurrentUnits,
      currentPipPosition: safeCurrentPipPosition,
    }
  }, [sizeMode, size, lotSize, pipPosition, selectedSymbol, liveBidNum, currency, pipPositionCurrency, getSymbolForCalculations])

  // Handle size mode change with conversion
  const handleSizeModeChange = useCallback((newMode: 'units' | 'lots' | 'pipPosition') => {
    if (newMode === sizeMode) return
    setSizeModeUserExplicit(true)

    const symbolForCalc = getSymbolForCalculations()
    if (!symbolForCalc || !selectedSymbol || liveBidNum <= 0) {
      setSizeMode(newMode)
      return
    }

    const price = liveBidNum
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
  }, [sizeMode, sizeCalculations, selectedSymbol, getSymbolForCalculations, liveBidNum])

  // Compute a default units size so estimated margin targets minimum threshold.
  const getDefaultSizeForMinMargin = useCallback((): string | null => {
    if (!selectedSymbol) return null
    const marketPrice = liveAskNum || liveBidNum || 0
    const limitPriceNum = parseFloat(limitPrice)
    const executionPrice =
      orderType === 'limit' && Number.isFinite(limitPriceNum) && limitPriceNum > 0
        ? limitPriceNum
        : marketPrice
    if (executionPrice <= 0) return null

    let notional = MIN_EST_MARGIN_DOLLARS * 50
    for (let i = 0; i < 5; i += 1) {
      const leverage = getEffectiveLeverage(
        notional,
        symbolLeverage?.tiers ?? null,
        meData?.minLeverage,
        meData?.maxLeverage,
        50
      )
      if (!Number.isFinite(leverage) || leverage <= 0) break
      notional = MIN_EST_MARGIN_DOLLARS * leverage
    }
    if (!Number.isFinite(notional) || notional <= 0) return null

    const symbolForCalc = getSymbolForCalculations()
    const volPrecision = symbolForCalc?.volumePrecision ?? 8
    if (currency === selectedSymbol.quoteCurrency) {
      return notional.toFixed(2)
    }
    return (notional / executionPrice).toFixed(volPrecision)
  }, [
    selectedSymbol,
    limitPrice,
    orderType,
    symbolLeverage?.tiers,
    meData?.minLeverage,
    meData?.maxLeverage,
    getSymbolForCalculations,
    currency,
    liveBidNum,
    liveAskNum,
  ])

  // Auto-seed default size once per context, so initial value meets min estimated margin target.
  // Previously: SHOW_ONLY_UNITS hid lots/pip and this effect only ran in units — lots mode kept stale lotSize vs min margin.
  // Fix: seed `size`, `lotSize`, or `pipPosition` from the same target base-units notional; seedKey includes `sizeMode`.
  // Reference: docs/phase-2-lot-size-investigation.md
  useEffect(() => {
    if (!selectedSymbol || !currency) return
    if (orderType === 'limit' && !limitPrice.trim()) return

    const seedKey = `${selectedSymbol.code}|${currency}|${orderType}|${orderType === 'limit' ? limitPrice.trim() : 'market'}|${sizeMode}`
    if (autoSizeSeedKeyRef.current === seedKey) return

    const nextSize = getDefaultSizeForMinMargin()
    if (!nextSize) return

    const marketPrice = liveAskNum || liveBidNum || 0
    const limitPriceNum = parseFloat(limitPrice)
    const executionPrice =
      orderType === 'limit' && Number.isFinite(limitPriceNum) && limitPriceNum > 0
        ? limitPriceNum
        : marketPrice
    if (executionPrice <= 0) return

    const symbolForCalc = getSymbolForCalculations()
    if (!symbolForCalc) return
    const baseUnits = defaultSizeStringToBaseUnits(nextSize, selectedSymbol, currency, executionPrice)
    if (baseUnits == null || baseUnits <= 0) return

    autoSizeSeedKeyRef.current = seedKey

    if (sizeMode === 'units') {
      setSize(nextSize)
      return
    }

    if (sizeMode === 'lots') {
      const lots = normalizeLotSize(calculateLotsFromUnits(baseUnits, symbolForCalc), symbolForCalc)
      setLotSize(formatLotSize(lots, symbolForCalc))
      return
    }

    if (sizeMode === 'pipPosition') {
      const lots = normalizeLotSize(calculateLotsFromUnits(baseUnits, symbolForCalc), symbolForCalc)
      const pip = calculatePipPositionFromLots(lots, symbolForCalc, executionPrice, pipPositionCurrency)
      if (Number.isFinite(pip) && pip > 0) setPipPosition(pip.toFixed(2))
    }
  }, [
    selectedSymbol,
    currency,
    orderType,
    limitPrice,
    sizeMode,
    getDefaultSizeForMinMargin,
    getSymbolForCalculations,
    pipPositionCurrency,
    liveBidNum,
    liveAskNum,
  ])

  /** Server-side margin (same as place_order). Uses Redis execution price + risk::effective_leverage. */
  const canEstimateServerMargin =
    !!selectedSymbol &&
    Number.isFinite(sizeCalculations.currentUnits) &&
    sizeCalculations.currentUnits > 0 &&
    (orderType === 'market' || (orderType === 'limit' && limitPrice.trim() !== ''))

  const {
    data: serverMarginEstimate,
    isFetching: isEstimatingServerMargin,
    isError: isMarginEstimateError,
  } = useQuery({
    queryKey: [
      'v1',
      'orderMarginEstimate',
      selectedSymbol?.code,
      sizeCalculations.currentUnits,
      orderType,
      limitPrice,
      previewOrderSide,
    ],
    queryFn: () =>
      estimateOrderMargin({
        symbol: selectedSymbol!.code,
        side: previewOrderSide,
        orderType: orderType === 'limit' ? 'LIMIT' : 'MARKET',
        size: String(sizeCalculations.currentUnits),
        limitPrice: orderType === 'limit' && limitPrice.trim() ? limitPrice : undefined,
      }),
    enabled: canEstimateServerMargin,
    staleTime: 2000,
  })

  /** Pre-pay placement fee from POST /v1/orders/estimate; null when fees off / no rule / zero / loading. */
  const placementFeeFromEstimateUsd = useMemo(() => {
    const raw = serverMarginEstimate?.estimatedFeeUsd
    if (raw == null || raw === '') return null
    const n = Number(raw)
    if (!Number.isFinite(n) || n <= 0) return null
    return n
  }, [serverMarginEstimate?.estimatedFeeUsd])

  // Calculate costs from the same base-units path as place order (units / lots / pip), not raw `size` only
  const costBreakdown = useMemo(() => {
    if (!selectedSymbol) {
      return {
        spread: '0.00',
        margin: '0.00',
        liquidation: '-',
        usdValue: '0.00',
        baseSize: '0.00',
        quoteValue: '0.00',
      }
    }

    const bid = liveBidNum || 0
    const ask = liveAskNum || bid
    const refPriceMid = ask !== bid ? (bid + ask) / 2 : bid

    const baseSize = sizeCalculations.currentUnits
    const quoteValue = refPriceMid > 0 ? baseSize * refPriceMid : 0

    const spread = Math.abs(ask - bid)
    const limitPx =
      orderType === 'limit' && limitPrice.trim() !== '' ? parseFloat(limitPrice) : Number.NaN
    const limitExecutionPrice = Number.isFinite(limitPx) && limitPx > 0 ? limitPx : null
    const marginUsd = clientMarketFallbackMarginUsdOrNull({
      bid,
      ask,
      side: previewOrderSide,
      baseUnits: baseSize,
      tiers: symbolLeverage?.tiers,
      userMin: meData?.minLeverage,
      userMax: meData?.maxLeverage,
      orderType: orderType === 'limit' ? 'LIMIT' : 'MARKET',
      limitExecutionPrice,
    })
    const margin = marginUsd != null ? marginUsd.toFixed(2) : '—'
    const liquidation = '-'

    return {
      spread: spread.toFixed(2),
      margin,
      liquidation,
      usdValue: quoteValue.toFixed(2),
      baseSize: baseSize.toFixed(8),
      quoteValue: quoteValue.toFixed(2),
    }
  }, [
    selectedSymbol,
    sizeCalculations.currentUnits,
    meData?.minLeverage,
    meData?.maxLeverage,
    symbolLeverage?.tiers,
    previewOrderSide,
    orderType,
    limitPrice,
    liveBidNum,
    liveAskNum,
  ])

  // Current order notional (exposure) for "active tier" indicator in Leverage card (matches preview execution price)
  const currentOrderNotional = useMemo(() => {
    if (!selectedSymbol) return 0
    if (orderType === 'limit' && limitPrice.trim() !== '') {
      const lp = parseFloat(limitPrice)
      if (Number.isFinite(lp) && lp > 0) {
        return sizeCalculations.currentUnits * lp
      }
    }
    const bid = liveBidNum || 0
    const ask = liveAskNum || bid
    const exec = previewOrderSide === 'SELL' ? bid : ask
    if (exec <= 0) return 0
    return sizeCalculations.currentUnits * exec
  }, [selectedSymbol, sizeCalculations.currentUnits, previewOrderSide, orderType, limitPrice])

  // Effective leverage for current order (used to show "active" on user min/max when clamped)
  const effectiveLeverageForCard = useMemo(
    () => getEffectiveLeverage(currentOrderNotional, symbolLeverage?.tiers ?? null, meData?.minLeverage, meData?.maxLeverage, 50),
    [currentOrderNotional, symbolLeverage?.tiers, meData?.minLeverage, meData?.maxLeverage]
  )
  const isUserLimitActive =
    meData &&
    ((meData.minLeverage != null && effectiveLeverageForCard === meData.minLeverage) ||
      (meData.maxLeverage != null && effectiveLeverageForCard === meData.maxLeverage))

  const parsedServerMarginUsd = useMemo(() => {
    const s = serverMarginEstimate?.requiredMargin
    if (s == null || s === '') return null
    const n = parseFloat(s)
    return Number.isFinite(n) ? n : null
  }, [serverMarginEstimate?.requiredMargin])

  const fallbackMarginUsd = useMemo(() => {
    if (!selectedSymbol) return null
    const limitPx =
      orderType === 'limit' && limitPrice.trim() !== '' ? parseFloat(limitPrice) : Number.NaN
    const limitExecutionPrice = Number.isFinite(limitPx) && limitPx > 0 ? limitPx : null
    return clientMarketFallbackMarginUsdOrNull({
      bid: liveBidNum || 0,
      ask: liveAskNum || liveBidNum || 0,
      side: previewOrderSide,
      baseUnits: sizeCalculations.currentUnits,
      tiers: symbolLeverage?.tiers,
      userMin: meData?.minLeverage,
      userMax: meData?.maxLeverage,
      orderType: orderType === 'limit' ? 'LIMIT' : 'MARKET',
      limitExecutionPrice,
    })
  }, [
    selectedSymbol,
    previewOrderSide,
    sizeCalculations.currentUnits,
    symbolLeverage?.tiers,
    meData?.minLeverage,
    meData?.maxLeverage,
    orderType,
    limitPrice,
  ])

  /** Resolved margin: server estimate when valid, else strict client fallback (no 2% guess). */
  const estMarginDollars: number | null =
    parsedServerMarginUsd != null ? parsedServerMarginUsd : fallbackMarginUsd

  const effectiveLeverageDisplay: string = (() => {
    if (isMarginEstimateError) return '—'
    const raw = serverMarginEstimate?.effectiveLeverage
    if (raw == null) return '—'
    const n = Number(raw)
    if (!Number.isFinite(n) || n <= 0) return '—'
    return Number.isInteger(n) ? `${n}×` : `${n.toFixed(2)}×`
  })()

  const marginCalcUnavailable = canEstimateServerMargin && estMarginDollars == null

  // Block Buy/Sell when estimated margin + placement fee exceeds free margin (server also enforces)
  const insufficientFreeMargin =
    estMarginDollars != null &&
    estMarginDollars + (placementFeeFromEstimateUsd ?? 0) > (accountSummary?.freeMargin ?? 0)
  const minRequiredMarginDollars = MIN_EST_MARGIN_DOLLARS
  const belowMinRequiredMargin =
    estMarginDollars != null && estMarginDollars > 0 && estMarginDollars < minRequiredMarginDollars

  // Format live price for limit price placeholder
  const livePricePlaceholder = useMemo(() => {
    if (!selectedSymbol || liveBidNum <= 0) {
      return 'Enter limit price'
    }
    // Use bid price (numericPrice) as the reference
    const price = liveBidNum
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
    if (!selectedSymbol || liveBidNum <= 0) {
      return 'Enter size'
    }
    // Show current market price as reference
    const price = liveBidNum
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
    if (!selectedSymbol || !liveBidNum) {
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
      const maxBaseSize = maxQuoteValue / liveBidNum
      setSize(maxBaseSize.toFixed(8))
    }
    toast.success('Size set to maximum')
  }

  // Handle currency change with conversion
  const handleCurrencyChange = (newCurrency: string) => {
    if (!selectedSymbol || !liveBidNum || currency === newCurrency) {
      setCurrency(newCurrency)
      return
    }

    const sizeNum = parseFloat(size) || 0
    if (sizeNum <= 0) {
      setCurrency(newCurrency)
      return
    }

    const price = liveBidNum || 0
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
  const [wsState, setWsState] = useState<WsConnectionState>(wsClient.getState() as WsConnectionState)
  const [showWsDisconnectedWarning, setShowWsDisconnectedWarning] = useState(false)
  const wsWarningSuppressedUntilRef = useRef<number>(Date.now() + WS_WARNING_INITIAL_GRACE_MS)
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

  const headerClockTime = useMemo(
    () =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: tz.iana,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(clockNow),
    [clockNow, tz.iana],
  )
  const headerClockDate = useMemo(
    () =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: tz.iana,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
        .format(clockNow)
        .replace(/\//g, '.'),
    [clockNow, tz.iana],
  )

  // Measure ping by fetching WS gateway health (proxied in dev via /ws-health)
  useEffect(() => {
    const wsUrl = getWsGatewayUrl()
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
      const state = wsClient.getState() as WsConnectionState
      setWsState(state)
      setWsConnected(state === 'authenticated')
    }
    updateStatus()
    
    // Subscribe to state changes
    const unsubscribeState = wsClient.onStateChange((state) => {
      setWsState(state as WsConnectionState)
      setWsConnected(state === 'authenticated')
    })

    // Subscribe to order update events
    const unsubscribe = wsClient.subscribe((event: WsInboundEvent) => {
      // Handle order update events (when backend sends them via WebSocket)
      if (event.type === 'admin.order.updated' || event.type === 'admin.order.filled' || event.type === 'admin.order.canceled' || event.type === 'admin.order.rejected') {
        const order = (event as any).payload.order || (event as any).payload
        const orderId = order?.orderId || order?.id || (event as any).payload.orderId
        const status = order?.status || (event as any).payload.status
        if (status === 'Filled' || status === 'FILLED' || status === 'filled') {
          useTerminalStore.getState().requestOpenPositionsRefresh()
        }

        if (orderId && typeof orderId === 'string' && pendingOrders.has(orderId)) {
          setPendingOrders(prev => {
            const next = new Set(prev)
            next.delete(orderId)
            return next
          })

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

  // Professional WS banner behavior:
  // - hide warning while connection is in progress
  // - only show disconnected warning after brief stability delay + initial grace
  useEffect(() => {
    if (wsState === 'authenticated' || wsState === 'connecting' || wsState === 'connected') {
      setShowWsDisconnectedWarning(false)
      return
    }

    setShowWsDisconnectedWarning(false)
    const now = Date.now()
    const remainingGrace = Math.max(0, wsWarningSuppressedUntilRef.current - now)
    const timer = window.setTimeout(() => {
      setShowWsDisconnectedWarning(true)
    }, remainingGrace + WS_WARNING_STABLE_MS)

    return () => window.clearTimeout(timer)
  }, [wsState])

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

    // Get base size in units based on current mode (API always receives base units).
    let baseSize = 0
    let displaySize = ''

    if (sizeMode === 'units') {
      const sizeNum = parseFloat(size)
      if (!sizeNum || sizeNum <= 0) {
        toast.error('Please enter a valid size')
        return
      }
      baseSize = sizeNum
      if (currency === selectedSymbol.quoteCurrency && liveBidNum > 0) {
        baseSize = sizeNum / liveBidNum
      }
      displaySize = currency === selectedSymbol.quoteCurrency 
        ? `${size} ${selectedSymbol.quoteCurrency} (${baseSize.toFixed(8)} ${selectedSymbol.baseCurrency})`
        : `${size} ${selectedSymbol.baseCurrency}`
    } else if (sizeMode === 'lots') {
      const lotSizeNum = parseFloat(lotSize)
      if (!lotSizeNum || lotSizeNum <= 0) {
        toast.error('Please enter a valid lot size')
        return
      }
      const normalizedLots = normalizeLotSize(lotSizeNum, symbolForCalc)
      baseSize = calculateUnitsFromLots(normalizedLots, symbolForCalc)
      displaySize = `${formatLotSize(normalizedLots, symbolForCalc)} lots (${formatUnits(baseSize, symbolForCalc)} units)`
    } else if (sizeMode === 'pipPosition') {
      const pipPosNum = parseFloat(pipPosition)
      if (!pipPosNum || pipPosNum <= 0) {
        toast.error('Please enter a valid pip position')
        return
      }
      const price = liveBidNum || 0
      if (price <= 0) {
        toast.error('Price not available')
        return
      }
      const calculatedLots = calculateLotSizeFromPipPosition(pipPosNum, symbolForCalc, price, pipPositionCurrency)
      baseSize = calculateUnitsFromLots(calculatedLots, symbolForCalc)
      displaySize = `${formatAmount(pipPosNum, pipPositionCurrency as CurrencyCode)}/pip (${formatLotSize(calculatedLots, symbolForCalc)} lots, ${formatUnits(baseSize, symbolForCalc)} units)`
    }

    if (!Number.isFinite(baseSize) || baseSize <= 0) {
      toast.error('Invalid position size')
      return
    }

    if (orderType === 'limit' && !limitPrice) {
      toast.error('Please enter a limit price for limit orders')
      return
    }

    if (canEstimateServerMargin && estMarginDollars == null) {
      toast.error(
        'Margin cannot be calculated — tier configuration unavailable or price data missing. Check Admin leverage profiles for this symbol.'
      )
      return
    }

    if (insufficientFreeMargin && estMarginDollars != null) {
      const freeMargin = accountSummary?.freeMargin ?? 0
      toast.error(
        `Insufficient funds: required margin ${formatMoney(estMarginDollars)}, free margin ${formatMoney(freeMargin)}`
      )
      return
    }
    if (belowMinRequiredMargin) {
      toast.error(`Estimated margin must be at least ${formatMoney(minRequiredMarginDollars)} to open a position`)
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
        ...(orderType === 'market' && slippageOverridden ? { slippage_bps: slippageBps } : {}),
      }

      const response = await placeOrder(payload)
      
      // Handle both camelCase (API) and snake_case (legacy) for compatibility
      const orderId = response.orderId || (response as any).order_id
      
      if (!orderId) {
        throw new Error('Order ID not returned from server')
      }
      
      setPendingOrders(prev => new Set(prev).add(orderId))
      useTerminalStore.getState().registerRecentSubmittedOrder(orderId)

      useTerminalStore.getState().requestOpenPositionsRefresh()

      // Show "submitted" message - actual execution happens asynchronously
      toast.success(
        `${side} order submitted: ${displaySize} @ ${selectedSymbol.code} (Order ID: ${orderId.slice(0, 8)}...)`,
        { duration: 3000 }
      )

      // Reset form for market orders (keep limit orders for potential modifications)
      if (orderType === 'market') {
        if (sizeMode === 'units') {
          const nextDefaultSize = getDefaultSizeForMinMargin()
          setSize(nextDefaultSize ?? '0.003457')
        } else if (sizeMode === 'lots') {
          setLotSize('0.5')
        } else if (sizeMode === 'pipPosition') {
          setPipPosition('5')
        }
        setStopLoss('')
        setTakeProfit('')
        setUseSlTp(false)
      }
    } catch (error: unknown) {
      if (tryToastPlaceOrderForbiddenError(error, toast, clockNow.getTime())) {
        return
      }
      const err = error as { response?: { data?: { error?: string | { code?: string; message?: string }; message?: string }; status?: number }; message?: string }
      const data = err?.response?.data
      const status = err?.response?.status
      const apiMessage = typeof data?.error === 'object' && data?.error?.message
        ? data.error.message
        : data?.message ?? (typeof data?.error === 'object' ? (data.error as { message?: string }).message : undefined)
      const insufficientCode =
        data?.error === 'INSUFFICIENT_FREE_MARGIN' ||
        (typeof data?.error === 'object' && data?.error?.code === 'INSUFFICIENT_FREE_MARGIN')
      const minRequiredMarginCode =
        data?.error === 'MIN_REQUIRED_MARGIN_NOT_MET' ||
        (typeof data?.error === 'object' && data?.error?.code === 'MIN_REQUIRED_MARGIN_NOT_MET')
      const required = Number((data as { required_margin?: string })?.required_margin)
      const free = Number((data as { free_margin?: string })?.free_margin)
      const minRequired = Number((data as { min_required_margin?: string })?.min_required_margin)
      const insufficientMessage =
        Number.isFinite(required) && Number.isFinite(free)
          ? `Insufficient funds: required margin ${formatMoney(required)}, free margin ${formatMoney(free)}`
          : 'Insufficient funds/margin to place this order'
      const minRequiredMessage =
        Number.isFinite(minRequired)
          ? `Estimated margin must be at least ${formatMoney(minRequired)} to open a position`
          : `Estimated margin must be at least ${formatMoney(minRequiredMarginDollars)} to open a position`
      const is403 = status === 403 || (typeof err?.message === 'string' && err.message.includes('403'))
      const errorMessage =
        (minRequiredMarginCode ? minRequiredMessage : null) ||
        (insufficientCode ? insufficientMessage : null) ||
        apiMessage ||
        (is403 ? 'Trading is disabled. You cannot open new positions.' : null) ||
        (error instanceof Error ? error.message : 'Failed to place order')
      const showPlain = minRequiredMarginCode || insufficientCode || is403 || apiMessage
      toast.error(showPlain ? errorMessage : `Order failed: ${errorMessage}`)
      console.error('Order placement error:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleBuy = () => {
    setPreviewOrderSide('BUY')
    void handlePlaceOrder('BUY')
  }

  const handleSell = () => {
    setPreviewOrderSide('SELL')
    void handlePlaceOrder('SELL')
  }

  return (
    <div className="h-full min-h-0 overflow-hidden bg-gradient-to-b from-slate-100 to-slate-50 dark:from-[#0f172a] dark:to-[#0b1220] flex flex-col border-l border-slate-200 dark:border-white/5">
      {/* Header */}
      <div className="shrink-0 h-12 border-b border-slate-200 dark:border-white/5 flex items-center justify-between px-4 bg-gradient-to-r from-slate-100/70 dark:from-white/[0.02] to-transparent">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-text tracking-tight">Trading Panel</h2>
          <div className="h-1.5 w-1.5 rounded-full bg-success animate-pulse shadow-sm shadow-success/50"></div>
        </div>
        <button
          onClick={() => toast('Panel close feature coming soon')}
          className="p-1.5 hover:bg-surface-2 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95"
          title="Close Panel"
        >
          <X className="h-4 w-4 text-slate-600 dark:text-muted" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        {/* Order Ticket */}
        <div className="p-4 border-b border-slate-200 dark:border-white/5">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-1 w-1 rounded-full bg-accent"></div>
            <div className="text-xs font-bold text-text uppercase tracking-wider">Order Ticket</div>
          </div>

          {/* Symbol */}
          <div className="mb-4 relative" ref={symbolDropdownRef}>
            <label className="text-xs font-semibold text-slate-600 dark:text-muted mb-2 block uppercase tracking-wider">Symbol</label>
            <button
              type="button"
              onClick={() => setSymbolDropdownOpen((o) => !o)}
              className={cn(
                'w-full rounded-lg bg-surface-2 border px-3 py-2.5 text-sm font-medium text-text focus:outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20 focus:ring-offset-0 transition-all duration-200 hover:border-accent/30 flex items-center justify-between gap-2',
                symbolDropdownOpen ? 'border-accent/50' : 'border-slate-200 dark:border-white/5'
              )}
            >
              <span className="truncate">{selectedSymbol?.code || 'Select symbol'}</span>
              <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-600 dark:text-muted transition-transform', symbolDropdownOpen && 'rotate-180')} />
            </button>
            {symbolDropdownOpen && (
              <div
                className="absolute left-0 right-0 top-full mt-1 z-50 rounded-lg bg-surface-2 border border-slate-300 dark:border-white/10 shadow-xl shadow-slate-400/20 dark:shadow-black/40 overflow-hidden flex flex-col"
                style={{ maxHeight: 'min(60vh, 320px)' }}
              >
                <div className="shrink-0 p-2 border-b border-slate-200 dark:border-white/5">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-600 dark:text-muted pointer-events-none" />
                    <Input
                      placeholder="Search symbols..."
                      value={symbolSearchQuery}
                      onChange={(e) => setSymbolSearchQuery(e.target.value)}
                      className={cn(
                        'pl-8 h-9 text-sm bg-slate-100 dark:bg-white/5 border-slate-300 dark:border-white/10 text-text placeholder:text-slate-500 dark:placeholder:text-muted',
                        'focus:border-accent/50 focus:ring-1 focus:ring-accent/20'
                      )}
                      autoFocus
                    />
                  </div>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto">
                  {filteredSymbolsForDropdown.length === 0 ? (
                    <div className="px-3 py-4 text-center text-slate-600 dark:text-muted text-sm">No symbols match</div>
                  ) : (
                    filteredSymbolsForDropdown.map((symbol) => {
                      const ddSession = dropdownSessionMap[symbol.code]
                      const ddClosed = ddSession != null && !ddSession.isOpen
                      const ddDimmed = !symbol.enabled || ddClosed
                      return (
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
                          ddDimmed && 'opacity-50 hover:opacity-75',
                          selectedSymbol?.id === symbol.id
                            ? 'bg-accent/15 text-accent'
                            : 'text-text hover:bg-slate-100 dark:hover:bg-white/5'
                        )}
                      >
                        <span className="truncate flex items-center gap-2 min-w-0">
                          {symbol.code}
                          {ddDimmed ? (
                            <span className="text-[10px] font-bold uppercase text-amber-500 shrink-0">
                              {!symbol.enabled ? 'Off' : 'Closed'}
                            </span>
                          ) : null}
                        </span>
                        {selectedSymbol?.id === symbol.id ? <Check className="h-4 w-4 shrink-0 text-accent" /> : null}
                      </button>
                      )
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Live Quote - Enhanced Professional Design */}
          {selectedSymbol && (
            <div className="mb-4 p-4 rounded-xl bg-gradient-to-br from-slate-100 to-white border border-slate-200 shadow-sm dark:from-surface-2/80 dark:to-surface-2/40 dark:border-white/5 dark:shadow-lg dark:shadow-black/20 relative overflow-hidden">
              {/* Live indicator */}
              <div className="absolute top-2 right-2 flex items-center gap-1.5">
                <Activity className="h-3 w-3 text-success animate-pulse" />
                <span className="text-[10px] font-semibold text-success uppercase tracking-wider">Live</span>
              </div>
              
              <div className="flex flex-wrap items-center gap-2 pr-14 mb-3">
                <div className="text-[10px] font-bold text-slate-600 dark:text-muted uppercase tracking-widest">Live Quote</div>
                {session && !session.is24_7 ? (
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide',
                      session.isOpen
                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                        : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                    )}
                  >
                    <span
                      className={cn(
                        'h-1.5 w-1.5 rounded-full shrink-0',
                        session.isOpen ? 'bg-emerald-500' : 'bg-amber-500'
                      )}
                    />
                    {session.isOpen
                      ? formatClosesInLabel(session.nextCloseAt, session.timezone, clockNow.getTime()) ||
                        'Market open'
                      : formatOpensInLabel(session.nextOpenAt, session.timezone, clockNow.getTime()) ||
                        'Market closed'}
                  </span>
                ) : null}
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <div className="text-[10px] text-slate-600/90 dark:text-muted/70 uppercase tracking-wider">Bid</div>
                  {liveBidNum > 0 ? (
                    <SinglePriceDisplay
                      price={liveBidNum}
                      formatted={formatLiveQuoteBid(selectedSymbol)}
                    />
                  ) : (
                    <div className="text-lg font-bold text-slate-500 dark:text-text-muted">—</div>
                  )}
                </div>
                <div className="space-y-1.5 text-right">
                  <div className="text-[10px] text-slate-600/90 dark:text-muted/70 uppercase tracking-wider">Ask</div>
                  {liveAskNum > 0 ? (
                    <div className="flex justify-end">
                      <SinglePriceDisplay
                        price={liveAskNum}
                        formatted={formatLiveQuoteAsk(selectedSymbol)}
                      />
                    </div>
                  ) : (
                    <div className="text-lg font-bold text-slate-500 dark:text-text-muted">—</div>
                  )}
                </div>
              </div>
              
              {/* Spread indicator */}
              {liveBidNum > 0 && liveAskNum > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-200 dark:border-white/5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-600/90 dark:text-muted/70">Spread</span>
                    <span className="text-xs font-semibold text-text">
                      {liveQuoteSpreadFormatted(selectedSymbol, liveBidNum, liveAskNum, liveBidStr, liveAskStr)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Order Type */}
          <div className="mb-4">
            <label className="text-xs font-semibold text-slate-600 dark:text-muted mb-2 block uppercase tracking-wider">Order Type</label>
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
              <label className="text-xs text-slate-600 dark:text-muted mb-1 block">Limit Price</label>
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

          {/* Size Mode Selector */}
          <div className="mb-3">
            <label className="text-xs font-semibold text-slate-600 dark:text-muted uppercase tracking-wider mb-2 block">Size Mode</label>
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

          {/* Size Input - Conditional based on mode */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-600 dark:text-muted uppercase tracking-wider">
                {sizeMode === 'units' ? 'Size' : sizeMode === 'lots' ? 'Lot Size' : 'Pip Position'}
              </label>
              {sizeMode === 'units' && (
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
            {sizeMode === 'units' && (
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
                    className="rounded-lg bg-surface-2 border border-slate-200 dark:border-white/5 px-3 py-2 text-sm text-text focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/20 focus:ring-offset-0 transition-all duration-200"
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
                <div className="text-xs text-slate-600 dark:text-muted mt-1">
                  {selectedSymbol && currency ? (
                    currency === selectedSymbol.baseCurrency ? (
                      <>≈ {costBreakdown.quoteValue} {selectedSymbol.quoteCurrency}</>
                    ) : (
                      <>≈ {costBreakdown.baseSize} {selectedSymbol.baseCurrency}</>
                    )
                  ) : (
                    <>≈ {formatMoney(0)}</>
                  )}
                </div>

                <div className="flex items-center justify-between text-xs pt-1 mt-3">
                  <span className="text-slate-600/90 dark:text-muted/80">Leverage</span>
                  <span className="font-semibold text-accent">{effectiveLeverageDisplay}</span>
                </div>
              </>
            )}

            {/* Lots Mode */}
            {sizeMode === 'lots' && (
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
                  <div className="rounded-lg bg-surface-2 border border-slate-200 dark:border-white/5 px-3 py-2 text-sm text-text">
                    Lots
                  </div>
                </div>
                <div className="text-xs text-slate-600 dark:text-muted mt-1">
                  {sizeCalculations.currentUnits > 0 && (
                    <>
                      {formatUnits(sizeCalculations.currentUnits, getSymbolForCalculations() || {} as AdminSymbol)} units
                    </>
                  )}
                  {sizeCalculations.currentPipPosition > 0 && (
                    <span className="ml-2">
                      • {formatAmount(sizeCalculations.currentPipPosition, pipPositionCurrency as CurrencyCode)}/pip
                    </span>
                  )}
                  {getSymbolForCalculations() && (
                    <span className="ml-2 text-slate-600/85 dark:text-muted/70">
                      (Min: {getSymbolForCalculations()?.lotMin || 0.01}, Max: {getSymbolForCalculations()?.lotMax || 100})
                    </span>
                  )}
                </div>
              </>
            )}

            {/* Pip Position Mode */}
            {sizeMode === 'pipPosition' && (
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
                    className="rounded-lg bg-surface-2 border border-slate-200 dark:border-white/5 px-3 py-2 text-sm text-text focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/20 focus:ring-offset-0 transition-all duration-200"
                  >
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                  </select>
                </div>
                <div className="text-xs text-slate-600 dark:text-muted mt-1">
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
                    <span className="ml-2 text-slate-600/85 dark:text-muted/70">
                      (Pip value: {formatAmount(sizeCalculations.pipValuePerLot, (selectedSymbol?.quoteCurrency || 'USD') as CurrencyCode)}/lot)
                    </span>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Stop Loss / Take Profit - Price and Amount (same as Edit Position popup) */}
          <div className="mb-3">
            <div className="flex items-center mb-2">
              <Checkbox
                checked={useSlTp}
                onChange={(e) => setUseSlTp(e.target.checked)}
              />
              <span className="text-xs text-slate-600 dark:text-muted ml-2">Use Stop Loss / Take Profit</span>
            </div>
            {useSlTp && (
              <div className="space-y-3 mt-2">
                {/* Side for SL/TP calculation (entry price = ask for LONG, bid for SHORT) */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-600 dark:text-muted">For:</span>
                  <div className="flex rounded-lg overflow-hidden border border-slate-300 dark:border-white/10">
                    <button
                      type="button"
                      onClick={() => setSlTpSide('LONG')}
                      className={cn(
                        'px-2 py-1 text-[10px] font-medium transition-colors',
                        slTpSide === 'LONG' ? 'bg-accent text-white' : 'bg-slate-100 text-slate-600 hover:text-slate-900 dark:bg-surface-2 dark:text-muted dark:hover:text-text'
                      )}
                    >
                      Buy
                    </button>
                    <button
                      type="button"
                      onClick={() => setSlTpSide('SHORT')}
                      className={cn(
                        'px-2 py-1 text-[10px] font-medium transition-colors',
                        slTpSide === 'SHORT' ? 'bg-accent text-white' : 'bg-slate-100 text-slate-600 hover:text-slate-900 dark:bg-surface-2 dark:text-muted dark:hover:text-text'
                      )}
                    >
                      Sell
                    </button>
                  </div>
                </div>
                {/* Stop Loss: price and notional in quote currency */}
                <div className="space-y-1.5">
                  <label className="text-[10px] text-slate-600 dark:text-muted font-semibold block">Stop Loss</label>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-slate-600 dark:text-muted/80 mb-0.5 block">
                        Price ({selectedSymbol?.quoteCurrency || 'USD'})
                      </label>
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
                              ? (liveAskNum || liveBidNum)
                              : liveBidNum
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
                      <label className="text-[10px] text-slate-600 dark:text-muted/80 mb-0.5 block">
                        Amount ({selectedSymbol?.quoteCurrency || 'USD'} notional)
                      </label>
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
                              ? (liveAskNum || liveBidNum)
                              : liveBidNum
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
                {/* Take Profit: price and notional in quote currency */}
                <div className="space-y-1.5">
                  <label className="text-[10px] text-slate-600 dark:text-muted font-semibold block">Take Profit</label>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-slate-600 dark:text-muted/80 mb-0.5 block">
                        Price ({selectedSymbol?.quoteCurrency || 'USD'})
                      </label>
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
                              ? (liveAskNum || liveBidNum)
                              : liveBidNum
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
                      <label className="text-[10px] text-slate-600 dark:text-muted/80 mb-0.5 block">
                        Amount ({selectedSymbol?.quoteCurrency || 'USD'} notional)
                      </label>
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
                              ? (liveAskNum || liveBidNum)
                              : liveBidNum
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
          <div className="mb-4 p-4 rounded-xl bg-gradient-to-br from-slate-100 to-slate-50 border border-slate-200 shadow-sm dark:from-surface-2/60 dark:to-surface-2/30 dark:border-white/5 dark:shadow-md">
            <div className="text-[10px] font-bold text-slate-600 dark:text-muted uppercase tracking-widest mb-3">Cost Breakdown</div>
            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between items-center py-1 border-b border-slate-200 dark:border-white/5">
                <span className="text-slate-600/90 dark:text-muted/80">Spread</span>
                <span className="font-semibold text-text">{costBreakdown.spread}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-200 dark:border-white/5">
                <span className="text-slate-600/90 dark:text-muted/80">Fees</span>
                <span className="font-semibold text-text">
                  {placementFeeFromEstimateUsd != null
                    ? formatMoney(placementFeeFromEstimateUsd)
                    : '—'}
                </span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-200 dark:border-white/5">
                <span className="text-slate-600/90 dark:text-muted/80">Est. Margin</span>
                <span className="font-semibold text-accent inline-flex items-center gap-1.5">
                  {isEstimatingServerMargin && canEstimateServerMargin && estMarginDollars == null ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-600 dark:text-muted shrink-0" />
                  ) : null}
                  {estMarginDollars == null ? '—' : formatMoney(estMarginDollars)}
                </span>
              </div>
              <div className="flex justify-between items-center py-1">
                <span className="text-slate-600/90 dark:text-muted/80">Est. Liquidation</span>
                <span className="font-semibold text-text">{costBreakdown.liquidation}</span>
              </div>
              {orderType === 'market' && (
                <div className="pt-2 mt-1 border-t border-slate-200/80 dark:border-white/5">
                  <SlippageInput
                    value={slippageBps}
                    defaultBps={defaultSlippageBps}
                    defaultSource={defaultSlippageSource}
                    isOverridden={slippageOverridden}
                    onChange={(bps, isOverride) => {
                      setSlippageBps(bps)
                      setSlippageOverridden(isOverride)
                    }}
                  />
                </div>
              )}
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
              onMouseEnter={() => setPreviewOrderSide('BUY')}
              onFocus={() => setPreviewOrderSide('BUY')}
              title={
                sessionBlocksOrders
                  ? isSessionClosed
                    ? 'Market is closed for this symbol.'
                    : 'Trading is disabled for this symbol.'
                  : marginCalcUnavailable
                    ? 'Margin cannot be calculated — tier configuration unavailable.'
                    : undefined
              }
              disabled={
                isSubmitting ||
                !selectedSymbol ||
                !wsConnected ||
                marginCalcUnavailable ||
                insufficientFreeMargin ||
                belowMinRequiredMargin ||
                !canPlaceOrder ||
                sessionBlocksOrders
              }
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
              onMouseEnter={() => setPreviewOrderSide('SELL')}
              onFocus={() => setPreviewOrderSide('SELL')}
              title={
                sessionBlocksOrders
                  ? isSessionClosed
                    ? 'Market is closed for this symbol.'
                    : 'Trading is disabled for this symbol.'
                  : marginCalcUnavailable
                    ? 'Margin cannot be calculated — tier configuration unavailable.'
                    : undefined
              }
              disabled={
                isSubmitting ||
                !selectedSymbol ||
                !wsConnected ||
                marginCalcUnavailable ||
                insufficientFreeMargin ||
                belowMinRequiredMargin ||
                !canPlaceOrder ||
                sessionBlocksOrders
              }
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
          {isSessionClosed && session && (
            <div className="mt-2 text-center text-xs text-amber-500">
              Market closed —{' '}
              {formatOpensInLabel(session.nextOpenAt, session.timezone, clockNow.getTime()) ||
                'No upcoming session'}
            </div>
          )}
          {!isSessionClosed && isSymbolTradingOff && (
            <div className="mt-2 text-center text-xs text-amber-500">Trading disabled for this symbol.</div>
          )}
          {insufficientFreeMargin && estMarginDollars != null && estMarginDollars > 0 && (
            <div className="mt-2 text-xs text-danger text-center">
              Insufficient free margin (Est. margin &gt; Free margin)
            </div>
          )}
          {marginCalcUnavailable && (
            <div className="mt-2 text-xs text-warning text-center px-2">
              Margin cannot be calculated — tier configuration unavailable or price data missing. Check Admin leverage
              profiles for this symbol.
            </div>
          )}
          {belowMinRequiredMargin && (
            <div className="mt-2 text-xs text-warning text-center">
              Minimum estimated margin is {formatMoney(minRequiredMarginDollars)}
            </div>
          )}
          {!wsConnected && (wsState === 'connecting' || wsState === 'connected') && (
            <div className="mt-2 text-xs text-slate-600 dark:text-muted text-center">
              Connecting to live updates...
            </div>
          )}
          {showWsDisconnectedWarning && (
            <div className="mt-2 text-xs text-warning text-center">
              ⚠️ WebSocket disconnected - order updates may be delayed
            </div>
          )}
        </div>

        {/* Leverage, Symbol Details, User - collapsibles */}
        <div className="border-b border-slate-200 dark:border-white/5">
          {/* Leverage - collapsible (first); hidden when user's group has hide_leverage_in_terminal */}
          {!meData?.hideLeverageInTerminal && (
          <div className="border-b border-slate-200 dark:border-white/5">
            <button
              onClick={() => setLeverageDetailsOpen(!leverageDetailsOpen)}
              className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-surface-2/30 transition-all duration-200 group"
            >
              <div className="flex items-center gap-2">
                <div className="h-1 w-1 rounded-full bg-accent"></div>
                <span className="text-xs font-bold text-text uppercase tracking-wider">Leverage</span>
              </div>
              {leverageDetailsOpen ? (
                <ChevronUp className="h-4 w-4 text-slate-600 dark:text-muted group-hover:text-slate-900 dark:group-hover:text-text transition-colors" />
              ) : (
                <ChevronDown className="h-4 w-4 text-slate-600 dark:text-muted group-hover:text-slate-900 dark:group-hover:text-text transition-colors" />
              )}
            </button>
            {leverageDetailsOpen && (
              <div className="px-4 pb-4 space-y-2.5 text-xs bg-surface-2/20">
                {meData ? (
                  <>
                    {selectedSymbol && (
                      <div className="flex justify-between items-center py-2 border-b border-slate-200 dark:border-white/5">
                        <span className="text-slate-600/90 dark:text-muted/80">Symbol</span>
                        <span className="font-mono font-medium text-text">{selectedSymbol.code}</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center py-2 border-b border-slate-200 dark:border-white/5">
                      <span className="text-slate-600/90 dark:text-muted/80">Leverage profile{selectedSymbol ? ` (${selectedSymbol.code})` : ''}</span>
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
                        <span className={isUserLimitActive ? 'text-text' : 'text-slate-600/90 dark:text-muted/80'}>Your min – max</span>
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
                      <p className="text-[10px] text-slate-600/90 dark:text-muted/80 pt-1">
                        Set in Admin → Users (leverage column)
                      </p>
                    )}
                    {selectedSymbol && symbolLeverage?.tiers && symbolLeverage.tiers.length > 0 && (
                      <div className="pt-2 border-t border-slate-200 dark:border-white/5 space-y-1.5">
                        <span className="text-slate-600/90 dark:text-muted/80 text-[10px] uppercase tracking-wider block mb-1.5">Profile tiers</span>
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
                                  <span className={isActive ? 'text-text' : 'text-slate-600/90 dark:text-muted/80 truncate'}>
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
                  <div className="flex items-center gap-2 text-slate-600 dark:text-muted py-2">
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                    <span>Loading…</span>
                  </div>
                )}
              </div>
            )}
          </div>
          )}

          {/* Symbol Details - collapsible (second) */}
          <div className="border-t border-slate-200 dark:border-white/5">
            <button
              onClick={() => setSymbolDetailsOpen(!symbolDetailsOpen)}
              className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-surface-2/30 transition-all duration-200 group"
            >
              <div className="flex items-center gap-2">
                <div className="h-1 w-1 rounded-full bg-accent"></div>
                <span className="text-xs font-bold text-text uppercase tracking-wider">Symbol Details</span>
              </div>
              {symbolDetailsOpen ? (
                <ChevronUp className="h-4 w-4 text-slate-600 dark:text-muted group-hover:text-slate-900 dark:group-hover:text-text transition-colors" />
              ) : (
                <ChevronDown className="h-4 w-4 text-slate-600 dark:text-muted group-hover:text-slate-900 dark:group-hover:text-text transition-colors" />
              )}
            </button>
            {symbolDetailsOpen && selectedSymbol && (
              <div className="px-4 pb-4 space-y-3 text-xs bg-surface-2/20">
                {selectedSymbol.providerDescription && (
                  <div className="py-2 border-b border-slate-200 dark:border-white/5">
                    <div className="text-slate-600/90 dark:text-muted/80 mb-1">Description</div>
                    <div className="font-medium text-text leading-relaxed">
                      {selectedSymbol.providerDescription}
                    </div>
                  </div>
                )}
                {selectedSymbol.mmdpsCategory && (
                  <div className="flex justify-between items-center py-2 border-b border-slate-200 dark:border-white/5">
                    <span className="text-slate-600/90 dark:text-muted/80">Category</span>
                    <span className="font-semibold text-text">{selectedSymbol.mmdpsCategory}</span>
                  </div>
                )}
                <div className="flex justify-between items-center py-2 border-b border-slate-200 dark:border-white/5">
                  <span className="text-slate-600/90 dark:text-muted/80">Price</span>
                  <span className="font-semibold text-text">
                    {liveBidNum > 0 ? formatLiveQuoteBid(selectedSymbol) : '—'}
                  </span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-200 dark:border-white/5">
                  <span className="text-slate-600/90 dark:text-muted/80">24h Change</span>
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
                  <span className="text-slate-600/90 dark:text-muted/80">24h Volume</span>
                  <span className="font-semibold text-text">
                    {`${(selectedSymbol.volume24h / 1_000_000).toFixed(2)}M`}{' '}
                    <span className="text-muted font-normal">{selectedSymbol.quoteCurrency ?? ''}</span>
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* User - collapsible (third) */}
          <div className="border-t border-slate-200 dark:border-white/5">
            <button
              onClick={() => setUserDetailsOpen(!userDetailsOpen)}
              className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-surface-2/30 transition-all duration-200 group"
            >
              <div className="flex items-center gap-2">
                <div className="h-1 w-1 rounded-full bg-accent"></div>
                <span className="text-xs font-bold text-text uppercase tracking-wider">User</span>
              </div>
              {userDetailsOpen ? (
                <ChevronUp className="h-4 w-4 text-slate-600 dark:text-muted group-hover:text-slate-900 dark:group-hover:text-text transition-colors" />
              ) : (
                <ChevronDown className="h-4 w-4 text-slate-600 dark:text-muted group-hover:text-slate-900 dark:group-hover:text-text transition-colors" />
              )}
            </button>
            {userDetailsOpen && (
              <div className="px-4 pb-4 space-y-2.5 text-xs bg-surface-2/20">
                {meData ? (
                  <>
                    <div className="flex items-center gap-2 pb-2 border-b border-slate-200 dark:border-white/5">
                      <User className="h-4 w-4 text-accent shrink-0" />
                      <span className="font-semibold text-text truncate">{meData.email}</span>
                    </div>
                    {meData.groupName != null && (
                      <div className="flex justify-between items-center py-2 border-b border-slate-200 dark:border-white/5">
                        <span className="text-slate-600/90 dark:text-muted/80">Group</span>
                        <span className="font-medium text-text">{meData.groupName}</span>
                      </div>
                    )}
                    {meData.priceProfileName != null && (
                      <div className="flex justify-between items-center py-2 border-b border-slate-200 dark:border-white/5">
                        <span className="text-slate-600/90 dark:text-muted/80">Price stream</span>
                        <span className="font-medium text-text">{meData.priceProfileName}</span>
                      </div>
                    )}
                    {meData.leverageProfileName != null && (
                      <div className="flex justify-between items-center py-2 border-b border-slate-200 dark:border-white/5">
                        <span className="text-slate-600/90 dark:text-muted/80">Leverage profile</span>
                        <span className="font-medium text-text">{meData.leverageProfileName}</span>
                      </div>
                    )}
                    {(meData.minLeverage != null || meData.maxLeverage != null) && (
                      <div className="flex justify-between items-center py-2">
                        <span className="text-slate-600/90 dark:text-muted/80">Leverage range</span>
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
                  <div className="flex items-center gap-2 text-slate-600 dark:text-muted py-2">
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
              <div className="relative rounded-xl border border-slate-300 dark:border-white/10 bg-surface-2/60 overflow-hidden shadow-lg shadow-slate-300/20 dark:shadow-black/10">
                <div className="aspect-[400/180] w-full animate-pulse bg-slate-200 dark:bg-slate-800 rounded-xl" />
              </div>
            </div>
          )}
          {!promoLoading && !promoError && promoSlides.length > 0 && (
            <div className="p-4">
              <div className="relative rounded-xl border border-slate-300 dark:border-white/10 bg-surface-2/60 overflow-hidden shadow-lg shadow-slate-300/20 dark:shadow-black/10">
                <div className="absolute top-0 right-0 z-10 flex items-center gap-1.5 px-2 py-1.5">
                  <span className="text-[10px] font-bold text-slate-600 dark:text-white/70 uppercase tracking-widest">Promoted</span>
                  <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-semibold text-accent">New</span>
                </div>
                <div className="relative aspect-[400/180] w-full overflow-hidden bg-slate-200 dark:bg-slate-800">
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
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white drop-shadow-sm">{slide.title}</h3>
                        <p className="text-[11px] text-slate-700 dark:text-white/80 mt-0.5">{slide.subtitle ?? ''}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-surface-2/40 border-t border-slate-200 dark:border-white/5">
                  <div className="flex items-center gap-1.5">
                    {promoSlides.map((_, idx) => (
                      <button
                        key={promoSlides[idx]?.id ?? idx}
                        type="button"
                        aria-label={`Go to slide ${idx + 1}`}
                        onClick={() => setPromoSlideIndex(idx)}
                        className={cn(
                          'h-1.5 rounded-full transition-all',
                          idx === promoSlideIndex ? 'w-4 bg-accent' : 'w-1.5 bg-slate-400/80 dark:bg-white/30 hover:bg-slate-500 dark:hover:bg-white/50'
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
      <div className="shrink-0 border-t border-slate-200 dark:border-white/5 px-3 py-3">
        <div className="rounded-lg bg-surface-2/40 border border-slate-200 dark:border-white/5 p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2 text-slate-600 dark:text-slate-400">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate text-[10px] font-medium text-slate-600 dark:text-slate-400">
                {offsetLabel} · {tz.iana}
              </span>
            </span>
            <span className="shrink-0 font-mono text-[11px] font-medium tabular-nums text-slate-900 dark:text-slate-100">
              {headerClockTime} {headerClockDate}
            </span>
          </div>
          <div className="h-px bg-slate-200 dark:bg-white/5" />
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
              <Gauge className="h-3.5 w-3.5 shrink-0" />
              <span>Ping</span>
            </span>
            <span
              className={cn(
                'font-mono text-[11px] font-medium tabular-nums',
                pingMs == null
                  ? 'text-slate-500 dark:text-slate-400'
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

