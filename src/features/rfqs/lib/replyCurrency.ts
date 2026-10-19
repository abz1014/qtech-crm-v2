// The currency a supplier reply is pre-filled with. It is never typed: the person only changes it in the rare
// case the pre-fill is wrong. Order (BUILD_PLAN R07): the supplier's own last currency (reply or procurement leg), else a country map (Pakistan is PKR), else nothing: the row shows a currency chip row and the first save remembers the pick as the last currency.

/** Country name (as the companies table spells it, any case) to the currency suppliers there usually quote in. */
const COUNTRY_CURRENCY: Record<string, string> = {
  pakistan: 'PKR',
  china: 'CNY',
  'hong kong': 'USD',
  taiwan: 'USD',
  'united states': 'USD',
  usa: 'USD',
  us: 'USD',
  'united arab emirates': 'AED',
  uae: 'AED',
  dubai: 'AED',
  germany: 'EUR',
  france: 'EUR',
  italy: 'EUR',
  spain: 'EUR',
  netherlands: 'EUR',
  austria: 'EUR',
  belgium: 'EUR',
  finland: 'EUR',
  ireland: 'EUR',
  switzerland: 'EUR',
  'united kingdom': 'GBP',
  uk: 'GBP',
  england: 'GBP',
  japan: 'JPY',
  india: 'USD',
  singapore: 'USD',
  malaysia: 'USD',
  turkey: 'USD',
  'saudi arabia': 'SAR',
  'south korea': 'USD',
  korea: 'USD',
}

export const REPLY_CURRENCIES = ['PKR', 'USD', 'EUR', 'CNY', 'AED', 'GBP', 'JPY', 'SAR'] as const

export type PrefillSource = 'last' | 'country' | 'none'

export interface PrefillCurrency {
  currency: string
  source: PrefillSource
}

export function currencyForSupplier(lastCurrency: string | null | undefined, country: string | null | undefined): PrefillCurrency {
  if (lastCurrency && /^[A-Z]{3}$/.test(lastCurrency)) return { currency: lastCurrency, source: 'last' }
  const mapped = country ? COUNTRY_CURRENCY[country.trim().toLowerCase()] : undefined
  if (mapped) return { currency: mapped, source: 'country' }
  // Nothing on file (no reply, no leg, no known country): never assume PKR (audit R1). The row asks once, in one tap.
  return { currency: '', source: 'none' }
}

/** The words that say where the pre-filled currency came from ("USD, their last reply"). */
export function currencySourceNote(c: PrefillCurrency, country?: string | null): string {
  if (c.source === 'last') return `${c.currency}, their last reply`
  if (c.source === 'country') return `${c.currency}, usual for ${country ?? 'their country'}`
  return 'not set yet'
}
