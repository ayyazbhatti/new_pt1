import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface WalletState {
  balance: number
  currency: string
  available: number
  locked: number
  equity: number
  margin_used: number
  free_margin: number
  isLoading: boolean
  setBalance: (balance: number) => void
  setWalletData: (data: {
    balance: number
    currency: string
    available: number
    locked: number
    equity: number
    margin_used: number
    free_margin: number
  }) => void
  setLoading: (loading: boolean) => void
}

export const useWalletStore = create<WalletState>()(
  persist(
    (set) => ({
      balance: 0,
      currency: 'USD',
      available: 0,
      locked: 0,
      equity: 0,
      margin_used: 0,
      free_margin: 0,
      isLoading: false,
      setBalance: (balance: number) => set({ balance }),
      setWalletData: (data) => set(data),
      setLoading: (isLoading: boolean) => set({ isLoading }),
    }),
    {
      name: 'wallet-storage',
      partialize: (state) => ({
        balance: state.balance,
        currency: state.currency,
      }),
    }
  )
)

