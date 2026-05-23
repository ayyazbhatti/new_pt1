import { describe, it, expect } from 'vitest'
import { formatSymbolPrice } from './priceFormat'

describe('formatSymbolPrice', () => {
  it('uses pricePrecision for FX-style quotes', () => {
    expect(formatSymbolPrice(0.98518, { pricePrecision: 5 })).toBe('0.98518')
  })

  it('falls back to digits when pricePrecision missing', () => {
    expect(formatSymbolPrice(0.7104, { digits: 4 })).toBe('0.7104')
  })

  it('formats crypto-style with 2 decimals', () => {
    expect(formatSymbolPrice(77000.5, { pricePrecision: 2 })).toBe('77000.50')
  })

  it('JPY-style pairs use 3 decimal precision when configured', () => {
    expect(formatSymbolPrice(150.235, { pricePrecision: 3 })).toBe('150.235')
  })

  it('handles missing precision with default 2', () => {
    expect(formatSymbolPrice(150.25, {})).toBe('150.25')
    expect(formatSymbolPrice(150.25, null)).toBe('150.25')
  })

  it('handles invalid string input', () => {
    expect(formatSymbolPrice('not a number', { pricePrecision: 5 })).toBe('—')
  })

  it('handles null price', () => {
    expect(formatSymbolPrice(null, { pricePrecision: 5 })).toBe('—')
  })
})
