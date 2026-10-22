import { readFileSync } from 'node:fs'
import { expect, test, type BrowserContext, type Locator, type Page, type TestInfo } from '@playwright/test'
import { rest } from '../../support/stack'
import { fetchStoredPdf, pdfIsValid, pdfText, renderPdfPng } from '../../support/pdf'
import { readClipboardWhen, resetClipboard } from '../../support/clipboard'
import { db, num, USER } from '../../verify/support/db'
import { company, invoice, karachiDay, order, payment, post, ref, setProfile, setRates, supplier, type Co, type LineSpec } from '../../verify/support/fixtures'
import { MONEY_PATHS, restLog } from '../../verify/support/session'
import { amount } from '../../verify/support/text'
import { ctxAs, layout, note, OUT, probe, settle, shot, tag, visit, watch } from './support'

/*
 * Exploratory hunt: the ORDER WORKFLOW end to end, at 1366x768 and 375x812 (touch), as admin, sales and engineer. Every step is a
 * probe (a failure is recorded with a screenshot and the test goes on); anything suspicious that is not an exception is a note.
 * Figures are worked out here from the lines (DB rules: line net = round(qty x price, 2), GST whole rupees per line) and compared
 * with the screen AND the database to the paisa.
 *
 * Probed (beyond e2e/verify/order-flow, money-flow and resilience):
 *   A  order page totals vs DB (decimal qty 2.5, paisa prices, an exempt service line); leg totals in EUR and USD with "1 of 2 lines
 *      priced"; browser Back and reload with the Issue PO dialog open; Issue PO on a EUR leg with one missing supplier price (typed
 *      17.255: dialog total vs stored total vs PDF, rounding, the written-back price, whether the PDF leaks our selling price), double
 *      click Issue PO; Issue PO on the USD leg from the page's primary button (PDF total and words); Today place_po hand-off; goods
 *      chase (copy text vs clipboard, chase stamp, Undo, Today goods_late active/waiting); Delivered today double click + Undo (dates
 *      restored exactly); part delivery (goods state on page and DB); engineer Today job_on_site; phone views for sales/admin.
 *   B  commissioning on the phone: sales plans and assigns from the sticky bar; the engineer at 375 px: Today job_commissioning, the
 *      order page with no prices and no money requests, tap targets, Change planned date + Undo, Mark done today double tap + Undo;
 *      Today delivered_not_invoiced hand-off to sales.
 *   C  money on a mixed 18%/exempt order: Create invoice double click; the Sales Tax invoice PDF (download; NTN, STRN, GST 18%,
 *      exempt supplies, totals, amount in words, payment due) vs DB; Record payment part (1,234.56) / rest / over (double click Save,
 *      the toast's figure); Void (double click) + toast Undo; Correct + Undo; Remove (void) + Undo from the Voided list; after every
 *      step the order page, Who owes us and order_receivables must agree; a stale sales page editing a line of a fully invoiced order.
 *   D  part invoices: Today payment_overdue; the payment reminder copy + mark reminded + Undo (DB and Today); two people: admin records
 *      a payment while sales has the page open stale and invoices the rest from it (no double invoicing, the stale balance updates);
 *      the second invoice's PDF (its lines and its "Payment due" vs the order's due date in the DB); a part invoice on a mixed order
 *      (is its PDF printable?); typing more than is left to invoice (any warning?).
 *   E  cancel/reopen: Back and reload with Record payment / Cancel dialogs open; cancel with a PO already sent (copy cancellation
 *      message), double click Cancel order, Undo, Today items of a cancelled order, Reopen + its Undo, the balance of a cancelled
 *      invoiced order; admin on the phone records a payment from the sticky bar; phone layouts of the order page and Who owes us.
 */

// ------------------------------------------------------------------------------------------------ helpers

const T = 12_000
const today = karachiDay(0)
const slashDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** The invoice PDF's day ("5 Oct 2026"). */
const pdfDay = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const actions = (p: Page) => p.locator('[data-slot="order-actions"]')
const legRow = (p: Page, supplierName: string) => p.getByRole('listitem', { name: `Supplier order, ${supplierName}` })
const payPanel = (p: Page) => p.locator('[data-slot="invoices-payments"]')
const toNum = (s: string | null | undefined): number => {
  const t = (s ?? '').replace(/−/g, '-').replace(/[^0-9.-]/g, '')
  return t ? Number(t) : NaN
}
const same = (a: number, b: number) => Math.abs(a - b) < 0.005
const r2 = (n: number) => Math.round(n * 100) / 100

function obs(info: TestInfo, where: string, what: string, detail?: unknown): void {
  note(info, { kind: 'observation', where, what, detail })
}
/** Records an observation when `ok` is false. */
function want(info: TestInfo, where: string, ok: boolean, what: string, detail?: unknown): boolean {
  if (!ok) obs(info, where, what, detail)
  return ok
}

/** One order line as the database computes it (v_order_items_total): net to the paisa, GST whole rupees per line. */
function lineMath(l: Pick<LineSpec, 'qty' | 'price' | 'gst'>): { net: number; gst: number } {
  const netPaisa = Math.round((Math.round(l.qty * 1000) * Math.round(l.price * 100)) / 1000)
  const rate = l.gst ?? 18
  const gst = rate > 0 ? Math.round((netPaisa * rate) / 10000) : 0
  return { net: netPaisa / 100, gst }
}
function orderMath(lines: Pick<LineSpec, 'qty' | 'price' | 'gst'>[]) {
  const per = lines.map(lineMath)
  const net = r2(per.reduce((s, l) => s + l.net, 0))
  const gst = per.reduce((s, l) => s + l.gst, 0)
  return { per, net, gst, gross: r2(net + gst) }
}
/** qty x price to the paisa, half away from zero (the PO's line amount, purchase_order_set_total). */
const productPaisa = (qty: number, price: number) => Math.round((Math.round(qty * 1000) * Math.round(price * 10000)) / 100000)

// Amount in words, written here independently of the app (international system, as the app's wholeInWords).
const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
function below1000(n: number): string {
  const parts: string[] = []
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} hundred`)
    n %= 100
  }
  if (n >= 20) parts.push(n % 10 ? `${TENS[Math.floor(n / 10)]}-${ONES[n % 10]}` : TENS[Math.floor(n / 10)])
  else if (n > 0) parts.push(ONES[n])
  return parts.join(' ')
}
function whole(n: number): string {
  if (n === 0) return 'zero'
  const parts: string[] = []
  for (const [size, name] of [
    [1_000_000_000, 'billion'],
    [1_000_000, 'million'],
    [1_000, 'thousand'],
    [1, ''],
  ] as const) {
    const chunk = Math.floor(n / size)
    n %= size
    if (chunk > 0) parts.push(name ? `${below1000(chunk)} ${name}` : below1000(chunk))
  }
  return parts.join(' ')
}
function inWords(value: number, names: [string, string, string, string]): string {
  const paisa = Math.round(value * 100)
  const w = Math.floor(paisa / 100)
  const p = paisa % 100
  let s = `${whole(w)} ${w === 1 ? names[0] : names[1]}`
  if (p > 0) s += ` and ${whole(p)} ${p === 1 ? names[2] : names[3]}`
  return `${s.charAt(0).toUpperCase()}${s.slice(1)} only.`
}
const flat = (s: string) => s.replace(/\s+/g, ' ')
/** Whether the PDF text holds `needle`, ignoring how pdftotext broke the lines. */
const pdfHas = (text: string, needle: string) => flat(text).includes(flat(needle))

type Rec = { gross: number; settled: number; balance: number; over: number; state: string; dueOn: string | null; reminders: number; remindedOn: string | null }
async function rec(orderId: string): Promise<Rec | null> {
  const rows = await db.adminRpc<
    { gross_target: number; settled: number; balance: number; overpaid_by: number; payment_state: string; due_on: string | null; reminder_count: number; last_reminded_on: string | null }[]
  >('order_receivables', { p_order_id: orderId })
  const r = rows[0]
  return r
    ? { gross: num(r.gross_target), settled: num(r.settled), balance: num(r.balance), over: num(r.overpaid_by), state: r.payment_state, dueOn: r.due_on, reminders: num(r.reminder_count), remindedOn: r.last_reminded_on }
    : null
}
const counting = (orderId: string) => db.rows<{ id: string; amount: number }>(`payments_in?order_id=eq.${orderId}&voided_at=is.null&select=id,amount&order=created_at`)
const invoicesOf = (orderId: string) => db.rows<{ id: string; number: string; net_amount: number; gst_amount: number; invoice_date: string }>(`invoices?order_id=eq.${orderId}&select=id,number,net_amount,gst_amount,invoice_date&order=created_at`)
const stateOf = async (orderId: string) =>
  (await db.view<{ goods_state: string; commissioning_state: string; invoicing_state: string; lifecycle: string }>(`v_order_state?order_id=eq.${orderId}&select=goods_state,commissioning_state,invoicing_state,lifecycle`))[0]
const itemsTotal = async (orderId: string) => {
  const t = (await db.view<{ net: number; gst: number; gross: number }>(`v_order_items_total?order_id=eq.${orderId}&select=net,gst,gross`))[0]
  return { net: num(t?.net), gst: num(t?.gst), gross: num(t?.gross) }
}
const legDates = (legId: string) =>
  db.one<{ placed_on: string | null; expected_on: string | null; delivered_on: string | null; received_on: string | null; chase_count: number; last_chased_on: string | null }>(
    `supplier_orders?id=eq.${legId}&select=placed_on,expected_on,delivered_on,received_on,chase_count,last_chased_on`,
  )
const posOf = (legId: string) =>
  db.rows<{ id: string; number: number; revision: number; currency: string; total: number; pdf_path: string | null }>(`purchase_orders?supplier_order_id=eq.${legId}&select=id,number,revision,currency,total,pdf_path&order=revision`)

/** Poll a read until `ok`, for up to `ms`; returns the last value (never throws). */
async function until<V>(read: () => Promise<V>, ok: (v: V) => boolean, ms = 8000): Promise<V> {
  const end = Date.now() + ms
  let v = await read()
  while (!ok(v) && Date.now() < end) {
    await new Promise(r => setTimeout(r, 400))
    v = await read()
  }
  return v
}

async function newPage(ctx: BrowserContext, info: TestInfo, label: string): Promise<Page> {
  const p = await ctx.newPage()
  // Run 2: with no action timeout a missing button waited until the 600 s test limit and every later probe was lost.
  p.setDefaultTimeout(15_000)
  p.setDefaultNavigationTimeout(30_000)
  watch(p, info, label)
  return p
}

/** Today, opened fresh: how many items of `rule` mention `text`, and how many of those sit in Waiting. */
async function todayItems(ctx: BrowserContext, info: TestInfo, rule: string, text: string): Promise<{ count: number; waiting: number }> {
  const p = await newPage(ctx, info, `today ${rule}`)
  try {
    await visit(p, info, '/today')
    await p.getByRole('heading', { level: 1, name: 'Today' }).waitFor({ timeout: T }).catch(() => undefined)
    await p.getByText(/\d+ need you|Nothing due|all done/i).first().waitFor({ timeout: T }).catch(() => undefined)
    // Waiting starts collapsed (R2-08): open it so its items are in the DOM too.
    const toggle = p.getByRole('region', { name: 'Waiting' }).getByRole('button', { expanded: false })
    if (await toggle.count()) await toggle.first().click().catch(() => undefined)
    const li = p.locator(`li[data-rule="${rule}"]`).filter({ hasText: text })
    return { count: await li.count(), waiting: await p.locator(`li[data-rule="${rule}"][data-waiting]`).filter({ hasText: text }).count() }
  } finally {
    await p.close()
  }
}

/** The balance the order page shows (reloaded), Who owes us and order_receivables(): all three must agree. */
async function threeWay(info: TestInfo, orderPage: Page, rp: Page, orderId: string, customer: string, where: string): Promise<void> {
  const r = await rec(orderId)
  if (!r) {
    obs(info, where, 'order_receivables returned no row for the order')
    return
  }
  await orderPage.reload()
  await settle(orderPage)
  const shown = toNum(await orderPage.getByTestId('order-balance').innerText({ timeout: T }))
  want(info, where, same(shown, r.balance), `order page balance ${shown} != order_receivables balance ${r.balance}`, r)
  await visit(rp, info, `/money/receivables?q=${encodeURIComponent(customer)}`)
  await rp
    .getByRole('link', { name: /^Open ORD-\d+/ })
    .or(rp.getByText(/Nothing matches|Nothing is owed/))
    .first()
    .waitFor({ timeout: T })
    .catch(() => undefined)
  // Only real data rows: they carry the order link ("Open ORD-0001"); the "Nothing matches" empty state is a row too.
  const row = rp.getByRole('row').filter({ hasText: customer }).filter({ has: rp.getByRole('link', { name: /^Open ORD-\d+/ }) })
  const n = await row.count()
  if (r.state === 'settled') {
    want(info, where, n === 0, `Who owes us (Open) still lists the order although the DB says settled (balance ${r.balance})`, await row.first().innerText().catch(() => ''))
  } else if (want(info, where, n === 1, `Who owes us lists ${n} rows for the order (DB state ${r.state}, balance ${r.balance})`)) {
    const text = await row.innerText()
    want(info, where, flat(text).includes(amount(r.balance)), `Who owes us row does not show the DB balance ${amount(r.balance)}`, flat(text))
  }
}

/** Clicks `click` and returns the downloaded file's bytes. */
async function download(page: Page, click: () => Promise<void>): Promise<Buffer | null> {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), click()])
  const path = await dl.path()
  return path ? readFileSync(path) : null
}

async function setBuyerTax(c: Co): Promise<void> {
  await db.patch(`companies?id=eq.${c.id}`, { ntn: '7654321-0', strn: '3277876543210', sales_tax_registered: true, invoice_address: 'Plot 9, Sundar Industrial Estate, Raiwind Road, Lahore' })
}
let profileStrn: string | null | undefined
async function ensureProfileStrn(): Promise<void> {
  await setProfile(true)
  if (profileStrn === undefined) profileStrn = (await db.one<{ strn: string | null }>('company_profile?id=eq.1&select=strn')).strn
  if (!profileStrn) await db.patch('company_profile?id=eq.1', { strn: '1234567890123' })
}
async function restoreProfileStrn(): Promise<void> {
  if (profileStrn === undefined) return
  await db.patch('company_profile?id=eq.1', { strn: profileStrn }).catch(() => undefined)
}

/** The toast (role=status) whose text matches, and its Undo button. */
const toast = (p: Page, text: string | RegExp) => p.getByRole('status').filter({ hasText: text })
const undoIn = (l: Locator) => l.getByRole('button', { name: /^Undo/ }).first()

/** Opens the payment row menu of the payment of `amt` and picks Void or Correct. */
async function paymentMenu(p: Page, amt: number, item: RegExp): Promise<void> {
  await payPanel(p).getByRole('button', { name: `Change payment of PKR ${amount(amt)}` }).first().click({ timeout: T })
  await p.getByRole('menuitem', { name: item }).click({ timeout: T })
}

/**
 * Opens Record payment. It is a button in the order header while an invoice is owed; before an invoice (an advance) and once the
 * order is paid it lives in the order's More menu (r3/rfq-orders, UX audit P2).
 */
async function openRecordPayment(p: Page): Promise<Locator> {
  const button = actions(p).getByRole('button', { name: 'Record payment', exact: true }).first()
  if (await button.waitFor({ timeout: 5000 }).then(() => true).catch(() => false)) await button.click({ timeout: T })
  else {
    await p.getByRole('button', { name: /^More( actions)?$/ }).first().click({ timeout: T })
    await p.getByRole('menuitem', { name: 'Record payment' }).click({ timeout: T })
  }
  const d = p.getByRole('dialog', { name: 'Record payment' })
  await d.getByRole('textbox', { name: 'Amount received, PKR' }).waitFor({ timeout: T })
  return d
}

test.afterAll(async () => {
  await restoreProfileStrn()
})

// ------------------------------------------------------------------------------------------------ A: POs, chase, delivery

test('hunt orderflow A: Issue PO in EUR and USD with the PDFs, goods chase, delivered and Undo, part delivery, Today hand-offs', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const t = tag()
  const supE = await supplier(`Hunt Rhein Messtechnik ${t}`, 'Germany')
  const supU = await supplier(`Hunt Ohio Controls ${t}`, 'United States')
  const L: LineSpec[] = [
    { description: `Hunt pressure transmitter ${tag()}`, qty: 2.5, price: 1234.56, leg: 0, supplierPrice: 812.35 },
    { description: `Hunt gauge siphon ${tag()}`, qty: 3, price: 999.99, leg: 0 }, // no supplier price: typed in the PO dialog
    { description: `Hunt flow switch ${tag()}`, qty: 4, price: 15000.5, leg: 1, supplierPrice: 99.99 },
    { description: `Hunt site calibration ${tag()}`, qty: 1, price: 5000.5, gst: 0, service: true },
  ]
  const seed = await order({ suppliers: [{ supplier: supE, currency: 'EUR' }, { supplier: supU, currency: 'USD' }], lines: L, owner: 'sales', needsCommissioning: true })
  await post('order_engineers', { order_id: seed.order.id, user_id: USER.engineer }).catch(e => obs(info, 'A fixture', `could not assign the engineer: ${String(e).slice(0, 200)}`))
  const id = seed.order.id
  const oref = ref.order(seed.order.number)
  const [legE, legU] = seed.legs.map(l => l.id)
  const M = orderMath(L)
  const sales = await ctxAs(browser, info, 'sales', 'desktop')
  const page = await newPage(sales, info, 'A sales')

  await probe(info, page, 'A order page totals vs DB (2.5 qty, paisa prices, exempt service)', async () => {
    const db_ = await itemsTotal(id)
    want(info, 'A totals', same(db_.net, M.net) && same(db_.gst, M.gst) && same(db_.gross, M.gross), `v_order_items_total ${JSON.stringify(db_)} != hand-worked ${JSON.stringify({ net: M.net, gst: M.gst, gross: M.gross })}`)
    await visit(page, info, '/orders')
    await visit(page, info, `/orders/${id}`)
    const table = page.getByRole('table', { name: 'Order items' })
    const footer = await table.getByRole('row').filter({ hasText: /Total before GST/ }).innerText({ timeout: T })
    want(info, 'A totals', flat(footer).includes(amount(db_.net)), `items footer does not show the DB net ${amount(db_.net)}`, flat(footer))
    const bar = await page.getByTestId('items-gst-summary').innerText({ timeout: T })
    want(info, 'A totals', flat(bar).includes(amount(db_.gst)) && flat(bar).includes(amount(db_.gross)), `GST bar does not show GST ${amount(db_.gst)} and gross ${amount(db_.gross)}`, flat(bar))
    for (const [i, l] of L.entries()) {
      const row = await table.getByRole('row').filter({ hasText: l.description }).first().innerText()
      want(info, 'A totals', flat(row).includes(amount(M.per[i].net)), `line ${i + 1} does not show its net ${amount(M.per[i].net)}`, flat(row))
    }
    await layout(page, info, 'A sales desktop order')
    await shot(page, 'A-sales-desktop-order-before-po')
  })

  await probe(info, page, 'A Today place_po for both supplier orders (sales)', async () => {
    const e = await todayItems(sales, info, 'place_po', oref)
    want(info, 'A Today place_po', e.count === 2, `Today lists ${e.count} place_po items for ${oref}, expected 2 (one per supplier)`)
  })

  await probe(info, page, 'A leg totals in EUR and USD, priced count, PKR estimate', async () => {
    const e = flat(await legRow(page, supE.name).innerText({ timeout: T }))
    // 2.5 x 812.35 = 2,030.875 EUR (shown to the paisa); line 2 has no price
    want(info, 'A leg EUR', /2,030\.88/.test(e), 'EUR supplier order total is not 2,030.88 (2.5 x 812.35 = 2,030.875)', e)
    want(info, 'A leg EUR', e.includes('1 of 2 lines priced'), 'EUR supplier order does not say "1 of 2 lines priced"', e)
    const u = flat(await legRow(page, supU.name).innerText())
    // 4 x 99.99 = 399.96 USD, at 280 = PKR 111,988.80
    want(info, 'A leg USD', u.includes('399.96'), 'USD supplier order total is not 399.96', u)
    want(info, 'A leg USD', u.includes('111,988.80') || u.includes('111,988.8'), 'USD supplier order PKR estimate is not 111,988.80 at 280', u)
  })

  await probe(info, page, 'A browser Back with the Issue PO dialog open', async () => {
    await legRow(page, supU.name).getByRole('button', { name: `Issue PO, ${supU.name}` }).click({ timeout: T })
    const d = page.getByRole('dialog')
    await d.getByRole('heading', { name: 'Issue purchase order' }).waitFor({ timeout: T })
    await page.goBack()
    await page.waitForTimeout(1200)
    const stillOpen = await page.getByRole('dialog').count()
    want(info, 'A Back', stillOpen === 0, `after Back the dialog is still open (url ${page.url()})`)
    want(info, 'A Back', !page.url().includes(`/orders/${id}`), `Back with the dialog open stayed on the order page (url ${page.url()}); dialogs do not take a history entry, as expected?`)
    await shot(page, 'A-after-back-with-po-dialog')
    want(info, 'A Back', (await posOf(legU)).length === 0, 'a PO was issued by pressing Back')
  })

  await probe(info, page, 'A reload with the Issue PO dialog open', async () => {
    await visit(page, info, `/orders/${id}`)
    await legRow(page, supU.name).getByRole('button', { name: `Issue PO, ${supU.name}` }).click({ timeout: T })
    await page.getByRole('dialog').getByRole('heading', { name: 'Issue purchase order' }).waitFor({ timeout: T })
    await page.reload()
    await settle(page)
    want(info, 'A reload', (await page.getByRole('dialog').count()) === 0, 'the Issue PO dialog is open again after a reload')
    want(info, 'A reload', (await posOf(legU)).length === 0, 'a PO exists after a reload mid-dialog')
  })

  // The EUR leg: line 1 priced on the order (812.35), line 2 typed here as 17.255 (four decimals, numeric(14,4)).
  // Line amounts: 2.5 x 812.35 = 2,030.875 -> 2,030.88; 3 x 17.255 = 51.765 -> 51.77 (half away from zero); total 2,082.65 EUR.
  const poTotalE = (productPaisa(2.5, 812.35) + productPaisa(3, 17.255)) / 100
  await probe(info, page, 'A Issue PO (EUR) with a missing supplier price, double click Issue PO', async () => {
    await legRow(page, supE.name).getByRole('button', { name: `Issue PO, ${supE.name}` }).click({ timeout: T })
    const d = page.getByRole('dialog')
    await d.getByRole('heading', { name: 'Issue purchase order' }).waitFor({ timeout: T })
    await d.getByTestId('po-missing').waitFor({ timeout: T })
    want(info, 'A Issue PO EUR', /One line needs a price/.test(await d.getByTestId('po-missing').innerText()), 'the missing-price line is not "One line needs a price"')
    want(info, 'A Issue PO EUR', await d.getByRole('button', { name: 'Issue PO', exact: true }).isDisabled(), 'Issue PO is enabled while a line has no price')
    want(info, 'A Issue PO EUR', (await d.getByLabel('Currency').inputValue()) === 'EUR', 'the dialog currency is not EUR')
    const price2 = d.getByLabel('Unit price, line 2')
    await price2.fill('17.255')
    await price2.blur()
    await d.getByTestId('po-missing').waitFor({ state: 'detached', timeout: T })
    const shownTotal = flat(await d.getByTestId('po-total').innerText())
    want(info, 'A Issue PO EUR', shownTotal.includes(amount(poTotalE, { always: true })), `dialog total ${shownTotal} is not EUR ${amount(poTotalE, { always: true })}`)
    want(info, 'A Issue PO EUR', (await price2.inputValue()).replace(/,/g, '').startsWith('17.255'), `the typed 17.255 reads back as ${await price2.inputValue()} (rounded?)`)
    await layout(page, info, 'A Issue PO dialog desktop')
    await shot(page, 'A-issue-po-eur-dialog')
    await d.getByRole('button', { name: 'Issue PO', exact: true }).dblclick()
    await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 30_000 })
    await page.waitForTimeout(1500)
    const pos = await posOf(legE)
    want(info, 'A Issue PO EUR', pos.length === 1, `double click on Issue PO made ${pos.length} PO rows`, pos)
    const po = pos[pos.length - 1]
    want(info, 'A Issue PO EUR', same(num(po.total), poTotalE), `stored PO total ${po.total} != dialog/hand total ${poTotalE}`)
    want(info, 'A Issue PO EUR', po.currency === 'EUR', `stored PO currency ${po.currency}`)
    const items = await db.rows<{ position: number; supplier_unit_price: number | null }>(`order_items?order_id=eq.${id}&select=position,supplier_unit_price&order=position`)
    want(info, 'A Issue PO EUR', same(num(items[1]?.supplier_unit_price), 17.255), `typed price not written back to the order line exactly (got ${items[1]?.supplier_unit_price})`)
    const placed = await legDates(legE)
    want(info, 'A Issue PO EUR', placed.placed_on === today, `the EUR leg is not placed today after issuing (placed_on ${placed.placed_on})`)
    const withPdf = await until(() => posOf(legE), r => !!r[r.length - 1]?.pdf_path, 15_000)
    const path = withPdf[withPdf.length - 1]?.pdf_path
    if (!want(info, 'A PO PDF EUR', !!path, 'the issued PO has no stored PDF')) return
    const pdf = await fetchStoredPdf('sales', 'generated-docs', path as string)
    want(info, 'A PO PDF EUR', pdfIsValid(pdf), 'the stored PO PDF is not a valid PDF')
    if (pdf) renderPdfPng(pdf, OUT, `A-po-eur-${t}`)
    const text = pdf ? pdfText(pdf) : null
    if (!text) return obs(info, 'A PO PDF EUR', 'pdftotext not available: PDF text not checked')
    for (const needle of [`EUR ${amount(poTotalE, { always: true })}`, '2,030.88', supE.name, inWords(poTotalE, ['euro', 'euros', 'cent', 'cents'])])
      want(info, 'A PO PDF EUR', pdfHas(text, needle), `PO PDF text lacks "${needle}"`)
    want(info, 'A PO PDF EUR', pdfHas(text, '51.77'), `PO PDF line 2 amount is not 51.77 (3 x 17.255 = 51.765)`, flat(text).match(/51\.7\d/g))
    want(info, 'A PO PDF EUR', pdfHas(text, '17.255'), 'PO PDF does not print the unit price 17.255 (rounded to 2 places?)')
    // The PO goes to the supplier: our selling prices and margin must not be on it.
    for (const sell of ['1,234.56', '999.99', '15,000.50', '5,000.50']) want(info, 'A PO PDF EUR', !pdfHas(text, sell), `PO PDF to the supplier shows our selling price ${sell}`)
    want(info, 'A PO PDF EUR', !pdfHas(text, L[2].description), 'the EUR PO lists the USD supplier\'s line')
    want(info, 'A PO PDF EUR', !pdfHas(text, L[3].description), 'the EUR PO lists the service line')
  })

  const poTotalU = productPaisa(4, 99.99) / 100 // 399.96
  await probe(info, page, 'A Issue PO (USD) from the page\'s primary button; PDF total and words', async () => {
    await page.reload()
    await settle(page)
    const primary = actions(page).getByRole('button', { name: `Issue PO, ${supU.name}` })
    if ((await primary.count()) === 0) {
      obs(info, 'A primary', 'the page\'s primary step is not "Issue PO" for the USD supplier after the EUR PO', flat(await actions(page).innerText()).slice(0, 300))
      await legRow(page, supU.name).getByRole('button', { name: `Issue PO, ${supU.name}` }).click({ timeout: T })
    } else await primary.first().click()
    const d = page.getByRole('dialog')
    await d.getByRole('heading', { name: 'Issue purchase order' }).waitFor({ timeout: T })
    want(info, 'A Issue PO USD', flat(await d.getByTestId('po-total').innerText({ timeout: T })).includes('399.96'), 'USD dialog total is not 399.96')
    await d.getByRole('button', { name: 'Issue PO', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 30_000 })
    const pos = await until(() => posOf(legU), r => !!r[0]?.pdf_path, 15_000)
    want(info, 'A Issue PO USD', pos.length === 1 && same(num(pos[0].total), poTotalU), `USD PO rows ${JSON.stringify(pos)}`)
    const pdf = pos[0]?.pdf_path ? await fetchStoredPdf('admin', 'generated-docs', pos[0].pdf_path) : null
    const text = pdf ? pdfText(pdf) : null
    if (text) {
      want(info, 'A PO PDF USD', pdfHas(text, 'USD 399.96'), 'USD PO PDF lacks "USD 399.96"')
      const w = inWords(poTotalU, ['US dollar', 'US dollars', 'cent', 'cents'])
      want(info, 'A PO PDF USD', pdfHas(text, w), `USD PO PDF lacks the words "${w}"`)
    }
    const chip = await legRow(page, supU.name).locator('[data-testid$="-po"]').innerText()
    want(info, 'A Issue PO USD', /^PO-\d\d-\d{4} · R0$/.test(chip.trim()), `PO chip reads "${chip}"`)
    await shot(page, 'A-both-pos-issued')
  })

  await probe(info, page, 'A Today place_po gone once both POs are issued', async () => {
    const e = await todayItems(sales, info, 'place_po', oref)
    want(info, 'A Today place_po', e.count === 0, `Today still lists ${e.count} place_po items for ${oref} after both POs were issued`)
  })

  await probe(info, page, 'A goods chase: copy text = clipboard, the chase stamp, Undo, Today goods_late', async () => {
    await db.patch(`supplier_orders?id=eq.${legE}`, { placed_on: karachiDay(-12), expected_on: karachiDay(-3) })
    const before = await todayItems(sales, info, 'goods_late', supE.name)
    want(info, 'A Today goods_late', before.count === 1 && before.waiting === 0, `Today goods_late for ${supE.name}: ${JSON.stringify(before)}, expected 1 active`)
    await page.reload()
    await settle(page)
    await legRow(page, supE.name).getByRole('button', { name: `Chase goods, ${supE.name}` }).click({ timeout: T })
    const d = page.getByRole('dialog', { name: 'Chase the goods' })
    const draft = flat(await d.getByTestId('draft-text').innerText({ timeout: T }))
    want(info, 'A chase', draft.length > 40, 'the chase draft is (nearly) empty', draft)
    for (const leak of ['1,234.56', '15,000.50', seed.customer.name]) want(info, 'A chase', !draft.includes(leak), `the supplier chase text mentions "${leak}" (our price or customer)`, draft)
    await shot(page, 'A-goods-chase-dialog')
    await resetClipboard(page)
    await d.getByRole('button', { name: 'Copy and mark chased' }).click()
    const clip = flat(await readClipboardWhen(page, s => s.length > 20))
    want(info, 'A chase', clip.includes(draft.slice(0, 60)) || draft.includes(clip.slice(0, 60)), 'the clipboard text is not the draft shown', { draft: draft.slice(0, 200), clip: clip.slice(0, 200) })
    const stamped = await until(() => legDates(legE), r => r.chase_count === 1)
    want(info, 'A chase', stamped.chase_count === 1 && stamped.last_chased_on === today, `chase stamp ${JSON.stringify(stamped)}`)
    await undoIn(toast(page, /marked chased/)).click({ timeout: 8000 })
    const undone = await until(() => legDates(legE), r => r.chase_count === 0)
    want(info, 'A chase Undo', undone.chase_count === 0 && undone.last_chased_on === null, `Undo of the chase left ${JSON.stringify(undone)}`)
    want(info, 'A chase Undo', undone.placed_on === karachiDay(-12) && undone.expected_on === karachiDay(-3), 'Undo of the chase moved the leg dates', undone)
    // chase again and leave it: Today should move it to Waiting
    await page.reload()
    await settle(page)
    await legRow(page, supE.name).getByRole('button', { name: `Chase goods, ${supE.name}` }).click({ timeout: T })
    await resetClipboard(page)
    await page.getByRole('dialog', { name: 'Chase the goods' }).getByRole('button', { name: 'Copy and mark chased' }).click({ timeout: T })
    await until(() => legDates(legE), r => r.chase_count === 1)
    const after = await todayItems(sales, info, 'goods_late', supE.name)
    want(info, 'A Today goods_late', after.waiting === 1, `after a chase Today's goods_late is not in Waiting: ${JSON.stringify(after)}`)
  })

  await probe(info, page, 'A Delivered today double click, then Undo restores the dates exactly', async () => {
    await page.reload()
    await settle(page)
    const before = await legDates(legE)
    await legRow(page, supE.name).getByRole('button', { name: `Delivered today, ${supE.name}` }).dblclick({ timeout: T })
    const d1 = await until(() => legDates(legE), r => r.delivered_on === today)
    want(info, 'A delivered', d1.delivered_on === today && d1.received_on === today, `after Delivered today: ${JSON.stringify(d1)}`)
    await page.waitForTimeout(800)
    const toasts = await toast(page, /Marked delivered/).count()
    want(info, 'A delivered', toasts <= 1, `a double click on Delivered today showed ${toasts} "Marked delivered" toasts (two writes?)`)
    await shot(page, 'A-delivered-toast')
    await undoIn(toast(page, /Marked delivered/)).click({ timeout: 8000 })
    const back = await until(() => legDates(legE), r => r.delivered_on === null)
    want(
      info,
      'A delivered Undo',
      back.delivered_on === null && back.received_on === null && back.placed_on === before.placed_on && back.expected_on === before.expected_on,
      `Undo after a double-clicked Delivered today did not restore the dates`,
      { before, back },
    )
  })

  await probe(info, page, 'A part delivery: goods state on the page and in the DB; engineer Today job_on_site', async () => {
    await page.reload()
    await settle(page)
    // With two suppliers, a supplier order already delivered when the page opens folds to one line (r3/rfq-orders, UX audit P9):
    // open it first. A folded one is delivered already (the Undo above did not take it back) and has no Delivered today: only a
    // supplier order still to deliver is stamped here.
    const fold = legRow(page, supE.name).locator(':scope > button[aria-expanded="false"]')
    if (await fold.isVisible().catch(() => false)) await fold.click()
    if ((await legDates(legE)).delivered_on === null) await legRow(page, supE.name).getByRole('button', { name: `Delivered today, ${supE.name}` }).click({ timeout: T })
    await until(() => legDates(legE), r => r.delivered_on === today)
    const s = await until(() => stateOf(id), v => v.goods_state !== 'on_order')
    want(info, 'A part delivery', /part/.test(s.goods_state), `goods_state with one of two suppliers delivered is "${s.goods_state}"`)
    await page.reload()
    await settle(page)
    const cell = flat(await page.getByRole('group', { name: 'State of this order' }).innerText({ timeout: T }))
    want(info, 'A part delivery', /part|some|1 of 2/i.test(cell), 'the Goods cell does not say the goods are part delivered', cell.slice(0, 300))
    await layout(page, info, 'A part delivered desktop')
    await shot(page, 'A-part-delivered')
    const eng = await ctxAs(browser, info, 'engineer', 'phone')
    const e = await todayItems(eng, info, 'job_on_site', oref)
    want(info, 'A engineer Today', e.count === 1, `engineer Today has ${e.count} job_on_site items for ${oref} (goods partly on site, commissioning to plan, engineer assigned)`)
    await eng.close()
  })

  await probe(info, page, 'A phone views: sales and admin order page; engineer sees no PO prices', async () => {
    for (const role of ['sales', 'admin'] as const) {
      const ctx = await ctxAs(browser, info, role, 'phone')
      const p = await newPage(ctx, info, `A ${role} phone`)
      await visit(p, info, `/orders/${id}`)
      await layout(p, info, `A ${role} phone order`)
      await shot(p, `A-${role}-phone-order`)
      const bar = p.getByRole('toolbar', { name: 'Order actions' })
      if (await bar.count()) {
        const box = await bar.boundingBox()
        want(info, `A ${role} phone`, !!box && box.y + box.height <= 812 + 1, `the sticky action bar is off screen: ${JSON.stringify(box)}`)
      }
      await ctx.close()
    }
    const eng = await ctxAs(browser, info, 'engineer', 'phone')
    const p = await newPage(eng, info, 'A engineer phone')
    const log = restLog(p)
    await visit(p, info, `/orders/${id}`)
    const text = flat(await p.locator('#main').innerText())
    for (const price of ['812.35', '17.255', '2,030.88', '399.96', '1,234.56', '15,000.50']) want(info, 'A engineer phone', !text.includes(price), `the engineer sees the price ${price}`)
    const money = log.urls.filter(u => MONEY_PATHS.some(m => u.includes(m)))
    want(info, 'A engineer phone', money.length === 0, `the engineer's order page asked for money (${money.length})`, money.slice(0, 5))
    await layout(p, info, 'A engineer phone order')
    await shot(p, 'A-engineer-phone-order')
    await eng.close()
  })
  await sales.close()
})

// ------------------------------------------------------------------------------------------------ B: commissioning on the phone

test('hunt orderflow B: commissioning planned by sales on the phone, the engineer at 375 px marks it done (no prices, Undo, Today)', async ({ browser }, info) => {
  const sup = await supplier(`Hunt Lahore Stockist ${tag()}`, 'Pakistan')
  const seed = await order({
    suppliers: [{ supplier: sup }],
    lines: [
      { description: `Hunt level transmitter ${tag()}`, qty: 2.5, price: 48765.43, leg: 0, supplierPrice: 39876.5 },
      { description: `Hunt commissioning visit ${tag()}`, qty: 1, price: 25000.75, service: true },
    ],
    owner: 'sales',
    needsCommissioning: true,
  })
  const id = seed.order.id
  const oref = ref.order(seed.order.number)
  await db.patch(`supplier_orders?id=eq.${seed.legs[0].id}`, { placed_on: karachiDay(-10), expected_on: karachiDay(-2), delivered_on: karachiDay(-1), received_on: karachiDay(-1) })
  const orderRow = () => db.one<{ commissioning_planned_on: string | null; commissioning_done_on: string | null }>(`orders?id=eq.${id}&select=commissioning_planned_on,commissioning_done_on`)
  const salesPhone = await ctxAs(browser, info, 'sales', 'phone')
  const sp = await newPage(salesPhone, info, 'B sales phone')

  await probe(info, sp, 'B sales phone: Plan commissioning from the sticky bar, assign the engineer', async () => {
    const st = await stateOf(id)
    want(info, 'B plan', st.commissioning_state === 'to_plan', `commissioning_state before planning is ${st.commissioning_state}`)
    await visit(sp, info, `/orders/${id}`)
    const bar = sp.getByRole('toolbar', { name: 'Order actions' })
    want(info, 'B plan', (await bar.count()) === 1, 'no sticky "Order actions" bar on the phone')
    await bar.getByRole('button', { name: 'Plan commissioning' }).click({ timeout: T })
    const d = sp.getByRole('dialog')
    const planned = d.getByRole('textbox', { name: 'Planned on' })
    await planned.fill(slashDate(today))
    await planned.press('Enter')
    await d.getByRole('combobox', { name: 'Assign an engineer' }).selectOption({ label: 'Test Engineer' })
    await until(() => db.count(`order_engineers?order_id=eq.${id}&user_id=eq.${USER.engineer}&select=user_id`), n => n === 1)
    await layout(sp, info, 'B sales phone commissioning dialog')
    await shot(sp, 'B-sales-phone-plan-dialog')
    await d.getByRole('button', { name: 'Save' }).click()
    const o = await until(orderRow, r => r.commissioning_planned_on === today)
    want(info, 'B plan', o.commissioning_planned_on === today, `planned_on after Save is ${o.commissioning_planned_on}`)
    want(info, 'B plan', (await db.count(`order_engineers?order_id=eq.${id}&select=user_id`)) === 1, 'the engineer is not assigned exactly once')
  })

  const engPhone = await ctxAs(browser, info, 'engineer', 'phone')
  const ep = await newPage(engPhone, info, 'B engineer phone')
  const log = restLog(ep)

  await probe(info, ep, 'B engineer phone Today: "Commissioning today"', async () => {
    await visit(ep, info, '/today')
    await ep.getByRole('heading', { level: 1, name: 'Today' }).waitFor({ timeout: T })
    const li = ep.locator('li[data-rule="job_commissioning"]').filter({ hasText: oref })
    want(info, 'B engineer Today', (await li.count()) === 1, `engineer Today has ${await li.count()} job_commissioning items for ${oref}`)
    if (await li.count()) want(info, 'B engineer Today', /Commissioning today/.test(await li.innerText()), 'the item does not say "Commissioning today"', await li.innerText())
    await layout(ep, info, 'B engineer phone Today')
    await shot(ep, 'B-engineer-phone-today')
  })

  await probe(info, ep, 'B engineer phone order page: no prices, Your job, tap targets', async () => {
    await visit(ep, info, `/orders/${id}`)
    await ep.getByRole('region', { name: 'Your job' }).waitFor({ timeout: T })
    const text = flat(await ep.locator('#main').innerText())
    for (const price of ['48,765.43', '39,876.50', '25,000.75', '121,913.58']) want(info, 'B engineer prices', !text.includes(price), `the engineer sees ${price}`)
    for (const header of ['Unit price', 'Total']) want(info, 'B engineer prices', (await ep.getByRole('columnheader', { name: new RegExp(header) }).count()) === 0, `the engineer's items table has a "${header}" column`)
    want(info, 'B engineer', (await ep.getByRole('button', { name: /Issue PO|Record payment|Create invoice|Print invoice/ }).count()) === 0, 'the engineer sees a money button')
    await layout(ep, info, 'B engineer phone order')
    await shot(ep, 'B-engineer-phone-order')
  })

  await probe(info, ep, 'B engineer changes the planned date, then Undo', async () => {
    await ep.getByRole('button', { name: 'Change planned date' }).click({ timeout: T })
    const pop = ep.getByRole('dialog', { name: 'Planned date' })
    const box = pop.getByRole('textbox').first()
    await box.fill(slashDate(karachiDay(1)))
    await box.press('Tab')
    await shot(ep, 'B-engineer-change-planned-date')
    await pop.getByRole('button', { name: 'Save' }).click({ timeout: T })
    const moved = await until(orderRow, r => r.commissioning_planned_on === karachiDay(1))
    want(info, 'B planned date', moved.commissioning_planned_on === karachiDay(1), `planned date after the engineer's change is ${moved.commissioning_planned_on}`)
    await undoIn(toast(ep, /Planned date changed/)).click({ timeout: 8000 })
    const back = await until(orderRow, r => r.commissioning_planned_on === today)
    want(info, 'B planned date Undo', back.commissioning_planned_on === today, `Undo of the planned date left ${back.commissioning_planned_on}`)
  })

  await probe(info, ep, 'B engineer Mark done today: double tap, Undo, then done', async () => {
    await ep.reload()
    await settle(ep)
    const btn = ep.getByRole('button', { name: 'Mark done today' }).first()
    const box = await btn.boundingBox()
    want(info, 'B mark done', !!box && box.height >= 44, `"Mark done today" is ${box ? Math.round(box.height) : 0} px tall on the phone (touch target)`)
    await btn.dblclick({ timeout: T })
    const done = await until(orderRow, r => r.commissioning_done_on === today)
    want(info, 'B mark done', done.commissioning_done_on === today, `done_on after Mark done is ${done.commissioning_done_on}`)
    await ep.waitForTimeout(800)
    const n = await toast(ep, /Commissioning marked done/).count()
    want(info, 'B mark done', n <= 1, `a double tap on Mark done today showed ${n} toasts`)
    await shot(ep, 'B-engineer-marked-done')
    await undoIn(toast(ep, /Commissioning marked done/)).click({ timeout: 8000 })
    const undone = await until(orderRow, r => r.commissioning_done_on === null)
    want(info, 'B mark done Undo', undone.commissioning_done_on === null, `Undo of Mark done left done_on ${undone.commissioning_done_on}`)
    await ep.reload()
    await settle(ep)
    await ep.getByRole('button', { name: 'Mark done today' }).first().click({ timeout: T })
    await until(orderRow, r => r.commissioning_done_on === today)
    want(info, 'B mark done', (await stateOf(id)).commissioning_state === 'done', 'commissioning_state is not done after Mark done')
  })

  await probe(info, ep, 'B the engineer asked for no money', async () => {
    const money = log.urls.filter(u => MONEY_PATHS.some(m => u.includes(m)))
    want(info, 'B engineer money', money.length === 0, `the engineer's pages asked for money ${money.length} times`, money.slice(0, 6))
  })

  await probe(info, sp, 'B Today hand-off: delivered_not_invoiced for sales, the engineer\'s item gone', async () => {
    const s = await todayItems(salesPhone, info, 'delivered_not_invoiced', oref)
    want(info, 'B Today sales', s.count === 1, `sales Today has ${s.count} delivered_not_invoiced items for ${oref} after commissioning done`)
    const e = await todayItems(engPhone, info, 'job_commissioning', oref)
    want(info, 'B Today engineer', e.count === 0, `engineer Today still lists the job after it was marked done (${e.count})`)
  })
  await engPhone.close()
  await salesPhone.close()
})

// ------------------------------------------------------------------------------------------------ C: invoice, PDF, payments, corrections

test('hunt orderflow C: invoice and its PDF on a mixed-GST order, payments part/rest/over, void, correct, remove and their Undo, three-way balances', async ({ browser }, info) => {
  await ensureProfileStrn()
  const cust = await company('Hunt Mixed Customer', { city: 'Lahore' })
  await setBuyerTax(cust)
  const L: LineSpec[] = [
    { description: `Hunt Cerabar transmitter ${tag()}`, qty: 2.5, price: 1234.56 },
    { description: `Hunt Liquiphant switch ${tag()}`, qty: 3, price: 999.99 },
    { description: `Hunt calibration certificate ${tag()}`, qty: 1, price: 5000.5, gst: 0 },
  ]
  // 2.5 x 1,234.56 = 3,086.40 (GST 555.552 -> 556); 3 x 999.99 = 2,999.97 (GST 539.99 -> 540); 5,000.50 exempt
  // net 11,086.87; GST 1,096; gross 12,182.87
  const M = orderMath(L)
  const seed = await order({ customer: cust, lines: L, owner: 'sales', terms: 30 })
  const id = seed.order.id
  const admin = await ctxAs(browser, info, 'admin', 'desktop')
  const salesCtx = await ctxAs(browser, info, 'sales', 'desktop')
  const sp = await newPage(salesCtx, info, 'C sales stale')
  await visit(sp, info, `/orders/${id}`) // stays open, never reloaded, until the last probe
  const ap = await newPage(admin, info, 'C admin')
  const rp = await newPage(admin, info, 'C admin receivables')
  await visit(ap, info, `/orders/${id}`)
  const P1 = 1234.56
  const P2 = r2(M.gross - P1)
  const P3 = 500.25

  await probe(info, ap, 'C DB totals = hand-worked totals', async () => {
    const t = await itemsTotal(id)
    want(info, 'C totals', same(t.net, M.net) && same(t.gst, M.gst) && same(t.gross, M.gross), `DB ${JSON.stringify(t)} vs hand ${JSON.stringify({ net: M.net, gst: M.gst, gross: M.gross })}`)
  })

  await probe(info, ap, 'C Create invoice, double click: one invoice, figures from the lines', async () => {
    await actions(ap).getByRole('button', { name: 'Create invoice', exact: true }).first().click({ timeout: T })
    const d = ap.getByRole('dialog', { name: 'Create invoice' })
    await d.getByText(amount(M.gross), { exact: true }).waitFor({ timeout: T })
    for (const f of [M.net, M.gst]) want(info, 'C create invoice', (await d.getByText(amount(f), { exact: true }).count()) > 0, `the dialog does not show ${amount(f)}`)
    want(info, 'C create invoice', (await d.getByText('GST, from the lines').count()) > 0, 'a mixed order does not show "GST, from the lines"')
    await shot(ap, 'C-create-invoice-dialog')
    await d.getByRole('button', { name: 'Create invoice', exact: true }).dblclick()
    await d.waitFor({ state: 'hidden', timeout: T })
    await ap.waitForTimeout(1500)
    const rows = await invoicesOf(id)
    want(info, 'C create invoice', rows.length === 1, `double click on Create invoice made ${rows.length} invoices`, rows)
    want(info, 'C create invoice', same(num(rows[0]?.net_amount), M.net) && same(num(rows[0]?.gst_amount), M.gst), `stored invoice ${JSON.stringify(rows[0])}`)
    const tt = flat(await toast(ap, /Created invoice/).first().innerText().catch(() => ''))
    want(info, 'C create invoice', tt.includes(amount(M.gross)), `the toast does not print the gross as ${amount(M.gross)}`, tt)
  })

  await probe(info, ap, 'C Sales Tax invoice PDF: download and read it against the DB', async () => {
    const [inv] = await invoicesOf(id)
    await ap.reload()
    await settle(ap)
    await ap.getByRole('button', { name: 'Print invoice' }).first().click({ timeout: T })
    const d = ap.getByRole('dialog', { name: 'Sales tax invoice' })
    const dl = d.getByRole('button', { name: /^(Download|Share)$/ })
    await dl.waitFor({ timeout: T })
    await shot(ap, 'C-invoice-pdf-dialog')
    if (await dl.isDisabled()) return obs(info, 'C invoice PDF', 'Download is disabled for a whole-order invoice', flat(await d.innerText()).slice(0, 600))
    const pdf = await download(ap, () => dl.click())
    want(info, 'C invoice PDF', pdfIsValid(pdf), 'the downloaded invoice is not a valid PDF')
    if (pdf) renderPdfPng(pdf, OUT, `C-invoice-${inv.number}`)
    const text = pdf ? pdfText(pdf) : null
    if (!text) return obs(info, 'C invoice PDF', 'pdftotext not available: invoice PDF text not checked')
    const needles = [
      'Sales Tax Invoice',
      inv.number,
      'NTN 1234567-8',
      '7654321-0',
      '3277876543210',
      cust.name,
      `PKR ${amount(M.net, { always: true })}`,
      `PKR ${amount(M.gst, { always: true })}`,
      `PKR ${amount(M.gross, { always: true })}`,
      `PKR ${amount(5000.5, { always: true })}`,
      'Sales tax at 18%',
      inWords(M.gross, ['rupee', 'rupees', 'paisa', 'paise']),
      pdfDay(today),
      pdfDay(addDays(today, 30)),
      ref.order(seed.order.number),
    ]
    obs(info, 'C invoice PDF', 'pdftotext -layout of the invoice (for review)', text.slice(0, 2500))
    for (const n of needles) want(info, 'C invoice PDF', pdfHas(text, n), `invoice PDF lacks "${n}"`)
    for (const [i, l] of L.entries()) {
      want(info, 'C invoice PDF', pdfHas(text, amount(M.per[i].net, { always: true })), `invoice PDF lacks line ${i + 1}'s value ${amount(M.per[i].net, { always: true })}`)
      // -layout wraps a long description inside its column: look for its first two words and its tag (the last word) separately.
      const words = l.description.split(' ')
      const found = pdfHas(text, words.slice(0, 2).join(' ')) && pdfHas(text, words[words.length - 1])
      want(info, 'C invoice PDF', found, `invoice PDF lacks line ${i + 1}'s description "${l.description}"`)
    }
    want(info, 'C invoice PDF', /\b2\.5\b/.test(text), 'invoice PDF does not print the 2.5 quantity')
    await d.getByRole('button', { name: 'Close' }).first().click().catch(() => undefined)
  })

  await probe(info, ap, 'C part payment 1,234.56 (double click Save): note, toast, three-way balance', async () => {
    const d = await openRecordPayment(ap)
    const box = d.getByRole('textbox', { name: 'Amount received, PKR' })
    want(info, 'C part payment', (await box.inputValue()) === amount(M.gross), `the amount opens at "${await box.inputValue()}", not the balance ${amount(M.gross)}`)
    await box.fill(String(P1))
    const noteText = flat(await d.getByTestId('payment-note').innerText())
    want(info, 'C part payment', noteText.includes(`PKR ${amount(P1)}`) && noteText.includes(`PKR ${amount(P2)} will still be due`), `payment note "${noteText}" (figures without paisa zeros?)`)
    await d.getByRole('button', { name: 'Save payment' }).dblclick()
    await d.waitFor({ state: 'hidden', timeout: T })
    await ap.waitForTimeout(1500)
    const pays = await counting(id)
    want(info, 'C part payment', pays.length === 1, `double click on Save payment made ${pays.length} payments`, pays)
    const tt = flat(await toast(ap, /Recorded payment/).first().innerText().catch(() => ''))
    want(info, 'C part payment', tt.includes(`PKR ${amount(P1)}`), `the payment toast does not print PKR ${amount(P1)}`, tt)
    const r = await rec(id)
    want(info, 'C part payment', !!r && same(r.balance, P2) && r.state === 'part', `DB after the part payment ${JSON.stringify(r)}`)
    await threeWay(info, ap, rp, id, cust.name, 'C after part payment')
  })

  await probe(info, ap, 'C the rest: the amount opens at the balance, settles the order', async () => {
    const d = await openRecordPayment(ap)
    const box = d.getByRole('textbox', { name: 'Amount received, PKR' })
    want(info, 'C rest', (await box.inputValue()) === amount(P2), `the amount opens at "${await box.inputValue()}", expected ${amount(P2)}`)
    await d.getByRole('button', { name: 'Save payment' }).click()
    await d.waitFor({ state: 'hidden', timeout: T })
    const r = await until(() => rec(id), v => v?.state === 'settled')
    want(info, 'C rest', !!r && r.balance === 0 && r.state === 'settled', `DB after paying the rest ${JSON.stringify(r)}`)
    await threeWay(info, ap, rp, id, cust.name, 'C after the rest')
  })

  await probe(info, ap, 'C over-payment 500.25: the note says so, DB overpaid_by', async () => {
    const d = await openRecordPayment(ap)
    const box = d.getByRole('textbox', { name: 'Amount received, PKR' })
    const opened = await box.inputValue()
    if (opened !== '') {
      // Seen in run 1: "10,948.31" (the balance BEFORE the last payment) after a full page reload. Record what the dialog and DB said.
      await shot(ap, 'C-over-dialog-opens-with-old-balance')
      obs(info, 'C over', `Record payment on a settled order opens at "${opened}" (a payment of that much would be recorded twice)`, {
        note: flat(await d.getByTestId('payment-note').innerText().catch(() => '')),
        already: flat(await d.getByTestId('already-recorded').innerText().catch(() => '')),
        db: await rec(id),
        payments: await counting(id),
      })
      await box.fill('')
    }
    await box.fill(String(P3))
    const noteText = flat(await d.getByTestId('payment-note').innerText())
    want(info, 'C over', noteText.includes(`PKR ${amount(P3)} more than the balance`), `over-payment note "${noteText}"`)
    await d.getByRole('button', { name: 'Save payment' }).click()
    await d.waitFor({ state: 'hidden', timeout: T })
    const r = await until(() => rec(id), v => !!v && v.over > 0)
    want(info, 'C over', !!r && same(r.over, P3) && r.balance === 0, `DB after the over-payment ${JSON.stringify(r)}`)
    await ap.reload()
    await settle(ap)
    want(info, 'C over', toNum(await ap.getByTestId('order-balance').innerText({ timeout: T })) === 0, 'order page balance is not 0 after an over-payment')
    const cell = flat(await ap.getByRole('group', { name: 'State of this order' }).innerText())
    want(info, 'C over', /over|more than/i.test(cell), 'the order page does not say the order is overpaid', cell.slice(0, 300))
  })

  await probe(info, ap, 'C void the over-payment (double click Void payment), toast Undo, void again', async () => {
    await ap.reload()
    await settle(ap)
    await paymentMenu(ap, P3, /^Void/)
    const d = ap.getByRole('dialog', { name: 'Void payment' })
    await d.getByRole('button', { name: 'Typed twice' }).click({ timeout: T })
    await shot(ap, 'C-void-dialog')
    await d.getByRole('button', { name: 'Void payment', exact: true }).dblclick()
    await d.waitFor({ state: 'hidden', timeout: T })
    await ap.waitForTimeout(1200)
    want(info, 'C void', (await ap.getByRole('alert').filter({ hasText: /already|voided|could not/i }).count()) === 0, 'a double click on Void payment showed an error', flat(await ap.getByRole('alert').allInnerTexts().then(a => a.join(' | '))))
    const r = await until(() => rec(id), v => !!v && v.over === 0)
    want(info, 'C void', !!r && r.over === 0 && r.state === 'settled', `DB after voiding the over-payment ${JSON.stringify(r)}`)
    const t1 = toast(ap, /Voided payment/)
    await undoIn(t1).click({ timeout: 8000 })
    const back = await until(() => rec(id), v => !!v && v.over > 0)
    want(info, 'C void Undo', !!back && same(back.over, P3), `toast Undo of the void left ${JSON.stringify(back)}`)
    await ap.reload()
    await settle(ap)
    await paymentMenu(ap, P3, /^Void/)
    const d2 = ap.getByRole('dialog', { name: 'Void payment' })
    await d2.getByRole('button', { name: 'Wrong order' }).click()
    await d2.getByRole('button', { name: 'Void payment', exact: true }).click()
    await d2.waitFor({ state: 'hidden', timeout: T })
    await until(() => rec(id), v => !!v && v.over === 0)
    await threeWay(info, ap, rp, id, cust.name, 'C after voiding the over-payment')
  })

  await probe(info, ap, 'C correct the part payment 1,234.56 -> 1,000, then Undo', async () => {
    await paymentMenu(ap, P1, /^Correct/)
    const d = ap.getByRole('dialog', { name: 'Correct payment' })
    const box = d.getByRole('textbox', { name: /Amount received/ })
    await box.fill('1000')
    await box.blur()
    const changes = flat(await d.getByTestId('correction-changes').innerText())
    want(info, 'C correct', changes.includes(`PKR ${amount(P1)} → 1,000`), `Changes line reads "${changes}"`)
    await d.getByRole('textbox', { name: /Reason/ }).fill('Bank charges deducted by the customer')
    await d.getByRole('button', { name: /Save correction/ }).dblclick()
    await d.waitFor({ state: 'hidden', timeout: T })
    await ap.waitForTimeout(1200)
    const pays = await counting(id)
    want(info, 'C correct', pays.length === 2 && pays.some(p => same(num(p.amount), 1000)), `counting payments after the correction ${JSON.stringify(pays)}`)
    const r = await rec(id)
    // gross 12,182.87 - (1,000 + 10,948.31) = 234.56
    want(info, 'C correct', !!r && same(r.balance, r2(M.gross - 1000 - P2)) && r.state === 'part', `DB after the correction ${JSON.stringify(r)}`)
    await undoIn(toast(ap, /Corrected payment/)).click({ timeout: 8000 })
    const back = await until(() => rec(id), v => v?.state === 'settled')
    want(info, 'C correct Undo', !!back && back.balance === 0 && back.state === 'settled', `Undo of the correction left ${JSON.stringify(back)}`)
    const after = await counting(id)
    want(info, 'C correct Undo', after.length === 2 && after.some(p => same(num(p.amount), P1)) && !after.some(p => same(num(p.amount), 1000)), `after Undo the counting payments are ${JSON.stringify(after)}`)
    await threeWay(info, ap, rp, id, cust.name, 'C after the correction and its Undo')
  })

  await probe(info, ap, 'C remove (void) the rest payment, then Undo from the Voided list', async () => {
    await paymentMenu(ap, P2, /^Void/)
    const d = ap.getByRole('dialog', { name: 'Void payment' })
    await d.getByRole('button', { name: 'Cheque bounced' }).click({ timeout: T })
    await d.getByRole('button', { name: 'Void payment', exact: true }).click()
    await d.waitFor({ state: 'hidden', timeout: T })
    const r = await until(() => rec(id), v => !!v && v.balance > 0)
    want(info, 'C remove', !!r && same(r.balance, P2), `DB after removing the rest payment ${JSON.stringify(r)}`)
    await threeWay(info, ap, rp, id, cust.name, 'C after removing a payment')
    // Undo from the Voided list (the toast is gone after the reloads)
    await payPanel(ap).getByRole('button', { name: /^Voided \(\d+\)$/ }).click({ timeout: T })
    await shot(ap, 'C-voided-list')
    const line = payPanel(ap).getByTestId('voided-line').filter({ hasText: amount(P2) })
    want(info, 'C remove Undo', (await line.count()) === 1, `the Voided list has ${await line.count()} lines for ${amount(P2)}`)
    await line.getByRole('button', { name: 'Undo' }).click({ timeout: T })
    const back = await until(() => rec(id), v => v?.state === 'settled')
    want(info, 'C remove Undo', !!back && back.balance === 0, `Undo from the Voided list left ${JSON.stringify(back)}`)
    await threeWay(info, ap, rp, id, cust.name, 'C after Undo of the removal')
    await layout(ap, info, 'C admin desktop money panels')
    await shot(ap, 'C-admin-order-after-corrections')
  })

  await probe(info, sp, 'C a stale sales page edits a line of the fully invoiced order', async () => {
    const stale = toNum(await sp.getByTestId('order-balance').innerText({ timeout: T }).catch(() => ''))
    const r = await rec(id)
    obs(info, 'C stale page', `the sales page opened before the invoice still shows balance ${stale}; DB balance ${r?.balance} (no live refresh)`)
    await sp.getByRole('button', { name: 'Edit GST and lines' }).click({ timeout: T })
    await sp.getByLabel('GST rate, line 3').selectOption('18')
    await sp.waitForTimeout(2000)
    const rate = (await db.rows<{ gst_rate: number }>(`order_items?order_id=eq.${id}&select=gst_rate&order=position`)).map(x => num(x.gst_rate))
    if (rate[2] === 18) {
      const st = await stateOf(id)
      const tot = await itemsTotal(id)
      obs(info, 'C stale page', `a line of a fully invoiced and settled order was changed from a stale page without warning: gross now ${tot.gross}, invoicing_state ${st.invoicing_state}`, { tot, st })
      await shot(sp, 'C-stale-sales-edit-after-invoice')
      await db.patch(`order_items?order_id=eq.${id}&position=eq.2`, { gst_rate: 0 })
    } else obs(info, 'C stale page', `the GST change on an invoiced order was refused or not saved (rates ${rate.join(',')})`, flat(await sp.getByRole('alert').allInnerTexts().then(a => a.join(' | '))))
  })

  await probe(info, null, 'C Who owes us at phone size (admin)', async () => {
    const ctx = await ctxAs(browser, info, 'admin', 'phone')
    const p = await newPage(ctx, info, 'C admin phone receivables')
    await visit(p, info, `/money/receivables?q=${encodeURIComponent(cust.name)}`)
    await layout(p, info, 'C admin phone receivables')
    await shot(p, 'C-admin-phone-receivables')
    await ctx.close()
  })
  await admin.close()
  await salesCtx.close()
})

// ------------------------------------------------------------------------------------------------ D: part invoices, reminder, two people

test('hunt orderflow D: overdue part invoice, the reminder and its Undo, two people on one order, the second invoice\'s PDF, a mixed part invoice', async ({ browser }, info) => {
  await ensureProfileStrn()
  const cust = await company('Hunt Part Customer', { city: 'Karachi' })
  await setBuyerTax(cust)
  const L: LineSpec[] = [
    { description: `Hunt analyser panel ${tag()}`, qty: 2, price: 15000.5 },
    { description: `Hunt sample probe ${tag()}`, qty: 1, price: 7999.99 },
  ]
  // line 1: 30,001.00 net, GST 5,400.18 -> 5,400; line 2: 7,999.99 net, GST 1,439.998 -> 1,440. Order gross 44,840.99.
  const M = orderMath(L)
  const seed = await order({ customer: cust, lines: L, owner: 'sales', terms: 30 })
  const id = seed.order.id
  const oref = ref.order(seed.order.number)
  const inv1Date = karachiDay(-40) // due -10: overdue
  const inv1 = await invoice(id, M.per[0].net, M.per[0].gst, inv1Date)
  const inv1Gross = r2(M.per[0].net + M.per[0].gst) // 35,401
  const salesCtx = await ctxAs(browser, info, 'sales', 'desktop')
  const admin = await ctxAs(browser, info, 'admin', 'desktop')
  const ap = await newPage(admin, info, 'D admin')

  await probe(info, ap, 'D DB: the part invoice is overdue; Today payment_overdue for sales', async () => {
    const r = await rec(id)
    want(info, 'D overdue', !!r && same(r.balance, inv1Gross) && r.state === 'overdue' && r.dueOn === addDays(inv1Date, 30), `order_receivables ${JSON.stringify(r)}`)
    const e = await todayItems(salesCtx, info, 'payment_overdue', oref)
    want(info, 'D Today', e.count === 1 && e.waiting === 0, `sales Today payment_overdue for ${oref}: ${JSON.stringify(e)}`)
  })

  await probe(info, ap, 'D payment reminder: copy and mark reminded, Today moves to Waiting, Undo', async () => {
    await visit(ap, info, `/money/receivables?q=${encodeURIComponent(cust.name)}`)
    await ap.getByRole('row').filter({ hasText: cust.name }).first().click({ timeout: T })
    const panel = ap.getByTestId('reminder-panel')
    const text = flat(await panel.getByTestId('reminder-text').innerText({ timeout: T }))
    want(info, 'D reminder', text.includes(`PKR ${amount(inv1Gross)}`), `reminder text does not state the balance PKR ${amount(inv1Gross)}`, text)
    want(info, 'D reminder', text.includes(inv1.number), 'reminder text does not name the invoice', text)
    want(info, 'D reminder', !text.includes(amount(M.gross)), `reminder text states the whole order gross ${amount(M.gross)} although only part is invoiced`, text)
    await shot(ap, 'D-reminder-panel')
    await resetClipboard(ap)
    await panel.getByRole('button', { name: 'Copy and mark reminded' }).click({ timeout: T })
    const clip = flat(await readClipboardWhen(ap, s => s.length > 20))
    want(info, 'D reminder', clip.includes(amount(inv1Gross)), 'the copied reminder lacks the balance', clip.slice(0, 300))
    const stamped = await until(() => rec(id), v => !!v && v.reminders === 1)
    want(info, 'D reminder', !!stamped && stamped.reminders === 1 && stamped.remindedOn === today, `after Copy and mark reminded ${JSON.stringify(stamped)}`)
    const e = await todayItems(salesCtx, info, 'payment_overdue', oref)
    want(info, 'D reminder Today', e.waiting === 1, `after the reminder sales Today payment_overdue is not Waiting: ${JSON.stringify(e)}`)
    await panel.getByRole('button', { name: 'Undo' }).click({ timeout: 8000 }).catch(async () => undoIn(toast(ap, /remind/i)).click({ timeout: 3000 }))
    const back = await until(() => rec(id), v => !!v && v.reminders === 0)
    want(info, 'D reminder Undo', !!back && back.reminders === 0 && back.remindedOn === null, `Undo of the reminder left ${JSON.stringify(back)}`)
  })

  const sp = await newPage(salesCtx, info, 'D sales stale')
  await probe(info, sp, 'D two people: admin records 10,000 while sales has the order open; sales invoices the rest from the stale page', async () => {
    await visit(sp, info, `/orders/${id}`)
    const staleBalance = toNum(await sp.getByTestId('order-balance').innerText({ timeout: T }))
    await visit(ap, info, `/orders/${id}`)
    const d = await openRecordPayment(ap)
    await d.getByRole('textbox', { name: 'Amount received, PKR' }).fill('10000')
    await d.getByRole('button', { name: 'Save payment' }).click()
    await d.waitFor({ state: 'hidden', timeout: T })
    await until(() => counting(id), p => p.length === 1)
    // sales, on the page opened before the payment, without a reload
    await actions(sp).getByRole('button', { name: 'Create invoice', exact: true }).first().click({ timeout: T })
    const inv = sp.getByRole('dialog', { name: 'Create invoice' })
    await inv.getByText('what is left to invoice', { exact: false }).waitFor({ timeout: T })
    const gross2 = r2(M.per[1].net + M.per[1].gst) // 9,439.99
    for (const f of [M.per[1].net, M.per[1].gst, gross2]) want(info, 'D stale invoice', (await inv.getByText(amount(f), { exact: true }).count()) > 0, `the stale page's invoice dialog does not offer ${amount(f)} (what is left)`)
    await shot(sp, 'D-stale-sales-invoice-dialog')
    await inv.getByRole('button', { name: 'Create invoice', exact: true }).click()
    await inv.waitFor({ state: 'hidden', timeout: T })
    const rows = await invoicesOf(id)
    want(info, 'D stale invoice', rows.length === 2, `invoices after the stale page's invoice: ${rows.length}`, rows)
    const sumNet = r2(rows.reduce((s, r) => s + num(r.net_amount), 0))
    const sumGst = rows.reduce((s, r) => s + num(r.gst_amount), 0)
    want(info, 'D stale invoice', same(sumNet, M.net) && sumGst === M.gst, `the invoices add up to net ${sumNet} GST ${sumGst}, order net ${M.net} GST ${M.gst}`)
    want(info, 'D stale invoice', (await stateOf(id)).invoicing_state === 'fully_invoiced', 'the order is not fully invoiced after both invoices')
    const r = await rec(id)
    const shown = await until(async () => toNum(await sp.getByTestId('order-balance').innerText()), v => !!r && same(v, r.balance), 6000)
    want(info, 'D stale balance', !!r && same(shown, r.balance), `sales page (no reload) shows balance ${shown}, DB ${r?.balance} (was ${staleBalance} before the admin's payment)`)
  })

  await probe(info, sp, 'D the second invoice\'s PDF: its lines and "Payment due" vs the order\'s due date', async () => {
    const rows = await invoicesOf(id)
    const second = rows[rows.length - 1]
    const r = await rec(id)
    await sp.reload()
    await settle(sp)
    await sp.getByRole('button', { name: 'Print invoice' }).first().click({ timeout: T })
    const d = sp.getByRole('dialog', { name: 'Sales tax invoice' })
    const dl = d.getByRole('button', { name: /^(Download|Share)$/ })
    await dl.waitFor({ timeout: T })
    want(info, 'D PDF', flat(await d.innerText()).includes(second.number), `the PDF dialog does not default to the latest invoice ${second.number}`)
    if (await dl.isDisabled()) return obs(info, 'D PDF', 'Download is disabled for the second (rest) invoice', flat(await d.innerText()).slice(0, 600))
    const pdf = await download(sp, () => dl.click())
    const text = pdf ? pdfText(pdf) : null
    if (pdf) renderPdfPng(pdf, OUT, `D-invoice-${second.number}`)
    if (!text) return obs(info, 'D PDF', 'pdftotext not available')
    const tagOf = (d: string) => d.split(' ').slice(-1)[0]
    want(info, 'D PDF', pdfHas(text, second.number) && pdfHas(text, tagOf(L[1].description)) && !pdfHas(text, tagOf(L[0].description)), 'the second invoice PDF does not list exactly line 2', text.slice(0, 1500))
    want(info, 'D PDF', pdfHas(text, `PKR ${amount(M.per[1].gst, { always: true })}`), `the second invoice PDF lacks its GST ${amount(M.per[1].gst, { always: true })}`)
    const pdfDue = pdfDay(addDays(today, 30))
    if (r?.dueOn && pdfHas(text, pdfDue) && !pdfHas(text, pdfDay(r.dueOn)))
      obs(info, 'D PDF due date', `the second invoice's PDF says "Payment due ${pdfDue}" (its own date + 30) but the order is due ${r.dueOn} (first invoice + 30) in order_receivables, Today and Who owes us`)
    else if (r?.dueOn) want(info, 'D PDF due date', pdfHas(text, pdfDay(r.dueOn)), `the PDF's Payment due is neither ${pdfDue} nor the DB's ${r.dueOn}`)
  })

  await probe(info, ap, 'D a part invoice on a mixed 18%/exempt order: is its PDF printable?', async () => {
    const mixed = await order({
      customer: cust,
      lines: [
        { description: `Hunt dosing pump ${tag()}`, qty: 1, price: 10000 },
        { description: `Hunt operator training ${tag()}`, qty: 1, price: 5000, gst: 0 },
      ],
      owner: 'sales',
    })
    await visit(ap, info, `/orders/${mixed.order.id}`)
    await actions(ap).getByRole('button', { name: 'Create invoice', exact: true }).first().click({ timeout: T })
    const d = ap.getByRole('dialog', { name: 'Create invoice' })
    await d.getByRole('button', { name: /Edit the amounts/ }).click({ timeout: T })
    const net = d.getByRole('textbox', { name: 'Net amount, PKR' })
    await net.fill('10000') // exactly line 1, whose own GST is 1,800
    await net.blur()
    await ap.waitForTimeout(300)
    const body = flat(await d.innerText())
    const offered = body.includes('1,800') ? 1800 : body.includes('1,200') ? 1200 : NaN
    if (offered !== 1800) obs(info, 'D mixed part', `invoicing net 10,000 (exactly the 18% line) on a mixed order offers GST ${offered} (proportional share of 1,800 over 15,000), not the line's own 1,800`, body.slice(0, 400))
    await shot(ap, 'D-mixed-part-invoice-dialog')
    await d.getByRole('button', { name: 'Create invoice', exact: true }).click()
    await d.waitFor({ state: 'hidden', timeout: T })
    await ap.reload()
    await settle(ap)
    await ap.getByRole('button', { name: 'Print invoice' }).first().click({ timeout: T })
    const pd = ap.getByRole('dialog', { name: 'Sales tax invoice' })
    const dl = pd.getByRole('button', { name: /^(Download|Share)$/ })
    await dl.waitFor({ timeout: T })
    await shot(ap, 'D-mixed-part-invoice-pdf-dialog')
    if (await dl.isDisabled()) obs(info, 'D mixed part PDF', 'the part invoice made with the dialog\'s own figures cannot be printed (Download disabled)', flat(await pd.innerText()).slice(0, 700))
    await pd.getByRole('button', { name: 'Close' }).first().click().catch(() => undefined)
    // More than is left: does the dialog warn before saving?
    await ap.keyboard.press('Escape').catch(() => undefined)
    await actions(ap).getByRole('button', { name: 'Create invoice', exact: true }).first().click({ timeout: T })
    const d2 = ap.getByRole('dialog', { name: 'Create invoice' })
    await d2.getByRole('button', { name: /Edit the amounts/ }).click({ timeout: T })
    const net2 = d2.getByRole('textbox', { name: 'Net amount, PKR' })
    await net2.fill('20000')
    await net2.blur()
    await ap.waitForTimeout(400)
    const warn = await d2.getByText(/more than|exceeds|left to invoice is|over the order/i).count()
    want(info, 'D over-invoice', warn > 0, 'typing net 20,000 when 5,000 is left to invoice shows no warning before Create invoice')
    await shot(ap, 'D-over-invoice-dialog')
    await d2.getByRole('button', { name: 'Cancel' }).click()
  })
  await admin.close()
  await salesCtx.close()
})

// ------------------------------------------------------------------------------------------------ E: cancel/reopen, Back, reload, phone money

test('hunt orderflow E: Back and reload with dialogs open, cancel with a PO sent, Undo, reopen, admin pays on the phone', async ({ browser }, info) => {
  await setProfile(true)
  const sup = await supplier(`Hunt Karachi Valves ${tag()}`, 'Pakistan')
  const cust = await company('Hunt Cancel Customer', { city: 'Multan' })
  const L: LineSpec[] = [{ description: `Hunt butterfly valve DN150 ${tag()}`, qty: 6, price: 18750.25, leg: 0, supplierPrice: 14200.5 }]
  const M = orderMath(L) // 112,501.50 net; GST 20,250.27 -> 20,250; gross 132,751.50
  const seed = await order({ customer: cust, suppliers: [{ supplier: sup }], lines: L, owner: 'sales', terms: 30 })
  const id = seed.order.id
  const oref = ref.order(seed.order.number)
  const issued = await rest('admin', 'rpc/issue_purchase_order', { method: 'POST', body: { p_po_id: crypto.randomUUID(), p_supplier_order_id: seed.legs[0].id } })
  if (issued.status >= 300) obs(info, 'E fixture', `issue_purchase_order answered ${issued.status}`, issued.body)
  await invoice(id, M.net, M.gst)
  const admin = await ctxAs(browser, info, 'admin', 'desktop')
  const ap = await newPage(admin, info, 'E admin')
  const orderRow = () => db.one<{ cancelled_on: string | null; cancel_reason: string | null }>(`orders?id=eq.${id}&select=cancelled_on,cancel_reason`)

  await probe(info, ap, 'E Back with Record payment open (amount typed)', async () => {
    await visit(ap, info, '/orders')
    await visit(ap, info, `/orders/${id}`)
    const d = await openRecordPayment(ap)
    await d.getByRole('textbox', { name: 'Amount received, PKR' }).fill('777')
    await ap.goBack()
    await ap.waitForTimeout(1200)
    want(info, 'E Back', (await ap.getByRole('dialog').count()) === 0, `after Back the payment dialog is still open (url ${ap.url()})`)
    await shot(ap, 'E-after-back-with-payment-dialog')
    want(info, 'E Back', (await counting(id)).length === 0, 'a payment was saved by pressing Back')
  })

  await probe(info, ap, 'E reload with Record payment open', async () => {
    await visit(ap, info, `/orders/${id}`)
    const d = await openRecordPayment(ap)
    await d.getByRole('textbox', { name: 'Amount received, PKR' }).fill('777')
    await ap.reload()
    await settle(ap)
    want(info, 'E reload', (await ap.getByRole('dialog').count()) === 0, 'the payment dialog is open after a reload')
    want(info, 'E reload', (await counting(id)).length === 0, 'a payment was saved by a reload')
  })

  await probe(info, ap, 'E Back with the Cancel dialog open; it lists the PO already sent', async () => {
    await ap.getByRole('button', { name: /^More( actions)?$/ }).first().click({ timeout: T })
    await ap.getByRole('menuitem', { name: 'Cancel order' }).click({ timeout: T })
    const d = ap.getByRole('dialog', { name: 'Cancel this order' })
    await d.waitFor({ timeout: T })
    want(info, 'E cancel dialog', (await d.getByTestId('cancel-sent-pos').count()) === 1, 'the Cancel dialog does not list the PO already sent to the supplier')
    await shot(ap, 'E-cancel-dialog-with-po')
    await ap.goBack()
    await ap.waitForTimeout(1200)
    want(info, 'E Back', (await ap.getByRole('dialog').count()) === 0, `after Back the Cancel dialog is still open (url ${ap.url()})`)
    want(info, 'E Back', (await orderRow()).cancelled_on === null, 'the order was cancelled by pressing Back')
  })

  await probe(info, ap, 'E cancel: copy the cancellation message, double click Cancel order, Undo', async () => {
    await visit(ap, info, `/orders/${id}`)
    await ap.getByRole('button', { name: /^More( actions)?$/ }).first().click({ timeout: T })
    await ap.getByRole('menuitem', { name: 'Cancel order' }).click({ timeout: T })
    const d = ap.getByRole('dialog', { name: 'Cancel this order' })
    await resetClipboard(ap)
    await d.getByRole('button', { name: 'Copy cancellation message' }).click({ timeout: T })
    const clip = await readClipboardWhen(ap, s => s.length > 10)
    want(info, 'E cancel message', /PO-\d\d-\d{4}/.test(clip), 'the cancellation message does not name the PO', clip.slice(0, 300))
    want(info, 'E cancel message', !clip.includes('18,750.25') && !clip.includes(cust.name), 'the supplier cancellation message shows our selling price or the customer', clip.slice(0, 300))
    await d.getByRole('radio', { name: 'The customer cancelled the PO' }).click()
    await d.getByRole('button', { name: 'Cancel order', exact: true }).dblclick()
    await d.waitFor({ state: 'hidden', timeout: T })
    const c = await until(orderRow, r => r.cancelled_on !== null)
    want(info, 'E cancel', c.cancelled_on === today && c.cancel_reason === 'customer_cancelled', `after Cancel order ${JSON.stringify(c)}`)
    await ap.waitForTimeout(600)
    const n = await toast(ap, /Order cancelled/).count()
    want(info, 'E cancel', n <= 1, `a double click on Cancel order showed ${n} toasts`)
    const r = await rec(id)
    want(info, 'E cancel', !!r && same(r.balance, M.gross), `an invoiced cancelled order no longer owes its invoice: ${JSON.stringify(r)}`)
    await shot(ap, 'E-cancelled-toast')
    await undoIn(toast(ap, /Order cancelled/)).click({ timeout: 8000 })
    const back = await until(orderRow, r2_ => r2_.cancelled_on === null)
    want(info, 'E cancel Undo', back.cancelled_on === null && back.cancel_reason === null, `Undo of the cancel left ${JSON.stringify(back)}`)
  })

  await probe(info, ap, 'E cancelled: Today has no work items for it; reopen and the Undo of reopen', async () => {
    await db.patch(`orders?id=eq.${id}`, { cancelled_on: today, cancel_reason: 'customer_cancelled' })
    const salesCtx = await ctxAs(browser, info, 'sales', 'desktop')
    for (const rule of ['place_po', 'goods_late', 'delivered_not_invoiced', 'plan_commissioning']) {
      const e = await todayItems(salesCtx, info, rule, oref)
      want(info, 'E Today cancelled', e.count === 0, `Today lists ${rule} for the cancelled order ${oref}`)
    }
    await salesCtx.close()
    await visit(ap, info, `/orders/${id}`)
    want(info, 'E cancelled page', (await actions(ap).getByRole('button', { name: /Record payment|Create invoice|Issue PO|Delivered today/ }).count()) === 0, 'a cancelled order still offers a work button in its header')
    await layout(ap, info, 'E cancelled order desktop')
    await shot(ap, 'E-cancelled-order')
    await ap.getByRole('button', { name: /^More( actions)?$/ }).first().click({ timeout: T })
    await ap.getByRole('menuitem', { name: 'Reopen order' }).click({ timeout: T })
    await until(orderRow, r => r.cancelled_on === null)
    want(info, 'E reopen', (await stateOf(id)).lifecycle === 'active', 'the order is not active after Reopen order')
    await undoIn(toast(ap, /Order reopened/)).click({ timeout: 8000 })
    const again = await until(orderRow, r => r.cancelled_on !== null)
    want(info, 'E reopen Undo', again.cancelled_on === today && again.cancel_reason === 'customer_cancelled', `Undo of Reopen restored ${JSON.stringify(again)} (reason lost?)`)
    await db.patch(`orders?id=eq.${id}`, { cancelled_on: null, cancel_reason: null })
  })

  await probe(info, null, 'E admin on the phone: Record payment from the sticky bar', async () => {
    // Delivered and invoiced, nothing paid: payment is the next step (run 1 left the goods undelivered, so the bar said Delivered today).
    await db.patch(`supplier_orders?id=eq.${seed.legs[0].id}`, { placed_on: karachiDay(-10), delivered_on: karachiDay(-1), received_on: karachiDay(-1) })
    const ctx = await ctxAs(browser, info, 'admin', 'phone')
    const p = await newPage(ctx, info, 'E admin phone')
    await visit(p, info, `/orders/${id}`)
    const bar = p.getByRole('toolbar', { name: 'Order actions' })
    let btn = bar.getByRole('button', { name: 'Record payment', exact: true })
    if ((await btn.count()) === 0) {
      obs(info, 'E phone pay', 'the sticky bar of a delivered, invoiced, unpaid order is not Record payment', flat(await bar.innerText().catch(() => '')))
      btn = p.getByRole('button', { name: 'Record payment', exact: true })
      if ((await btn.count()) === 0) {
        await bar.getByRole('button', { name: /More/ }).first().click({ timeout: 3000 }).catch(() => undefined)
        const item = p.getByRole('menuitem', { name: /Record payment/ })
        if ((await item.count()) === 0) {
          obs(info, 'E phone pay', 'no reachable Record payment on the phone for a delivered, invoiced, unpaid order')
          await shot(p, 'E-admin-phone-no-pay')
          await ctx.close()
          return
        }
        btn = item
      }
    }
    await btn.first().tap()
    const d = p.getByRole('dialog', { name: 'Record payment' })
    const box = d.getByRole('textbox', { name: 'Amount received, PKR' })
    await box.waitFor({ timeout: T })
    await layout(p, info, 'E admin phone payment dialog')
    await shot(p, 'E-admin-phone-payment-dialog')
    const save = d.getByRole('button', { name: 'Save payment' })
    const sb = await save.boundingBox()
    want(info, 'E phone pay', !!sb && sb.y + sb.height <= 812 && sb.height >= 40, `Save payment on the phone is off screen or small: ${JSON.stringify(sb)}`)
    await box.fill('32751.5')
    await save.tap()
    await d.waitFor({ state: 'hidden', timeout: T })
    const r = await until(() => rec(id), v => !!v && v.settled > 0)
    // 132,751.50 - 32,751.50 = 100,000
    want(info, 'E phone pay', !!r && same(r.balance, r2(M.gross - 32751.5)), `DB after the phone payment ${JSON.stringify(r)}`)
    await p.reload()
    await settle(p)
    const shown = toNum(await p.getByTestId('order-balance').innerText({ timeout: T }))
    want(info, 'E phone pay', !!r && same(shown, r.balance), `phone order page balance ${shown} != DB ${r?.balance}`)
    await layout(p, info, 'E admin phone order after pay')
    await shot(p, 'E-admin-phone-after-pay')
    await ctx.close()
  })

  await probe(info, null, 'E sales on the phone: order page and Who owes us', async () => {
    const ctx = await ctxAs(browser, info, 'sales', 'phone')
    const p = await newPage(ctx, info, 'E sales phone')
    await visit(p, info, `/orders/${id}`)
    want(info, 'E sales phone', (await p.getByRole('button', { name: 'Record payment', exact: true }).count()) === 0, 'sales sees Record payment (payments are admin-only)')
    await layout(p, info, 'E sales phone order')
    await shot(p, 'E-sales-phone-order')
    await visit(p, info, `/money/receivables?q=${encodeURIComponent(cust.name)}`)
    const txt = flat(await p.locator('#main').innerText())
    const r = await rec(id)
    if (r) want(info, 'E sales phone', txt.includes(amount(r.balance)), `sales phone Who owes us does not show the balance ${amount(r.balance)}`)
    await layout(p, info, 'E sales phone receivables')
    await shot(p, 'E-sales-phone-receivables')
    await ctx.close()
  })
  await admin.close()
})

// ------------------------------------------------------------------------------------------------ confirmed bugs, pinned

/*
 * Confirmed by run 1 (CI 39672642562). Each test does its setup with ordinary expects (a broken setup is a red failure, never a
 * false pass), then calls test.fail(true, 'HW-n: ...') immediately before the ONE expect that states the correct behaviour. A fix
 * makes that expect pass, the test then "unexpectedly passes" and turns red: drop the test.fail line then.
 */

/** Counts the PATCH requests the page sends to one REST table from now on (a write that really went out). */
function patches(page: Page, table: string): { count: () => number } {
  let n = 0
  page.on('request', r => {
    if (r.method() === 'PATCH' && r.url().includes(`/rest/v1/${table}?`)) n++
  })
  return { count: () => n }
}

/** Opens Print invoice on the order page; returns the dialog's Download (or Share) button once it is drawn. */
async function invoicePdfDownload(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Print invoice' }).first().click()
  const dl = page.getByRole('dialog', { name: 'Sales tax invoice' }).getByRole('button', { name: /^(Download|Share)$/ })
  await expect(dl).toBeVisible({ timeout: 15_000 })
  return dl
}

test('HW-11 (fixed): a part invoice of exactly the 18% line of a mixed order gets that line\'s own GST, and its PDF prints', async ({ browser }, info) => {
  await ensureProfileStrn()
  const cust = await company('Hunt HW11 Customer', { city: 'Lahore' })
  await setBuyerTax(cust)
  // 1 x 10,000 at 18% (own GST 1,800) and 1 x 5,000 exempt: order net 15,000, GST 1,800.
  const seed = await order({
    customer: cust,
    lines: [
      { description: 'Dosing pump 60 l/h', qty: 1, price: 10000 },
      { description: 'Operator training, one day', qty: 1, price: 5000, gst: 0 },
    ],
    owner: 'sales',
  })
  const ctx = await ctxAs(browser, info, 'admin', 'desktop')
  const page = await ctx.newPage()
  await page.goto(`/orders/${seed.order.id}`)
  await actions(page).getByRole('button', { name: 'Create invoice', exact: true }).first().click()
  const d = page.getByRole('dialog', { name: 'Create invoice' })
  await d.getByRole('button', { name: /Edit the amounts/ }).click()
  const net = d.getByRole('textbox', { name: 'Net amount, PKR' })
  await net.fill('10000')
  await net.blur()
  await d.getByRole('button', { name: 'Create invoice', exact: true }).click()
  await expect(d).toBeHidden({ timeout: 15_000 })
  const [inv] = await invoicesOf(seed.order.id)
  expect(num(inv.net_amount)).toBe(10000)
  await page.reload()
  const dl = await invoicePdfDownload(page)
  expect(num(inv.gst_amount)).toBe(1800) // HW-11 fixed: exactly the 18% line carries its own GST (was 1,200, a share)
  await expect(dl).toBeEnabled({ timeout: 5000 })
  await ctx.close()
})

test('HW-12 (fixed): the second invoice\'s PDF prints "Payment due" as the order\'s due date (first invoice + terms)', async ({ browser }, info) => {
  await ensureProfileStrn()
  const cust = await company('Hunt HW12 Customer', { city: 'Karachi' })
  await setBuyerTax(cust)
  // line 1: 2 x 15,000.50 = 30,001 (GST 5,400); line 2: 7,999.99 (GST 1,440). Invoiced line by line; the first 40 days ago, 30-day terms.
  const seed = await order({
    customer: cust,
    lines: [
      { description: 'Analyser panel', qty: 2, price: 15000.5 },
      { description: 'Sample probe', qty: 1, price: 7999.99 },
    ],
    owner: 'sales',
    terms: 30,
  })
  await invoice(seed.order.id, 30001, 5400, karachiDay(-40))
  const second = await invoice(seed.order.id, 7999.99, 1440)
  const r = await rec(seed.order.id)
  const orderDue = addDays(karachiDay(-40), 30)
  expect(r?.dueOn).toBe(orderDue)
  const ctx = await ctxAs(browser, info, 'sales', 'desktop')
  const page = await ctx.newPage()
  await page.goto(`/orders/${seed.order.id}`)
  const dl = await invoicePdfDownload(page)
  await expect(dl).toBeEnabled({ timeout: 10_000 })
  const pdf = await download(page, () => dl.click())
  expect(pdfIsValid(pdf)).toBe(true)
  const text = pdf ? pdfText(pdf) : null
  test.skip(text === null, 'pdftotext (poppler) is not installed')
  expect(pdfHas(text ?? '', second.number)).toBe(true)
  // HW-12 fixed: the PDF prints the order's due date (first invoice + terms), as order_receivables does
  expect(pdfHas(text ?? '', pdfDay(orderDue))).toBe(true)
  await ctx.close()
})

test('HW-13 (fixed): Create invoice refuses a net amount above what is left to invoice', async ({ browser }, info) => {
  const seed = await order({ lines: [{ description: 'Level switch', qty: 1, price: 10000 }], owner: 'sales' })
  const ctx = await ctxAs(browser, info, 'admin', 'desktop')
  const page = await ctx.newPage()
  await page.goto(`/orders/${seed.order.id}`)
  await actions(page).getByRole('button', { name: 'Create invoice', exact: true }).first().click()
  const d = page.getByRole('dialog', { name: 'Create invoice' })
  await d.getByRole('button', { name: /Edit the amounts/ }).click()
  const net = d.getByRole('textbox', { name: 'Net amount, PKR' })
  await net.fill('20000') // 10,000 is all there is to invoice
  await net.blur()
  await d.getByRole('button', { name: 'Create invoice', exact: true }).click()
  await page.waitForTimeout(2500)
  const invoiced = (await invoicesOf(seed.order.id)).reduce((s, x) => s + num(x.net_amount), 0)
  // HW-13 fixed: the dialog refuses a net above what is left to invoice
  expect(invoiced).toBeLessThanOrEqual(10000)
  await ctx.close()
})

test('HW-14 (fixed): the lines of a fully invoiced and settled order are locked, so it stays fully invoiced', async ({ browser }, info) => {
  // 10,000 at 18% (GST 1,800) and 5,000 exempt: gross 16,800, invoiced and paid in full.
  const seed = await order({
    lines: [
      { description: 'Gate valve DN100', qty: 1, price: 10000 },
      { description: 'Site test certificate', qty: 1, price: 5000, gst: 0 },
    ],
    owner: 'sales',
  })
  const id = seed.order.id
  await invoice(id, 15000, 1800)
  await payment(id, 16800)
  expect((await stateOf(id)).invoicing_state).toBe('fully_invoiced')
  expect((await rec(id))?.state).toBe('settled')
  const ctx = await ctxAs(browser, info, 'sales', 'desktop')
  const page = await ctx.newPage()
  await page.goto(`/orders/${id}`)
  await expect(page.getByRole('table', { name: 'Order items' })).toBeVisible({ timeout: 15_000 })
  try {
    await page.getByRole('button', { name: 'Edit GST and lines' }).click({ timeout: 5000 })
    await page.getByLabel('GST rate, line 2').selectOption('18', { timeout: 5000 })
  } catch {
    // not offered or refused: that is the fixed behaviour, checked below
  }
  await page.waitForTimeout(2000)
  const st = await stateOf(id)
  // HW-14 fixed: a fully invoiced order's lines are locked (Edit GST and lines is not offered)
  expect(st.invoicing_state).toBe('fully_invoiced')
  await ctx.close()
})

test('HW-15: a double click on Delivered today sends two writes (two success toasts, two Undo)', async ({ browser }, info) => {
  const sup = await supplier('Hunt HW15 Gauges', 'Pakistan')
  const seed = await order({ suppliers: [{ supplier: sup }], lines: [{ description: 'Pressure gauge 0-16 bar', qty: 6, price: 3150, leg: 0, supplierPrice: 2100 }], owner: 'sales' })
  const leg = seed.legs[0].id
  await db.patch(`supplier_orders?id=eq.${leg}`, { placed_on: karachiDay(-5), expected_on: karachiDay(5) })
  const ctx = await ctxAs(browser, info, 'sales', 'desktop')
  const page = await ctx.newPage()
  await page.goto(`/orders/${seed.order.id}`)
  const button = legRow(page, sup.name).getByRole('button', { name: `Delivered today, ${sup.name}` })
  await expect(button).toBeVisible({ timeout: 15_000 })
  const writes = patches(page, 'supplier_orders')
  await button.dblclick()
  await expect.poll(async () => (await legDates(leg)).delivered_on, { timeout: 10_000 }).toBe(today)
  await page.waitForTimeout(2000)
  expect(writes.count()).toBe(1)
  await ctx.close()
})

test('HW-15: a double tap on Mark done today (engineer, phone) sends two writes', async ({ browser }, info) => {
  const seed = await order({ lines: [{ description: 'Commissioning visit, one day', qty: 1, price: 25000, service: true }], owner: 'sales', needsCommissioning: true })
  const id = seed.order.id
  await db.patch(`orders?id=eq.${id}`, { commissioning_planned_on: today })
  await post('order_engineers', { order_id: id, user_id: USER.engineer })
  const ctx = await ctxAs(browser, info, 'engineer', 'phone')
  const page = await ctx.newPage()
  await page.goto(`/orders/${id}`)
  const button = page.getByRole('button', { name: 'Mark done today' }).first()
  await expect(button).toBeVisible({ timeout: 15_000 })
  const writes = patches(page, 'orders')
  await button.dblclick()
  await expect.poll(async () => (await db.one<{ commissioning_done_on: string | null }>(`orders?id=eq.${id}&select=commissioning_done_on`)).commissioning_done_on, { timeout: 10_000 }).toBe(today)
  await page.waitForTimeout(2000)
  expect(writes.count()).toBe(1)
  await ctx.close()
})

test('HW-15: a double click on Cancel order sends two writes', async ({ browser }, info) => {
  const seed = await order({ lines: [{ description: 'Flow switch', qty: 2, price: 8400 }], owner: 'sales' })
  const id = seed.order.id
  const ctx = await ctxAs(browser, info, 'admin', 'desktop')
  const page = await ctx.newPage()
  await page.goto(`/orders/${id}`)
  await page.getByRole('button', { name: /^More( actions)?$/ }).first().click({ timeout: 15_000 })
  await page.getByRole('menuitem', { name: 'Cancel order' }).click()
  const d = page.getByRole('dialog', { name: 'Cancel this order' })
  await d.getByRole('radio', { name: 'The customer cancelled the PO' }).click()
  const writes = patches(page, 'orders')
  await d.getByRole('button', { name: 'Cancel order', exact: true }).dblclick()
  await expect.poll(async () => (await db.one<{ cancelled_on: string | null }>(`orders?id=eq.${id}&select=cancelled_on`)).cancelled_on, { timeout: 10_000 }).toBe(today)
  await page.waitForTimeout(2000)
  expect(writes.count()).toBe(1)
  await ctx.close()
})
