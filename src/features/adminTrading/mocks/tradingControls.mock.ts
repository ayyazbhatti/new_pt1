import { SymbolControl, GroupControl, AuditLogEntry } from '../types/adminTrading'

export const mockSymbolControls: SymbolControl[] = [
  {
    symbol: 'BTCUSDT',
    tradingEnabled: true,
    closeOnly: false,
    allowNewOrders: true,
    maxLeverageCap: 500,
    maxOrderSize: 10.0,
    maxPositionSize: 50.0,
  },
  {
    symbol: 'ETHUSDT',
    tradingEnabled: true,
    closeOnly: false,
    allowNewOrders: true,
    maxLeverageCap: 200,
    maxOrderSize: 100.0,
    maxPositionSize: 500.0,
  },
  {
    symbol: 'EURUSD',
    tradingEnabled: true,
    closeOnly: false,
    allowNewOrders: true,
    maxLeverageCap: 500,
    maxOrderSize: 1000000,
    maxPositionSize: 5000000,
  },
  {
    symbol: 'XAUUSD',
    tradingEnabled: false,
    closeOnly: true,
    allowNewOrders: false,
    maxLeverageCap: 100,
    maxOrderSize: 1.0,
    maxPositionSize: 5.0,
  },
]

export const mockGroupControls: GroupControl[] = [
  {
    groupId: '1',
    groupName: 'Standard Group',
    tradingEnabled: true,
    closeOnly: false,
    maxLeverageMin: 1,
    maxLeverageMax: 500,
    maxOpenPositionsPerUser: 50,
  },
  {
    groupId: '2',
    groupName: 'VIP Group',
    tradingEnabled: true,
    closeOnly: false,
    maxLeverageMin: 1,
    maxLeverageMax: 1000,
    maxOpenPositionsPerUser: 100,
  },
  {
    groupId: '3',
    groupName: 'Restricted Group',
    tradingEnabled: true,
    closeOnly: true,
    maxLeverageMin: 1,
    maxLeverageMax: 50,
    maxOpenPositionsPerUser: 10,
  },
]

export const mockAuditLog: AuditLogEntry[] = [
  {
    id: 'AUD-001',
    time: '2024-01-20T11:00:00Z',
    admin: 'admin@broker.com',
    action: 'Updated symbol control',
    target: 'BTCUSDT - Max Leverage: 500',
  },
  {
    id: 'AUD-002',
    time: '2024-01-20T10:30:00Z',
    admin: 'admin@broker.com',
    action: 'Disabled trading',
    target: 'XAUUSD',
  },
  {
    id: 'AUD-003',
    time: '2024-01-20T09:15:00Z',
    admin: 'admin@broker.com',
    action: 'Updated group control',
    target: 'Restricted Group - Close Only: true',
  },
  {
    id: 'AUD-004',
    time: '2024-01-19T16:00:00Z',
    admin: 'admin@broker.com',
    action: 'Updated symbol control',
    target: 'ETHUSDT - Max Order Size: 100.0',
  },
]

