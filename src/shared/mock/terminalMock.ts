import type { AssetClass } from '@/features/symbols/types/symbol'

export interface MockSymbol {
  id: string
  code: string
  price: string
  price2: string
  value: string
  enabled: boolean
  numericPrice: number
  numericPrice2: number
  change24h: number
  volume24h: number
  baseCurrency: string
  quoteCurrency: string
  /** Decimal places for price (axes/tooltips); from symbol config */
  pricePrecision?: number
  /** Decimal places for volume (axes/tooltips); from symbol config */
  volumePrecision?: number
  /** From catalog (e.g. FX vs Crypto) */
  assetClass?: AssetClass | null
  /** Raw bid string from WebSocket/API — preserves full decimal precision for forex */
  bidQuote?: string
  /** Raw ask string from WebSocket/API */
  askQuote?: string
}

export interface MockPosition {
  id: string
  symbol: string
  quantity: string
  direction: 'Buy' | 'Sell'
  margin: string
  entry: string
  current: string
  pnl: string
  sl: string
  tp: string
}

export interface MockOrder {
  id: string
  symbol: string
  type: 'market' | 'limit'
  side: 'buy' | 'sell'
  size: string
  price?: string
  status: 'open' | 'filled' | 'cancelled'
  createdAt: string
}

export const mockSymbols: MockSymbol[] = [
  { id: '1', code: 'BTC-USD', price: '$107438.65', price2: '$107438.65', value: '$0', enabled: false, numericPrice: 107438.65, numericPrice2: 107438.65, change24h: 2.45, volume24h: 1250000000, baseCurrency: 'BTC', quoteCurrency: 'USD' },
  { id: '2', code: 'ETH-USD', price: '$3766.92', price2: '$3766.93', value: '$0.01', enabled: false, numericPrice: 3766.92, numericPrice2: 3766.93, change24h: 1.23, volume24h: 850000000, baseCurrency: 'ETH', quoteCurrency: 'USD' },
  { id: '3', code: 'BNB-USD', price: '$1070.79', price2: '$1070.80', value: '$0.01', enabled: false, numericPrice: 1070.79, numericPrice2: 1070.80, change24h: -0.45, volume24h: 320000000, baseCurrency: 'BNB', quoteCurrency: 'USD' },
  { id: '4', code: 'SOL-USD', price: '$165.28', price2: '$165.29', value: '$0.01', enabled: false, numericPrice: 165.28, numericPrice2: 165.29, change24h: 3.67, volume24h: 450000000, baseCurrency: 'SOL', quoteCurrency: 'USD' },
  { id: '5', code: 'AVAX-USD', price: '$0.00', price2: '$0.00', value: '$0', enabled: false, numericPrice: 0, numericPrice2: 0, change24h: 0, volume24h: 0, baseCurrency: 'AVAX', quoteCurrency: 'USD' },
  { id: '6', code: 'DOT-USD', price: '$2.84', price2: '$2.84', value: '$0.001', enabled: false, numericPrice: 2.84, numericPrice2: 2.84, change24h: -1.12, volume24h: 180000000, baseCurrency: 'DOT', quoteCurrency: 'USD' },
  { id: '7', code: 'XRP-USD', price: '$2.45', price2: '$2.45', value: '$0.0001', enabled: false, numericPrice: 2.45, numericPrice2: 2.45, change24h: 0.89, volume24h: 150000000, baseCurrency: 'XRP', quoteCurrency: 'USD' },
  { id: '8', code: 'ADA-USD', price: '$0.601400', price2: '$0.601500', value: '$0.0001', enabled: false, numericPrice: 0.6014, numericPrice2: 0.6015, change24h: -0.23, volume24h: 120000000, baseCurrency: 'ADA', quoteCurrency: 'USD' },
  { id: '9', code: 'DOGE-USD', price: '$0.00', price2: '$0.00', value: '$0', enabled: false, numericPrice: 0, numericPrice2: 0, change24h: 0, volume24h: 0, baseCurrency: 'DOGE', quoteCurrency: 'USD' },
]

export const mockPositions: MockPosition[] = [
  {
    id: '1',
    symbol: 'BTCUSD',
    quantity: '0.00345713',
    direction: 'Buy',
    margin: '7.43',
    entry: '107434.26',
    current: '107438.65',
    pnl: '+0.02',
    sl: '0.00',
    tp: '0.00',
  },
  {
    id: '2',
    symbol: 'BTCUSD',
    quantity: '0.00345713',
    direction: 'Buy',
    margin: '7.43',
    entry: '107422.35',
    current: '107438.65',
    pnl: '+0.06',
    sl: '0.00',
    tp: '0.00',
  },
  {
    id: '3',
    symbol: 'BTCUSD',
    quantity: '0.00345713',
    direction: 'Buy',
    margin: '7.43',
    entry: '107423.26',
    current: '107438.65',
    pnl: '+0.05',
    sl: '0.00',
    tp: '0.00',
  },
]

export const mockOrders: MockOrder[] = [
  {
    id: '1',
    symbol: 'BTC-USD',
    type: 'market',
    side: 'buy',
    size: '0.003457',
    status: 'filled',
    createdAt: '2025-10-30 22:30:00',
  },
  {
    id: '2',
    symbol: 'ETH-USD',
    type: 'limit',
    side: 'sell',
    size: '0.5',
    price: '3800.00',
    status: 'open',
    createdAt: '2025-10-30 22:45:00',
  },
]

export const mockOrderHistory: MockOrder[] = [
  {
    id: '1',
    symbol: 'BTC-USD',
    type: 'market',
    side: 'buy',
    size: '0.003457',
    status: 'filled',
    createdAt: '2025-10-30 22:30:00',
  },
  {
    id: '2',
    symbol: 'ETH-USD',
    type: 'limit',
    side: 'sell',
    size: '0.5',
    price: '3800.00',
    status: 'filled',
    createdAt: '2025-10-30 22:45:00',
  },
]

export const mockPositionHistory: MockPosition[] = [
  {
    id: '1',
    symbol: 'BTCUSD',
    quantity: '0.00345713',
    direction: 'Buy',
    margin: '7.43',
    entry: '107400.00',
    current: '107450.00',
    pnl: '+0.17',
    sl: '0.00',
    tp: '0.00',
  },
]
