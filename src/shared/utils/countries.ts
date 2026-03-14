import { getCountryDataList, getEmojiFlag } from 'countries-list'

export interface CountryOption {
  code: string
  name: string
  flag: string
}

/** Sorted list of all countries (name, ISO code, flag) for dropdowns. */
let cached: CountryOption[] | null = null

export function getCountryOptions(): CountryOption[] {
  if (cached) return cached
  const list = getCountryDataList()
  cached = list
    .map((c) => ({
      code: c.iso2,
      name: c.name,
      flag: getEmojiFlag(c.iso2),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return cached
}

/** Get display label: flag + name + code (e.g. "🇺🇸 United States (US)"). */
export function getCountryLabel(option: CountryOption): string {
  return `${option.flag} ${option.name} (${option.code})`
}
