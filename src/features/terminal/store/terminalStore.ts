import { create } from 'zustand'
import { type MockSymbol } from '@/shared/mock/terminalMock'

interface TerminalStore {
  selectedSymbol: MockSymbol | null
  symbols: MockSymbol[]
  isLoading: boolean
  watchlist: Set<string>
  searchQuery: string
  activeTab: 'all' | 'watchlists'
  settingsPanelOpen: boolean
  notificationPanelOpen: boolean
  paymentPanelOpen: boolean
  chatPanelOpen: boolean
  /** Mobile: left sidebar / menu overlay open (hamburger). */
  mobileMenuOpen: boolean
  setMobileMenuOpen: (open: boolean) => void
  /** Mobile: symbol live price panel overlay open (from Positions header icon). */
  mobileSymbolPanelOpen: boolean
  setMobileSymbolPanelOpen: (open: boolean) => void
  /** Show ask price line on chart (persisted in localStorage only). */
  chartShowAskPrice: boolean
  /** Show position open marker (dot) on chart (persisted in localStorage only). */
  chartShowPositionMarker: boolean
  /** Show closed position marker (dot) on chart – position history (persisted in localStorage only). */
  chartShowClosedPositionMarker: boolean
  /** Receive an email when position is liquidated (persisted in user terminal preferences). */
  enableLiquidationEmail: boolean
  /** Receive an email when position is closed by SL or TP (persisted in user terminal preferences). */
  enableSlTpEmail: boolean
  /** Mobile bottom nav tab (only used when viewport < 1024px). */
  mobileTab: 'quotes' | 'chart' | 'trade' | 'positions' | 'account' | 'history'
  setMobileTab: (tab: 'quotes' | 'chart' | 'trade' | 'positions' | 'account' | 'history') => void
  setSymbols: (symbols: MockSymbol[]) => void
  setLoading: (loading: boolean) => void
  setSelectedSymbol: (symbol: MockSymbol) => void
  setWatchlist: (symbolIds: string[]) => void
  toggleWatchlist: (symbolId: string) => void
  setSearchQuery: (query: string) => void
  setActiveTab: (tab: 'all' | 'watchlists') => void
  setSettingsPanelOpen: (open: boolean) => void
  setNotificationPanelOpen: (open: boolean) => void
  setPaymentPanelOpen: (open: boolean) => void
  setChatPanelOpen: (open: boolean) => void
  setChartShowAskPrice: (show: boolean) => void
  setChartShowPositionMarker: (show: boolean) => void
  setChartShowClosedPositionMarker: (show: boolean) => void
  setEnableLiquidationEmail: (value: boolean) => void
  setEnableSlTpEmail: (value: boolean) => void
  getFilteredSymbols: () => MockSymbol[]
}

const STORAGE_KEY_MOBILE_TAB = 'terminal.mobileTab'
const STORAGE_KEY_SEARCH_QUERY = 'terminal.searchQuery'

const STORAGE_KEY_SELECTED_SYMBOL = 'terminal.selectedSymbolId'
const STORAGE_KEY_CHART_SHOW_ASK = 'terminal.chartShowAskPrice'
const STORAGE_KEY_CHART_SHOW_POSITION_MARKER = 'terminal.chartShowPositionMarker'
const STORAGE_KEY_CHART_SHOW_CLOSED_POSITION_MARKER = 'terminal.chartShowClosedPositionMarker'
const STORAGE_KEY_ENABLE_LIQUIDATION_EMAIL = 'terminal.enableLiquidationEmail'
const STORAGE_KEY_ENABLE_SLTP_EMAIL = 'terminal.enableSlTpEmail'

function getEnableLiquidationEmailFromStorage(): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEY_ENABLE_LIQUIDATION_EMAIL)
    if (v === 'true') return true
    if (v === 'false') return false
  } catch {}
  return false
}

function getEnableSlTpEmailFromStorage(): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEY_ENABLE_SLTP_EMAIL)
    if (v === 'true') return true
    if (v === 'false') return false
  } catch {}
  return false
}

function getChartShowAskPriceFromStorage(): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEY_CHART_SHOW_ASK)
    if (v === 'false') return false
    if (v === 'true') return true
  } catch {}
  return true
}

function getChartShowPositionMarkerFromStorage(): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEY_CHART_SHOW_POSITION_MARKER)
    if (v === 'false') return false
    if (v === 'true') return true
  } catch {}
  return true
}

function getChartShowClosedPositionMarkerFromStorage(): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEY_CHART_SHOW_CLOSED_POSITION_MARKER)
    if (v === 'false') return false
    if (v === 'true') return true
  } catch {}
  return true
}

const MAX_SEARCH_QUERY_LEN = 256

function getSearchQueryFromStorage(): string {
  try {
    const v = localStorage.getItem(STORAGE_KEY_SEARCH_QUERY)
    if (v == null) return ''
    if (typeof v !== 'string') return ''
    return v.slice(0, MAX_SEARCH_QUERY_LEN)
  } catch {
    return ''
  }
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  selectedSymbol: null,
  symbols: [],
  isLoading: false,
  watchlist: new Set(),
  searchQuery: getSearchQueryFromStorage(),
  activeTab: 'all',
  setSymbols: (symbols) => {
    const state = get()
    const currentSelectedId = state.selectedSymbol?.id
    
    set({ symbols })
    
    // If we have a currently selected symbol, check if it still exists in the new symbols list
    if (currentSelectedId) {
      const stillExists = symbols.find((s) => s.id === currentSelectedId)
      if (stillExists) {
        // Update the selected symbol with the latest data (prices may have changed)
        set({ selectedSymbol: stillExists })
        return
      }
      // Current selection no longer exists, clear it
      set({ selectedSymbol: null })
    }
    
    // Try to restore selected symbol from localStorage
    if (!currentSelectedId && symbols.length > 0) {
      const savedSymbolId = localStorage.getItem(STORAGE_KEY_SELECTED_SYMBOL)
      if (savedSymbolId) {
        const savedSymbol = symbols.find((s) => s.id === savedSymbolId)
        if (savedSymbol) {
          set({ selectedSymbol: savedSymbol })
          return
        }
      }
      // Default to BTCUSDT for new users; otherwise first symbol
      const btcSymbol = symbols.find(
        (s) =>
          s.code === 'BTCUSDT' ||
          s.code === 'BTC-USD' ||
          s.code?.toUpperCase().replace(/-/g, '') === 'BTCUSDT'
      )
      set({ selectedSymbol: btcSymbol ?? symbols[0] })
    }
  },
  setLoading: (loading) => set({ isLoading: loading }),
  setSelectedSymbol: (symbol) => {
    set({ selectedSymbol: symbol })
    // Persist selected symbol ID to localStorage
    if (symbol) {
      localStorage.setItem(STORAGE_KEY_SELECTED_SYMBOL, symbol.id)
    } else {
      localStorage.removeItem(STORAGE_KEY_SELECTED_SYMBOL)
    }
  },
  setWatchlist: (symbolIds) => set({ watchlist: new Set(symbolIds) }),
  toggleWatchlist: (symbolId) =>
    set((state) => {
      const newWatchlist = new Set(state.watchlist)
      if (newWatchlist.has(symbolId)) {
        newWatchlist.delete(symbolId)
      } else {
        newWatchlist.add(symbolId)
      }
      return { watchlist: newWatchlist }
    }),
  setSearchQuery: (query) => {
    const safe = typeof query === 'string' ? query.slice(0, MAX_SEARCH_QUERY_LEN) : ''
    try {
      if (safe) {
        localStorage.setItem(STORAGE_KEY_SEARCH_QUERY, safe)
      } else {
        localStorage.removeItem(STORAGE_KEY_SEARCH_QUERY)
      }
    } catch {}
    set({ searchQuery: safe })
  },
  setActiveTab: (tab) => set({ activeTab: tab }),
  settingsPanelOpen: false,
  setSettingsPanelOpen: (open) => set({ settingsPanelOpen: open }),
  notificationPanelOpen: false,
  setNotificationPanelOpen: (open) => set({ notificationPanelOpen: open }),
  paymentPanelOpen: false,
  setPaymentPanelOpen: (open) => set({ paymentPanelOpen: open }),
  chatPanelOpen: false,
  setChatPanelOpen: (open) => set({ chatPanelOpen: open }),
  mobileMenuOpen: false,
  setMobileMenuOpen: (open) => set({ mobileMenuOpen: open }),
  mobileSymbolPanelOpen: false,
  setMobileSymbolPanelOpen: (open) => set({ mobileSymbolPanelOpen: open }),
  chartShowAskPrice: getChartShowAskPriceFromStorage(),
  setChartShowAskPrice: (show) => {
    try {
      localStorage.setItem(STORAGE_KEY_CHART_SHOW_ASK, String(show))
    } catch {}
    set({ chartShowAskPrice: show })
  },
  chartShowPositionMarker: getChartShowPositionMarkerFromStorage(),
  setChartShowPositionMarker: (show) => {
    try {
      localStorage.setItem(STORAGE_KEY_CHART_SHOW_POSITION_MARKER, String(show))
    } catch {}
    set({ chartShowPositionMarker: show })
  },
  chartShowClosedPositionMarker: getChartShowClosedPositionMarkerFromStorage(),
  setChartShowClosedPositionMarker: (show) => {
    try {
      localStorage.setItem(STORAGE_KEY_CHART_SHOW_CLOSED_POSITION_MARKER, String(show))
    } catch {}
    set({ chartShowClosedPositionMarker: show })
  },
  enableLiquidationEmail: getEnableLiquidationEmailFromStorage(),
  setEnableLiquidationEmail: (value) => {
    try {
      localStorage.setItem(STORAGE_KEY_ENABLE_LIQUIDATION_EMAIL, String(value))
    } catch {}
    set({ enableLiquidationEmail: value })
  },
  enableSlTpEmail: getEnableSlTpEmailFromStorage(),
  setEnableSlTpEmail: (value) => {
    try {
      localStorage.setItem(STORAGE_KEY_ENABLE_SLTP_EMAIL, String(value))
    } catch {}
    set({ enableSlTpEmail: value })
  },
  mobileTab: (() => {
    try {
      const s = localStorage.getItem(STORAGE_KEY_MOBILE_TAB)
      if (s === 'quotes' || s === 'chart' || s === 'trade' || s === 'positions' || s === 'account' || s === 'history') return s
    } catch {}
    return 'chart'
  })(),
  setMobileTab: (tab) => {
    try {
      localStorage.setItem(STORAGE_KEY_MOBILE_TAB, tab)
    } catch {}
    set({ mobileTab: tab })
  },
  getFilteredSymbols: () => {
    const { searchQuery, activeTab, watchlist, symbols } = get()
    let filtered = symbols

    // Filter by tab
    if (activeTab === 'watchlists') {
      filtered = filtered.filter((s) => watchlist.has(s.id))
    }

    // Filter by search
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(
        (s) =>
          s.code.toLowerCase().includes(query) ||
          s.price.toLowerCase().includes(query)
      )
    }

    // Sort: highest price first, then lowest; symbols without price at the end (by code)
    filtered = [...filtered].sort((a, b) => {
      const priceA = a.numericPrice ?? 0
      const priceB = b.numericPrice ?? 0
      if (priceA > 0 && priceB > 0) return priceB - priceA // high to low
      if (priceA > 0) return -1 // a has price, b doesn't -> a first
      if (priceB > 0) return 1  // b has price, a doesn't -> b first
      return (a.code || '').localeCompare(b.code || '', undefined, { sensitivity: 'base' }) // no price: sort by code
    })

    return filtered
  },
}))

