import { useEffect, useMemo } from 'react'
import { TerminalLayout } from '../layout/TerminalLayout'
import { LeftSidebar } from '../components/LeftSidebar'
import { CenterWorkspace } from '../components/CenterWorkspace'
import { RightTradingPanel } from '../components/RightTradingPanel'
import { useTerminalStore } from '../store'
import { useSymbolsList } from '@/features/symbols/hooks/useSymbols'
import { usePriceStream } from '@/features/symbols/hooks/usePriceStream'
import { AdminSymbol } from '@/features/symbols/types/symbol'
import { MockSymbol } from '@/shared/mock/terminalMock'

// Map AdminSymbol to MockSymbol format
function mapSymbolToTerminal(symbol: AdminSymbol, prices: Map<string, { bid: string; ask: string; ts: number }>): MockSymbol {
  // Use providerSymbol if available, otherwise use symbolCode
  const symbolKey = (symbol.providerSymbol || symbol.symbolCode).toUpperCase()
  const priceData = prices.get(symbolKey)
  
  // Debug: Log symbol matching
  if (!priceData) {
    console.log(`⚠️ No price data for symbol: ${symbol.symbolCode} | Key: ${symbolKey} | Available keys:`, Array.from(prices.keys()))
  } else {
    console.log(`✅ Found price for ${symbol.symbolCode}: bid=${priceData.bid}, ask=${priceData.ask}`)
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
  }
}

export function AppShellTerminal() {
  const { setSymbols, setLoading, symbols } = useTerminalStore()

  // Fetch enabled symbols
  const { data: symbolsData, isLoading } = useSymbolsList({
    is_enabled: 'true',
    page_size: 100,
  })

  // Get symbol codes for price streaming
  const symbolCodes = useMemo(() => {
    if (!symbolsData?.items) return []
    const codes = symbolsData.items
      .map((s) => {
        const code = (s.providerSymbol || s.symbolCode).toUpperCase()
        console.log(`🔍 Symbol mapping: ${s.symbolCode} -> providerSymbol: ${s.providerSymbol} -> final: ${code}`)
        return code
      })
      .filter((code) => code && code.length > 0)
    console.log('📡 Final symbol codes to subscribe:', codes)
    return codes
  }, [symbolsData])

  // Subscribe to price stream
  const { prices: priceMap, isConnected } = usePriceStream(symbolCodes)

  // Debug: Log connection status and prices
  useEffect(() => {
    console.log('🔌 Terminal: WebSocket connected:', isConnected)
    console.log('📊 Terminal: Symbol codes to subscribe:', symbolCodes)
    console.log('💰 Terminal: Current prices map size:', priceMap.size)
    console.log('💰 Terminal: Current prices keys:', Array.from(priceMap.keys()))
    console.log('💰 Terminal: Current prices entries:', Array.from(priceMap.entries()).slice(0, 5))
    
    // Check if we're receiving any price updates
    if (priceMap.size === 0 && isConnected && symbolCodes.length > 0) {
      console.warn('⚠️ WARNING: WebSocket is connected and symbols are subscribed, but price map is empty!')
      console.warn('⚠️ This suggests prices are not being received or callbacks are not firing.')
      console.warn('⚠️ Please check for these logs:')
      console.warn('   - 📨 usePriceStream received tick')
      console.warn('   - 📞 Wrapped callback called')
      console.warn('   - 🔄 usePriceStream: Price map updated')
    }
  }, [isConnected, symbolCodes, priceMap])

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
    <TerminalLayout
      left={<LeftSidebar />}
      center={<CenterWorkspace />}
      right={<RightTradingPanel />}
    />
  )
}
