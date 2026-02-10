export interface SymbolForAssignment {
  code: string
  market: string
  currentProfile?: string
}

export const mockSymbolsForAssignment: SymbolForAssignment[] = [
  { code: 'BTCUSDT', market: 'crypto', currentProfile: 'Standard Profile' },
  { code: 'ETHUSDT', market: 'crypto', currentProfile: 'Standard Profile' },
  { code: 'EURUSD', market: 'forex', currentProfile: 'Standard Profile' },
  { code: 'GBPUSD', market: 'forex', currentProfile: 'Standard Profile' },
  { code: 'USDJPY', market: 'forex', currentProfile: 'Standard Profile' },
  { code: 'XAUUSD', market: 'metals', currentProfile: 'Conservative Profile' },
  { code: 'XAGUSD', market: 'metals', currentProfile: 'Conservative Profile' },
  { code: 'US30', market: 'indices', currentProfile: 'Standard Profile' },
  { code: 'SPX500', market: 'indices', currentProfile: 'Standard Profile' },
  { code: 'AAPL', market: 'stocks', currentProfile: 'Conservative Profile' },
  { code: 'TSLA', market: 'stocks', currentProfile: undefined },
  { code: 'ADAUSDT', market: 'crypto', currentProfile: undefined },
]

