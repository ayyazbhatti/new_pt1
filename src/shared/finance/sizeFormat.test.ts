import { describe, it, expect } from 'vitest'
import { formatPositionSize } from './sizeFormat'

describe('formatPositionSize', () => {
  it('formats FX as lots', () => {
    const result = formatPositionSize(150000, {
      code: 'EURUSD',
      assetClass: 'FX',
      contractSize: '100000',
      baseCurrency: 'EUR',
      volumePrecision: 2,
    })
    expect(result.primary).toBe('1.50')
    expect(result.unit).toBe('lots')
    expect(result.secondary).toContain('150,000')
    expect(result.display).toBe('1.50 lots')
  })

  it('formats crypto as base units', () => {
    const result = formatPositionSize(0.5, {
      code: 'BTCUSDT',
      assetClass: 'CRYPTO',
      contractSize: '1',
      baseCurrency: 'BTC',
      volumePrecision: 2,
    })
    expect(result.primary).toBe('0.50')
    expect(result.unit).toBe('BTC')
    expect(result.display).toContain('BTC')
  })

  it('accepts Crypto enum casing from API', () => {
    const result = formatPositionSize(1, {
      code: 'ETHUSDT',
      assetClass: 'Crypto',
      contractSize: '1',
      baseCurrency: 'ETH',
      volumePrecision: 2,
    })
    expect(result.unit).toBe('ETH')
  })

  it('formats stocks as shares (integer)', () => {
    const result = formatPositionSize(100, {
      code: 'AAPL',
      assetClass: 'Stocks',
      contractSize: '1',
      baseCurrency: 'AAPL',
      volumePrecision: 2,
    })
    expect(result.primary).toBe('100')
    expect(result.unit).toBe('shares')
    expect(result.display).toBe('100 shares')
  })

  it('handles missing symbol meta gracefully', () => {
    const result = formatPositionSize(123, null)
    expect(result.display).toBeTruthy()
    expect(result.display).toContain('123')
  })

  it('formats index with contract_size > 1 as lots', () => {
    const result = formatPositionSize(50000, {
      code: 'NAS100',
      assetClass: 'Indices',
      contractSize: '100',
      baseCurrency: 'USD',
      volumePrecision: 2,
    })
    expect(result.unit).toBe('lots')
    expect(result.primary).toBe('500.00')
  })
})
