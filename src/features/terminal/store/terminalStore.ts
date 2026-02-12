import { create } from 'zustand'
import { type MockSymbol } from '@/shared/mock/terminalMock'

interface TerminalStore {
  selectedSymbol: MockSymbol | null
  symbols: MockSymbol[]
  isLoading: boolean
  watchlist: Set<string>
  searchQuery: string
  activeTab: 'all' | 'watchlists'
  setSymbols: (symbols: MockSymbol[]) => void
  setLoading: (loading: boolean) => void
  setSelectedSymbol: (symbol: MockSymbol) => void
  toggleWatchlist: (symbolId: string) => void
  setSearchQuery: (query: string) => void
  setActiveTab: (tab: 'all' | 'watchlists') => void
  getFilteredSymbols: () => MockSymbol[]
}

const STORAGE_KEY_SELECTED_SYMBOL = 'terminal.selectedSymbolId'

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

