import type { StepTone } from '@/lib/status'

/*
 * "Next step" of a job in plain words, from the stage the database reports (v_jobs.stage, stage_detail). Words only: no amount.
 * An engineer's words never mention invoices or payments ("Handled by the office"). `to` is where the one green button of the
 * read-only job page goes (the action on the old RFQ or order page) until the actions move onto the job page (P5-D1, P5-D2).
 */
export type Who = 'admin' | 'sales' | 'engineer'

export interface JobNext {
  text: string
  tone: StepTone
  /** The button label on the job page; null when there is nothing to do. */
  button: string | null
  /** Which old page the button opens. */
  on: 'rfq' | 'order' | null
  /** The query string that opens the right dialog there (the old pages read ?issue=1 and ?won=1). */
  query?: string
}

export interface NextInput {
  stage: string | null
  stageDetail: string | null
  role: Who
}

const has = (d: string | null, word: string) => (d ?? '').includes(word)

export function jobNext({ stage, stageDetail: d, role }: NextInput): JobNext {
  const office = role === 'engineer'
  switch (stage) {
    case 'enquiry':
      return { text: 'Ask the suppliers for prices', tone: 'now', button: 'Ask suppliers', on: 'rfq' }
    case 'asking_suppliers':
      return { text: `Waiting for supplier prices${d ? ` (${d})` : ''}`, tone: 'waiting', button: 'Open the enquiry', on: 'rfq' }
    case 'prices_in':
      return { text: 'Prices are in: send the quotation', tone: 'now', button: office ? null : 'Send quotation', on: office ? null : 'rfq', query: 'issue=1' }
    case 'quoted':
      return has(d, 'expired')
        ? { text: 'The quotation has expired: ask the customer', tone: 'late', button: office ? null : 'Open the enquiry', on: office ? null : 'rfq' }
        : { text: 'Waiting for the customer to order', tone: 'waiting', button: office ? null : 'Mark won', on: office ? null : 'rfq', query: 'won=1' }
    case 'ordered':
      return { text: has(d, 'to source') ? 'Choose a supplier for the items' : 'Place the supplier order', tone: 'now', button: 'Open the order', on: 'order' }
    case 'supplier_ordered':
      if (has(d, 'late')) return { text: 'The goods are late: chase the supplier', tone: 'late', button: 'Open the order', on: 'order' }
      if (has(d, 'arrived')) return { text: 'The goods are here: deliver them', tone: 'now', button: 'Open the order', on: 'order' }
      return { text: 'Waiting for the goods', tone: 'waiting', button: 'Open the order', on: 'order' }
    case 'delivered':
      if (office) return has(d, 'installation to plan') ? { text: 'Installation needs a date', tone: 'now', button: 'Open the order', on: 'order' } : { text: has(d, 'installation planned') ? 'Installation is planned' : 'Delivered. The office takes it from here', tone: 'inert', button: null, on: null }
      return { text: has(d, 'not invoiced') ? 'Delivered: send the invoice' : 'Invoice the rest', tone: 'now', button: 'Open the order', on: 'order' }
    case 'invoiced':
      if (office) return { text: 'Handled by the office', tone: 'inert', button: null, on: null }
      return { text: has(d, 'part paid') ? 'Part paid: chase the balance' : 'Invoiced: chase the payment', tone: 'waiting', button: 'Open the order', on: 'order' }
    case 'paid':
      return has(d, 'installation to plan')
        ? { text: 'Paid. Installation still needs a date', tone: 'now', button: 'Open the order', on: 'order' }
        : { text: has(d, 'installation planned') ? 'Paid. Installation is planned' : 'Done', tone: 'done', button: null, on: null }
    case 'lost':
      return { text: 'Closed without an order', tone: 'inert', button: null, on: null }
    case 'cancelled':
      return { text: has(d, 'money still open') ? 'Cancelled, with money still open' : 'Cancelled', tone: has(d, 'money still open') ? 'now' : 'inert', button: null, on: null }
    default:
      return { text: '', tone: 'inert', button: null, on: null }
  }
}
