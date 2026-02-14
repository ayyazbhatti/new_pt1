import { create } from 'zustand'
import { AdminOrder, AdminPosition, AdminAuditLog, TradingFilters, LookupSymbol, LookupUser, LookupGroup } from '../types'

interface AdminTradingState {
  // Filters
  filters: TradingFilters
  setFilters: (filters: Partial<TradingFilters>) => void
  clearFilters: () => void

  // Orders
  orders: Map<string, AdminOrder>
  ordersCursor?: string
  ordersHasMore: boolean
  ordersLoading: boolean
  setOrders: (orders: AdminOrder[], cursor?: string, hasMore?: boolean) => void
  upsertOrder: (order: AdminOrder) => void
  removeOrder: (orderId: string) => void
  setOrdersLoading: (loading: boolean) => void
  getOrdersArray: () => AdminOrder[]

  // Positions
  positions: Map<string, AdminPosition>
  positionsCursor?: string
  positionsHasMore: boolean
  positionsLoading: boolean
  setPositions: (positions: AdminPosition[], cursor?: string, hasMore?: boolean) => void
  upsertPosition: (position: AdminPosition) => void
  removePosition: (positionId: string) => void
  setPositionsLoading: (loading: boolean) => void
  getPositionsArray: () => AdminPosition[]

  // Audit
  auditLogs: AdminAuditLog[]
  auditCursor?: string
  auditHasMore: boolean
  auditLoading: boolean
  setAuditLogs: (logs: AdminAuditLog[], cursor?: string, hasMore?: boolean) => void
  appendAuditLog: (log: AdminAuditLog) => void
  setAuditLoading: (loading: boolean) => void

  // Lookups
  symbols: LookupSymbol[]
  users: LookupUser[]
  groups: LookupGroup[]
  setSymbols: (symbols: LookupSymbol[]) => void
  setUsers: (users: LookupUser[]) => void
  setGroups: (groups: LookupGroup[]) => void

  // UI State
  activeTab: 'orders' | 'positions' | 'audit'
  setActiveTab: (tab: 'orders' | 'positions' | 'audit') => void
  selectedOrderId: string | null
  setSelectedOrderId: (id: string | null) => void
  selectedPositionId: string | null
  setSelectedPositionId: (id: string | null) => void
  openModal: string | null
  setOpenModal: (modal: string | null) => void

  // WebSocket
  wsStatus: 'disconnected' | 'connecting' | 'connected'
  wsLastMessageAt: number | null
  setWsStatus: (status: 'disconnected' | 'connecting' | 'connected') => void
  setWsLastMessageAt: (timestamp: number) => void
}

const defaultFilters: TradingFilters = {
  limit: 100,
}

export const useAdminTradingStore = create<AdminTradingState>((set, get) => ({
  // Filters
  filters: defaultFilters,
  setFilters: (newFilters) =>
    set((state) => ({
      filters: { ...state.filters, ...newFilters },
    })),
  clearFilters: () => set({ filters: defaultFilters }),

  // Orders
  orders: new Map(),
  ordersCursor: undefined,
  ordersHasMore: false,
  ordersLoading: false,
  setOrders: (orders, cursor, hasMore) => {
    const ordersMap = new Map<string, AdminOrder>()
    orders.forEach((order) => ordersMap.set(order.id, order))
    set({
      orders: ordersMap,
      ordersCursor: cursor,
      ordersHasMore: hasMore ?? false,
    })
  },
  upsertOrder: (order) => {
    const orders = new Map(get().orders)
    orders.set(order.id, order)
    set({ orders })
  },
  removeOrder: (orderId) => {
    const orders = new Map(get().orders)
    orders.delete(orderId)
    set({ orders })
  },
  setOrdersLoading: (loading) => set({ ordersLoading: loading }),
  getOrdersArray: () => Array.from(get().orders.values()),

  // Positions
  positions: new Map(),
  positionsCursor: undefined,
  positionsHasMore: false,
  positionsLoading: false,
  setPositions: (positions, cursor, hasMore) => {
    const positionsMap = new Map<string, AdminPosition>()
    positions.forEach((position) => positionsMap.set(position.id, position))
    set({
      positions: positionsMap,
      positionsCursor: cursor,
      positionsHasMore: hasMore ?? false,
    })
  },
  upsertPosition: (position) => {
    const positions = new Map(get().positions)
    positions.set(position.id, position)
    set({ positions })
  },
  removePosition: (positionId) => {
    const positions = new Map(get().positions)
    positions.delete(positionId)
    set({ positions })
  },
  setPositionsLoading: (loading) => set({ positionsLoading: loading }),
  getPositionsArray: () => Array.from(get().positions.values()),

  // Audit
  auditLogs: [],
  auditCursor: undefined,
  auditHasMore: false,
  auditLoading: false,
  setAuditLogs: (logs, cursor, hasMore) =>
    set({
      auditLogs: logs,
      auditCursor: cursor,
      auditHasMore: hasMore ?? false,
    }),
  appendAuditLog: (log) =>
    set((state) => ({
      auditLogs: [log, ...state.auditLogs].slice(0, 1000), // Keep last 1000
    })),
  setAuditLoading: (loading) => set({ auditLoading: loading }),

  // Lookups
  symbols: [],
  users: [],
  groups: [],
  setSymbols: (symbols) => set({ symbols }),
  setUsers: (users) => set({ users }),
  setGroups: (groups) => set({ groups }),

  // UI State
  activeTab: (() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('adminTradingActiveTab')
      if (saved === 'orders' || saved === 'positions' || saved === 'audit') {
        return saved
      }
    }
    return 'orders'
  })(),
  setActiveTab: (tab) => {
    set({ activeTab: tab })
    if (typeof window !== 'undefined') {
      localStorage.setItem('adminTradingActiveTab', tab)
    }
  },
  selectedOrderId: null,
  setSelectedOrderId: (id) => set({ selectedOrderId: id }),
  selectedPositionId: null,
  setSelectedPositionId: (id) => set({ selectedPositionId: id }),
  openModal: null,
  setOpenModal: (modal) => set({ openModal: modal }),

  // WebSocket
  wsStatus: 'disconnected',
  wsLastMessageAt: null,
  setWsStatus: (status) => set({ wsStatus: status }),
  setWsLastMessageAt: (timestamp) => set({ wsLastMessageAt: timestamp }),
}))

