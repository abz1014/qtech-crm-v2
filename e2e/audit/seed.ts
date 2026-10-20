import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { karachiDay, must, rest } from '../support/stack'

/*
 * Realistic data for the screen audit (docs/audit/SCREEN_AUDIT.md). One small trading company's working month: ten customers,
 * six suppliers, a prospect, about twenty RFQs in every stage, a dozen orders in every state, invoices, payments, expenses,
 * targets and exchange rates. Everything goes in through the REST API as the fixture admin (Row Level Security applies), on the
 * local CI stack only (e2e/support/stack.ts never talks to anything else).
 *
 * Records are owned by all three fixture users, because Today routes every item to its owner: each role opens a Today with items.
 * Dates are relative to today in Karachi, so the same states (overdue, due soon, late goods) exist on every day the audit runs.
 *
 * The ids of the records each audited state needs are written to `<AUDIT_DIR>/seed.json`. A second run against the same database
 * (a local re-run, or a restarted worker) reuses them instead of seeding twice.
 */

export const USER = {
  admin: 'a0000000-0000-4000-8000-000000000001',
  sales: 'a0000000-0000-4000-8000-000000000002',
  engineer: 'a0000000-0000-4000-8000-000000000003',
} as const

export interface Fixture {
  rfq: { notSent: string; waiting: string; pricesIn: string; quoted: string; compare: string }
  order: { notPlaced: string; poIssued: string; delivered: string; invoiced: string; paid: string; multiLeg: string }
  company: { customer: string; supplier: string }
  intake: { customerName: string; paste: string }
}

type Id = { id: string }
const D = (n: number) => karachiDay(n)
const at = (n: number, hour = 10) => `${karachiDay(n)}T${String(hour).padStart(2, '0')}:00:00+05:00`

async function post<T = Id>(table: string, body: unknown): Promise<T> {
  return (await must(rest<T[]>('admin', table, { method: 'POST', body })))[0]
}
async function postMany<T = Id>(table: string, body: unknown[]): Promise<T[]> {
  return must(rest<T[]>('admin', table, { method: 'POST', body }))
}
async function patch(path: string, body: unknown): Promise<void> {
  await must(rest('admin', path, { method: 'PATCH', body, prefer: 'return=minimal' }))
}
async function rpc<T = unknown>(fn: string, body: unknown): Promise<T> {
  return must(rest<T>('admin', `rpc/${fn}`, { method: 'POST', body }))
}

/** A company by name; an existing one (a re-run on the same database) is reused rather than refused. */
async function company(name: string, extra: Record<string, unknown> = {}): Promise<Id & { name: string }> {
  const found = await must(rest<(Id & { name: string })[]>('admin', `companies?name=eq.${encodeURIComponent(name)}&select=id,name`))
  if (found[0]) return found[0]
  return post<Id & { name: string }>('companies', { name, ...extra })
}

async function brand(name: string): Promise<string> {
  const found = await must(rest<Id[]>('admin', `brands?name=eq.${encodeURIComponent(name)}&select=id`))
  return found[0]?.id ?? (await post('brands', { name, kind: 'brand' })).id
}

// ---------------------------------------------------------------- RFQs

interface ItemSpec {
  d: string
  qty: number
  unit?: string
  brand?: string
}
interface QuoteSpec {
  /** Item index. */
  i: number
  price: number
  lead?: string
  stock?: boolean
  origin?: string
}
interface InquirySpec {
  supplier: string
  currency: string
  sent?: number
  chased?: number
  noOffer?: number
  quotes?: QuoteSpec[]
}
interface RfqSpec {
  company: string
  owner: string
  received: number
  due?: number
  ref?: string
  priority?: boolean
  site?: string
  contact?: string
  items: ItemSpec[]
  inquiries?: InquirySpec[]
  /** Questions to the customer: asked `asked` days ago (unasked when absent), answered when `answer` is set. */
  questions?: { q: string; asked?: number; answer?: string }[]
  /** Selling prices per item and an issued quotation (issue_quotation). */
  quote?: number[]
  /** Bid sent without a stored quotation (an older RFQ). */
  quotedOn?: number
  closed?: { on: number; reason: string; note?: string }
}

async function makeRfq(s: RfqSpec, brands: Record<string, string>): Promise<{ id: string; items: string[] }> {
  const rfq = await post('rfqs', {
    company_id: s.company,
    owner_id: s.owner,
    received_on: D(s.received),
    due_on: s.due === undefined ? null : D(s.due),
    customer_ref: s.ref ?? null,
    is_priority: s.priority ?? false,
    site_id: s.site ?? null,
    contact_id: s.contact ?? null,
    quoted_on: s.quotedOn === undefined ? null : D(s.quotedOn),
    closed_on: s.closed ? D(s.closed.on) : null,
    close_reason: s.closed?.reason ?? null,
    close_note: s.closed?.note ?? null,
  })
  const items = await postMany<Id & { position: number }>(
    'rfq_items',
    s.items.map((it, position) => ({ rfq_id: rfq.id, position, description: it.d, qty: it.qty, unit: it.unit ?? 'nos', brand_id: it.brand ? brands[it.brand] : null })),
  )
  items.sort((a, b) => a.position - b.position)
  for (const inq of s.inquiries ?? []) {
    const row = await post('supplier_inquiries', {
      rfq_id: rfq.id,
      supplier_id: inq.supplier,
      sent_on: inq.sent === undefined ? null : D(inq.sent),
      last_chased_on: inq.chased === undefined ? null : D(inq.chased),
      chase_count: inq.chased === undefined ? 0 : 1,
      no_offer_on: inq.noOffer === undefined ? null : D(inq.noOffer),
    })
    if (inq.quotes?.length) {
      await postMany(
        'supplier_quote_lines',
        inq.quotes.map(q => ({
          inquiry_id: row.id,
          rfq_item_id: items[q.i].id,
          unit_price: q.price,
          currency: inq.currency,
          lead_time: q.lead ?? null,
          in_stock: q.stock ?? null,
          origin: q.origin ?? null,
        })),
      )
    }
  }
  for (const q of s.questions ?? []) {
    await post('clarifications', {
      rfq_id: rfq.id,
      question: q.q,
      first_asked_at: q.asked === undefined ? null : at(-q.asked),
      last_asked_at: q.asked === undefined ? null : at(-q.asked),
      ask_count: q.asked === undefined ? 0 : 1,
      answer: q.answer ?? null,
      answered_at: q.answer ? at(-Math.max(0, (q.asked ?? 1) - 1), 15) : null,
    })
  }
  if (s.quote) {
    for (let i = 0; i < items.length; i++) {
      await patch(`rfq_items?id=eq.${items[i].id}`, { quoted_unit_price_net: s.quote[i], quoted_lead_time: i === 0 ? '4 to 6 weeks' : 'Ex-stock Dubai, 2 weeks' })
    }
    await rpc('issue_quotation', {
      p_quotation_id: crypto.randomUUID(),
      p_rfq_id: rfq.id,
      p_delivery_text: 'DDP your site, Lahore',
      p_payment_terms: '50% advance, balance on delivery',
    })
  }
  return { id: rfq.id, items: items.map(i => i.id) }
}

// ---------------------------------------------------------------- orders

interface LegSpec {
  supplier: string
  currency: string
  placed?: number
  expected?: number
  received?: number
  delivered?: number
  /** Issue the supplier PO through issue_purchase_order (every goods line on the leg must have a supplier price). */
  po?: boolean
  reference?: string
}
interface LineSpec {
  d: string
  qty: number
  unit?: string
  price: number
  /** Index into `legs`; absent for a service line or a line not yet given to a supplier. */
  leg?: number
  cost?: number
  service?: boolean
  brand?: string
}
interface OrderSpec {
  company: string
  owner: string
  ordered: number
  terms?: number
  po?: string
  commissioning?: { planned?: number; done?: number }
  engineers?: string[]
  site?: string
  contact?: string
  legs: LegSpec[]
  lines: LineSpec[]
  invoices?: { number: string; on: number; share?: number; tcs?: number; psid?: string; deposited?: number }[]
  payments?: { on: number; amount: number | 'full'; ref?: string; via?: 'bank' | 'cash' }[]
  costs?: { expected: number; complete?: boolean }
  cancelled?: { on: number; reason: string }
}

async function makeOrder(s: OrderSpec, brands: Record<string, string>): Promise<{ id: string; legs: string[] }> {
  const order = await post('orders', {
    company_id: s.company,
    owner_id: s.owner,
    ordered_on: D(s.ordered),
    payment_terms_days: s.terms ?? 30,
    customer_po_number: s.po ?? null,
    needs_commissioning: Boolean(s.commissioning),
    commissioning_planned_on: s.commissioning?.planned === undefined ? null : D(s.commissioning.planned),
    commissioning_done_on: s.commissioning?.done === undefined ? null : D(s.commissioning.done),
    site_id: s.site ?? null,
    contact_id: s.contact ?? null,
  })
  const legs: string[] = []
  for (const l of s.legs) {
    legs.push(
      (
        await post('supplier_orders', {
          order_id: order.id,
          supplier_id: l.supplier,
          currency: l.currency,
          reference: l.reference ?? null,
          // A leg whose PO is issued gets placed_on from issue_purchase_order unless it is set here first.
          placed_on: l.placed === undefined ? null : D(l.placed),
          expected_on: l.expected === undefined ? null : D(l.expected),
          received_on: l.received === undefined ? null : D(l.received),
          delivered_on: l.delivered === undefined ? null : D(l.delivered),
        })
      ).id,
    )
  }
  await postMany(
    'order_items',
    s.lines.map((ln, position) => ({
      order_id: order.id,
      position,
      description: ln.d,
      qty: ln.qty,
      unit: ln.unit ?? (ln.service ? 'job' : 'nos'),
      unit_price_net: ln.price,
      is_service: ln.service ?? false,
      supplier_order_id: ln.leg === undefined ? null : legs[ln.leg],
      supplier_unit_price: ln.cost ?? null,
      brand_id: ln.brand ? brands[ln.brand] : null,
    })),
  )
  for (const e of s.engineers ?? []) await must(rest('admin', 'order_engineers', { method: 'POST', body: { order_id: order.id, user_id: e }, prefer: 'return=minimal' }))
  for (let i = 0; i < s.legs.length; i++) {
    if (!s.legs[i].po) continue
    await rpc('issue_purchase_order', {
      p_po_id: crypto.randomUUID(),
      p_supplier_order_id: legs[i],
      p_incoterm: 'DAP',
      p_delivery_terms: 'Air freight to Lahore, 3 to 4 weeks',
      p_payment_terms: '30% advance, balance before dispatch',
    })
  }
  const net = s.lines.reduce((a, l) => a + l.qty * l.price, 0)
  const gst = Math.round(net * 0.18)
  for (const inv of s.invoices ?? []) {
    const share = inv.share ?? 1
    await post('invoices', {
      order_id: order.id,
      number: inv.number,
      invoice_date: D(inv.on),
      net_amount: Math.round(net * share),
      gst_amount: Math.round(gst * share),
      tcs_sent_on: inv.tcs === undefined ? null : D(inv.tcs),
      psid: inv.psid ?? null,
      tax_deposited_on: inv.deposited === undefined ? null : D(inv.deposited),
      tax_deposit_amount: inv.deposited === undefined ? null : Math.round(gst * share),
    })
  }
  for (const p of s.payments ?? []) {
    await post('payments_in', {
      order_id: order.id,
      received_on: D(p.on),
      amount: p.amount === 'full' ? net + gst : p.amount,
      reference: p.ref ?? null,
      paid_via: p.via ?? 'bank',
    })
  }
  if (s.costs) {
    await post('order_costs', { order_id: order.id, expected_cost_pkr: s.costs.expected, ...(s.costs.complete ? { costs_complete_at: new Date().toISOString() } : {}) })
  }
  if (s.cancelled) await patch(`orders?id=eq.${order.id}`, { cancelled_on: D(s.cancelled.on), cancel_reason: s.cancelled.reason })
  return { id: order.id, legs }
}

// ---------------------------------------------------------------- the data set

async function seedAll(): Promise<Fixture> {
  const { admin: ADMIN, sales: SALES, engineer: ENG } = USER

  await patch('company_profile?id=eq.1', {
    legal_name: 'Q-Tech Solutions (Pvt) Ltd',
    address: 'Office 4, 2nd Floor, Gulberg III, Lahore 54660',
    phone: '+92 42 555 0138',
    ntn: '1234567-8',
    po_terms: '100% advance against proforma',
  })
  for (const r of [
    { currency: 'USD', rate_pkr: 280.5 },
    { currency: 'EUR', rate_pkr: 304.2 },
    { currency: 'GBP', rate_pkr: 356.8 },
    { currency: 'AED', rate_pkr: 76.4 },
    { currency: 'CNY', rate_pkr: 38.9 },
  ]) {
    await must(rest('admin', 'fx_rates?on_conflict=currency,as_of,source', { method: 'POST', body: { ...r, as_of: D(0), source: 'manual' }, prefer: 'resolution=merge-duplicates,return=minimal' }))
  }
  const q = Math.floor((Number(D(0).slice(5, 7)) - 1) / 3) + 1
  const year = Number(D(0).slice(0, 4))
  await must(
    rest('admin', 'targets?on_conflict=user_id,year,quarter', {
      method: 'POST',
      body: [
        { user_id: SALES, year, quarter: q, target_net_pkr: 15_000_000 },
        { user_id: ADMIN, year, quarter: q, target_net_pkr: 8_000_000 },
      ],
      prefer: 'resolution=merge-duplicates,return=minimal',
    }),
  )

  const B: Record<string, string> = {}
  for (const n of ['Endress+Hauser', 'Siemens', 'ABB', 'Yokogawa', 'Rosemount', 'VEGA', 'KROHNE', 'Danfoss']) B[n] = await brand(n)

  // Customers (Pakistan) and suppliers.
  const c = {
    indus: await company('Indus Cement Works', { country: 'Pakistan', city: 'Lahore' }),
    ravi: await company('Ravi Fertilizers Ltd', { country: 'Pakistan', city: 'Sheikhupura' }),
    margalla: await company('Margalla Chemicals', { country: 'Pakistan', city: 'Islamabad' }),
    krs: await company('Karachi Refinery Services', { country: 'Pakistan', city: 'Karachi' }),
    ptm: await company('Punjab Textile Mills', { country: 'Pakistan', city: 'Faisalabad' }),
    sgp: await company('Sindh Gas Pipelines', { country: 'Pakistan', city: 'Hyderabad' }),
    chenab: await company('Chenab Power Company', { country: 'Pakistan', city: 'Jhang' }),
    lpl: await company('Lahore Packaging Ltd', { country: 'Pakistan', city: 'Lahore' }),
    thar: await company('Thar Minerals Ltd', { country: 'Pakistan', city: 'Islamkot' }),
    potohar: await company('Potohar Sugar Mills', { country: 'Pakistan', city: 'Chakwal' }),
  }
  await company('Bolan Mining Co', { country: 'Pakistan', city: 'Quetta' }) // a prospect: no RFQ, no order
  const s = {
    dubai: await company('Dubai Instrumentation FZE', { country: 'United Arab Emirates', city: 'Dubai' }),
    rhein: await company('Rhein Automation GmbH', { country: 'Germany', city: 'Duisburg' }),
    shanghai: await company('Shanghai Flowtech Co', { country: 'China', city: 'Shanghai' }),
    midlands: await company('Midlands Valves Ltd', { country: 'United Kingdom', city: 'Birmingham' }),
    gulf: await company('Gulf Process Controls LLC', { country: 'United Arab Emirates', city: 'Sharjah' }),
    khi: await company('Karachi Instruments House', { country: 'Pakistan', city: 'Karachi' }),
  }
  const carries: [string, string[]][] = [
    [s.dubai.id, ['Endress+Hauser', 'Yokogawa']],
    [s.rhein.id, ['Siemens', 'KROHNE', 'VEGA']],
    [s.shanghai.id, ['KROHNE', 'ABB']],
    [s.midlands.id, ['Rosemount', 'Danfoss']],
    [s.gulf.id, ['Endress+Hauser', 'Siemens', 'ABB']],
    [s.khi.id, ['Danfoss', 'ABB']],
  ]
  await must(
    rest('admin', 'company_brands?on_conflict=company_id,brand_id', {
      method: 'POST',
      body: carries.flatMap(([id, names]) => names.map(n => ({ company_id: id, brand_id: B[n] }))),
      prefer: 'resolution=ignore-duplicates,return=minimal',
    }),
  )

  const site = async (companyId: string, name: string, address: string) => (await post('company_sites', { company_id: companyId, name, address })).id
  const contact = async (companyId: string, name: string, siteId: string | null, phone: string, email: string) =>
    (await post('contacts', { company_id: companyId, site_id: siteId, name, phone, email })).id
  const indusPlant = await site(c.indus.id, 'Plant 2, Kalar Kahar', 'Kalar Kahar Road, District Chakwal')
  const indusHead = await site(c.indus.id, 'Head office', '12-B Main Boulevard, Gulberg II, Lahore')
  const kamran = await contact(c.indus.id, 'Kamran Zafar', indusPlant, '+92 300 1112233', 'kamran.zafar@example.com')
  await contact(c.indus.id, 'Ayesha Malik', indusHead, '+92 321 4455667', 'ayesha.malik@example.com')
  const raviSite = await site(c.ravi.id, 'Urea plant', 'Sheikhupura Industrial Estate')
  const imran = await contact(c.ravi.id, 'Imran Qureshi', raviSite, '+92 333 7788990', 'imran.qureshi@example.com')
  const krsSite = await site(c.krs.id, 'Korangi terminal', 'Plot 7, Korangi Creek, Karachi')
  const sana = await contact(c.krs.id, 'Sana Hussain', krsSite, '+92 302 5566778', 'sana.hussain@example.com')
  const chenabSite = await site(c.chenab.id, 'Jhang power station', 'Jhang-Chiniot Road, Jhang')
  const bilal = await contact(c.chenab.id, 'Bilal Ahmed', chenabSite, '+92 345 2233445', 'bilal.ahmed@example.com')
  await contact(c.ptm.id, 'Usman Tariq', null, '+92 300 9988776', 'usman.tariq@example.com')
  await contact(c.thar.id, 'Rahim Bux', null, '+92 301 3344556', 'rahim.bux@example.com')
  await contact(s.dubai.id, 'Rashid Al Mansoori', await site(s.dubai.id, 'Jebel Ali office', 'Office 14, Block C, Jebel Ali Free Zone'), '+971 4 555 0192', 'sales@example.ae')
  await contact(s.rhein.id, 'Jonas Becker', null, '+49 203 555 0144', 'j.becker@example.de')
  await contact(s.shanghai.id, 'Li Wei', null, '+86 21 5555 0108', 'li.wei@example.cn')
  await contact(s.midlands.id, 'Oliver Grant', null, '+44 121 555 0175', 'o.grant@example.co.uk')
  await contact(s.gulf.id, 'Faisal Rahman', null, '+971 6 555 0123', 'faisal@example.ae')
  await contact(s.khi.id, 'Asif Iqbal', null, '+92 21 3555 0161', 'asif.iqbal@example.com')

  // ------------------------------------------------------------ RFQs in every stage
  const rfqNotSent = await makeRfq(
    {
      company: c.ravi.id,
      owner: SALES,
      received: -1,
      due: 5,
      ref: 'RFF/PUR/2611',
      site: raviSite,
      contact: imran,
      items: [
        { d: 'Endress+Hauser Promag 10W electromagnetic flow meter DN100', qty: 2, brand: 'Endress+Hauser' },
        { d: 'Siemens SITRANS P DS III pressure transmitter 0-16 bar', qty: 4, brand: 'Siemens' },
        { d: 'VEGA VEGAPULS 21 radar level sensor', qty: 1, brand: 'VEGA' },
      ],
    },
    B,
  )
  const rfqWaiting = await makeRfq(
    {
      company: c.krs.id,
      owner: SALES,
      received: -5,
      due: 7,
      ref: 'KRS-MM-0457',
      site: krsSite,
      contact: sana,
      items: [
        { d: 'Rosemount 3051CD differential pressure transmitter', qty: 3, brand: 'Rosemount' },
        { d: 'Rosemount 644 temperature transmitter, head mount', qty: 6, brand: 'Rosemount' },
        { d: 'Danfoss MBS 3000 pressure transmitter 0-25 bar', qty: 10, brand: 'Danfoss' },
      ],
      inquiries: [
        { supplier: s.midlands.id, currency: 'GBP', sent: -4 },
        { supplier: s.gulf.id, currency: 'AED', sent: -4 },
        { supplier: s.khi.id, currency: 'PKR', sent: -3 },
      ],
      questions: [{ q: 'Which flange rating do you need on the 3051CD, ANSI 150 or 300?', asked: 4 }],
    },
    B,
  )
  const rfqPrices = await makeRfq(
    {
      company: c.ptm.id,
      owner: SALES,
      received: -8,
      due: 2,
      ref: 'PTM/ENG/88',
      items: [
        { d: 'ABB AquaMaster 4 electromagnetic flow meter DN80', qty: 2, brand: 'ABB' },
        { d: 'ABB 266 pressure transmitter, 0-10 bar', qty: 5, brand: 'ABB' },
        { d: 'Danfoss VLT FC-102 drive, 15 kW', qty: 1, brand: 'Danfoss' },
      ],
      inquiries: [
        {
          supplier: s.gulf.id,
          currency: 'AED',
          sent: -6,
          quotes: [
            { i: 0, price: 9850, lead: '3 weeks', origin: 'Germany' },
            { i: 1, price: 2140, lead: '2 weeks', stock: true },
          ],
        },
        {
          supplier: s.khi.id,
          currency: 'PKR',
          sent: -6,
          quotes: [
            { i: 0, price: 742000, lead: '5 weeks' },
            { i: 1, price: 168500, lead: 'Ex-stock', stock: true },
            { i: 2, price: 1185000, lead: '4 weeks' },
          ],
        },
        { supplier: s.shanghai.id, currency: 'USD', sent: -6, quotes: [{ i: 0, price: 2490, lead: '6 weeks', origin: 'China' }] },
      ],
    },
    B,
  )
  const rfqQuoted = await makeRfq(
    {
      company: c.indus.id,
      owner: SALES,
      received: -12,
      due: -1,
      ref: 'ICW/KK/2026/114',
      site: indusPlant,
      contact: kamran,
      items: [
        { d: 'Endress+Hauser Liquiphant FTL51 level switch', qty: 6, brand: 'Endress+Hauser' },
        { d: 'Yokogawa EJA110E differential pressure transmitter', qty: 2, brand: 'Yokogawa' },
      ],
      inquiries: [
        {
          supplier: s.dubai.id,
          currency: 'USD',
          sent: -10,
          quotes: [
            { i: 0, price: 612, lead: '4 to 6 weeks' },
            { i: 1, price: 1385, lead: '2 weeks', stock: true },
          ],
        },
        { supplier: s.gulf.id, currency: 'AED', sent: -10, quotes: [{ i: 0, price: 2390, lead: '3 weeks' }] },
      ],
      quote: [212000, 468000],
    },
    B,
  )
  const rfqCompare = await makeRfq(
    {
      company: c.chenab.id,
      owner: SALES,
      received: -6,
      due: 3,
      ref: 'CPC/INST/302',
      site: chenabSite,
      contact: bilal,
      items: [
        { d: 'KROHNE OPTIFLUX 4300 electromagnetic flow meter DN150', qty: 2, brand: 'KROHNE' },
        { d: 'Siemens SITRANS LR250 radar level transmitter', qty: 3, brand: 'Siemens' },
      ],
      inquiries: [
        {
          supplier: s.rhein.id,
          currency: 'EUR',
          sent: -5,
          quotes: [
            { i: 0, price: 3640, lead: '5 weeks', origin: 'Netherlands' },
            { i: 1, price: 2280, lead: '3 weeks', origin: 'Germany' },
          ],
        },
        {
          supplier: s.shanghai.id,
          currency: 'USD',
          sent: -5,
          quotes: [
            { i: 0, price: 3890, lead: '7 weeks', origin: 'China' },
            { i: 1, price: 2410, lead: '6 weeks' },
          ],
        },
        {
          supplier: s.gulf.id,
          currency: 'AED',
          sent: -5,
          quotes: [
            { i: 0, price: 14600, lead: '4 weeks', stock: false },
            { i: 1, price: 9050, lead: 'Ex-stock Sharjah', stock: true },
          ],
        },
        { supplier: s.dubai.id, currency: 'USD', sent: -5, quotes: [{ i: 1, price: 2395, lead: '2 weeks', stock: true }] },
      ],
    },
    B,
  )

  // More open RFQs, so the lists and Today look like a normal week. Owners spread over all three users.
  const open: RfqSpec[] = [
    {
      company: c.thar.id,
      owner: ENG,
      received: -2,
      due: 9,
      ref: 'TML-PR-019',
      items: [
        { d: 'ABB TZIDC positioner for control valve', qty: 4, brand: 'ABB' },
        { d: 'Danfoss AKS 33 pressure transmitter', qty: 6, brand: 'Danfoss' },
      ],
    },
    {
      company: c.potohar.id,
      owner: ENG,
      received: -7,
      due: 6,
      items: [{ d: 'Siemens SITRANS FM MAG 5100 W flow sensor DN200', qty: 1, brand: 'Siemens' }],
      inquiries: [{ supplier: s.rhein.id, currency: 'EUR', sent: -5 }],
    },
    {
      company: c.margalla.id,
      owner: ADMIN,
      received: -9,
      due: -1,
      priority: true,
      ref: 'MC/2026/77',
      items: [
        { d: 'Yokogawa ROTAMASS TI Coriolis flow meter', qty: 1, brand: 'Yokogawa' },
        { d: 'Endress+Hauser Memosens CPS11E pH sensor', qty: 8, brand: 'Endress+Hauser' },
      ],
      inquiries: [{ supplier: s.dubai.id, currency: 'USD', sent: -7, chased: -3, quotes: [{ i: 1, price: 214, lead: '2 weeks' }] }],
      questions: [{ q: 'Is the Coriolis meter for custody transfer?', asked: 6, answer: 'No, process control only.' }],
    },
    {
      company: c.sgp.id,
      owner: ADMIN,
      received: -10,
      due: 12,
      items: [{ d: 'Rosemount 5300 guided wave radar', qty: 2, brand: 'Rosemount' }],
      inquiries: [
        { supplier: s.midlands.id, currency: 'GBP', sent: -9, noOffer: -2 },
        { supplier: s.rhein.id, currency: 'EUR', sent: -8 },
      ],
    },
    {
      company: c.lpl.id,
      owner: SALES,
      received: 0,
      due: 14,
      ref: 'LPL-MNT-301',
      items: [
        { d: 'Danfoss VLT Micro Drive FC 51, 2.2 kW', qty: 3, brand: 'Danfoss' },
        { d: 'ABB ACS580 drive, 7.5 kW', qty: 2, brand: 'ABB' },
      ],
    },
    {
      company: c.indus.id,
      owner: SALES,
      received: -3,
      due: 10,
      site: indusHead,
      items: [{ d: 'VEGA VEGABAR 82 pressure transmitter', qty: 5, brand: 'VEGA' }],
      questions: [{ q: 'Power supply: 24 V DC or 230 V AC?' }],
    },
    {
      company: c.ravi.id,
      owner: ADMIN,
      received: -15,
      due: 4,
      quotedOn: -3,
      items: [{ d: 'Endress+Hauser Prosonic FMU90 transmitter', qty: 2, brand: 'Endress+Hauser' }],
      inquiries: [{ supplier: s.dubai.id, currency: 'USD', sent: -13, quotes: [{ i: 0, price: 1490, lead: '3 weeks' }] }],
    },
    {
      company: c.chenab.id,
      owner: ENG,
      received: -4,
      due: 8,
      items: [{ d: 'ABB TTF300 temperature transmitter', qty: 12, brand: 'ABB' }],
      inquiries: [{ supplier: s.khi.id, currency: 'PKR', sent: -3, quotes: [{ i: 0, price: 96500, lead: 'Ex-stock', stock: true }] }],
    },
  ]
  for (const r of open) await makeRfq(r, B)

  // Closed RFQs, with the reasons a month brings.
  const closed: [string, string, number, string][] = [
    [c.krs.id, SALES, -6, 'price'],
    [c.margalla.id, ADMIN, -11, 'competitor'],
    [c.ptm.id, SALES, -14, 'customer_cancelled'],
    [c.sgp.id, ENG, -20, 'could_not_source'],
    [c.lpl.id, SALES, -23, 'we_were_late'],
    [c.potohar.id, ADMIN, -27, 'no_reply_to_clarification'],
    [c.indus.id, SALES, -33, 'price'],
    [c.ravi.id, SALES, -38, 'competitor'],
  ]
  for (const [companyId, owner, on, reason] of closed) {
    await makeRfq(
      {
        company: companyId,
        owner,
        received: on - 12,
        due: on - 2,
        quotedOn: reason === 'could_not_source' || reason === 'no_reply_to_clarification' ? undefined : on - 5,
        items: [{ d: 'Yokogawa YTA610 temperature transmitter', qty: 4, brand: 'Yokogawa' }],
        closed: { on, reason },
      },
      B,
    )
  }

  // ------------------------------------------------------------ orders in every state
  const notPlaced = await makeOrder(
    {
      company: c.ravi.id,
      owner: SALES,
      ordered: -2,
      po: 'RFF-PO-88213',
      site: raviSite,
      contact: imran,
      legs: [{ supplier: s.dubai.id, currency: 'USD' }],
      lines: [
        { d: 'Endress+Hauser Promag 10W electromagnetic flow meter DN80', qty: 2, price: 485000, leg: 0, brand: 'Endress+Hauser' },
        { d: 'Endress+Hauser Cerabar PMC51 pressure transmitter', qty: 3, price: 187400, leg: 0, brand: 'Endress+Hauser' },
      ],
    },
    B,
  )
  const poIssued = await makeOrder(
    {
      company: c.krs.id,
      owner: SALES,
      ordered: -9,
      po: 'KRS/PO/2026/0911',
      site: krsSite,
      contact: sana,
      legs: [{ supplier: s.rhein.id, currency: 'EUR', placed: -7, expected: 18, po: true }],
      lines: [
        { d: 'Siemens SITRANS LR250 radar level transmitter', qty: 2, price: 845000, leg: 0, cost: 2280, brand: 'Siemens' },
        { d: 'KROHNE OPTIFLUX 2100 flow meter DN50', qty: 1, price: 1210000, leg: 0, cost: 3150, brand: 'KROHNE' },
      ],
      payments: [{ on: -6, amount: 900000, ref: 'IBFT 77812 advance' }],
    },
    B,
  )
  const delivered = await makeOrder(
    {
      company: c.ptm.id,
      owner: SALES,
      ordered: -35,
      po: 'PTM-4471',
      legs: [{ supplier: s.dubai.id, currency: 'USD', placed: -33, expected: -12, received: -9, delivered: -6, reference: 'DI-SO-20931' }],
      lines: [
        { d: 'Yokogawa EJA530E gauge pressure transmitter', qty: 4, price: 236000, leg: 0, cost: 690, brand: 'Yokogawa' },
        { d: 'Endress+Hauser Liquiphant FTL31 level switch', qty: 6, price: 61500, leg: 0, cost: 158, brand: 'Endress+Hauser' },
      ],
      costs: { expected: 1_120_000 },
    },
    B,
  )
  const invoiced = await makeOrder(
    {
      company: c.indus.id,
      owner: SALES,
      ordered: -50,
      po: 'ICW-PO-55120',
      site: indusPlant,
      contact: kamran,
      legs: [{ supplier: s.gulf.id, currency: 'AED', placed: -48, expected: -26, received: -24, delivered: -21 }],
      lines: [
        { d: 'ABB AquaMaster 4 electromagnetic flow meter DN100', qty: 2, price: 655000, leg: 0, cost: 10400, brand: 'ABB' },
        { d: 'ABB 266 pressure transmitter, 0-16 bar', qty: 4, price: 148000, leg: 0, cost: 2180, brand: 'ABB' },
      ],
      invoices: [{ number: 'INV-0108', on: -18 }],
      costs: { expected: 2_250_000 },
    },
    B,
  )
  const paid = await makeOrder(
    {
      company: c.lpl.id,
      owner: ADMIN,
      ordered: -70,
      po: 'LPL/2026/118',
      legs: [{ supplier: s.dubai.id, currency: 'USD', placed: -68, expected: -50, received: -48, delivered: -45, po: true }],
      lines: [
        { d: 'Endress+Hauser Promag 10W electromagnetic flow meter DN100', qty: 1, price: 512000, leg: 0, cost: 1520, brand: 'Endress+Hauser' },
        { d: 'Siemens SITRANS P DS III pressure transmitter 0-16 bar', qty: 2, price: 192000, leg: 0, cost: 560, brand: 'Siemens' },
      ],
      invoices: [{ number: 'INV-0101', on: -44, tcs: -40, psid: '1203260012345', deposited: -30 }],
      payments: [{ on: -14, amount: 'full', ref: 'Cheque 004518' }],
      costs: { expected: 640_000, complete: true },
    },
    B,
  )
  const multiLeg = await makeOrder(
    {
      company: c.chenab.id,
      owner: ADMIN,
      ordered: -20,
      po: 'CPC/PO/INST/2219',
      site: chenabSite,
      contact: bilal,
      commissioning: { planned: 6 },
      engineers: [ENG],
      legs: [
        { supplier: s.rhein.id, currency: 'EUR', placed: -18, expected: 5, po: true },
        { supplier: s.midlands.id, currency: 'GBP' },
        { supplier: s.khi.id, currency: 'PKR', placed: -15, expected: -5, received: -4, delivered: -3, reference: 'KIH-DN-7781' },
      ],
      lines: [
        { d: 'KROHNE OPTIFLUX 4300 electromagnetic flow meter DN150', qty: 2, price: 1360000, leg: 0, cost: 3640, brand: 'KROHNE' },
        { d: 'Siemens SITRANS LR250 radar level transmitter', qty: 3, price: 812000, leg: 0, cost: 2280, brand: 'Siemens' },
        { d: 'Rosemount 3051S coplanar pressure transmitter', qty: 4, price: 498000, leg: 1, brand: 'Rosemount' },
        { d: 'Danfoss MBT 5250 temperature sensor', qty: 10, price: 38500, leg: 2, cost: 24800, brand: 'Danfoss' },
        { d: 'ABB TTF300 temperature transmitter', qty: 10, price: 96500, leg: 2, cost: 71000, brand: 'ABB' },
        { d: 'Installation supervision and commissioning, 3 days', qty: 1, price: 450000, service: true },
      ],
      payments: [{ on: -19, amount: 3_500_000, ref: 'Advance, IBFT 99102' }],
      costs: { expected: 6_350_000 },
    },
    B,
  )

  // More orders for the lists, Today and Money.
  await makeOrder(
    {
      company: c.thar.id,
      owner: ENG,
      ordered: -25,
      engineers: [ENG],
      legs: [{ supplier: s.shanghai.id, currency: 'USD', placed: -24, expected: -4, reference: 'SF-2026-0331' }],
      lines: [{ d: 'KROHNE OPTISONIC 3400 ultrasonic flow meter DN250', qty: 1, price: 1640000, leg: 0, cost: 4480, brand: 'KROHNE' }],
    },
    B,
  )
  await makeOrder(
    {
      company: c.potohar.id,
      owner: ENG,
      ordered: -3,
      engineers: [ENG],
      legs: [{ supplier: s.khi.id, currency: 'PKR' }],
      lines: [{ d: 'Danfoss VLT AQUA Drive FC 202, 22 kW', qty: 1, price: 1185000, leg: 0, brand: 'Danfoss' }],
    },
    B,
  )
  await makeOrder(
    {
      company: c.sgp.id,
      owner: SALES,
      ordered: -60,
      po: 'SGP-HYD-2201',
      legs: [{ supplier: s.midlands.id, currency: 'GBP', placed: -58, expected: -40, received: -38, delivered: -36 }],
      lines: [{ d: 'Rosemount 3144P temperature transmitter', qty: 8, price: 172000, leg: 0, cost: 410, brand: 'Rosemount' }],
      invoices: [{ number: 'INV-0103', on: -50, tcs: -45 }],
      payments: [{ on: -20, amount: 600_000, ref: 'IBFT 55102 part' }],
      costs: { expected: 1_190_000, complete: true },
    },
    B,
  )
  await makeOrder(
    {
      company: c.margalla.id,
      owner: ADMIN,
      ordered: -90,
      commissioning: { planned: -62, done: -60 },
      engineers: [ENG],
      legs: [{ supplier: s.gulf.id, currency: 'AED', placed: -88, expected: -70, received: -68, delivered: -66 }],
      lines: [
        { d: 'Endress+Hauser Proline Promass F 300 Coriolis meter', qty: 1, price: 2350000, leg: 0, cost: 21500, brand: 'Endress+Hauser' },
        { d: 'Commissioning and loop check', qty: 1, price: 135000, service: true },
      ],
      invoices: [{ number: 'INV-0102', on: -58, tcs: -55, psid: '1203260011987', deposited: -40 }],
      payments: [{ on: -30, amount: 'full', ref: 'IBFT 41120' }],
      costs: { expected: 1_780_000, complete: true },
    },
    B,
  )
  await makeOrder(
    {
      company: c.indus.id,
      owner: SALES,
      ordered: -12,
      po: 'ICW-PO-55301',
      legs: [{ supplier: s.dubai.id, currency: 'USD', placed: -10, expected: 11, po: true }],
      lines: [{ d: 'Endress+Hauser Liquiphant FTL51 level switch', qty: 6, price: 212000, leg: 0, cost: 612, brand: 'Endress+Hauser' }],
    },
    B,
  )
  await makeOrder(
    {
      company: c.ravi.id,
      owner: SALES,
      ordered: -40,
      legs: [{ supplier: s.rhein.id, currency: 'EUR' }],
      lines: [{ d: 'VEGA VEGAFLEX 81 guided wave radar', qty: 2, price: 390000, leg: 0, brand: 'VEGA' }],
      cancelled: { on: -30, reason: 'customer_cancelled' },
    },
    B,
  )
  await makeOrder(
    {
      company: c.krs.id,
      owner: SALES,
      ordered: -46,
      legs: [{ supplier: s.gulf.id, currency: 'AED', placed: -44, expected: -30, received: -29, delivered: -28 }],
      lines: [{ d: 'Siemens SITRANS T3K PA temperature transmitter', qty: 12, price: 78500, leg: 0, cost: 980, brand: 'Siemens' }],
      invoices: [{ number: 'INV-0104', on: -27 }],
      payments: [{ on: -5, amount: 'full', ref: 'IBFT 61833' }],
      costs: { expected: 405_000, complete: true },
    },
    B,
  )

  // Expenses over this month and the last: overheads, cash spends and order costs.
  const CAT = (n: number) => `ca7e0000-0000-4000-8000-${String(n).padStart(12, '0')}`
  // PostgREST takes a bulk insert only when every row has the same keys: the optional links are always present.
  const ex = (days: number, cat: number, amount: number, description: string, via: 'bank' | 'cash', links: { order_id?: string; supplier_order_id?: string; payee_id?: string } = {}) => ({
    paid_on: D(days),
    category_id: CAT(cat),
    amount_pkr: amount,
    description,
    paid_via: via,
    order_id: links.order_id ?? null,
    supplier_order_id: links.supplier_order_id ?? null,
    payee_id: links.payee_id ?? null,
  })
  await postMany('expenses', [
    ex(-1, 5, 4350, 'Tea, milk and biscuits', 'cash'),
    ex(-2, 4, 12500, 'Fuel, site visit to Kalar Kahar', 'cash'),
    ex(-3, 6, 1850, 'TCS courier to Karachi', 'cash'),
    ex(-4, 12, 86000, 'DHL air freight, Dubai to Lahore', 'bank', { order_id: delivered.id, supplier_order_id: delivered.legs[0] }),
    ex(-5, 13, 42000, 'Customs clearing, Lahore dry port', 'bank', { order_id: delivered.id, supplier_order_id: delivered.legs[0] }),
    ex(-6, 3, 38450, 'LESCO electricity bill', 'bank'),
    ex(-8, 11, 1_250_000, 'Advance to Rhein Automation, 30%', 'bank', { order_id: multiLeg.id, supplier_order_id: multiLeg.legs[0], payee_id: s.rhein.id }),
    ex(-9, 8, 3200, 'IBFT and LC charges', 'bank'),
    ex(-10, 7, 9500, 'AC service, office', 'cash'),
    ex(-12, 14, 18000, 'Engineer travel to Jhang', 'cash', { order_id: multiLeg.id }),
    ex(-15, 2, 180000, 'Office rent, Gulberg', 'bank'),
    ex(-18, 1, 685000, 'Salaries', 'bank'),
    ex(-33, 2, 180000, 'Office rent, Gulberg', 'bank'),
    ex(-36, 3, 41200, 'LESCO electricity bill', 'bank'),
    ex(-40, 11, 1_480_000, 'Payment to Dubai Instrumentation', 'bank', { order_id: paid.id, supplier_order_id: paid.legs[0], payee_id: s.dubai.id }),
    ex(-47, 1, 685000, 'Salaries', 'bank'),
  ])

  return {
    rfq: { notSent: rfqNotSent.id, waiting: rfqWaiting.id, pricesIn: rfqPrices.id, quoted: rfqQuoted.id, compare: rfqCompare.id },
    order: { notPlaced: notPlaced.id, poIssued: poIssued.id, delivered: delivered.id, invoiced: invoiced.id, paid: paid.id, multiLeg: multiLeg.id },
    company: { customer: c.indus.id, supplier: s.dubai.id },
    intake: {
      customerName: c.lpl.name,
      paste: [
        'Dear Sir, please quote your best price and delivery for the following:',
        '1) Endress+Hauser Promag 10W electromagnetic flow meter DN100 - 2 nos',
        '2) Siemens SITRANS P DS III pressure transmitter 0-16 bar x 3',
        '3) VEGA VEGAPULS 21 radar level sensor - 1 no',
        'Regards, Procurement, Lahore Packaging Ltd',
      ].join('\n'),
    },
  }
}

/** Seeds once per database; a later call (same AUDIT_DIR, the RFQ still there) returns the saved ids. */
export async function seedAudit(file: string): Promise<Fixture> {
  if (existsSync(file)) {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as Fixture
    const still = await rest<Id[]>('admin', `rfqs?id=eq.${saved.rfq.notSent}&select=id`)
    if (still.status === 200 && still.body.length === 1) return saved
  }
  const fx = await seedAll()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(fx, null, 2))
  return fx
}
