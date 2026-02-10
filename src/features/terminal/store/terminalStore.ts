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

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  selectedSymbol: null,
  symbols: [],
  isLoading: false,
  watchlist: new Set(),
  searchQuery: '',
  activeTab: 'all',
  setSymbols: (symbols) => {
    const state = get()
    set({ symbols })
    // Auto-select first symbol if none selected
    if (!state.selectedSymbol && symbols.length > 0) {
      set({ selectedSymbol: symbols[0] })
    }
  },
  setLoading: (loading) => set({ isLoading: loading }),
  setSelectedSymbol: (symbol) => set({ selectedSymbol: symbol }),
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

    return filtered
  },
}))

