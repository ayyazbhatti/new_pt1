import { create } from 'zustand'
import { mockSymbols, type MockSymbol } from '@/shared/mock/terminalMock'

interface TerminalStore {
  selectedSymbol: MockSymbol
  watchlist: Set<string>
  searchQuery: string
  activeTab: 'all' | 'watchlists'
  setSelectedSymbol: (symbol: MockSymbol) => void
  toggleWatchlist: (symbolId: string) => void
  setSearchQuery: (query: string) => void
  setActiveTab: (tab: 'all' | 'watchlists') => void
  getFilteredSymbols: () => MockSymbol[]
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  selectedSymbol: mockSymbols[0],
  watchlist: new Set(),
  searchQuery: '',
  activeTab: 'all',
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
    const { searchQuery, activeTab, watchlist } = get()
    let filtered = mockSymbols

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

