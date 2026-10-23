import { type BrowserContext, type Locator, type Page, type TestInfo } from '@playwright/test'
import { moneyKeysIn } from '../../verify-roles/lib'
import { db, num, rpcAs, USER } from '../../verify/support/db'
import { company, karachiDay, post, postMany, supplier, type Co } from '../../verify/support/fixtures'
import { openMarkWon } from '../../verify/support/session'
import { amount } from '../../verify/support/text'
import { note, probe, visit, watch } from './support'

/*
 * Shared by jobflow.spec.ts (the hunt) and bugs.spec.ts (the pinned HW tests): the fictional cast (Indus Fibre Mills, Lahore Switchgear,
 * Gulf Instrumentation FZE), the seeding that writes only what the app or the legacy import would write (see jobflow.spec.ts), and the
 * readers. A support file, not a spec: it holds no test.
 */

// ------------------------------------------------------------------------------------------------ helpers

export const T = 12_000
export const today = karachiDay(0)
export const slashDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
export const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export const flat = (s: string) => s.replace(/\s+/g, ' ').trim()
export const same = (a: number, b: number) => Math.abs(a - b) < 0.005
export const r2 = (n: number) => Math.round(n * 100) / 100
export const orderRef = (n: number) => `ORD-${String(n).padStart(4, '0')}`

export function obs(info: TestInfo, where: string, what: string, detail?: unknown): void {
  note(info, { kind: 'observation', where, what, detail })
}
/** Records an observation when `ok` is false. Returns ok. */
export function want(info: TestInfo, where: string, ok: boolean, what: string, detail?: unknown): boolean {
  if (!ok) obs(info, where, what, detail)
  return ok
}

/** One line as the database computes it: net to the paisa, GST whole rupees per line. */
export function lineMath(l: { qty: number; price: number; gst?: number }): { net: number; gst: number } {
  const netPaisa = Math.round((Math.round(l.qty * 1000) * Math.round(l.price * 100)) / 1000)
  const rate = l.gst ?? 18
  return { net: netPaisa / 100, gst: rate > 0 ? Math.round((netPaisa * rate) / 10000) : 0 }
}
export function totalsOf(lines: { qty: number; price: number; gst?: number }[]) {
  const per = lines.map(lineMath)
  const net = r2(per.reduce((s, l) => s + l.net, 0))
  const gst = per.reduce((s, l) => s + l.gst, 0)
  return { per, net, gst, gross: r2(net + gst) }
}

export async function newPage(ctx: BrowserContext, info: TestInfo, label: string): Promise<Page> {
  const p = await ctx.newPage()
  p.setDefaultTimeout(15_000)
  p.setDefaultNavigationTimeout(30_000)
  watch(p, info, label)
  return p
}

/** Poll a read until `ok`, for up to `ms`; returns the last value (never throws). */
export async function until<V>(read: () => Promise<V>, ok: (v: V) => boolean, ms = 8000): Promise<V> {
  const end = Date.now() + ms
  let v = await read()
  while (!ok(v) && Date.now() < end) {
    await new Promise(r => setTimeout(r, 400))
    v = await read()
  }
  return v
}

export const toast = (p: Page, text: string | RegExp) => p.getByRole('status').filter({ hasText: text })
export const undoIn = (l: Locator) => l.getByRole('button', { name: /^Undo/ }).first()
export const actions = (p: Page) => p.locator('[data-slot="order-actions"]')
export const legRows = (p: Page, supplierName: string) => p.getByRole('listitem', { name: `Supplier order, ${supplierName}` })
/** The supplier order row of `supplierName` that carries the currency chip `ccy` (one supplier may have two supplier orders, USD and EUR). */
export async function legRowByCcy(p: Page, supplierName: string, ccy: string, count = 1): Promise<Locator> {
  const rows = legRows(p, supplierName)
  await rows.nth(count - 1).waitFor({ timeout: 15_000 })
  const texts = await rows.allInnerTexts()
  const i = texts.findIndex(t => t.split(/[^A-Za-z]+/).includes(ccy))
  return rows.nth(Math.max(i, 0))
}

// ------------------------------------------------------------------------------------------------ the cast and the seeding

export const ITEMS = [
  { description: 'Schneider LC1D25 contactor', qty: 10, unit: 'nos' },
  { description: 'Siemens S7-1200 PLC', qty: 1, unit: 'nos' },
  { description: 'Endress+Hauser PMC71 pressure transmitter', qty: 2, unit: 'nos' },
  { description: 'Level switch', qty: 4, unit: 'nos' },
  { description: 'Commissioning and loop check', qty: 1, unit: 'job' },
] as const

export interface Cast {
  customer: Co
  supA: Co
  supB: Co
  rfq: { id: string; number: number }
  items: { id: string; position: number; description: string; qty: number }[]
}

/** The customer, the two suppliers and an RFQ with the five items (no replies yet). */
export async function seedCast(opts: { items?: number; owner?: keyof typeof USER } = {}): Promise<Cast> {
  const customer = await company('Indus Fibre Mills', { city: 'Faisalabad' })
  const supA = await supplier('Lahore Switchgear', 'Pakistan')
  const supB = await supplier('Gulf Instrumentation FZE', 'United Arab Emirates')
  const r = await post<{ id: string; number: number }>('rfqs', { company_id: customer.id, owner_id: USER[opts.owner ?? 'sales'], due_on: karachiDay(5), received_on: karachiDay(-6) })
  const want_ = ITEMS.slice(0, opts.items ?? 5)
  const rows = await postMany<{ id: string; position: number; description: string }>(
    'rfq_items',
    want_.map((it, i) => ({ rfq_id: r.id, position: i, description: it.description, qty: it.qty, unit: it.unit, gst_rate: 18 })),
  )
  rows.sort((a, b) => a.position - b.position)
  return { customer, supA, supB, rfq: r, items: rows.map((x, i) => ({ ...x, qty: want_[i].qty })) }
}

/** A supplier asked on the RFQ and what they replied (what Save reply writes). */
export async function reply(rfqId: string, sup: Co, lines: { itemId: string; price: number; currency: string; lead?: string }[], sentDaysAgo = 4): Promise<{ id: string; lineIds: string[] }> {
  const inq = await post<{ id: string }>('supplier_inquiries', { rfq_id: rfqId, supplier_id: sup.id, sent_on: karachiDay(-sentDaysAgo) })
  const ls = await postMany<{ id: string }>(
    'supplier_quote_lines',
    lines.map(l => ({ inquiry_id: inq.id, rfq_item_id: l.itemId, unit_price: l.price, currency: l.currency, lead_time: l.lead ?? '3 weeks' })),
  )
  return { id: inq.id, lineIds: ls.map(l => l.id) }
}

/** The standard replies: A prices item 1 in PKR; B prices item 2 in USD and item 3 in EUR. Items 4 and 5 have no supplier price. */
export const PRICE = { a1: 8200, b2usd: 520, b3eur: 640 }
export async function standardReplies(c: Cast) {
  const a = await reply(c.rfq.id, c.supA, [{ itemId: c.items[0].id, price: PRICE.a1, currency: 'PKR', lead: 'ex-stock' }])
  const b = await reply(c.rfq.id, c.supB, [
    { itemId: c.items[1].id, price: PRICE.b2usd, currency: 'USD', lead: '2 weeks' },
    { itemId: c.items[2].id, price: PRICE.b3eur, currency: 'EUR', lead: '3-4 weeks' },
  ])
  return { a, b }
}

/** What the customer is quoted for the five items. */
export const SELL = [9800, 189500.5, 212400, 31250.75, 85000]

/**
 * Issues a quotation the way the dialog does (issue_quotation with p_lines and p_item_ids). `only` limits it to some items
 * (positions, 0-based): the others are left out, as unticked items are.
 */
export async function issueQuote(c: Cast, o: { only?: number[]; prices?: Record<number, number>; gst?: Record<number, number>; payment?: string | null; role?: 'sales' | 'admin' } = {}) {
  const only = o.only ?? c.items.map((_, i) => i)
  const lines = only.map(i => ({ id: c.items[i].id, unit_price: o.prices?.[i] ?? SELL[i], gst_rate: o.gst?.[i] ?? 18, lead_time: null, qty: c.items[i].qty }))
  return rpcAs<string>(o.role ?? 'sales', 'issue_quotation', {
    p_quotation_id: crypto.randomUUID(),
    p_rfq_id: c.rfq.id,
    p_item_ids: lines.map(l => l.id),
    p_lines: lines,
    p_payment_terms: o.payment === undefined ? '30 days from invoice' : o.payment,
    p_delivery_text: 'To your site within the lead time on each line',
  })
}

export interface RankRow {
  rfq_item_id: string
  quote_line_id: string
  supplier_id: string
  currency: string
  rank: number | null
  pkr_unit_price: number | null
  fx_state: string | null
  comparable: boolean
}

/** The p_items the Mark won dialog sends by default: the rank-1 quote of each QUOTED item (a lone unranked quote too), none otherwise. */
export async function dialogPayload(c: Cast, o: { service?: number[]; leftOut?: number[] } = {}) {
  const rank = (await rpcAs<RankRow[]>('sales', 'rank_item_quotes', { p_rfq_id: c.rfq.id })).body ?? []
  const priced = await db.rows<{ id: string; quoted_unit_price_net: number | null }>(`rfq_items?rfq_id=eq.${c.rfq.id}&select=id,quoted_unit_price_net`)
  const quoted = new Set(priced.filter(p => p.quoted_unit_price_net !== null).map(p => p.id))
  const out: Record<string, unknown>[] = []
  c.items.forEach((it, i) => {
    if (!quoted.has(it.id) || o.leftOut?.includes(i)) return
    if (o.service?.includes(i)) return void out.push({ rfq_item_id: it.id, is_service: true })
    const qs = rank.filter(r => r.rfq_item_id === it.id)
    const pick = qs.find(q => q.rank === 1) ?? (qs.length === 1 ? qs[0] : undefined)
    out.push(pick ? { rfq_item_id: it.id, quote_line_id: pick.quote_line_id } : { rfq_item_id: it.id })
  })
  return out
}

/** Mark won through the function, with the dialog's default payload. Returns the order id (or the refusal). */
export async function winRpc(c: Cast, o: { role?: 'sales' | 'admin'; service?: number[]; leftOut?: number[]; items?: Record<string, unknown>[]; needs?: boolean; terms?: number | null; po?: string | null } = {}) {
  const orderId = crypto.randomUUID()
  const r = await rpcAs<unknown>(o.role ?? 'sales', 'convert_rfq_to_order', {
    p_order_id: orderId,
    p_rfq_id: c.rfq.id,
    p_items: o.items ?? (await dialogPayload(c, o)),
    p_customer_po_number: o.po ?? null,
    p_payment_terms_days: o.terms === undefined ? 30 : o.terms,
    p_needs_commissioning: o.needs ?? false,
  })
  return { orderId, status: r.status, body: r.body }
}

export interface OItem {
  id: string
  position: number
  description: string
  qty: number
  unit: string | null
  unit_price_net: number
  gst_rate: number
  is_service: boolean
  supplier_order_id: string | null
  supplier_unit_price: number | null
  rfq_item_id: string | null
}
export const itemsOf = (orderId: string) =>
  db.rows<OItem>(`order_items?order_id=eq.${orderId}&select=id,position,description,qty,unit,unit_price_net,gst_rate,is_service,supplier_order_id,supplier_unit_price,rfq_item_id&order=position`)
export interface OLeg {
  id: string
  supplier_id: string
  currency: string | null
  inquiry_id: string | null
  placed_on: string | null
  expected_on: string | null
  delivered_on: string | null
  received_on: string | null
}
export const legsOf = (orderId: string) => db.rows<OLeg>(`supplier_orders?order_id=eq.${orderId}&select=id,supplier_id,currency,inquiry_id,placed_on,expected_on,delivered_on,received_on&order=created_at,id`)
export const orderRow = (id: string) =>
  db.one<{ id: string; number: number; rfq_id: string | null; customer_po_number: string | null; payment_terms_days: number | null; needs_commissioning: boolean; cancelled_on: string | null; cancel_reason: string | null; commissioning_planned_on: string | null; commissioning_done_on: string | null; owner_id: string | null; company_id: string }>(
    `orders?id=eq.${id}&select=id,number,rfq_id,customer_po_number,payment_terms_days,needs_commissioning,cancelled_on,cancel_reason,commissioning_planned_on,commissioning_done_on,owner_id,company_id`,
  )
export const orderTotal = async (id: string) => {
  const t = (await db.view<{ net: number; gst: number; gross: number }>(`v_order_items_total?order_id=eq.${id}&select=net,gst,gross`))[0]
  return { net: num(t?.net), gst: num(t?.gst), gross: num(t?.gross) }
}
export const stateOf = async (id: string) =>
  (await db.view<{ goods_state: string; commissioning_state: string; invoicing_state: string; lifecycle: string }>(`v_order_state?order_id=eq.${id}&select=goods_state,commissioning_state,invoicing_state,lifecycle`))[0]
export const rfqState = async (id: string) =>
  (await db.view<{ outcome: string; bid_state: string; quoted_on: string | null; closed_on: string | null; is_overdue: boolean }>(`v_rfq_state?rfq_id=eq.${id}&select=outcome,bid_state,quoted_on,closed_on,is_overdue`))[0]
export const posOf = (legId: string) => db.rows<{ id: string; number: number; revision: number; currency: string; total: number; pdf_path: string | null; lines: { order_item_id: string; unit_price: number | null; qty: number; description?: string }[] }>(`purchase_orders?supplier_order_id=eq.${legId}&select=id,number,revision,currency,total,pdf_path,lines&order=revision`)

/**
 * Mark won in the dialog. Returns what the dialog said and the order made (null when it could not be made). `before` runs once the
 * dialog has loaded (to change a supplier, split an item, tick the commissioning box).
 */
export async function winUi(
  page: Page,
  info: TestInfo,
  where: string,
  before?: (d: Locator) => Promise<void>,
): Promise<{ orderId: string | null; text: string; totals: string; legsText: string; created: boolean }> {
  const out = { orderId: null as string | null, text: '', totals: '', legsText: '', created: false }
  await probe(info, page, `${where}: open Mark won`, async () => {
    await openMarkWon(page)
    const d = page.getByRole('dialog')
    await d.getByRole('heading', { name: 'Mark won' }).waitFor({ timeout: T })
    await d.getByRole('group', { name: 'Suppliers by line' }).waitFor({ timeout: T })
    out.text = flat(await d.innerText())
    out.totals = flat(await d.getByRole('group', { name: 'Order totals' }).innerText().catch(() => ''))
    out.legsText = flat((await d.getByText(/supplier orders?:/).first().innerText().catch(() => '')) ?? '')
  })
  await probe(info, page, `${where}: change the dialog`, async () => {
    if (before) await before(page.getByRole('dialog'))
  })
  await probe(info, page, `${where}: Create order`, async () => {
    const d = page.getByRole('dialog')
    const button = d.getByRole('button', { name: 'Create order' })
    if (await button.isDisabled()) return
    await button.click()
    await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/, { timeout: 30_000 })
    out.orderId = /orders\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? null
    out.created = true
  })
  return out
}

/** Issue the quotation through the dialog: tick the items, type the prices. */
export async function issueUi(page: Page, info: TestInfo, where: string, prices: Record<number, number>, o: { exemptItem?: number; payment?: string; delivery?: string } = {}) {
  const dlg = { net: '', gst: '', gross: '', ok: false }
  await probe(info, page, `${where}: Issue quotation dialog`, async () => {
    await page.locator('[data-slot="issue-quotation"]').getByRole('button', { name: /Issue/ }).click()
    const d = page.getByRole('dialog')
    await d.getByRole('list', { name: 'Items to quote' }).waitFor({ timeout: T })
    for (const [i, price] of Object.entries(prices)) {
      const n = Number(i) + 1
      const box = d.getByRole('checkbox', { name: `Include item ${n}` })
      if ((await box.getAttribute('aria-checked')) !== 'true') await box.click()
      await d.getByLabel(`Unit price, net PKR, item ${n}`).fill(String(price))
    }
    if (o.exemptItem !== undefined) await d.getByLabel(`GST rate, item ${o.exemptItem + 1}`).selectOption('0')
    if (o.payment) await d.getByLabel('Payment terms', { exact: true }).fill(o.payment)
    if (o.delivery) await d.getByLabel('Delivery', { exact: true }).fill(o.delivery)
    dlg.net = flat(await d.getByTestId('total-net').innerText())
    dlg.gst = flat(await d.getByTestId('total-gst').innerText().catch(() => ''))
    dlg.gross = flat(await d.getByTestId('total-gross').innerText())
    await d.getByRole('button', { name: /Issue (revised )?quotation/ }).click()
    await d.getByTestId('pdf-ready').waitFor({ timeout: 45_000 })
    await d.getByRole('button', { name: 'Done' }).click()
    dlg.ok = true
  })
  return dlg
}
export interface Imported {
  customer: Co
  rfq: { id: string; number: number }
  items: { id: string; position: number }[]
  sup: Co
  lineIds: string[]
}
export const MARK = (table: string) => ({ imported: true, table })

/** What the import writes for an RFQ whose quotation was sent: marker, flags, quoted_on, items, one inquiry, quote lines; no quotation. */
export async function seedImported(nItems: number): Promise<Imported> {
  const customer = await company('Indus Fibre Mills', { city: 'Faisalabad' })
  const sup = await supplier('Lahore Switchgear', 'Pakistan')
  const r = await db.add<{ id: string; number: number }>('rfqs', {
    company_id: customer.id,
    owner_id: USER.sales,
    received_on: karachiDay(-70),
    due_on: karachiDay(-60),
    quoted_on: karachiDay(-62),
    legacy_flags: ['quoted_date_estimated'],
    legacy_source: MARK('rfqs'),
  })
  const items = await db.insert<{ id: string; position: number }>(
    'rfq_items',
    ITEMS.slice(0, nItems).map((it, i) => ({ rfq_id: r.id, position: i, description: it.description, qty: it.qty, unit: null, gst_rate: 18, legacy_flags: [], legacy_source: MARK('rfq_line_items') })),
  )
  items.sort((a, b) => a.position - b.position)
  const inq = await db.add<{ id: string }>('supplier_inquiries', { rfq_id: r.id, supplier_id: sup.id, sent_on: null, legacy_flags: ['inquiry_created_for_quote'], legacy_source: MARK('supplier_quotes') })
  // The import attaches every quote to the FIRST item and marks it item_guessed when the RFQ has more than one.
  const line = await db.add<{ id: string }>('supplier_quote_lines', {
    inquiry_id: inq.id,
    rfq_item_id: items[0].id,
    unit_price: 8200,
    currency: 'PKR',
    lead_time: '21 days',
    legacy_flags: nItems > 1 ? ['currency_unverified', 'item_guessed'] : ['currency_unverified'],
    legacy_source: MARK('supplier_quotes'),
  })
  return { customer, rfq: r, items, sup, lineIds: [line.id] }
}

// ------------------------------------------------------------------------------------------------ a ready order (RFQ -> quote -> won), made the way the app makes it

export interface Live {
  c: Cast
  id: string
  number: number
  A: OLeg
  BU: OLeg
  BE: OLeg
  items: OItem[]
}

/**
 * A job as the dialog leaves it: the five items, the standard replies, a full quotation, Mark won with the dialog's default payload.
 * `service5` marks line 5 a service (what a careful person picks in the dialog); `leaveOut4` leaves the level switch out of the order
 * (otherwise it is an unsourced goods line, which is what the dialog does with it by default).
 */
export async function liveOrder(o: { service5?: boolean; leaveOut4?: boolean; needs?: boolean; terms?: number | null; owner?: keyof typeof USER } = {}): Promise<Live> {
  const c = await seedCast({ owner: o.owner })
  await standardReplies(c)
  const q = await issueQuote(c, { gst: { 4: 0 } })
  if (q.status >= 300) throw new Error(`issue_quotation refused: ${JSON.stringify(q.body)}`)
  const w = await winRpc(c, { service: o.service5 === false ? [] : [4], leftOut: o.leaveOut4 ? [3] : [], needs: o.needs ?? false, terms: o.terms })
  if (w.status >= 300) throw new Error(`convert_rfq_to_order refused: ${JSON.stringify(w.body)}`)
  const legs = await legsOf(w.orderId)
  const by = (cur: string, sup: Co) => legs.find(l => l.currency === cur && l.supplier_id === sup.id)!
  const items = await itemsOf(w.orderId)
  const o2 = await orderRow(w.orderId)
  return { c, id: w.orderId, number: o2.number, A: by('PKR', c.supA), BU: by('USD', c.supB), BE: by('EUR', c.supB), items }
}

export const issuePoRpc = (legId: string, role: 'sales' | 'admin' = 'sales') => rpcAs<string>(role, 'issue_purchase_order', { p_po_id: crypto.randomUUID(), p_supplier_order_id: legId })

/** Today, opened fresh: how many items of `rule` mention `text`, and how many of those sit in Waiting. */
export async function todayItems(ctx: BrowserContext, info: TestInfo, rule: string, text: string): Promise<{ count: number; waiting: number }> {
  const p = await newPage(ctx, info, `today ${rule}`)
  try {
    await visit(p, info, '/today')
    await p.getByRole('heading', { level: 1, name: 'Today' }).waitFor({ timeout: T }).catch(() => undefined)
    await p.getByText(/\d+ need you|Nothing due|all done/i).first().waitFor({ timeout: T }).catch(() => undefined)
    const toggle = p.getByRole('region', { name: 'Waiting' }).getByRole('button', { expanded: false })
    if (await toggle.count()) await toggle.first().click().catch(() => undefined)
    const li = p.locator(`li[data-rule="${rule}"]`).filter({ hasText: text })
    return { count: await li.count(), waiting: await p.locator(`li[data-rule="${rule}"][data-waiting]`).filter({ hasText: text }).count() }
  } finally {
    await p.close()
  }
}

/** Everything an engineer's page asks the database for, and what came back: for "no price in the DOM or the network". */
export function spy(page: Page) {
  const urls: string[] = []
  const leaks: string[] = []
  page.on('response', async r => {
    const u = decodeURIComponent(r.url())
    if (!u.includes('/rest/v1/')) return
    urls.push(u)
    try {
      const ct = r.headers()['content-type'] ?? ''
      if (!ct.includes('json')) return
      const body = await r.json()
      const obj = /\/rest\/v1\/(?:rpc\/)?([a-z_0-9]+)/.exec(u)?.[1] ?? 'unknown'
      const rows = Array.isArray(body) ? body : body ? [body] : []
      for (const row of rows) {
        for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
          if (v === null || v === undefined || v === 0 || v === '0' || v === '') continue
          if (/^(gst_rate|prices_hidden)$/.test(k)) continue
          if (typeof v === 'number' && /(price|cost|amount|total|net|gross|sell|sold|margin|balance|paid|spread|pkr|rate_pkr)/i.test(k) && !/(items_|_count|count_|_quoted|_days|qty|rank|position|number|revision|tier|age_)/i.test(k)) leaks.push(`${obj}.${k}=${v}`)
          if (typeof v === 'object') for (const key of moneyKeysIn(v)) if (!/gst_rate/.test(key)) leaks.push(`${obj}.${k}${key}`)
        }
      }
    } catch {
      /* not JSON */
    }
  })
  return { urls, leaks }
}

export const PRICE_STRINGS = [...SELL, PRICE.a1, PRICE.b2usd, PRICE.b3eur, 82000, 98000, 424800].map(n => amount(n))
export async function repeatVia(page: Page, info: TestInfo, where: string, sourceNumber: number, customerName: string, po: string) {
  let id: string | null = null
  await probe(info, page, `${where}: Repeat a past order`, async () => {
    await visit(page, info, '/orders?owner=all')
    await page.getByRole('button', { name: 'Repeat a past order' }).first().click({ timeout: T })
    const d = page.getByRole('dialog')
    await d.getByLabel('Find a past order').fill(customerName)
    await d.getByRole('button', { name: new RegExp(`${customerName}.*${orderRef(sourceNumber)}`) }).click({ timeout: T })
    await d.getByLabel('Customer PO number').fill(po)
    await d.getByRole('button', { name: 'Create order' }).click()
    await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/, { timeout: 30_000 })
    id = /orders\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? null
  })
  return id
}

/** What the import writes for an old order whose price basis it could not prove: a marker, flags, one supplier order with no currency, a price and a 0. */
export async function seedImportedOrder() {
  const customer = await company('Indus Fibre Mills', { city: 'Faisalabad' })
  const sup = await supplier('Lahore Switchgear', 'Pakistan')
  const o = await db.add<{ id: string; number: number }>('orders', {
    company_id: customer.id,
    owner_id: USER.sales,
    ordered_on: karachiDay(-300),
    customer_po_number: `OLD-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    payment_terms_days: 30,
    needs_commissioning: false,
    legacy_flags: ['value_basis_unknown', 'dates_estimated'],
    legacy_source: MARK('orders'),
  })
  const leg = await db.add<{ id: string }>('supplier_orders', { order_id: o.id, supplier_id: sup.id, placed_on: karachiDay(-290), delivered_on: karachiDay(-280), received_on: karachiDay(-280), currency: null, legacy_flags: ['dates_estimated'], legacy_source: MARK('orders') })
  await db.insert('order_items', [
    { order_id: o.id, position: 0, description: 'Schneider LC1D25 contactor', qty: 1, unit_price_net: 125000, gst_rate: 18, is_service: false, supplier_order_id: leg.id, legacy_flags: [], legacy_source: MARK('orders') },
    { order_id: o.id, position: 1, description: 'Siemens S7-1200 PLC', qty: 1, unit_price_net: 0, gst_rate: 18, is_service: false, supplier_order_id: leg.id, legacy_flags: [], legacy_source: MARK('orders') },
  ])
  return { id: o.id, number: o.number, customer, supplier: sup }
}
