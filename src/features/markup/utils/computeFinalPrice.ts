import { MarkupRule, PricePreview } from '../types/markup'

export function computeFinalPrice(
  providerBid: number,
  providerAsk: number,
  rule: MarkupRule
): PricePreview {
  let finalBid = providerBid
  let finalAsk = providerAsk
  let appliedMarkupBid = 0
  let appliedMarkupAsk = 0

  // Apply markup based on type
  if (rule.markupType === 'fixed') {
    if (rule.applyTo === 'bid' || rule.applyTo === 'both') {
      finalBid += rule.value
      appliedMarkupBid = rule.value
    }
    if (rule.applyTo === 'ask' || rule.applyTo === 'both') {
      finalAsk += rule.value
      appliedMarkupAsk = rule.value
    }
  } else if (rule.markupType === 'percent') {
    if (rule.applyTo === 'bid' || rule.applyTo === 'both') {
      const markup = providerBid * (rule.value / 100)
      finalBid += markup
      appliedMarkupBid = markup
    }
    if (rule.applyTo === 'ask' || rule.applyTo === 'both') {
      const markup = providerAsk * (rule.value / 100)
      finalAsk += markup
      appliedMarkupAsk = markup
    }
  } else if (rule.markupType === 'spread') {
    if (rule.applyTo === 'both') {
      // Expand spread by value: ask += value/2, bid -= value/2
      finalAsk += rule.value / 2
      finalBid -= rule.value / 2
      appliedMarkupAsk = rule.value / 2
      appliedMarkupBid = -rule.value / 2
    } else if (rule.applyTo === 'ask') {
      finalAsk += rule.value
      appliedMarkupAsk = rule.value
    } else if (rule.applyTo === 'bid') {
      finalBid -= rule.value
      appliedMarkupBid = -rule.value
    }
  }

  // Apply clamps if provided
  if (rule.minMarkup !== undefined) {
    if (rule.applyTo === 'bid' || rule.applyTo === 'both') {
      const minBid = providerBid + rule.minMarkup
      if (finalBid < minBid) {
        appliedMarkupBid = rule.minMarkup
        finalBid = minBid
      }
    }
    if (rule.applyTo === 'ask' || rule.applyTo === 'both') {
      const minAsk = providerAsk + rule.minMarkup
      if (finalAsk < minAsk) {
        appliedMarkupAsk = rule.minMarkup
        finalAsk = minAsk
      }
    }
  }

  if (rule.maxMarkup !== undefined) {
    if (rule.applyTo === 'bid' || rule.applyTo === 'both') {
      const maxBid = providerBid + rule.maxMarkup
      if (finalBid > maxBid) {
        appliedMarkupBid = rule.maxMarkup
        finalBid = maxBid
      }
    }
    if (rule.applyTo === 'ask' || rule.applyTo === 'both') {
      const maxAsk = providerAsk + rule.maxMarkup
      if (finalAsk > maxAsk) {
        appliedMarkupAsk = rule.maxMarkup
        finalAsk = maxAsk
      }
    }
  }

  // Round to specified decimals
  const roundingFactor = Math.pow(10, rule.rounding)
  finalBid = Math.round(finalBid * roundingFactor) / roundingFactor
  finalAsk = Math.round(finalAsk * roundingFactor) / roundingFactor

  return {
    providerBid,
    providerAsk,
    finalBid,
    finalAsk,
    appliedMarkupBid,
    appliedMarkupAsk,
  }
}

