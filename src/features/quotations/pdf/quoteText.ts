/*
 * The words of the quotation PDF (QuotationDocument), worked out apart from the layout so they can be tested without rendering.
 * They follow the owner's own Excel quotation: "23-Nov-26", "Price Validity: 2 Weeks.", "Payment Terms: 30 Days Credit.".
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-11-23" -> "23-Nov-26", the Date in the quote reference box. */
export function quoteDay(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}-${MONTHS[Number(m) - 1]}-${y.slice(2)}`
}

/** "2026-11-21" -> "21-11-2026", the inquiry date. */
export function inquiryDay(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}-${m}-${y}`
}

const dayNumber = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/** How long the prices hold, from the issue date to the valid-until date: "2 Weeks." when it is whole weeks, else "10 Days.". */
export function validityLine(issuedOn: string, validUntil: string): string {
  const days = Math.max(0, Math.round(dayNumber(validUntil) - dayNumber(issuedOn)))
  if (days === 0) return 'Today only.'
  return days % 7 === 0 ? `${plural(days / 7, 'Week')}.` : `${plural(days, 'Day')}.`
}

const sentence = (text: string) => {
  const t = text.trim()
  return /[.!?]$/.test(t) ? t : `${t}.`
}

/**
 * The delivery line. The quotation's own delivery text wins. Otherwise the lead times quoted per item: one line when every item has
 * the same one, or "Mentioned against each item." with each item's lead time printed under it (`perItem`).
 */
export function deliveryLine(deliveryText: string | null, leads: readonly (string | null)[]): { line: string | null; perItem: boolean } {
  if (deliveryText?.trim()) return { line: sentence(deliveryText), perItem: false }
  const given = leads.map(l => l?.trim() ?? '').filter(Boolean)
  if (given.length === 0) return { line: null, perItem: false }
  const distinct = [...new Set(given.map(l => l.toLowerCase()))]
  if (distinct.length === 1 && given.length === leads.length) return { line: sentence(given[0]), perItem: false }
  return { line: 'Mentioned against each item.', perItem: true }
}

/**
 * "Payment Terms: 30 Days Credit." from the quotation's payment terms: a bare number of days reads as days of credit, any other text
 * is printed as typed. With none typed, the company's default terms; with a default of 0 days, no line.
 */
export function paymentLine(terms: string | null, defaultDays: number | null): { label: null; text: string } | null {
  const t = terms?.trim() ?? ''
  const days = /^(\d{1,3})\s*(days?)?$/i.exec(t)
  if (days) return { label: null, text: `Payment Terms: ${Number(days[1])} Days Credit.` }
  if (t) return { label: null, text: `Payment Terms: ${sentence(t)}` }
  if (defaultDays && defaultDays > 0) return { label: null, text: `Payment Terms: ${defaultDays} Days Credit.` }
  return null
}

const HONORIFIC = /^(mr|mrs|ms|miss|dr|engr|prof|sir|madam)\.?\s/i

/** "Mr. Shahid Ali (Purchase Manager)," for the To line. A name that already has a title keeps it. No contact, no line. */
export function toLine(name: string | null, title: string | null): string | null {
  const n = name?.trim()
  if (!n) return null
  const who = HONORIFIC.test(n) ? n : `Mr. ${n}`
  return `${who}${title?.trim() ? ` (${title.trim()})` : ''},`
}

export interface ItemDetail {
  /** The first line of the description, in capitals. */
  title: string
  /** The further lines. "Model: X" style lines keep their label, printed bold. */
  lines: { label: string | null; text: string }[]
}

const LABELLED = /^([A-Za-z][A-Za-z .#/-]{0,18}?)\s*:\s*(.+)$/

/**
 * The description cell. The first line is the item in capitals. Further lines that read "Label: value" (Model, Part No, Specs,
 * Make, Condition, any short label) print the label bold. A Make line is added from the item's brand when the text has none, and
 * the quoted lead time when the items' lead times differ.
 */
export function itemDetail(description: string, brand: string | null, leadTime: string | null): ItemDetail {
  const [first = '', ...rest] = description.split(/\r?\n/).map(l => l.trim())
  const lines = rest.filter(Boolean).map(l => {
    const m = LABELLED.exec(l)
    return m ? { label: m[1].trim(), text: m[2].trim() } : { label: null, text: l }
  })
  if (brand?.trim() && !lines.some(l => l.label && /^(make|brand|manufacturer)$/i.test(l.label))) {
    // the template's order: Model, Specs, Make, Condition
    const at = lines.findIndex(l => l.label && /^condition$/i.test(l.label))
    lines.splice(at < 0 ? lines.length : at, 0, { label: 'Make', text: brand.trim().toUpperCase() })
  }
  if (leadTime?.trim()) lines.push({ label: 'Delivery', text: leadTime.trim() })
  return { title: first.toUpperCase(), lines }
}

/** The footer address on two lines: its own line breaks, or else split at the first comma. */
export function footerAddress(address: string | null): string[] {
  const a = address?.trim()
  if (!a) return []
  const byLine = a.split(/\r?\n/).map(l => l.trim().replace(/,$/, '')).filter(Boolean)
  if (byLine.length > 1) return [byLine[0], byLine.slice(1).join(', ')]
  const at = a.indexOf(',')
  return at > 0 ? [a.slice(0, at).trim(), a.slice(at + 1).trim()] : [a]
}
