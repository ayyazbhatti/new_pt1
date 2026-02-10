import { mockSymbols } from '@/features/symbols/mocks/symbols.mock'

export const swapSymbols = mockSymbols.map((s) => ({
  code: s.code,
  name: s.name,
  market: s.market,
  quoteCurrency: s.market === 'forex' ? 'USD' : s.market === 'crypto' ? 'USDT' : 'USD',
}))

