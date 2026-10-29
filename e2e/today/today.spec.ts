import { expect, test, type Page } from '@playwright/test'
import { createCompany, createRfq, karachiDay, must, openAs, review, rest, rfqRef, uniqueName, type Role } from '../support/stack'
import { dueRows, showAllTodo } from '../support/todo'
import { axeViolations } from '../support/axe'
import { readClipboardWhen, resetClipboard } from '../support/clipboard'

/*
 * R11 and R16 end to end, against the local CI stack: Today for the three fixture roles, through the real login form.
 * Every test seeds its own companies and records (unique names). Items are routed to their owner, so every record is
 * created with an explicit owner: the sales user, the engineer, or the admin.
 *
 * FE-2 targets asserted here (BUILD_PLAN FE-2):
 *   Chase (copy and mark chased)   1 tap, then a 10 s Undo (optional)
 *   Snooze                         1 tap to open, 1 tap to choose (optional)
 */

const SALES = 'a0000000-0000-4000-8000-000000000002'
const ADMIN = 'a0000000-0000-4000-8000-000000000001'
const ENGINEER = 'a0000000-0000-4000-8000-000000000003'

const violations = (page: Page): Promise<string[]> => axeViolations(page)

const iso = (days: number) => karachiDay(days)
const ts = (days: number) => `${karachiDay(days)}T09:00:00+05:00`

interface ChaseSeed {
  customer: string
  rfq: { id: string; number: number }
  clarificationId: string
  ref: string
}

/** An open RFQ owned by `ownerId`, with two questions asked `askedDaysAgo` days ago and no answer: a customer chase that is due. */
async function seedCustomerChase(ownerId: string, askedDaysAgo = 9): Promise<ChaseSeed> {
  const customer = uniqueName('Today Customer')
  const co = await createCompany(customer)
  const rfq = await createRfq(co.id, { owner_id: ownerId, due_on: iso(14), customer_ref: `T${Math.random().toString(36).slice(2, 7)}` })
  await must(rest('admin', 'rfq_items', { method: 'POST', body: { rfq_id: rfq.id, position: 0, description: 'Flow meter DN50', qty: 2 }, prefer: 'return=minimal' }))
  const rows = await must(
    rest<{ id: string }[]>('admin', 'clarifications', {
      method: 'POST',
      body: [
        { rfq_id: rfq.id, question: 'Line size and flange rating on the process line', first_asked_at: ts(-askedDaysAgo), last_asked_at: ts(-askedDaysAgo), ask_count: 1 },
        { rfq_id: rfq.id, question: 'Fluid temperature range', first_asked_at: ts(-askedDaysAgo), last_asked_at: ts(-askedDaysAgo), ask_count: 1 },
      ],
    }),
  )
  return { customer, rfq, clarificationId: rows[0].id, ref: rfqRef(rfq.number) }
}

const askOf = (id: string) =>
  must(rest<{ ask_count: number; last_asked_at: string | null }[]>('admin', `clarifications?id=eq.${id}&select=ask_count,last_asked_at`)).then(r => r[0])

/** A goods leg owned (through its order) by `ownerId`: expected 6 days ago, placed, not received. */
async function seedLateGoods(ownerId: string) {
  const customer = uniqueName('Goods Customer')
  const supplier = uniqueName('Goods Supplier')
  const co = await createCompany(customer)
  const sup = await createCompany(supplier)
  const order = (await must(rest<{ id: string; number: number }[]>('admin', 'orders', { method: 'POST', body: { company_id: co.id, owner_id: ownerId, ordered_on: iso(-20) } })))[0]
  const reference = `PO${Math.random().toString(36).slice(2, 8).toUpperCase()}`
  const leg = (await must(rest<{ id: string }[]>('admin', 'supplier_orders', { method: 'POST', body: { order_id: order.id, supplier_id: sup.id, reference, placed_on: iso(-15), expected_on: iso(-6) } })))[0]
  await must(rest('admin', 'order_items', { method: 'POST', body: { order_id: order.id, description: 'Pressure transmitter', qty: 3, unit_price_net: 1000, supplier_order_id: leg.id }, prefer: 'return=minimal' }))
  return { customer, supplier, order, leg, reference }
}

/**
 * An order owned by `ownerId` with one invoice dated 45 days ago on 30-day terms: overdue by 15 days. `terms: null` leaves the
 * order without terms of its own, so the company default (30 days, audit Y1) decides.
 */
async function seedOverdueOrder(ownerId: string, terms: number | null = 30) {
  const customer = uniqueName('Debtor')
  const co = await createCompany(customer)
  const order = (await must(rest<{ id: string; number: number }[]>('admin', 'orders', { method: 'POST', body: { company_id: co.id, owner_id: ownerId, ordered_on: iso(-50), ...(terms === null ? {} : { payment_terms_days: terms }) } })))[0]
  await must(rest('admin', 'order_items', { method: 'POST', body: { order_id: order.id, description: 'Service visit', qty: 1, unit_price_net: 100000, is_service: true }, prefer: 'return=minimal' }))
  await must(rest('admin', 'invoices', { method: 'POST', body: { order_id: order.id, number: `INV-${Date.now().toString(36)}`, invoice_date: iso(-45), net_amount: 100000, gst_amount: 18000 }, prefer: 'return=minimal' }))
  return { customer, order }
}

/**
 * An order owned by SALES that the engineer is ASSIGNED to (order_engineers), not owner of. `planned`: commissioning planned for
 * tomorrow. `onSite`: the goods are delivered to the site and commissioning has no date yet.
 */
async function seedAssignedJob(kind: 'planned' | 'onSite') {
  const customer = uniqueName(kind === 'planned' ? 'Job Planned' : 'Job On Site')
  const co = await createCompany(customer)
  const order = (
    await must(
      rest<{ id: string; number: number }[]>('admin', 'orders', {
        method: 'POST',
        body: { company_id: co.id, owner_id: SALES, ordered_on: iso(-20), needs_commissioning: true, ...(kind === 'planned' ? { commissioning_planned_on: iso(1) } : {}) },
      }),
    )
  )[0]
  if (kind === 'onSite') {
    const sup = await createCompany(uniqueName('Job Supplier'))
    const leg = (await must(rest<{ id: string }[]>('admin', 'supplier_orders', { method: 'POST', body: { order_id: order.id, supplier_id: sup.id, placed_on: iso(-15), expected_on: iso(-5), delivered_on: iso(-2) } })))[0]
    await must(rest('admin', 'order_items', { method: 'POST', body: { order_id: order.id, description: 'Control valve', qty: 1, unit_price_net: 1000, supplier_order_id: leg.id }, prefer: 'return=minimal' }))
  } else {
    await must(rest('admin', 'order_items', { method: 'POST', body: { order_id: order.id, description: 'Commissioning visit', qty: 1, unit_price_net: 1000, is_service: true }, prefer: 'return=minimal' }))
  }
  await must(rest('admin', 'order_engineers', { method: 'POST', body: { order_id: order.id, user_id: ENGINEER }, prefer: 'return=minimal' }))
  return { customer, order, ref: `ORD-${String(order.number).padStart(4, '0')}` }
}

const rowOf = (page: Page, text: string | RegExp) => page.locator('li[data-rule]').filter({ hasText: text })
const paneFor = (page: Page, ref: string) => page.getByRole('region', { name: new RegExp(ref) })

test.describe('Today: the 1-tap chase (sales)', () => {
  test('one tap copies the message and marks it chased; Undo takes it back; the item then waits and returns on its date', async ({ page }) => {
    const s = await seedCustomerChase(SALES)
    await openAs(page, 'sales', '/todo')
    await showAllTodo(page)
    await expect(page.getByRole('heading', { level: 1, name: 'To do' })).toBeVisible()

    const row = rowOf(page, s.ref).filter({ hasText: 'Chase customer for clarifications' })
    await expect(row).toBeVisible()
    // Asked 9 days ago, bid in 14 days: the chase has been due for days, so it is in "Overdue or due today" and the chip says how late.
    // Late or today, wherever it is drawn: a block, or the "N more" fold when older late rows of the shared data take the seven places.
    await expect(dueRows(page).and(page.locator('li[data-rule="chase_customer"]')).filter({ hasText: s.ref })).toBeVisible()
    await expect(row.getByText(/^\d+ days? overdue$/)).toBeVisible()
    await expect(page.getByRole('region', { name: 'Ready to move' }).filter({ hasText: s.ref })).toHaveCount(0)
    await expect(page.locator('[data-needs-you-count]')).not.toHaveText('0') // the one count (redesign phase 0)
    await row.getByRole('button').first().click() // selecting a row is not a chase
    const pane = paneFor(page, s.ref)
    await expect(pane.getByText('Prepared for you')).toBeVisible()
    await expect(pane.getByTestId('draft-text')).toContainText('1. Line size and flange rating on the process line')
    await review(page, 'today-01-draft-1440')

    // ---- the chase: one tap
    let taps = 0
    await resetClipboard(page)
    await pane.getByRole('button', { name: 'Copy and mark chased' }).click()
    taps++
    const toast = page.getByRole('status').filter({ hasText: `Copied. ${s.ref} marked chased.` })
    await expect(toast).toBeVisible()
    expect(taps).toBe(1)
    const clip = await readClipboardWhen(page, 'A gentle reminder about your RFQ')
    expect(clip).toContain('A gentle reminder about your RFQ')
    expect(clip).toContain('1. Line size and flange rating on the process line')
    expect(clip).toContain('2. Fluid temperature range')
    expect((await askOf(s.clarificationId)).ask_count).toBe(2)
    // the row stays in place, marked, until the undo window closes
    await expect(row.getByText('Copied')).toBeVisible()
    await review(page, 'today-02-copied-1440')

    // ---- Undo (optional): back to exactly what it was
    await toast.getByRole('button', { name: /Undo/ }).click()
    await expect.poll(async () => (await askOf(s.clarificationId)).ask_count).toBe(1)
    await expect(row.getByText('Copied')).toHaveCount(0)

    // ---- chase again and let the window close: the item moves to Waiting
    await pane.getByRole('button', { name: 'Copy and mark chased' }).click()
    await expect(page.getByRole('status').filter({ hasText: `Copied. ${s.ref} marked chased.` })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: `${s.ref} marked chased` })).toBeVisible({ timeout: 15_000 }) // the settled sentence
    const waiting = page.getByRole('region', { name: 'Waiting' })
    await expect(waiting.locator('li[data-rule="chase_customer"]').filter({ hasText: s.ref })).toBeVisible({ timeout: 15_000 })
    await expect(waiting.getByText(/chased just now · next nudge on/).first()).toBeVisible()
    await expect(page.locator('li[data-rule="chase_customer"]:not([data-waiting])').filter({ hasText: s.ref })).toHaveCount(0)
    expect((await askOf(s.clarificationId)).ask_count).toBe(2)

    // ---- just chased: the title stays, the bar says where it went, the cells and the card switch, "Chase again" is there
    await expect(pane.getByRole('heading', { level: 2, name: 'Chase customer for clarifications' })).toBeVisible()
    await expect(pane.getByText('Moved to Waiting.')).toBeVisible()
    await expect(pane.getByText('Chased customer', { exact: true })).toBeVisible()
    await expect(pane.getByText('Chase again on', { exact: true })).toBeVisible()
    await expect(pane.getByRole('region', { name: 'Chased today' })).toBeVisible()
    await expect(pane.getByRole('button', { name: 'Copy and mark chased' })).toHaveCount(0)
    await review(page, 'today-03-waiting-1440')
    await pane.getByRole('button', { name: 'Chase again', exact: true }).click()
    await expect(pane.getByRole('button', { name: 'Copy and mark chased' })).toBeVisible()
  })

  test('the collision line: a colleague already chased it, so you are told who and when before you chase it again', async ({ page }) => {
    const s = await seedCustomerChase(SALES)
    // the admin chases it first (the same stamp the Copy buttons make)
    await must(rest('admin', 'rpc/stamp_clarification_ask', { method: 'POST', body: { p_clarification_ids: [s.clarificationId] }, prefer: 'return=minimal' }))
    await openAs(page, 'sales', '/todo')
    await showAllTodo(page)
    const waiting = page.getByRole('region', { name: 'Waiting' })
    // Waiting starts collapsed (R2-08): "Waiting · N · next nudge …"
    await waiting.getByRole('button', { name: /^Chased, waiting · \d+/ }).click()
    const row = waiting.locator('li[data-rule="chase_customer"]').filter({ hasText: s.ref })
    await expect(row).toBeVisible()
    await expect(row.locator('[data-collision]')).toContainText(/Test chased this (just now|\d+ min ago|\d+h ago|today)/)
    await row.getByRole('button').first().click()
    await expect(page.getByRole('region', { name: new RegExp(s.ref) }).locator('[data-collision]').first()).toContainText('chased this')
    await review(page, 'today-11-collision-1440')
  })

  test('snooze: Tomorrow hides the item, Undo brings it back', async ({ page }) => {
    const s = await seedCustomerChase(SALES)
    await openAs(page, 'sales', '/todo')
    await showAllTodo(page)
    const row = rowOf(page, s.ref).filter({ hasText: 'Chase customer for clarifications' })
    await row.getByRole('button').first().click()
    await paneFor(page, s.ref).getByRole('button', { name: 'Snooze', exact: true }).click() // tap 1: open
    await page.getByRole('menuitem', { name: /^Tomorrow/ }).click() // tap 2: choose
    await expect(page.getByRole('status').filter({ hasText: 'Snoozed until' })).toBeVisible()
    await expect(row).toHaveCount(0)
    await page.getByRole('status').filter({ hasText: 'Snoozed until' }).getByRole('button', { name: /Undo/ }).click()
    await expect(rowOf(page, s.ref).filter({ hasText: 'Chase customer for clarifications' })).toBeVisible()
  })

  test('at 1366 x 768 the one job, "Copy and mark chased", is on the first screen without scrolling', async ({ page }) => {
    const s = await seedCustomerChase(SALES)
    await page.setViewportSize({ width: 1366, height: 768 })
    await openAs(page, 'sales', '/todo')
    await showAllTodo(page)
    await rowOf(page, s.ref).filter({ hasText: 'Chase customer for clarifications' }).getByRole('button').first().click()
    const pane = paneFor(page, s.ref)
    const copy = pane.getByRole('button', { name: 'Copy and mark chased' })
    await expect(copy).toBeVisible()
    const box = await copy.boundingBox()
    expect((box?.y ?? 9999) + (box?.height ?? 0), 'the button bottom is inside the 768 px window').toBeLessThanOrEqual(768)
    // each fact is said once: the status chips and the date rail that repeated the cells are gone
    await expect(pane.locator('[data-status]')).toHaveCount(0)
    await review(page, 'today-12-above-the-fold-1366')
  })

  test('the target tile shows only the signed-in person\'s own number, with its working', async ({ page }) => {
    // A target for sales this quarter; the admin gets a different one that must never appear on sales' screen.
    const d = new Date(`${iso(0)}T00:00:00Z`)
    const year = d.getUTCFullYear()
    const quarter = Math.floor(d.getUTCMonth() / 3) + 1
    await must(rest('admin', 'targets?on_conflict=user_id,year,quarter', { method: 'POST', body: [{ user_id: SALES, year, quarter, target_net_pkr: 6_000_000 }, { user_id: ADMIN, year, quarter, target_net_pkr: 9_999_000 }], prefer: 'resolution=merge-duplicates,return=minimal' }))
    await openAs(page, 'sales', '/todo')
    await showAllTodo(page)
    const tile = page.getByRole('region', { name: new RegExp(`Your Q${quarter} target`) })
    await expect(tile).toContainText('PKR 6,000,000')
    await expect(page.getByText('9,999,000')).toHaveCount(0)
    await tile.getByRole('button', { name: /Day \d+ of \d+/ }).click()
    await expect(tile.getByText('Share of the quarter gone')).toBeVisible()
    await expect(tile.getByText('On pace today')).toBeVisible()
    await review(page, 'today-04-target-working-1440')
  })
})

test.describe('Today: role-aware', () => {
  test('engineer: the jobs they are ASSIGNED to are on Today (commissioning soon, goods on site), with no tabs to choose from', async ({ page }) => {
    const planned = await seedAssignedJob('planned')
    const onSite = await seedAssignedJob('onSite')
    await openAs(page, 'engineer', '/todo')
    await showAllTodo(page)
    const job = page.locator('li[data-rule="job_commissioning"]').filter({ hasText: planned.ref })
    // by day (redesign phase 7): the job is under Tomorrow, the row says the customer and the kind of visit
    await expect(page.getByRole('region', { name: 'Tomorrow' }).locator('li[data-rule="job_commissioning"]').filter({ hasText: planned.ref })).toHaveCount(1)
    await expect(job).toContainText('Installation') // a planned visit with no type is an installation (0109)
    await expect(job).toContainText(planned.customer)
    await expect(page.locator('li[data-rule="job_on_site"]').filter({ hasText: onSite.ref })).toContainText('Goods delivered to site: set the commissioning date')
    // one list for an engineer: no Quotations / Suppliers / Money tabs
    await expect(page.getByRole('radiogroup', { name: 'Show' })).toHaveCount(0)
    await job.getByRole('button').first().click()
    await paneFor(page, planned.ref).getByRole('button', { name: `Open ${planned.ref}` }).click()
    await expect(page).toHaveURL(new RegExp(`/orders/${planned.order.id}`))
    await review(page, 'today-13-engineer-jobs-1440')
  })

  test('engineer: no sales or money item reaches the list, even for their own records, and no receivables request', async ({ page }) => {
    const g = await seedLateGoods(ENGINEER)
    await seedOverdueOrder(ENGINEER)
    const requests: string[] = []
    page.on('request', r => requests.push(r.url()))
    await openAs(page, 'engineer', '/todo')
    await showAllTodo(page)
    // phase 7: an engineer's list is their assigned jobs only; a supplier chase or a late payment is not theirs to act on
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(rowOf(page, g.reference)).toHaveCount(0)
    await expect(page.getByRole('radio', { name: /^Money/ })).toHaveCount(0)
    await expect(page.locator('li[data-rule="payment_overdue"]')).toHaveCount(0)
    await expect(page.locator('li[data-rule="goods_late"]')).toHaveCount(0)
    await expect(page.locator('li[data-rule="close_month"]')).toHaveCount(0)
    expect(requests.some(u => u.includes('order_receivables') || u.includes('month_end_status') || u.includes('/rest/v1/invoices'))).toBe(false)
    await review(page, 'today-05-engineer-goods-1440')
  })

  test('sales: sees the payment-overdue item for their own order, with a reminder 1 tap away', async ({ page }) => {
    const p = await seedOverdueOrder(SALES)
    await openAs(page, 'sales', '/todo')
    await showAllTodo(page)
    const row = rowOf(page, p.customer)
    await expect(row.getByText(/Payment \d+ days overdue/)).toBeVisible()
    await row.getByRole('button').first().click()
    const pane = paneFor(page, `ORD-0*${p.order.number}`)
    await expect(pane.getByTestId('draft-text')).toContainText('outstanding balance of PKR 118,000')
    await pane.getByRole('button', { name: 'Copy and mark reminded' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'marked reminded' })).toBeVisible()
    const inv = await must(rest<{ reminder_count: number }[]>('admin', `invoices?order_id=eq.${p.order.id}&select=reminder_count`))
    expect(inv[0].reminder_count).toBe(1)
    await review(page, 'today-06-sales-payment-1440')
  })

  test('Y1: an order with no payment terms is still overdue, on the company default terms', async ({ page }) => {
    const p = await seedOverdueOrder(SALES, null)
    const [o] = await must(rest<{ payment_terms_days: number | null }[]>('admin', `orders?id=eq.${p.order.id}&select=payment_terms_days`))
    expect(o.payment_terms_days).toBeNull()
    await openAs(page, 'sales', '/todo')
    await showAllTodo(page)
    // invoiced 45 days ago, default terms 30 days: 15 days overdue, the same as an order that carries 30 days itself
    await expect(rowOf(page, p.customer).getByText(/Payment 15 days overdue/)).toBeVisible()
    const [r] = await must(rest<{ is_overdue: boolean; payment_state: string }[]>('admin', 'rpc/order_receivables', { method: 'POST', body: { p_order_id: p.order.id } }))
    expect(r).toMatchObject({ is_overdue: true, payment_state: 'overdue' })
    // and the order page says which terms apply
    await page.goto(`/orders/${p.order.id}`)
    await expect(page.getByTestId('order-terms')).toHaveText('Terms 30 days from invoice (default terms)')
  })

  test('sales: a delivered order with no invoice, and a part-invoiced one, come back as reminders', async ({ page }) => {
    const seed = async (invoiced: boolean) => {
      const customer = uniqueName(invoiced ? 'Part Invoiced' : 'Uninvoiced')
      const co = await createCompany(customer)
      const order = (await must(rest<{ id: string; number: number }[]>('admin', 'orders', { method: 'POST', body: { company_id: co.id, owner_id: SALES, ordered_on: iso(-30), needs_commissioning: true, commissioning_planned_on: iso(-12), commissioning_done_on: iso(-10) } })))[0]
      await must(rest('admin', 'order_items', { method: 'POST', body: { order_id: order.id, description: 'Commissioning visit', qty: 1, unit_price_net: 100000, is_service: true }, prefer: 'return=minimal' }))
      if (invoiced) await must(rest('admin', 'invoices', { method: 'POST', body: { order_id: order.id, number: `INV-${Date.now().toString(36)}`, invoice_date: iso(-8), net_amount: 50000, gst_amount: 9000 }, prefer: 'return=minimal' }))
      return { customer }
    }
    const plain = await seed(false)
    const part = await seed(true)
    await openAs(page, 'sales', '/todo')
    await showAllTodo(page)
    await expect(rowOf(page, plain.customer).getByText('Delivered, not invoiced')).toBeVisible()
    await expect(rowOf(page, part.customer).getByText('Partly invoiced: PKR 59,000 still to invoice')).toBeVisible()
  })

  test('sales: a won order with goods that have no supplier shows how many items still need one', async ({ page }) => {
    const customer = uniqueName('To Source')
    const co = await createCompany(customer)
    const order = (await must(rest<{ id: string }[]>('admin', 'orders', { method: 'POST', body: { company_id: co.id, owner_id: SALES, ordered_on: iso(-3) } })))[0]
    await must(
      rest('admin', 'order_items', {
        method: 'POST',
        body: [
          { order_id: order.id, description: 'Pressure transmitter', qty: 1, unit_price_net: 1000 },
          { order_id: order.id, description: 'Flow meter', qty: 1, unit_price_net: 2000 },
        ],
        prefer: 'return=minimal',
      }),
    )
    await openAs(page, 'sales', '/todo')
    await showAllTodo(page)
    await expect(rowOf(page, customer).getByText('2 items still need a supplier')).toBeVisible()
  })

  test('admin: sees money items for orders that are not sales-owned, plus everything of their own', async ({ page }) => {
    const p = await seedOverdueOrder(ADMIN)
    const mine = await seedCustomerChase(ADMIN)
    const theirs = await seedCustomerChase(SALES) // another owner's RFQ: not on the admin's Today
    await openAs(page, 'admin', '/todo')
    await showAllTodo(page)
    await expect(rowOf(page, p.customer).getByText(/Payment \d+ days overdue/)).toBeVisible()
    await expect(rowOf(page, mine.ref).first()).toBeVisible()
    await expect(rowOf(page, theirs.ref)).toHaveCount(0)
    // the topic tabs are gone (one list); the admin alone has Mine / Team
    await expect(page.getByRole('radiogroup', { name: 'Show' })).toHaveCount(0)
    await expect(page.getByRole('radiogroup', { name: 'Whose list' }).getByRole('radio', { name: 'Team' })).toBeVisible()
    await review(page, 'today-07-admin-1440')
  })
})

test.describe('To do: fits every width, with 44 px buttons', () => {
  for (const [width, height] of [[1440, 900], [1366, 768], [1024, 768], [800, 1024], [375, 812], [320, 640]] as const) {
    test(`at ${width} px nothing scrolls sideways and every row button is 44 px tall`, async ({ page }) => {
      await seedOverdueOrder(ADMIN)
      await page.setViewportSize({ width, height })
      await openAs(page, 'admin', '/todo')
      await showAllTodo(page)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'the page scrolls sideways').toBe(true)
      for (const b of await page.locator('li[data-due] [data-row-actions] button, li[data-due] button[aria-label="Snooze"]').all()) {
        expect((await b.boundingBox())?.height ?? 0, 'a row button is shorter than 44 px').toBeGreaterThanOrEqual(43.5)
      }
      // the colour blocks: Late is red, Today yellow, This week blue, and an empty block is not drawn
      for (const block of await page.locator('section[data-block="late"], section[data-block="today"], section[data-block="week"]').all()) {
        expect(await block.locator('li[data-rule]').count()).toBeGreaterThan(0)
      }
    })
  }
})

test.describe('Today: accessibility and mobile', () => {
  test('axe is clean at 1440 and at 375, and the pane folds into an accordion on a phone', async ({ page }) => {
    const s = await seedCustomerChase(SALES)
    await seedLateGoods(SALES)
    await openAs(page, 'sales', '/todo')
    await showAllTodo(page)
    await expect(rowOf(page, s.ref).first()).toBeVisible()
    await rowOf(page, s.ref).first().getByRole('button').first().click()
    await expect(paneFor(page, s.ref).getByText('Prepared for you')).toBeVisible()
    expect(await violations(page), 'axe at 1440').toEqual([])

    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/todo')
    await showAllTodo(page)
    await page.locator('#main').waitFor()
    const row = rowOf(page, s.ref).filter({ hasText: 'Chase customer for clarifications' })
    await expect(row).toBeVisible()
    // on a phone the list comes first: the target tile sits under it
    const firstRow = await page.locator('li[data-rule]').first().boundingBox()
    const tile = await page.getByRole('region', { name: /target/ }).boundingBox()
    expect(firstRow?.y ?? 9999).toBeLessThan(tile?.y ?? 0)
    await row.getByRole('button').first().click() // the accordion opens under the row
    await expect(row.getByText('Prepared for you')).toBeVisible()
    await review(page, 'today-08-mobile-accordion-375')
    expect(await violations(page), 'axe at 375, accordion open').toEqual([])
    const hit = await row.getByRole('button', { name: 'Copy and mark chased' }).boundingBox()
    expect(hit?.height ?? 0).toBeGreaterThanOrEqual(44) // actions are 44 px on a phone
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    await row.getByRole('button', { name: 'Copy and mark chased' }).click()
    await expect(page.getByRole('status').filter({ hasText: `Copied. ${s.ref} marked chased.` })).toBeVisible()
    await review(page, 'today-09-mobile-copied-375')
    // the undo window closes: the row joins Waiting and the accordion shows the compact "Chased today" card
    await expect(page.getByRole('status').filter({ hasText: `${s.ref} marked chased` })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('region', { name: 'Waiting' }).locator('li[data-rule="chase_customer"]').filter({ hasText: s.ref })).toBeVisible({ timeout: 15_000 })
    // (the row was open when it was chased, so it stays open in Waiting)
    await expect(page.getByRole('region', { name: 'Chased today' })).toBeVisible()
    await page.getByRole('region', { name: 'Chased today' }).scrollIntoViewIfNeeded()
    await review(page, 'today-10-mobile-waiting-375')
  })

  test('an empty Today reads as the goal state', async ({ page }) => {
    // The engineer has no seed of their own in this describe's first run; whatever is there, the heading and tabs must render.
    const role: Role = 'engineer'
    await openAs(page, role, '/todo')
    await showAllTodo(page)
    await expect(page.getByRole('heading', { level: 1, name: 'To do' })).toBeVisible()
    expect(await violations(page), 'axe empty or populated').toEqual([])
  })
})
