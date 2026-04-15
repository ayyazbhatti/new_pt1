import { useEffect, useMemo, useState } from 'react'
import { useMediaQuery } from '@/shared/hooks'
import { TerminalLayout } from '../layout/TerminalLayout'
import { LeftSidebar } from '../components/LeftSidebar'
import { CenterWorkspace } from '../components/CenterWorkspace'
import { RightTradingPanel } from '../components/RightTradingPanel'
import { SettingsPanel } from '../components/SettingsPanel'
import { NotificationsPanel } from '../components/NotificationsPanel'
import { PaymentPanel } from '../components/PaymentPanel'
import { ChatPanel } from '../components/ChatPanel'
import { TerminalAccountView } from '../components/TerminalAccountView'
import { TerminalHistoryView } from '../components/TerminalHistoryView'
import { TerminalPositionsView } from '../components/TerminalPositionsView'
import { TerminalMobileMenuPage } from '../components/TerminalMobileMenuPage'
import { TerminalSymbolsPage } from '../components/TerminalSymbolsPage'
import { TerminalMobileNav } from '../components/TerminalMobileNav'
import { useTerminalStore } from '../store'
import { useAllEnabledSymbolsForTerminal } from '@/features/symbols/hooks/useSymbols'
import { usePriceStream } from '@/features/symbols/hooks/usePriceStream'
import { AdminSymbol } from '@/features/symbols/types/symbol'
import { MockSymbol } from '@/shared/mock/terminalMock'
import { useAccountSummary } from '@/features/wallet/hooks/useAccountSummary'
import { useMarginCall } from '@/features/wallet/hooks/useMarginCall'
import { MarginCallModal } from '@/features/wallet/components/MarginCallModal'
import { DepositModal } from '@/features/wallet/components/DepositModal'
import { useAuthStore } from '@/shared/store/auth.store'
import { getTerminalPreferences } from '../api/preferences.api'
import { terminalFeedSymbol, terminalPriceLookupKey } from '../utils/terminalFeedSymbol'

// Map AdminSymbol to MockSymbol format
function mapSymbolToTerminal(symbol: AdminSymbol, prices: Map<string, { bid: string; ask: string; ts: number }>): MockSymbol {
  // Single lookup key: same derivation as subscription (`terminalFeedSymbol` + `normalizeSymbolKey`)
  const lookupKey = terminalPriceLookupKey(symbol)
  const priceData = prices.get(lookupKey)
  
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
    assetClass: symbol.assetClass,
    bidQuote: priceData?.bid,
    askQuote: priceData?.ask,
  }
}

export function AppShellTerminal() {
  const {
    setSymbols,
    setLoading,
    setWatchlist,
    symbols,
    selectedSymbol,
    notificationPanelOpen,
    chatPanelOpen,
    paymentPanelOpen,
    settingsPanelOpen,
    mobileMenuOpen,
    setMobileMenuOpen,
    mobileSymbolPanelOpen,
    setMobileSymbolPanelOpen,
    setMobileTab,
    setChartShowAskPrice,
    setChartShowPositionMarker,
    setChartShowClosedPositionMarker,
    setEnableLiquidationEmail,
    setEnableSlTpEmail,
  } = useTerminalStore()
  const { user } = useAuthStore()
  const [depositModalOpen, setDepositModalOpen] = useState(false)
  const { accountSummary } = useAccountSummary()
  const marginCall = useMarginCall(accountSummary ?? null)

  // Load terminal preferences from server once (chart options + favourite symbols)
  useEffect(() => {
    if (!user?.id) return
    getTerminalPreferences()
      .then((res) => {
        setChartShowAskPrice(res.preferences.chartShowAskPrice)
        setChartShowPositionMarker(res.preferences.chartShowPositionMarker)
        setChartShowClosedPositionMarker(res.preferences.chartShowClosedPositionMarker)
        setEnableLiquidationEmail(res.preferences.enableLiquidationEmail ?? false)
        setEnableSlTpEmail(res.preferences.enableSlTpEmail ?? false)
        const ids = res.preferences.favouriteSymbolIds ?? []
        if (ids.length > 0) setWatchlist(ids)
      })
      .catch(() => {
        // Keep current store values (localStorage or defaults); optional: toast could go here
      })
  }, [user?.id, setChartShowAskPrice, setChartShowPositionMarker, setChartShowClosedPositionMarker, setEnableLiquidationEmail, setEnableSlTpEmail, setWatchlist])

  // Fetch all enabled symbols (paged API under the hood) so forex and other classes are not truncated at 500 rows
  const { data: symbolsData, isLoading } = useAllEnabledSymbolsForTerminal()

  // Get symbol codes for price streaming - must match feed symbols (e.g. BTCUSDT from data-provider)
  const symbolCodes = useMemo(() => {
    if (!symbolsData?.items) return []
    return symbolsData.items.map((s) => terminalFeedSymbol(s)).filter((code) => code && code.length > 0)
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
      const mappedSymbols = symbolsData.items.map((symbol) =>
        mapSymbolToTerminal(symbol, priceMap)
      )
      setSymbols(mappedSymbols)
    }
  }, [symbolsData, priceMap, setSymbols])

  // Update loading state
  useEffect(() => {
    setLoading(isLoading)
  }, [isLoading, setLoading])

  const DEFAULT_TITLE = 'Trading UI'
  useEffect(() => {
    if (selectedSymbol?.code) {
      const priceStr = selectedSymbol.numericPrice > 0 ? ` ${selectedSymbol.price}` : ''
      document.title = `${selectedSymbol.code}${priceStr} | ${DEFAULT_TITLE}`
    } else {
      document.title = DEFAULT_TITLE
    }
    return () => {
      document.title = DEFAULT_TITLE
    }
  }, [selectedSymbol?.code, selectedSymbol?.price, selectedSymbol?.numericPrice])

  const isDesktopMedia = useMediaQuery('(min-width: 1024px)')
  // Sync with actual width so mobile nav shows on narrow viewports (handles mobile browser quirks)
  const [isNarrowViewport, setIsNarrowViewport] = useState(
    () => (typeof window !== 'undefined' ? window.innerWidth < 1024 : true)
  )
  useEffect(() => {
    const check = () => setIsNarrowViewport(window.innerWidth < 1024)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])
  const isDesktop = isDesktopMedia && !isNarrowViewport
  const mobileTab = useTerminalStore((s) => s.mobileTab)

  // When user taps a tab in the bottom bar while quote overlay is open, close the overlay
  useEffect(() => {
    setMobileSymbolPanelOpen(false)
  }, [mobileTab, setMobileSymbolPanelOpen])

  const mobileMain =
    mobileTab === 'quotes' ? (
      <TerminalSymbolsPage
        onClose={() => setMobileTab('chart')}
        onOpenMenu={() => setMobileTab('account')}
      />
    ) : mobileTab === 'chart' ? (
      <CenterWorkspace hideBottomDock />
    ) : mobileTab === 'trade' ? (
      <RightTradingPanel />
    ) : mobileTab === 'positions' ? (
      <TerminalPositionsView />
    ) : mobileTab === 'history' ? (
      <TerminalHistoryView />
    ) : (
      <TerminalAccountView onOpenDeposit={() => setDepositModalOpen(true)} />
    )

  return (
    <>
      {/* Mobile: full-screen menu page when hamburger opens (not the symbol panel) */}
      {!isDesktop && mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <TerminalMobileMenuPage
            onClose={() => setMobileMenuOpen(false)}
            onOpenDeposit={() => setDepositModalOpen(true)}
          />
        </div>
      )}
      {/* Mobile: full-screen quotes page when symbol icon is clicked in Positions header; include bottom nav inside overlay */}
      {!isDesktop && mobileSymbolPanelOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex-1 min-h-0 overflow-hidden">
            <TerminalSymbolsPage
              onClose={() => setMobileSymbolPanelOpen(false)}
              onOpenMenu={() => {
                setMobileSymbolPanelOpen(false)
                setMobileTab('account')
              }}
            />
          </div>
          <div className="shrink-0">
            <TerminalMobileNav />
          </div>
        </div>
      )}
      <TerminalLayout
        isMobile={!isDesktop}
        mobileMain={!isDesktop ? mobileMain : undefined}
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
