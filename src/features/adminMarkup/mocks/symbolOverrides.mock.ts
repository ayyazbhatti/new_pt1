import { SymbolPriceOverride } from '../types/pricing'
import { mockSymbols } from '@/features/symbols/mocks/symbols.mock'
import { mockGroupProfiles } from './groupProfiles.mock'
import { mockPriceProfiles } from './priceProfiles.mock'

// Get default group profiles for symbols
const getDefaultProfileForSymbol = (symbolCode: string) => {
  // In real app, this would come from symbol's group assignment
  // For mock, assign based on symbol market
  if (symbolCode.includes('BTC') || symbolCode.includes('ETH')) {
    return mockGroupProfiles.find((gp) => gp.groupId === '1') // Standard Group -> Standard Retail
  }
  return mockGroupProfiles.find((gp) => gp.groupId === '1') // Default to Standard
}

export const mockSymbolOverrides: SymbolPriceOverride[] = mockSymbols.map((symbol) => {
  const defaultProfile = getDefaultProfileForSymbol(symbol.code)
  const defaultProfileData = mockPriceProfiles.find((p) => p.id === defaultProfile?.profileId)
  
  // Some symbols have overrides
  let overrideProfileId: string | null = null
  let overrideProfileName: string | null = null
  
  if (symbol.code === 'XAUUSD') {
    overrideProfileId = 'profile-3'
    overrideProfileName = 'High Spread Premium'
  } else if (symbol.code === 'BTCUSDT') {
    overrideProfileId = 'profile-4'
    overrideProfileName = 'Crypto Standard'
  }

  const effectiveProfile = overrideProfileId
    ? mockPriceProfiles.find((p) => p.id === overrideProfileId)
    : defaultProfileData

  return {
    symbol: symbol.code,
    symbolName: symbol.name,
    defaultGroupProfileId: defaultProfile?.profileId || '',
    defaultGroupProfileName: defaultProfile?.profileName || '',
    overrideProfileId,
    overrideProfileName,
    effectiveBidMarkup: effectiveProfile?.bidMarkup || 0,
    effectiveAskMarkup: effectiveProfile?.askMarkup || 0,
  }
})

