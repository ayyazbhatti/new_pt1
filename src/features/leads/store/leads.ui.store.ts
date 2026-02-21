import { create } from 'zustand'
import type { Lead } from '../types/leads.types'

interface LeadsUiState {
  selectedLeadId: string | null
  setSelectedLeadId: (id: string | null) => void
  modal: {
    createLead: boolean
    editLead: boolean
    assignLead: boolean
    changeStage: boolean
    logCall: boolean
    sendEmail: boolean
    createTask: boolean
    mergeLead: boolean
  }
  openModal: (key: keyof LeadsUiState['modal']) => void
  closeModal: (key: keyof LeadsUiState['modal']) => void
  closeAllModals: () => void
  /** Lead used as context for modal (e.g. assign this lead) */
  modalLead: Lead | null
  setModalLead: (lead: Lead | null) => void
  /** Quick filters persisted in UI */
  quickFilters: {
    status?: string
    stageId?: string
    ownerUserId?: string
    source?: string
    country?: string
    scoreMin?: number
    scoreMax?: number
  }
  setQuickFilter: (key: keyof LeadsUiState['quickFilters'], value: unknown) => void
  clearQuickFilters: () => void
}

const initialModal = {
  createLead: false,
  editLead: false,
  assignLead: false,
  changeStage: false,
  logCall: false,
  sendEmail: false,
  createTask: false,
  mergeLead: false,
}

export const useLeadsUiStore = create<LeadsUiState>((set) => ({
  selectedLeadId: null,
  setSelectedLeadId: (id) => set({ selectedLeadId: id }),
  modal: initialModal,
  openModal: (key) =>
    set((s) => ({ modal: { ...s.modal, [key]: true } })),
  closeModal: (key) =>
    set((s) => ({ modal: { ...s.modal, [key]: false } })),
  closeAllModals: () => set({ modal: initialModal }),
  modalLead: null,
  setModalLead: (lead) => set({ modalLead: lead }),
  quickFilters: {},
  setQuickFilter: (key, value) =>
    set((s) => ({ quickFilters: { ...s.quickFilters, [key]: value } })),
  clearQuickFilters: () => set({ quickFilters: {} }),
}))
