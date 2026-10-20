/*
 * The one line under the company name (g2-company.html, every board). Decided in one pure function so the wording of each
 * state is tested:
 *   supplier, populated      "Linz, Austria · Quotes in EUR · Supplier since 2023"
 *   supplier, low data       "Shenzhen, China · Quotes in CNY · Added Oct 2026"
 *   supplier, imported only  "Rawalpindi, Pakistan · Quotes in PKR · Imported from the old CRM"
 *   customer                 "Karachi, Pakistan · 3 sites · 3 RFQs · 3 orders"   (no "Added": "Customer since" is in Roles)
 * The place is "City, Country" when the city is known (companies.city), else the country alone.
 */
export interface MetaInput {
  city?: string | null
  country: string | null
  isSupplier: boolean
  isCustomer: boolean
  legacyImported: boolean
  /** companies.created_at (an ISO timestamp). */
  createdAt: string
  /** Supplier: fewer than 3 enquiries counted. */
  lowData: boolean
  /** The currency they last quoted in, when known. */
  currency: string | null
  /** The earliest year we dealt with them (first enquiry or leg), when known. */
  sinceYear: number | null
  /** Customer counts, once the history has loaded. */
  counts: { sites: number; rfqs: number; orders: number } | null
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "Oct 2026" from a timestamp, in the business timezone. */
export function monthYearOf(iso: string): string {
  const d = new Date(iso)
  const parts = new Intl.DateTimeFormat('en-GB', { month: 'numeric', year: 'numeric', timeZone: 'Asia/Karachi' }).formatToParts(d)
  const m = Number(parts.find(p => p.type === 'month')?.value ?? 1)
  const y = parts.find(p => p.type === 'year')?.value ?? ''
  return `${MONTHS[m - 1]} ${y}`
}

/**
 * The place under a name in the Companies list (audit 9a: the city, not "Pakistan" on every row). The city alone when the
 * company is in the country most of the list shares, "City, Country" when it is abroad, the country when no city is known.
 */
export function listPlace(city: string | null | undefined, country: string | null | undefined, common: string | null): string | null {
  const c = city?.trim()
  const k = country?.trim()
  // country is free text: "Pakistan" and "pakistan" are the same country
  if (c) return k && k.toLowerCase() !== common?.toLowerCase() ? `${c}, ${k}` : c
  return k || null
}

export function companyMeta(i: MetaInput): string[] {
  const out: string[] = []
  const place = [i.city?.trim(), i.country?.trim()].filter(Boolean).join(', ')
  if (place) out.push(place)
  if (i.isSupplier) {
    if (i.currency) out.push(`Quotes in ${i.currency}`)
    out.push(i.legacyImported ? 'Imported from the old CRM' : i.lowData || i.sinceYear === null ? `Added ${monthYearOf(i.createdAt)}` : `Supplier since ${i.sinceYear}`)
    if (i.isCustomer && i.counts) out.push(`${plural(i.counts.sites, 'site')} · ${plural(i.counts.rfqs, 'RFQ')} · ${plural(i.counts.orders, 'order')}`)
    return out
  }
  if (i.counts) out.push(`${plural(i.counts.sites, 'site')} · ${plural(i.counts.rfqs, 'RFQ')} · ${plural(i.counts.orders, 'order')}`)
  if (i.legacyImported) out.push('Imported from the old CRM')
  return out
}
