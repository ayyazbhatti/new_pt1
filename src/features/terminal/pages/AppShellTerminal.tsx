import { useEffect, useMemo, useState } from 'react'
import { TerminalLayout } from '../layout/TerminalLayout'
import { LeftSidebar } from '../components/LeftSidebar'
import { CenterWorkspace } from '../components/CenterWorkspace'
import { RightTradingPanel } from '../components/RightTradingPanel'
import { SettingsPanel } from '../components/SettingsPanel'
import { NotificationsPanel } from '../components/NotificationsPanel'
import { PaymentPanel } from '../components/PaymentPanel'
import { ChatPanel } from '../components/ChatPanel'
import { useTerminalStore } from '../store'
import { useSymbolsList } from '@/features/symbols/hooks/useSymbols'
import { usePriceStream } from '@/features/symbols/hooks/usePriceStream'
import { AdminSymbol } from '@/features/symbols/types/symbol'
import { MockSymbol } from '@/shared/mock/terminalMock'
import { useAccountSummary } from '@/features/wallet/hooks/useAccountSummary'
import { useMarginCall } from '@/features/wallet/hooks/useMarginCall'
import { MarginCallModal } from '@/features/wallet/components/MarginCallModal'
import { DepositModal } from '@/features/wallet/components/DepositModal'
import { useAuthStore } from '@/shared/store/auth.store'
import { getTerminalPreferences } from '../api/preferences.api'

// Map AdminSymbol to MockSymbol format
function mapSymbolToTerminal(symbol: AdminSymbol, prices: Map<string, { bid: string; ask: string; ts: number }>): MockSymbol {
  // Normalize symbol key - try multiple formats to match price map
  // Gateway sends BTCUSD (after converting from BTCUSDT)
  // Symbol might have providerSymbol="BTCUSDT" or symbolCode="BTC-USD" or "BTCUSD"
  const normalizeKey = (key: string) => {
    return key
      .toUpperCase()
      .replace(/-/g, '') // Remove dashes: BTC-USD -> BTCUSD
      .replace('USDT', 'USD') // Convert USDT to USD: BTCUSDT -> BTCUSD
  }
  
  // Try multiple lookup keys
  const possibleKeys = [
    normalizeKey(symbol.providerSymbol || ''),
    normalizeKey(symbol.symbolCode),
    symbol.providerSymbol?.toUpperCase().replace('USDT', 'USD'),
    symbol.symbolCode.toUpperCase().replace(/-/g, ''),
  ].filter(k => k && k.length > 0)
  
  let priceData: { bid: string; ask: string; ts: number } | undefined
  let matchedKey: string | undefined
  
  for (const key of possibleKeys) {
    priceData = prices.get(key)
    if (priceData) {
      matchedKey = key
      break
    }
  }
  
  // Debug: Log symbol matching
  if (!priceData) {
    console.log(`⚠️ No price data for symbol: ${symbol.symbolCode} | Tried keys: ${possibleKeys.join(', ')} | Available keys:`, Array.from(prices.keys()))
  } else {
    console.log(`✅ Found price for ${symbol.symbolCode} (matched key: ${matchedKey}): bid=${priceData.bid}, ask=${priceData.ask}`)
  }
  
  const bid = priceData ? parseFloat(priceData.bid) : 0
  const ask = priceData ? parseFloat(priceData.ask) : bid || 0
  
  // Format prices based on precision
  const formatPrice = (value: number) => {
    if (value === 0) return '$0.00'
    const precision = symbol.pricePrecision || 2
    return `$${value.toFixed(precision)}`
  }

  return {
    id: symbol.id,
    code: symbol.symbolCode,
    price: formatPrice(bid),
    price2: formatPrice(ask),
    value: '$0',
    enabled: symbol.isEnabled && symbol.tradingEnabled,
    numericPrice: bid,
    numericPrice2: ask,
    change24h: 0, // TODO: Calculate from price history
    volume24h: 0, // TODO: Get from market data
    baseCurrency: symbol.baseCurrency,
    quoteCurrency: symbol.quoteCurrency,
    pricePrecision: symbol.pricePrecision,
    volumePrecision: symbol.volumePrecision,
  }
}

export function AppShellTerminal() {
  const {
    setSymbols,
    setLoading,
    symbols,
    notificationPanelOpen,
    chatPanelOpen,
    paymentPanelOpen,
    settingsPanelOpen,
    setChartShowAskPrice,
    setChartShowPositionMarker,
    setChartShowClosedPositionMarker,
  } = useTerminalStore()
  const { user } = useAuthStore()
  const [depositModalOpen, setDepositModalOpen] = useState(false)
  const { accountSummary } = useAccountSummary()
  const marginCall = useMarginCall(accountSummary ?? null)

  // Load terminal preferences from server once (non-blocking; store already has localStorage values for first paint)
  useEffect(() => {
    if (!user?.id) return
    getTerminalPreferences()
      .then((res) => {
        setChartShowAskPrice(res.preferences.chartShowAskPrice)
        setChartShowPositionMarker(res.preferences.chartShowPositionMarker)
        setChartShowClosedPositionMarker(res.preferences.chartShowClosedPositionMarker)
      })
      .catch(() => {
        // Keep current store values (localStorage or defaults); optional: toast could go here
      })
  }, [user?.id, setChartShowAskPrice, setChartShowPositionMarker, setChartShowClosedPositionMarker])

  // Fetch enabled symbols
  const { data: symbolsData, isLoading } = useSymbolsList({
    is_enabled: 'true',
    page_size: 100,
  })

  // Get symbol codes for price streaming - must match feed symbols (e.g. BTCUSDT from data-provider)
  const symbolCodes = useMemo(() => {
    if (!symbolsData?.items) return []
    const codes = symbolsData.items
      .map((s) => {
        if (s.providerSymbol) {
          return s.providerSymbol.toUpperCase()
        }
        const normalized = s.symbolCode.toUpperCase().replace(/-/g, '')
        // Feed uses BTCUSDT etc.; for crypto USD pairs derive XXXUSDT so gateway receives matching ticks
        if (s.assetClass === 'Crypto' && s.quoteCurrency === 'USD' && normalized.endsWith('USD') && !normalized.endsWith('USDT')) {
          return normalized.slice(0, -3) + 'USDT'
        }
        return normalized
      })
      .filter((code) => code && code.length > 0)
    console.log('📡 Final symbol codes to subscribe (feed format):', codes)
    return codes
  }, [symbolsData])

  // Subscribe to price stream
  const { prices: priceMap, isConnected, triggerResubscribe } = usePriceStream(symbolCodes)

  // Re-request price subscription when connected with symbols but no prices (in case first subscribe was lost)
  useEffect(() => {
    if (priceMap.size > 0 || !isConnected || symbolCodes.length === 0) return
    const t = setTimeout(() => {
      if (triggerResubscribe) {
        console.log('🔄 Terminal: Price map still empty after 3s, triggering re-subscribe')
        triggerResubscribe()
      }
    }, 3000)
    return () => clearTimeout(t)
  }, [isConnected, symbolCodes.length, priceMap.size, triggerResubscribe])

  // Update symbols when data or prices change
  useEffect(() => {
    if (symbolsData?.items) {
      console.log('🔄 Mapping symbols with prices. Price map size:', priceMap.size)
      console.log('🔄 Price map keys:', Array.from(priceMap.keys()))
      console.log('🔄 Symbols to map:', symbolsData.items.map(s => ({ 
        code: s.symbolCode, 
        provider: s.providerSymbol, 
        lookupKey: (s.providerSymbol || s.symbolCode).toUpperCase() 
      })))
      
      const mappedSymbols = symbolsData.items.map((symbol) =>
        mapSymbolToTerminal(symbol, priceMap)
      )
      const priceSummary = mappedSymbols.map(s => ({ 
        code: s.code, 
        price: s.numericPrice, 
        ask: s.numericPrice2,
        hasPrice: s.numericPrice > 0 
      }))
      const withPrices = priceSummary.filter(s => s.hasPrice)
      const withoutPrices = priceSummary.filter(s => !s.hasPrice)
      console.log('📋 Terminal: Mapped symbols with prices:', priceSummary)
      console.log(`📊 Summary: ${withPrices.length} symbols with prices, ${withoutPrices.length} without prices`)
      if (withoutPrices.length > 0) {
        console.log('⚠️ Symbols without prices:', withoutPrices.slice(0, 10).map(s => s.code))
      }
      if (withPrices.length > 0) {
        console.log('✅ Symbols with prices (first 5):', withPrices.slice(0, 5))
      }
      setSymbols(mappedSymbols)
    }
  }, [symbolsData, priceMap, setSymbols])

  // Update loading state
  useEffect(() => {
    setLoading(isLoading)
  }, [isLoading, setLoading])

  return (
    <>
      <TerminalLayout
        left={
          <LeftSidebar
            onOpenDeposit={() => setDepositModalOpen(true)}
          />
        }
        center={<CenterWorkspace />}
        right={<RightTradingPanel />}
        rightPanel={
          notificationPanelOpen ? <NotificationsPanel /> : chatPanelOpen ? <ChatPanel /> : paymentPanelOpen ? <PaymentPanel /> : settingsPanelOpen ? <SettingsPanel /> : undefined
        }
      />
      <MarginCallModal
        open={marginCall.showModal}
        onOpenChange={marginCall.setShowModal}
        onDepositClick={() => setDepositModalOpen(true)}
        accountSummary={marginCall.accountSummary}
        threshold={marginCall.threshold}
        currentLevel={marginCall.currentLevel}
      />
      <DepositModal
        open={depositModalOpen}
        onOpenChange={setDepositModalOpen}
      />
    </>
  )
}
