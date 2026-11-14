import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { rest } from '../support/stack'
import { seedAudit, type Fixture } from '../audit/seed'
import { adminPost, api, karachiToday, service, servicePost } from '../verify-roles/lib'
import { seedWorld, type World } from '../verify-roles/fixtures'
import { OUT } from './lib'

/*
 * The Forest audit's data, made once per database (one CI shard = one stack) and shared by every worker of the shard through
 * <OUT>/seed.json. The first worker takes a lock (an atomic mkdir), seeds and writes the file; the others wait for it.
 *   world  the verify-roles world (an RFQ with a quotation, an order with an invoice, a payment, an expense, an imported order)
 *   long   the same shape with very long names (company, supplier, item, PO, reference) and very big amounts
 *   fx     the screen audit's realistic month (e2e/audit/seed.ts): RFQs and orders in every state, so the lists look lived-in
 * Everything goes through the LOCAL stack only (API_URL from `supabase status`).
 */
export interface AuditSeed {
  world: World
  long: World
  /** null when the realistic seed failed (recorded as a harness finding): the {fx:...} routes are then skipped. */
  fx: Fixture | null
  fxError?: string
  /** Job keys: world, long, the imported order, and one per fx state. */
  jobs: Record<string, string>
  /** PO and invoice numbers that exist in the database: none may show on an engineer's screen. */
  secrets: string[]
}

const FILE = join(OUT, 'seed.json')
const LOCK = join(OUT, 'seed.lock')

export const LONG = {
  customer:
    'Pakistan International Precision Engineering and Industrial Instrumentation Services (Private) Limited, Korangi Industrial Area Phase II Branch',
  supplier: 'Supercalifragilisticexpialidocious-Instrumentation-Trading-Corporation-International-FZE',
  item:
    'Endress+Hauser Proline Promag W 400 electromagnetic flow meter, DN300 PN16 flanged, EPDM liner, stainless electrodes, remote transmitter with 30 m cable, HART, display, calibration certificate and third-party inspection',
  ref: 'CUSTOMER-REFERENCE-NUMBER-2026-11-0000123456789-REV-C',
  po: 'PO-KORANGI-PLANT-EXPANSION-PHASE-II-2026-0000987654',
}

async function jobKey(kind: 'rfq' | 'order', id: string): Promise<string | null> {
  const col = kind === 'rfq' ? 'rfq_id' : 'order_id'
  const r = await rest<{ job_key: string }[]>('admin', `v_jobs?${col}=eq.${id}&select=job_key&limit=1`)
  return r.status === 200 ? (r.body[0]?.job_key ?? null) : null
}

async function seedLong(big = true): Promise<World> {
  const tag = `FL${Date.now().toString(36).slice(-5)}`
  const amounts = big
    ? { sell: 98765432, supplier: 87654321, invoiceNet: 98765432109, invoiceGst: 17777777779, payment: 12345678901, expense: 9876543210, cost: 99999999999, legacyValue: 88888888888, legacyCost: 77777777777 }
    : { sell: 9876543, supplier: 8765432, invoiceNet: 987654321, invoiceGst: 177777777, payment: 123456789, expense: 98765432, cost: 999999999, legacyValue: 888888888, legacyCost: 777777777 }
  const qty = big ? 999 : 99
  // an invoice may not be for more than is left to invoice on the order: exactly the order's net, and its GST at 18%
  amounts.invoiceNet = qty * amounts.sell
  amounts.invoiceGst = Math.round(amounts.invoiceNet * 0.18)
  amounts.payment = Math.round(amounts.invoiceNet / 8)
  const today = karachiToday()
  const company = await adminPost<{ id: string; name: string }>('companies', { name: `${LONG.customer} ${tag}` })
  const supplier = await adminPost<{ id: string; name: string }>('companies', { name: `${LONG.supplier}-${tag}`, country: 'United Arab Emirates' })
  const rfq = await adminPost<{ id: string; number: number }>('rfqs', { company_id: company.id, owner_id: 'a0000000-0000-4000-8000-000000000002', customer_ref: `${LONG.ref}-${tag}` })
  const item = await adminPost('rfq_items', { rfq_id: rfq.id, position: 0, description: `${LONG.item} ${tag}`, qty, quoted_unit_price_net: amounts.sell })
  await adminPost('rfq_items', { rfq_id: rfq.id, position: 1, description: `${LONG.supplier} spare parts kit ${tag}`, qty: 1, quoted_unit_price_net: 1 })
  const inquiry = await adminPost('supplier_inquiries', { rfq_id: rfq.id, supplier_id: supplier.id, sent_on: today })
  await adminPost('supplier_quote_lines', { inquiry_id: inquiry.id, rfq_item_id: item.id, unit_price: amounts.supplier, currency: 'PKR', lead_time: '26 weeks from the date of the purchase order and the advance payment' })
  const q = await api('admin', '/rest/v1/rpc/issue_quotation', { method: 'POST', body: { p_quotation_id: crypto.randomUUID(), p_rfq_id: rfq.id } })
  if (q.status >= 300) throw new Error(`issue_quotation (long): ${q.status} ${q.text}`)
  const order = await adminPost<{ id: string; number: number }>('orders', { company_id: company.id, owner_id: 'a0000000-0000-4000-8000-000000000002', customer_po_number: `${LONG.po}-${tag}` })
  const leg = await adminPost('supplier_orders', { order_id: order.id, supplier_id: supplier.id, currency: 'PKR' })
  await adminPost('order_items', { order_id: order.id, position: 0, description: `${LONG.item} ${tag}`, qty, unit_price_net: amounts.sell, gst_rate: 18, supplier_order_id: leg.id, supplier_unit_price: amounts.supplier })
  await adminPost('order_engineers', { order_id: order.id, user_id: 'a0000000-0000-4000-8000-000000000003' })
  const invoice = await adminPost<{ id: string; number: string }>('invoices', { order_id: order.id, number: `INV-${tag}-0000000001`, invoice_date: today, net_amount: amounts.invoiceNet, gst_amount: amounts.invoiceGst })
  await adminPost('payments_in', { order_id: order.id, amount: amounts.payment, reference: `${LONG.ref} IBFT ${tag}` })
  await adminPost('expenses', { order_id: order.id, supplier_order_id: leg.id, amount_pkr: amounts.expense, category_id: 'ca7e0000-0000-4000-8000-000000000011', description: `${LONG.supplier} advance against proforma ${tag}` })
  await adminPost('order_costs', { order_id: order.id, expected_cost_pkr: amounts.cost })
  const legacyRow = { id: `${tag}-old`, order_value: amounts.legacyValue, cost_value: amounts.legacyCost, order_gst_amount: 45140, invoice_number: `OLD-${tag}` }
  const legacyOrder = await servicePost<{ id: string; number: number }>('orders', { company_id: company.id, owner_id: 'a0000000-0000-4000-8000-000000000002', legacy_source: { table: 'orders', row: legacyRow } })
  return { tag, company, supplier, rfq, rfqItem: item.id, order, leg: leg.id, invoice, legacyOrder, month: '', amounts }
}

async function secrets(): Promise<string[]> {
  const out = new Set<string>()
  const pos = await service('/rest/v1/orders?select=customer_po_number&customer_po_number=not.is.null&limit=2000')
  if (pos.ok) for (const r of (await pos.json()) as { customer_po_number: string }[]) if (r.customer_po_number.length >= 5) out.add(r.customer_po_number)
  const inv = await service('/rest/v1/invoices?select=number&number=not.is.null&limit=2000')
  if (inv.ok) for (const r of (await inv.json()) as { number: string }[]) if (r.number.length >= 5) out.add(r.number)
  return [...out]
}

async function seedAll(): Promise<AuditSeed> {
  const world = await seedWorld('FA')
  let longError: string | undefined
  const long = await seedLong(true).catch(async e => {
    longError = `big amounts refused: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`
    return seedLong(false)
  })
  long.month = world.month
  let fx: Fixture | null = null
  let fxError: string | undefined
  try {
    fx = await seedAudit(join(OUT, 'fx.json'))
  } catch (e) {
    fxError = (e instanceof Error ? e.message : String(e)).slice(0, 400)
  }
  const jobs: Record<string, string> = {}
  const put = async (k: string, kind: 'rfq' | 'order', id: string | undefined) => {
    if (!id) return
    const key = await jobKey(kind, id)
    if (key) jobs[k] = key
  }
  await put('job', 'rfq', world.rfq.id)
  await put('long:job', 'rfq', long.rfq.id)
  await put('directJob', 'order', world.legacyOrder.id)
  await put('orderJob', 'order', world.order.id)
  await put('long:orderJob', 'order', long.order.id)
  if (fx) {
    for (const [k, id] of Object.entries(fx.rfq)) await put(`fx:${k}`, 'rfq', id)
    for (const [k, id] of Object.entries(fx.order)) await put(`fx:${k}`, 'order', id)
  }
  return { world, long, fx, fxError: [fxError, longError].filter(Boolean).join(' | ') || undefined, jobs, secrets: await secrets() }
}

let cached: AuditSeed | null = null

/** The shard's seed: made by the first worker, read by the rest. */
export async function ensureSeed(): Promise<AuditSeed> {
  if (cached) return cached
  mkdirSync(OUT, { recursive: true })
  if (existsSync(FILE)) {
    const saved = JSON.parse(readFileSync(FILE, 'utf8')) as AuditSeed
    const still = await rest<{ id: string }[]>('admin', `rfqs?id=eq.${saved.world.rfq.id}&select=id`)
    if (still.status === 200 && still.body.length === 1) return (cached = saved)
    rmSync(FILE, { force: true })
    rmSync(LOCK, { recursive: true, force: true })
  }
  let mine = false
  try {
    mkdirSync(LOCK)
    mine = true
  } catch {
    /* another worker is seeding */
  }
  if (mine) {
    try {
      const s = await seedAll()
      writeFileSync(FILE, JSON.stringify(s, null, 2))
      return (cached = s)
    } catch (e) {
      // the other workers stop waiting at once
      writeFileSync(`${FILE}.error`, String(e instanceof Error ? e.message : e))
      throw e
    }
  }
  for (let i = 0; i < 600; i++) {
    if (existsSync(`${FILE}.error`)) throw new Error(`the seeding worker failed: ${readFileSync(`${FILE}.error`, 'utf8').slice(0, 300)}`)
    if (existsSync(FILE)) {
      try {
        return (cached = JSON.parse(readFileSync(FILE, 'utf8')) as AuditSeed)
      } catch {
        /* half written */
      }
    }
    await new Promise(r => setTimeout(r, 1000))
  }
  throw new Error('the seeding worker never wrote seed.json')
}

/** The address of a route with the seed's records in it, or null when a placeholder has nothing (the fx seed failed). */
export function fillPath(path: string, s: AuditSeed, longState = false): string | null {
  const w = longState ? s.long : s.world
  const values: Record<string, string | undefined> = {
    job: longState ? s.jobs['long:job'] : s.jobs.job,
    orderJob: longState ? s.jobs['long:orderJob'] : s.jobs.orderJob,
    directJob: s.jobs.directJob,
    company: w.company.id,
    supplier: w.supplier.id,
    order: w.order.id,
    invoice: w.invoice.id,
    month: s.world.month,
    'long:job': s.jobs['long:job'],
    'fx:customer': s.fx?.company.customer,
    'fx:supplier': s.fx?.company.supplier,
  }
  let missing = false
  const out = path.replace(/\{([\w:]+)\}/g, (_, k: string) => {
    const v = k in values ? values[k] : s.jobs[k]
    if (!v) missing = true
    return v ?? ''
  })
  return missing ? null : out
}
