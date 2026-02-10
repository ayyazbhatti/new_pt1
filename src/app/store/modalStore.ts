import { create } from 'zustand'
import { ReactNode } from 'react'

interface ModalState {
  modals: Record<string, { component: ReactNode; props?: Record<string, unknown> }>
  openModal: (key: string, component: ReactNode, props?: Record<string, unknown>) => void
  closeModal: (key: string) => void
  closeAllModals: () => void
}

export const useModalStore = create<ModalState>((set) => ({
  modals: {},
  openModal: (key, component, props) =>
    set((state) => ({
      modals: { ...state.modals, [key]: { component, props } },
    })),
  closeModal: (key) =>
    set((state) => {
      const { [key]: _, ...rest } = state.modals
      return { modals: rest }
    }),
  closeAllModals: () => set({ modals: {} }),
}))

