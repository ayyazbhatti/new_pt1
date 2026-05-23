/**
 * Asset-class-aware display for position/order sizes (raw units from backend).
 * Backend always stores size as raw units; this module maps to lots/shares/etc. for UI.
 */

export type SizeUnitLabel = 'lots' | 'shares' | 'units' | string

export interface FormattedSize {
  /** Headline numeric portion */
  primary: string
  /** Short unit label, e.g. "lots", "BTC", "shares" */
  unit: SizeUnitLabel
  /** Tooltip: raw units (e.g. base currency notional for FX lots) */
  secondary: string
  /** Single-line primary label, e.g. "1.50 lots" */
  display: string
}

export interface SymbolMeta {
  code: string
  /** e.g. FX | Crypto | Stocks | Indices | Metals | Commodities */
  assetClass?: string | null
  market?: string | null
  contractSize?: string | number | null
  baseCurrency?: string | null
  quoteCurrency?: string | null
  volumePrecision?: number | null
  pricePrecision?: number | null
  digits?: number | null
}

function formatRawUnits(units: number, baseCurrency?: string | null): string {
  const formatted = units.toLocaleString('en-US', { maximumFractionDigits: 8 })
  return baseCurrency ? `${formatted} ${baseCurrency}` : formatted
}

function normalizeAssetClass(assetClass?: string | null): string {
  return (assetClass ?? '').trim().toUpperCase()
}

function normalizeMarket(market?: string | null): string {
  return (market ?? '').trim().toLowerCase()
}

/** FX lots: always show 4 decimals so sub–0.01 lots are not rounded away (e.g. 0.0051 not 0.01). */
function formatFxLotsForDisplay(lots: number): string {
  return lots.toFixed(4)
}

function fallbackFormatted(rawUnits: number | string): FormattedSize {
  const s = typeof rawUnits === 'string' ? rawUnits : String(rawUnits)
  const n = typeof rawUnits === 'string' ? parseFloat(rawUnits) : rawUnits
  if (Number.isFinite(n)) {
    const display = n.toLocaleString('en-US', { maximumFractionDigits: 8 })
    return {
      primary: display,
      unit: 'units',
      secondary: '',
      display,
    }
  }
  return {
    primary: s,
    unit: 'units',
    secondary: '',
    display: s,
  }
}

/**
 * Convert raw units (what the backend stores) to a display-appropriate representation.
 */
export function formatPositionSize(
  rawUnits: number | string,
  symbol: SymbolMeta | null | undefined
): FormattedSize {
  const units = typeof rawUnits === 'string' ? parseFloat(rawUnits) : rawUnits
  if (!Number.isFinite(units)) {
    return fallbackFormatted(rawUnits)
  }
  if (!symbol) {
    return fallbackFormatted(units)
  }

  const contractSize = Math.max(0, parseFloat(String(symbol.contractSize ?? 1)) || 0) || 1
  const precision = symbol.volumePrecision ?? 2
  const ac = normalizeAssetClass(symbol.assetClass)
  const market = normalizeMarket(symbol.market)

  const isFx = ac === 'FX' || market === 'forex'
  const isCrypto = ac === 'CRYPTO' || market === 'crypto'
  const isStock = ac === 'STOCKS' || ac === 'STOCK' || market === 'stocks'
  const isIndex = ac === 'INDICES' || ac === 'INDEX' || market === 'indices'
  const isMetal = ac === 'METALS' || ac === 'METAL' || market === 'metals'
  const isCommodity = ac === 'COMMODITIES' || ac === 'COMMODITY' || market === 'commodities'

  if (isFx) {
    const lots = contractSize > 0 ? units / contractSize : units
    const primary = formatFxLotsForDisplay(lots)
    const secondary = formatRawUnits(units, symbol.baseCurrency)
    return {
      primary,
      unit: 'lots',
      secondary,
      display: `${primary} lots`,
    }
  }

  if (isCrypto) {
    const primary = units.toFixed(precision)
    const label = symbol.baseCurrency?.trim() || 'units'
    const display = symbol.baseCurrency?.trim()
      ? `${primary} ${symbol.baseCurrency.trim()}`
      : primary
    return {
      primary,
      unit: label,
      secondary: '',
      display,
    }
  }

  if (isStock) {
    const rounded = Math.round(units)
    const primary = String(rounded)
    return {
      primary,
      unit: 'shares',
      secondary: '',
      display: `${primary} shares`,
    }
  }

  if ((isIndex || isMetal || isCommodity) && contractSize > 1) {
    const lots = units / contractSize
    const primary = lots.toFixed(precision)
    const secondary = formatRawUnits(units, symbol.baseCurrency)
    return {
      primary,
      unit: 'lots',
      secondary,
      display: `${primary} lots`,
    }
  }

  const primary = units.toFixed(precision)
  const secondary = formatRawUnits(units, symbol.baseCurrency)
  return {
    primary,
    unit: 'units',
    secondary,
    display: `${primary} units`,
  }
}
