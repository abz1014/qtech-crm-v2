import { createCompany, createRfq, karachiDay, must, orderRef, rest, rfqRef, uniqueName } from './stack'

/*
 * Helpers for the Archive specs (0141). The setting archive_settings is ONE row for the whole database, so a spec that switches it on
 * must switch it off again (afterEach), and the archive project runs one worker, in order. Dates are relative to the business day the
 * stack is running on, so the specs do not depend on the calendar: the cutoff is 5 days back, "old" records are 12 days back (before the
 * cutoff, so hidden when archiving is on) and "new" ones are yesterday (on or after it, so always listed).
 */
export const CUTOFF = (): string => karachiDay(-5)
export const OLD_DAY = (): string => karachiDay(-12)
export const NEW_DAY = (): string => karachiDay(-1)

export const ADMIN_ID = 'a0000000-0000-4000-8000-000000000001'
export const SALES_ID = 'a0000000-0000-4000-8000-000000000002'

/** archive_set as the admin fixture user, through REST: switch archiving on (with a cutoff) or off. */
export async function setArchive(enabled: boolean, cutoff: string | null = CUTOFF()): Promise<void> {
  await must(rest('admin', 'rpc/archive_set', { method: 'POST', body: { p_enabled: enabled, p_cutoff: cutoff } }))
}

export const archiveOn = (cutoff: string = CUTOFF()): Promise<void> => setArchive(true, cutoff)
export const archiveOff = (): Promise<void> => setArchive(false, CUTOFF())

export interface ArchiveFixture {
  tag: string
  company: { id: string; name: string }
  /** An RFQ received before the cutoff, with no order: its job is "Job <number>". */
  oldRfq: { id: string; number: number; ref: string }
  /** An RFQ received after the cutoff. */
  newRfq: { id: string; number: number; ref: string }
  /** Orders with no RFQ ("Job O-<number>"), one dated before the cutoff and one after it, each with a line and an invoice. */
  oldOrder: { id: string; number: number; invoiceId: string; invoiceNumber: string }
  newOrder: { id: string; number: number; invoiceId: string; invoiceNumber: string }
  /** One payment on each order, dated like the order. */
  oldPaid: { amount: number }
  newPaid: { amount: number }
}

async function order(companyId: string, tag: string, day: string, owner: string, label: string, net: number) {
  const [o] = await must(rest<{ id: string; number: number }[]>('admin', 'orders', { method: 'POST', body: { company_id: companyId, owner_id: owner, ordered_on: day, payment_terms_days: 30 } }))
  await must(rest('admin', 'order_items', { method: 'POST', body: { order_id: o.id, position: 0, description: `Flow meter ${tag}`, qty: 1, unit_price_net: net, gst_rate: 18 }, prefer: 'return=minimal' }))
  const invoiceNumber = `AR-${label}-${tag}`.toUpperCase()
  const [inv] = await must(rest<{ id: string }[]>('admin', 'invoices', { method: 'POST', body: { order_id: o.id, number: invoiceNumber, invoice_date: day, net_amount: net, gst_amount: net * 0.18 } }))
  const amount = 1000 + net / 1000
  await must(rest('admin', 'payments_in', { method: 'POST', body: { order_id: o.id, amount, received_on: day }, prefer: 'return=minimal' }))
  return { id: o.id, number: o.number, invoiceId: inv.id, invoiceNumber, paid: { amount } }
}

/** One company with an old and a new RFQ job, and an old and a new order job (each with an invoice and a payment). Unique names. */
export async function seedArchive(owner: string = ADMIN_ID): Promise<ArchiveFixture> {
  const tag = Math.random().toString(36).slice(2, 7).toUpperCase()
  const company = await createCompany(uniqueName(`Arch${tag} Works`), { invoice_address: 'Plot 1, Korangi, Karachi', sales_tax_registered: false })
  const oldRef = `ENQ-OLD-${tag}`
  const newRef = `ENQ-NEW-${tag}`
  const oldRfq = await createRfq(company.id, { owner_id: owner, received_on: OLD_DAY(), customer_ref: oldRef })
  const newRfq = await createRfq(company.id, { owner_id: owner, received_on: NEW_DAY(), customer_ref: newRef })
  const o = await order(company.id, tag, OLD_DAY(), owner, 'OLD', 200000)
  const n = await order(company.id, tag, NEW_DAY(), owner, 'NEW', 300000)
  return {
    tag,
    company,
    oldRfq: { ...oldRfq, ref: oldRef },
    newRfq: { ...newRfq, ref: newRef },
    oldOrder: { id: o.id, number: o.number, invoiceId: o.invoiceId, invoiceNumber: o.invoiceNumber },
    newOrder: { id: n.id, number: n.number, invoiceId: n.invoiceId, invoiceNumber: n.invoiceNumber },
    oldPaid: o.paid,
    newPaid: n.paid,
  }
}

/** Job row names on the Jobs list. */
export const jobRowName = {
  rfq: (n: number) => new RegExp(String.raw`${rfqRef(n)}\b`),
  order: (n: number) => new RegExp(String.raw`${orderRef(n)}\b`),
}
