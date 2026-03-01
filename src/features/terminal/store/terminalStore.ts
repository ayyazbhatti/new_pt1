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
  setSymbols: (symbols: MockSymbol[]) => void
  setLoading: (loading: boolean) => void
  setSelectedSymbol: (symbol: MockSymbol) => void
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

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  selectedSymbol: null,
  symbols: [],
  isLoading: false,
  watchlist: new Set(),
  searchQuery: '',
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
      // Fallback to first symbol if no saved symbol found
      set({ selectedSymbol: symbols[0] })
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
  setSearchQuery: (query) => set({ searchQuery: query }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  settingsPanelOpen: false,
  setSettingsPanelOpen: (open) => set({ settingsPanelOpen: open }),
  notificationPanelOpen: false,
  setNotificationPanelOpen: (open) => set({ notificationPanelOpen: open }),
  paymentPanelOpen: false,
  setPaymentPanelOpen: (open) => set({ paymentPanelOpen: open }),
  chatPanelOpen: false,
  setChatPanelOpen: (open) => set({ chatPanelOpen: open }),
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

    // Sort by price (high to low)
    filtered = [...filtered].sort((a, b) => {
      const priceA = a.numericPrice || 0
      const priceB = b.numericPrice || 0
      return priceB - priceA // High to low
    })

    return filtered
  },
}))

