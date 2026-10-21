import type { SupplierStats } from '@/features/companies/api'

/*
 * What the supplier panel says, decided in one pure function (DATA_MODEL section 5c display rules).
 * Rates are always shown with their counts, never a percentage; a measure only appears once there is
 * enough behind it; below the thresholds the panel states the raw fact or says what unlocks it.
 * Nothing here is a score and nothing here orders anything.
 */
export interface SupplierFacts {
  asked: number
  replied: number
  quoted: number
  declined: number
  waiting: number
  /** "Replied 5 of 6 · quoted 4" once there are 3 or more enquiries; "Asked twice · 1 reply" below that. */
  enquirySummary: string
  replyTime: { kind: 'known'; days: number; logged: number; importedLeftOut: number } | { kind: 'withheld'; logged: number; importedOnly: boolean }
  /**
   * known: quoted items later ordered (from them or someone else). orders: no quoted item was ordered yet, but there are orders with
   * a supplier order from them (a repeat or a direct order has no RFQ item to trace back), so "nothing ordered" would be false.
   */
  chosen: { kind: 'known'; chosen: number; of: number } | { kind: 'orders'; orders: number } | { kind: 'none' }
  /** Orders with a supplier order from them (v_supplier_stats.orders_count), cancelled ones left out. */
  orders: number
  deliveries: { kind: 'known'; total: number; late: number; medianDaysLate: number | null } | { kind: 'none' }
  lastContact: string | null
  provenance: { legacyAsked: number; pricesHidden: number; importedOnly: boolean; hasImported: boolean }
  lowData: boolean
  empty: boolean
}

const WORDS = ['no times', 'once', 'twice']
const times = (n: number) => (n < WORDS.length ? WORDS[n] : `${n} times`)
const replies = (n: number) => (n === 1 ? '1 reply' : n === 0 ? 'no replies' : `${n} replies`)

export function supplierFacts(s: SupplierStats | null): SupplierFacts | null {
  if (!s) return null
  const asked = s.asked ?? 0
  const replied = s.replied ?? 0
  const quoted = s.quoted ?? 0
  const declined = s.no_offer ?? 0
  const legacyAsked = s.legacy_asked ?? 0
  const logged = s.reply_days_n ?? 0
  const deliveries = s.deliveries ?? 0
  const late = s.late ?? 0
  const chosenOf = s.chosen_of ?? 0
  const orders = s.orders_count ?? 0

  const enquirySummary =
    asked >= 3
      ? `Replied ${replied} of ${asked} · quoted ${quoted}${declined >= 1 ? ` · couldn't offer ${declined}` : ''}`
      : asked === 0
        ? 'No enquiries yet'
        : `Asked ${times(asked)} · ${replies(replied)}`

  return {
    asked,
    replied,
    quoted,
    declined,
    waiting: Math.max(asked - replied, 0),
    enquirySummary,
    replyTime:
      s.median_reply_days !== null && s.median_reply_days !== undefined
        ? { kind: 'known', days: Math.round(s.median_reply_days), logged, importedLeftOut: Math.max(replied - logged, 0) }
        : { kind: 'withheld', logged, importedOnly: asked > 0 && legacyAsked === asked },
    chosen: chosenOf >= 1 ? { kind: 'known', chosen: s.chosen ?? 0, of: chosenOf } : orders > 0 ? { kind: 'orders', orders } : { kind: 'none' },
    orders,
    deliveries:
      deliveries >= 1 ? { kind: 'known', total: deliveries, late, medianDaysLate: s.median_days_late ?? null } : { kind: 'none' },
    lastContact: s.last_contact ?? null,
    provenance: {
      legacyAsked,
      pricesHidden: s.prices_hidden ?? 0,
      importedOnly: asked > 0 && legacyAsked === asked,
      hasImported: legacyAsked > 0,
    },
    lowData: asked < 3,
    empty: asked === 0 && deliveries === 0 && s.last_contact === null,
  }
}

/**
 * The supplier's record in one line, for the page header (it replaced the "What we know" panel, round 3):
 * "Replied 5 of 6 in about 3 days · quoted 4 · 2 orders · late 1 of 4". Null with nothing to say.
 */
export function recordLine(f: SupplierFacts): string | null {
  const parts: string[] = []
  const inDays = f.replyTime.kind === 'known' ? ` in about ${f.replyTime.days} ${f.replyTime.days === 1 ? 'day' : 'days'}` : ''
  if (f.asked >= 3) parts.push(`Replied ${f.replied} of ${f.asked}${inDays}`, `quoted ${f.quoted}`)
  else if (f.asked > 0) parts.push(f.enquirySummary)
  if (f.orders > 0) parts.push(`${f.orders} ${f.orders === 1 ? 'order' : 'orders'}`)
  if (f.deliveries.kind === 'known') parts.push(`late ${f.deliveries.late} of ${f.deliveries.total}`)
  if (parts.length === 0) return null
  const line = parts.join(' · ')
  return line[0].toUpperCase() + line.slice(1)
}

/** What "Chosen" says: "2 of 5 quoted items", "3 orders with them", or "Nothing ordered yet" only when there is truly none. */
export function chosenText(f: SupplierFacts): string {
  const c = f.chosen
  if (c.kind === 'known') return `${c.chosen} of ${c.of} quoted items`
  if (c.kind === 'orders') return `${c.orders} ${c.orders === 1 ? 'order' : 'orders'} with them`
  return 'Nothing ordered yet'
}

/** Deliveries in a few words: "Late 1 of 4 · about 6 days over", "Late 0 of 3 · dates estimated", "None recorded yet". */
export function deliveryLine(f: SupplierFacts): string {
  const d = f.deliveries
  if (d.kind === 'none') return 'None recorded yet'
  const over = d.late > 0 && d.medianDaysLate !== null ? ` · about ${Math.round(d.medianDaysLate)} ${Math.round(d.medianDaysLate) === 1 ? 'day' : 'days'} over` : ''
  return `Late ${d.late} of ${d.total}${over}${f.provenance.importedOnly ? ' · dates estimated' : ''}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthYear = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`
const isAre = (n: number, one: string, many: string) => (n === 1 ? one : many)

/**
 * What the (i) beside "What we know" says: where the numbers come from and the rules behind them, one sentence each. These
 * were footnotes and sub-lines on the page; the page now shows the counts, and the reasons wait behind the tip.
 */
export function factNotes(f: SupplierFacts, span: { from: string; to: string } | null): string[] {
  const p = f.provenance
  const out: string[] = []
  if (p.importedOnly) {
    out.push(`All imported from the old CRM${span ? `, ${monthYear(span.from)} to ${monthYear(span.to)}` : ''}. Nothing logged here since.`)
  } else {
    out.push('Counted from enquiries, quotes, POs and delivery dates. Nothing is typed in.')
    if (p.hasImported) out.push(`Includes imported history: ${p.legacyAsked} of ${f.asked} enquiries came from the old CRM.`)
  }
  if (p.pricesHidden > 0) out.push(`${p.pricesHidden} ${isAre(p.pricesHidden, 'price is', 'prices are')} hidden: the currency was never checked.`)
  const r = f.replyTime
  if (r.kind === 'known') {
    out.push(
      `Reply time is the middle of the ${r.logged} replies logged here.${r.importedLeftOut > 0 ? ` ${r.importedLeftOut} imported ${isAre(r.importedLeftOut, 'reply is', 'replies are')} left out (no real date).` : ''}`,
    )
  } else if (r.importedOnly) {
    out.push('No reply time: imported replies carry the import date, not the day they answered.')
  } else if (f.asked > 0) {
    out.push(`Reply time shows once 3 replies are logged here (${r.logged} so far).`)
  }
  if (f.chosen.kind === 'known') out.push(`Chosen: ${chosenText(f)} were later ordered from them.`)
  else if (f.chosen.kind === 'orders') out.push(`Ordered: ${chosenText(f)}, none traced back to one of their quotes.`)
  // Imported delivery dates being estimates is said by the Deliveries tip and the "est." beside each such date.
  if (f.lowData && !p.importedOnly) out.push('With so few enquiries these are facts, not a pattern.')
  return out
}
