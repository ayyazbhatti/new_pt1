import { LeverageProfile } from '../types/leverageProfile'

export const mockLeverageProfiles: LeverageProfile[] = [
  {
    id: '1',
    name: 'Standard Profile',
    description: 'Standard leverage profile for regular traders',
    status: 'active',
    tiers: [
      { id: 't1', from: 0, to: 10000, leverage: 500 },
      { id: 't2', from: 10001, to: 50000, leverage: 200 },
      { id: 't3', from: 50001, to: 100000, leverage: 50 },
      { id: 't4', from: 100001, to: 500000, leverage: 20 },
    ],
    assignedSymbols: ['EURUSD', 'GBPUSD', 'USDJPY', 'BTCUSDT', 'ETHUSDT'],
    createdAt: '2024-01-15',
    updatedAt: '2024-01-20',
  },
  {
    id: '2',
    name: 'Conservative Profile',
    description: 'Lower leverage for risk-averse traders',
    status: 'active',
    tiers: [
      { id: 't5', from: 0, to: 50000, leverage: 100 },
      { id: 't6', from: 50001, to: 200000, leverage: 50 },
      { id: 't7', from: 200001, to: 1000000, leverage: 10 },
    ],
    assignedSymbols: ['XAUUSD', 'XAGUSD', 'AAPL'],
    createdAt: '2024-01-10',
    updatedAt: '2024-01-18',
  },
  {
    id: '3',
    name: 'Aggressive Profile',
    description: 'High leverage for experienced traders',
    status: 'disabled',
    tiers: [
      { id: 't8', from: 0, to: 5000, leverage: 1000 },
      { id: 't9', from: 5001, to: 20000, leverage: 500 },
      { id: 't10', from: 20001, to: 100000, leverage: 200 },
    ],
    assignedSymbols: [],
    createdAt: '2024-01-05',
    updatedAt: '2024-01-12',
  },
]

