import { AdminSymbol } from '@/features/symbols/types/symbol'

/**
 * Calculate pip value per lot using cTrader formula
 * Formula: Pip Value Per Lot = (Tick Size × Contract Size) / Current Price
 * 
 * @param symbol - Symbol with tick_size, contract_size, etc.
 * @param price - Current market price
 * @param accountCurrency - Account currency (default: USD)
 * @returns Pip value per lot in account currency
 */
export function calculatePipValuePerLot(
  symbol: AdminSymbol,
  price: number,
  accountCurrency: string = 'USD'
): number {
  if (!price || price <= 0) return 0
  
  // Get tick size (default to 0.0001 for FX if not set)
  const tickSize = symbol.tickSize ?? (symbol.assetClass === 'FX' ? 0.0001 : 0.01)
  
  // Get contract size (default to 100000 for FX if not set)
  const contractSize = parseFloat(symbol.contractSize) || (symbol.assetClass === 'FX' ? 100000 : 1)
  
  // cTrader formula: (Tick Size × Contract Size) / Current Price
  const pipValue = (tickSize * contractSize) / price
  
  // For now, assume quote currency = account currency (USD pairs)
  // TODO: Add currency conversion if quote currency != account currency
  
  return pipValue
}

/**
 * Normalize lot size to valid increments and validate min/max
 * Similar to cTrader's NormalizeVolumeInUnits but for lot size
 * 
 * @param lotSize - Lot size to normalize
 * @param symbol - Symbol with lot_min, lot_max, volume_precision
 * @returns Normalized lot size
 */
export function normalizeLotSize(lotSize: number, symbol: AdminSymbol): number {
  if (lotSize <= 0) return 0
  
  const volumePrecision = symbol.volumePrecision || 2
  const lotMin = symbol.lotMin ?? 0.01
  const lotMax = symbol.lotMax ?? 100
  
  // Round to volume precision
  const multiplier = Math.pow(10, volumePrecision)
  let normalized = Math.round(lotSize * multiplier) / multiplier
  
  // Clamp to min/max
  normalized = Math.max(lotMin, Math.min(lotMax, normalized))
  
  return normalized
}

/**
 * Calculate lot size from pip position using cTrader formula
 * Formula: Lot Size = (Risk Amount Per Pip) / (Pip Value Per Lot)
 * 
 * @param pipPosition - Dollar risk per pip (e.g., $5 per pip)
 * @param symbol - Symbol configuration
 * @param price - Current market price
 * @param accountCurrency - Account currency (default: USD)
 * @returns Calculated lot size (normalized)
 */
export function calculateLotSizeFromPipPosition(
  pipPosition: number,
  symbol: AdminSymbol,
  price: number,
  accountCurrency: string = 'USD'
): number {
  if (pipPosition <= 0) return 0
  
  const pipValuePerLot = calculatePipValuePerLot(symbol, price, accountCurrency)
  if (pipValuePerLot === 0) return 0
  
  const lotSize = pipPosition / pipValuePerLot
  
  // Normalize and validate
  return normalizeLotSize(lotSize, symbol)
}

/**
 * Convert lot size to units using cTrader formula
 * Formula: Units = Lot Size × Contract Size
 * 
 * @param lots - Lot size (e.g., 0.5, 1.0, 2.5)
 * @param symbol - Symbol with contract_size
 * @returns Units in base currency
 */
export function calculateUnitsFromLots(lots: number, symbol: AdminSymbol): number {
  if (lots <= 0) return 0
  
  const contractSize = parseFloat(symbol.contractSize) || (symbol.assetClass === 'FX' ? 100000 : 1)
  return lots * contractSize
}

/**
 * Convert units to lot size using cTrader formula
 * Formula: Lot Size = Units / Contract Size
 * 
 * @param units - Units in base currency
 * @param symbol - Symbol with contract_size
 * @returns Lot size (normalized)
 */
export function calculateLotsFromUnits(units: number, symbol: AdminSymbol): number {
  if (units <= 0) return 0
  
  const contractSize = parseFloat(symbol.contractSize) || (symbol.assetClass === 'FX' ? 100000 : 1)
  if (contractSize === 0) return 0
  
  const lotSize = units / contractSize
  return normalizeLotSize(lotSize, symbol)
}

/**
 * Normalize volume in units (cTrader NormalizeVolumeInUnits equivalent)
 * Converts units to lot size, normalizes, then converts back to units
 * 
 * @param units - Units to normalize
 * @param symbol - Symbol configuration
 * @returns Normalized units
 */
export function normalizeVolumeInUnits(units: number, symbol: AdminSymbol): number {
  if (units <= 0) return 0
  
  const lots = calculateLotsFromUnits(units, symbol)
  return calculateUnitsFromLots(lots, symbol)
}

/**
 * Calculate pip position from lot size (reverse calculation)
 * Formula: Pip Position = Lot Size × Pip Value Per Lot
 * 
 * @param lots - Lot size
 * @param symbol - Symbol configuration
 * @param price - Current market price
 * @param accountCurrency - Account currency (default: USD)
 * @returns Pip position in account currency
 */
export function calculatePipPositionFromLots(
  lots: number,
  symbol: AdminSymbol,
  price: number,
  accountCurrency: string = 'USD'
): number {
  if (lots <= 0) return 0
  
  const pipValuePerLot = calculatePipValuePerLot(symbol, price, accountCurrency)
  return lots * pipValuePerLot
}

/**
 * Format lot size for display
 * 
 * @param lots - Lot size
 * @param symbol - Symbol with volume_precision
 * @returns Formatted string
 */
export function formatLotSize(lots: number, symbol: AdminSymbol): string {
  const volumePrecision = symbol.volumePrecision || 2
  return lots.toFixed(volumePrecision)
}

/**
 * Format units for display
 * 
 * @param units - Units
 * @param symbol - Symbol with volume_precision
 * @returns Formatted string
 */
export function formatUnits(units: number, symbol: AdminSymbol): string {
  const volumePrecision = symbol.volumePrecision || 2
  if (units >= 1000000) {
    return `${(units / 1000000).toFixed(2)}M`
  } else if (units >= 1000) {
    return `${(units / 1000).toFixed(2)}K`
  }
  return units.toFixed(volumePrecision)
}

