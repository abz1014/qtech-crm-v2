import { expect, test, type Locator, type Page } from '@playwright/test'
import { createCompany, createRfq, karachiDay, must, openAs, rest, rfqRef, uniqueName } from '../support/stack'
import { db } from '../verify/support/db'
import { dueRows, showAllTodo } from '../support/todo'

/*
 * Redesign phase 0, whole app: NO screen says a false "N days overdue". The old CRM's data (an order delivered 757 days ago and part
 * invoiced, an RFQ quoted a year ago, a purchase order never marked delivered, a late payment) is history to review, not a debt that
 * is 757 days late. A count of days late over 30 is never shown; the date is said in words ("since 3 Jun 2024") or the record is
 * grey "Imported, to review". A v2 order with the same kind of fact is still red: the CONTROL (invoiced, due 5 days ago, unpaid)
 * must show a red "5 days overdue" on Today, its order page and To collect, and be in the Overdue total.
 *
 * Runs as admin and as sales over every screen that can say it: Today, the RFQ board and an RFQ page, Orders and each order page,
 * To collect, the aging report and the supplier page. Needs no database change (the app works at migration 0086).
 * Fictional data. The import marker (legacy_source) is written as the service role, the import's own role.
 */
const OWNER: Record<'admin' | 'sales', string> = {
  admin: 'a0000000-0000-4000-8000-000000000001',
  sales: 'a0000000-0000-4000-8000-000000000002',
}
// Over 30 days is never a count (COUNT_WORDS_MAX_DAYS = 30): exactly 30 is still said in days, so another suite's 30-day-late RFQ on the shared board is legitimate.
const FALSE_OVERDUE = /\b(3[1-9]|[4-9]\d|\d{3,}) days (overdue|late)\b/
const FOLDS = 'section[aria-label="Imported, to review"], section[aria-label="Older than 30 days"]'
const CONTROL_GROSS = 118_000

interface Placed {
  id: string
  customer: string
  supplier: string
  supplierId: string
}

async function order(role: 'admin' | 'sales', o: {
  tag: string
  orderedAgo: number
  leg?: { placed: number; expected: number; received?: number; delivered?: number }
  invoice?: { ago: number; share: number; number: string }
  imported: boolean
  net?: number
}): Promise<Placed> {
  const customer = uniqueName(`${o.tag} Customer`)
  const supplier = uniqueName(`${o.tag} Supplier`)
  const co = await createCompany(customer)
  const sup = await createCompany(supplier)
  const net = o.net ?? 100_000
  const ord = (await must(rest<{ id: string }[]>('admin', 'orders', { method: 'POST', body: { company_id: co.id, owner_id: OWNER[role], ordered_on: karachiDay(-o.orderedAgo), payment_terms_days: 30 } })))[0]
  let legId: string | null = null
  if (o.leg) {
    const l = o.leg
    legId = (await must(rest<{ id: string }[]>('admin', 'supplier_orders', { method: 'POST', body: {
      order_id: ord.id, supplier_id: sup.id, placed_on: karachiDay(-l.placed), expected_on: karachiDay(-l.expected),
      received_on: l.received === undefined ? null : karachiDay(-l.received), delivered_on: l.delivered === undefined ? null : karachiDay(-l.delivered),
    } })))[0].id
  }
  await must(rest('admin', 'order_items', { method: 'POST', body: { order_id: ord.id, description: 'Pressure transmitter', qty: 1, unit_price_net: net, supplier_order_id: legId }, prefer: 'return=minimal' }))
  if (o.invoice) {
    await must(rest('admin', 'invoices', { method: 'POST', body: {
      order_id: ord.id, number: o.invoice.number, invoice_date: karachiDay(-o.invoice.ago),
      net_amount: Math.round(net * o.invoice.share), gst_amount: Math.round(net * 0.18 * o.invoice.share),
    }, prefer: 'return=minimal' }))
  }
  if (o.imported) {
    await db.patch(`orders?id=eq.${ord.id}`, { legacy_source: { imported: true, table: 'orders' } })
    // the import marks the purchase-order legs too (the supplier page reads supplier_orders.legacy_source)
    await db.patch(`supplier_orders?order_id=eq.${ord.id}`, { legacy_source: { imported: true, table: 'supplier_orders' } })
    if (o.invoice) await db.patch(`invoices?order_id=eq.${ord.id}`, { legacy_source: { imported: true, table: 'invoices' } })
  }
  return { id: ord.id, customer, supplier, supplierId: sup.id }
}

async function seed(role: 'admin' | 'sales') {
  const tag = role === 'admin' ? 'NFA' : 'NFS'
  const rfq = async (name: string, o: { receivedAgo: number; dueAgo: number; quotedAgo?: number }) => {
    const co = await createCompany(uniqueName(`${name} Customer`))
    const r = await createRfq(co.id, {
      owner_id: OWNER[role], received_on: karachiDay(-o.receivedAgo), due_on: karachiDay(-o.dueAgo),
      quoted_on: o.quotedAgo === undefined ? null : karachiDay(-o.quotedAgo),
    })
    await db.patch(`rfqs?id=eq.${r.id}`, { legacy_source: { imported: true, table: 'rfqs' } })
    return { id: r.id, ref: rfqRef(r.number), customer: co.name }
  }
  // An imported order delivered 757 days ago, part-invoiced (half), nothing paid.
  const partInvoiced = await order(role, { tag: `${tag} PartInv`, orderedAgo: 810, leg: { placed: 800, expected: 770, received: 760, delivered: 757 }, invoice: { ago: 750, share: 0.5, number: uniqueName('IMP-PI') }, imported: true })
  // An imported order delivered and not invoiced.
  const notInvoiced = await order(role, { tag: `${tag} NotInv`, orderedAgo: 400, leg: { placed: 390, expected: 380, received: 372, delivered: 370 }, imported: true })
  // An imported late payment: fully invoiced long ago, nothing received.
  const latePayment = await order(role, { tag: `${tag} LatePay`, orderedAgo: 320, leg: { placed: 310, expected: 305, received: 302, delivered: 300 }, invoice: { ago: 290, share: 1, number: uniqueName('IMP-LP') }, imported: true })
  // An imported purchase order never marked delivered.
  const poOpen = await order(role, { tag: `${tag} PoOpen`, orderedAgo: 500, leg: { placed: 495, expected: 480 }, imported: true })
  // An imported RFQ with the quotation sent, due a year ago; and one never quoted, due 400 days ago.
  const rfqSent = await rfq(`${tag} RfqSent`, { receivedAgo: 380, dueAgo: 365, quotedAgo: 375 })
  const rfqOpen = await rfq(`${tag} RfqOpen`, { receivedAgo: 410, dueAgo: 400 })
  // CONTROL: a v2 order, invoiced, due 5 days ago (invoice 35 days ago on 30-day terms), unpaid.
  const control = await order(role, { tag: `${tag} Control`, orderedAgo: 45, leg: { placed: 44, expected: 40, received: 39, delivered: 38 }, invoice: { ago: 35, share: 1, number: uniqueName('V2-CTL') }, imported: false, net: 100_000 })
  return { partInvoiced, notInvoiced, latePayment, poOpen, rfqSent, rfqOpen, control }
}
type Seeded = Awaited<ReturnType<typeof seed>>

const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' }).first()

/** Let the page finish loading, then read what a person can see. */
async function visibleText(page: Page): Promise<string> {
  await page.waitForLoadState('networkidle').catch(() => undefined)
  return page.locator('body').innerText()
}

async function expectNoFalseOverdue(page: Page, where: string): Promise<void> {
  const text = await visibleText(page)
  expect(FALSE_OVERDUE.exec(text)?.[0] ?? null, `a false "N days overdue" on ${where}`).toBeNull()
}

/** Red: any match of the text (the title or the badge) or one of its few ancestors carries a danger tone class. */
async function isRed(l: Locator): Promise<boolean> {
  const reds = await l.evaluateAll(els => els.map(el => {
    // The status word and its icon are red; the second line ("5 days overdue") under it is a quieter grey by design (StatusText), so look at the same status block too.
    for (let n: Element | null = el, i = 0; n && i < 6; n = n.parentElement, i++) if (/danger|red/.test(n.getAttribute('class') ?? "") || (i >= 1 && i <= 2 && n.querySelector('[class*=danger]') !== null)) return true
    return false
  }))
  return reds.some(Boolean)
}

async function todayReading(page: Page) {
  await page.goto('/todo')
  const header = page.locator('[data-needs-you-count]')
  await expect(header).toBeVisible()
  const n = Number(await header.innerText())
  await expect(nav(page).getByRole('link', { name: n > 0 ? new RegExp(`^To do\\s?, ${n} need you$`) : /^To do$/ })).toBeVisible({ timeout: 10_000 }).catch(() => undefined)
  await showAllTodo(page)
  const rules = await dueRows(page).evaluateAll(ls => ls.map(l => l.getAttribute('data-rule') ?? ''))
  const link = (await nav(page).getByRole('link', { name: /^To do/ }).first().textContent()) ?? ''
  return { badge: Number(/(\d+)/.exec(link)?.[1] ?? 0), header: Number(await header.innerText()), rows: rules.length, rules }
}

async function checkToday(page: Page, s: Seeded): Promise<void> {
  await expect(async () => {
    const t = await todayReading(page)
    expect(t.header, 'Today header vs the top-bar badge').toBe(t.badge)
    expect(t.rows, 'rows in the counted group vs the header').toBe(t.header)
  }).toPass({ timeout: 90_000 })

  await page.goto('/todo')
  await expect(page.locator('[data-needs-you-count]')).toBeVisible()
  await expectNoFalseOverdue(page, 'Today (folds closed)')

  // The control is counted, red, "5 days overdue".
  const ctl = page.locator('section[data-block="late"], section[data-block="today"]').locator('li[data-rule="payment_overdue"]').filter({ hasText: s.control.customer })
  await expect(ctl).toBeVisible()
  const five = ctl.getByText(/\b5 days overdue\b/)
  await expect(five.first()).toBeVisible()
  expect(await isRed(five), 'the control\'s "5 days overdue" on Today is red').toBe(true)

  // Open every fold: still no false count, and every imported item sits inside a fold.
  for (const name of ['Imported, to review', 'Older than 30 days']) {
    const button = page.getByRole('region', { name }).getByRole('button', { name: new RegExp(`^${name}`) })
    if (await button.count()) if ((await button.first().getAttribute('aria-expanded')) === 'false') await button.first().click()
  }
  await expectNoFalseOverdue(page, 'Today (folds open)')
  const imported = [s.partInvoiced, s.notInvoiced, s.latePayment, s.poOpen].flatMap(o => [o.customer, o.supplier]).concat([s.rfqSent.customer, s.rfqOpen.customer, s.rfqSent.ref, s.rfqOpen.ref])
  const rows = await page.locator('li[data-rule]').evaluateAll((ls, folds) => ls.map(l => ({ text: l.textContent ?? '', rule: l.getAttribute('data-rule') ?? '', inFold: l.closest(folds) !== null })), FOLDS)
  const outside = rows.filter(r => !r.inFold && imported.some(n => r.text.includes(n)))
  expect(outside.map(r => r.rule), 'imported items outside the folds on Today').toEqual([])
  const inFold = (name: string, rule: string) => rows.some(r => r.inFold && r.rule === rule && r.text.includes(name))
  expect(inFold(s.latePayment.customer, 'payment_overdue'), 'the imported late payment waits in the fold').toBe(true)
  expect(inFold(s.poOpen.supplier, 'goods_late'), 'the imported purchase order waits in the fold').toBe(true)
  expect(rows.some(r => r.inFold && r.text.includes(s.rfqOpen.customer)), 'the imported RFQ due 400 days ago waits in the fold').toBe(true)
}

async function checkRfqs(page: Page, s: Seeded): Promise<void> {
  await page.goto('/jobs?chip=open')
  await expect(page.getByRole('heading', { name: 'Jobs', level: 1 })).toBeVisible()
  await expectNoFalseOverdue(page, '/jobs (open)')
  for (const r of [s.rfqSent, s.rfqOpen]) {
    await page.goto(`/rfqs/${r.id}`)
    await expect(page.getByText(r.customer).first()).toBeVisible()
    await expectNoFalseOverdue(page, `Job page of ${r.ref}`)
  }
}

async function checkOrders(page: Page, s: Seeded): Promise<void> {
  await page.goto('/jobs?chip=history')
  await expect(page.getByRole('heading', { name: 'Jobs', level: 1 })).toBeVisible()
  await expectNoFalseOverdue(page, '/jobs (history)')
  for (const [name, o] of Object.entries({ partInvoiced: s.partInvoiced, notInvoiced: s.notInvoiced, latePayment: s.latePayment, poOpen: s.poOpen })) {
    await page.goto(`/orders/${o.id}`)
    await expect(page.getByText(o.customer).first()).toBeVisible()
    await expectNoFalseOverdue(page, `the imported order page (${name})`)
  }
}

async function checkMoney(page: Page, s: Seeded): Promise<void> {
  await page.goto('/money/receivables')
  await expect(page.getByText(s.control.customer).first()).toBeVisible()
  await expectNoFalseOverdue(page, '/money/receivables')
  const row = page.locator('tr, [role="row"]').filter({ hasText: s.control.customer }).first()
  const five = row.getByText(/\b5 days overdue\b/)
  await expect(five.first()).toBeVisible()
  expect(await isRed(five), 'the control\'s "5 days overdue" on To collect is red').toBe(true)
  // The imported order is a grey tile, not a debt; the control is in the Overdue total.
  await expect(page.getByText('Imported, to review').first()).toBeVisible()
  const tile = page.getByRole('region', { name: 'Balance by status, includes GST' }).locator('div').filter({ has: page.getByText('Overdue', { exact: true }) }).last()
  const amounts = ((await tile.innerText()).match(/\d[\d,]*/g) ?? []).map(t => Number(t.replace(/,/g, '')))
  expect(Math.max(0, ...amounts), 'the Overdue total includes the control').toBeGreaterThanOrEqual(CONTROL_GROSS)

  await page.goto('/money/reports/aging')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expectNoFalseOverdue(page, 'the aging report')
}

async function checkControl(page: Page, s: Seeded): Promise<void> {
  await page.goto(`/orders/${s.control.id}`)
  await expect(page.getByText(s.control.customer).first()).toBeVisible()
  await expectNoFalseOverdue(page, 'the control job page')
}

async function checkSupplier(page: Page, s: Seeded): Promise<void> {
  for (const o of [s.poOpen, s.partInvoiced]) {
    await page.goto(`/companies/${o.supplierId}`)
    await expect(page.getByText(o.supplier).filter({ visible: true }).first()).toBeVisible()
    await expectNoFalseOverdue(page, 'the supplier page')
  }
  await page.goto(`/companies/${s.poOpen.supplierId}`)
  await expect(page.getByText('Imported, not marked delivered').first()).toBeVisible()
}

for (const role of ['admin', 'sales'] as const) {
  test(`no screen shows a false "N days overdue" for imported data, and the v2 control stays red (${role})`, async ({ page }) => {
    test.setTimeout(240_000)
    const s = await seed(role)
    await openAs(page, role, '/todo')
    await expect(page.getByRole('heading', { level: 1, name: 'To do' })).toBeVisible()

    await checkToday(page, s)
    await checkRfqs(page, s)
    await checkOrders(page, s)
    await checkControl(page, s)
    await checkMoney(page, s)
    await checkSupplier(page, s)

  })
}
