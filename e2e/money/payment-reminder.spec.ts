import { expect, test, type Page } from '@playwright/test'
import { createCompany, karachiDay, must, openAs, review, rest, uniqueName } from '../support/stack'
import { axeViolations } from '../support/axe'

/*
 * M09 (payment-reminder panel beside Receivables) and M08 (Today v3 money rules), end to end on the local CI stack.
 *
 * FE-2 target asserted here: "Copy and mark reminded" is ONE tap (one mouse press, no key) and stamps every invoice of the
 * order; Undo inside 10 seconds puts the old values back; the order then moves to Waiting on Today; an engineer can neither
 * see Money nor call stamp_payment_reminder; Today's four rolled-up money items reach admin and sales and never an engineer.
 */
const today = () => karachiDay(0)
const unique = () => Math.random().toString(36).slice(2, 8)

interface Seed {
  orderId: string
  orderNumber: number
  company: { id: string; name: string }
  invoiceId: string
  invoiceNumber: string
}

/** An overdue order: invoiced 60 days ago on 30-day terms (so 30 days late), one contact, one invoice, nothing paid. */
async function seedOverdue(over: { net?: number; invoiceDate?: string; ownerId?: string } = {}): Promise<Seed> {
  const company = await createCompany(uniqueName('Reminder Customer'))
  const [contact] = await must(rest<{ id: string }[]>('admin', 'contacts', { method: 'POST', body: { company_id: company.id, name: 'Mr. Faisal Qureshi', phone: '0300 555 0118', job_title: 'Accounts' } }))
  const [order] = await must(
    rest<{ id: string; number: number }[]>('admin', 'orders', {
      method: 'POST',
      body: { company_id: company.id, contact_id: contact.id, payment_terms_days: 30, customer_po_number: `PO-${unique()}`, ...(over.ownerId ? { owner_id: over.ownerId } : {}) },
    }),
  )
  await must(rest('admin', 'order_items', { method: 'POST', body: { order_id: order.id, position: 0, description: 'Flow meter DN50', qty: 1, unit_price_net: over.net ?? 100000, gst_rate: 18 }, prefer: 'return=minimal' }))
  const number = `RM-${unique()}`
  const [inv] = await must(
    rest<{ id: string }[]>('admin', 'invoices', {
      method: 'POST',
      body: { order_id: order.id, number, invoice_date: over.invoiceDate ?? karachiDay(-60), net_amount: over.net ?? 100000, gst_amount: Math.round((over.net ?? 100000) * 0.18) },
    }),
  )
  return { orderId: order.id, orderNumber: order.number, company, invoiceId: inv.id, invoiceNumber: number }
}

const invoiceRow = (id: string) => must(rest<{ last_reminded_on: string | null; reminder_count: number }[]>('admin', `invoices?id=eq.${id}&select=last_reminded_on,reminder_count`)).then(r => r[0])

async function pick(page: Page, s: Seed) {
  await page.getByRole('row', { name: new RegExp(s.company.name) }).click()
}

test.describe.configure({ mode: 'serial' })

test.describe('payment-reminder panel (M09)', () => {
  test('the panel opens on the order, shows the written text, and Copy and mark reminded is one tap that stamps the invoice', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const s = await seedOverdue()
    await openAs(page, 'admin', '/money/receivables')
    await pick(page, s)
    const panel = page.getByTestId('reminder-panel')
    await expect(panel.getByRole('heading', { name: 'Payment reminder' })).toBeVisible()
    await expect(panel.getByText(s.company.name)).toBeVisible()
    const text = panel.getByTestId('reminder-text')
    await expect(text).toContainText(`Sales Tax Invoice ${s.invoiceNumber}`)
    await expect(text).toContainText('PKR 118,000')
    await expect(text).toContainText('Assalamu alaikum Mr. Faisal Qureshi,')
    await expect(panel.getByText('0300 555 0118')).toBeVisible()
    await expect(panel.getByTestId('reminder-state')).toHaveText('Not reminded yet')
    await expect(panel.getByText(/Firmer wording, because the invoice is 30 days overdue|Standard wording, 30 days overdue/)).toBeVisible()
    await review(page, 'm09-receivables-reminder-1440')

    await page.evaluate(() => {
      const w = window as unknown as { __keys: string[]; __mouse: number }
      w.__keys = []
      w.__mouse = 0
      document.addEventListener('keydown', e => e.key.length > 1 && w.__keys.push(e.key), true)
      document.addEventListener('mousedown', () => (w.__mouse += 1), true)
    })
    await panel.getByRole('button', { name: 'Copy and mark reminded' }).click() // the one tap
    await expect(panel.getByText(/Reminder 1 recorded today/)).toBeVisible()
    const c = await page.evaluate(() => ({ keys: (window as unknown as { __keys: string[] }).__keys, mouse: (window as unknown as { __mouse: number }).__mouse }))
    expect(c).toEqual({ keys: [], mouse: 1 })
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(`Sales Tax Invoice ${s.invoiceNumber}`)
    expect(await invoiceRow(s.invoiceId)).toEqual({ last_reminded_on: today(), reminder_count: 1 })
    await review(page, 'm09-receivables-reminder-copied-1440')
  })

  test('Undo inside the window puts the old values back', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const s = await seedOverdue()
    await openAs(page, 'admin', '/money/receivables')
    await pick(page, s)
    const panel = page.getByTestId('reminder-panel')
    await panel.getByRole('button', { name: 'Copy and mark reminded' }).click()
    await expect(panel.getByRole('button', { name: 'Undo' })).toBeVisible()
    await panel.getByRole('button', { name: 'Undo' }).click()
    await expect(panel.getByRole('button', { name: 'Copy and mark reminded' })).toBeVisible()
    expect(await invoiceRow(s.invoiceId)).toEqual({ last_reminded_on: null, reminder_count: 0 })
  })

  test('a reminded order leaves Today for Waiting, and the Receivables row says when it was reminded', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const s = await seedOverdue()
    await openAs(page, 'admin', '/today')
    await expect(page.locator('li[data-rule="payment_overdue"]:not([data-waiting])').filter({ hasText: s.company.name })).toBeVisible()
    await page.goto('/money/receivables')
    await pick(page, s)
    await page.getByTestId('reminder-panel').getByRole('button', { name: 'Copy and mark reminded' }).click()
    await expect(page.getByText(/Reminder 1 recorded today/)).toBeVisible()
    await page.waitForTimeout(10_500) // the undo window closes and the screen re-reads
    await expect(page.getByRole('row', { name: new RegExp(s.company.name) })).toContainText('Reminded 1×')
    await page.goto('/today')
    await expect(page.locator('li[data-rule="payment_overdue"][data-waiting]').filter({ hasText: s.company.name })).toHaveCount(1)
    await expect(page.locator('li[data-rule="payment_overdue"]:not([data-waiting])').filter({ hasText: s.company.name })).toHaveCount(0)
  })

  test('an order not yet overdue gets the plain sentence and no message', async ({ page }) => {
    const s = await seedOverdue({ invoiceDate: karachiDay(-5) })
    await openAs(page, 'admin', '/money/receivables')
    await pick(page, s)
    const panel = page.getByTestId('reminder-panel')
    await expect(panel.getByText('Not overdue yet.')).toBeVisible()
    await expect(panel.getByTestId('reminder-text')).toHaveCount(0)
  })

  test('sales get the panel on Order balances; an engineer reaches neither the screen nor the RPC', async ({ page }) => {
    const s = await seedOverdue()
    await openAs(page, 'sales', '/money/receivables')
    await pick(page, s)
    await expect(page.getByTestId('reminder-text')).toContainText(s.invoiceNumber)
    await review(page, 'm09-order-balances-reminder-sales-1440')

    const seen: string[] = []
    page.on('request', r => {
      if (/stamp_payment_reminder|rpc\/order_receivables|\/rest\/v1\/invoices/.test(r.url())) seen.push(r.url())
    })
    await openAs(page, 'engineer', '/money/receivables')
    await expect(page.getByRole('heading', { name: /not available to your role/ })).toBeVisible()
    expect(seen, 'engineer must not fetch money data').toEqual([])
    const refused = await rest('engineer', 'rpc/stamp_payment_reminder', { method: 'POST', body: { p_invoice_ids: [s.invoiceId] } })
    expect(refused.status).toBeGreaterThanOrEqual(400)
    expect(await invoiceRow(s.invoiceId)).toEqual({ last_reminded_on: null, reminder_count: 0 })
  })

  test('the layout holds at 375 and axe passes at 1440 and 375', async ({ page }) => {
    const s = await seedOverdue()
    await openAs(page, 'admin', '/money/receivables')
    await pick(page, s)
    await expect(page.getByTestId('reminder-text')).toBeVisible()
    expect(await axeViolations(page)).toEqual([])
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/money/receivables')
    await page.waitForLoadState('networkidle')
    await page.getByText(s.company.name).first().click()
    await expect(page.getByTestId('reminder-text')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByTestId('reminder-panel').scrollIntoViewIfNeeded()
    await review(page, 'm09-receivables-reminder-375')
    expect(await axeViolations(page)).toEqual([])
  })
})

test.describe('Today v3 money rules (M08)', () => {
  test('admin and sales see the TCS item; the engineer sees no money item and no money request', async ({ page }) => {
    // An invoice from 10 days ago with no courier date: "n invoices not sent by TCS" (one rolled-up item).
    await seedOverdue({ invoiceDate: karachiDay(-10) })
    for (const role of ['admin', 'sales'] as const) {
      await openAs(page, role, '/today')
      await expect(page.locator('li[data-rule="tcs_not_sent"]')).toHaveCount(1)
      await expect(page.locator('li[data-rule="tcs_not_sent"]')).toContainText(/\d+ invoices? not sent by TCS/)
      if (role === 'sales') for (const rule of ['costs_incomplete', 'recurring_due']) await expect(page.locator(`li[data-rule="${rule}"]`)).toHaveCount(0)
    }
    await openAs(page, 'admin', '/today')
    await page.getByRole('radio', { name: /^Money/ }).click()
    await review(page, 'm08-today-money-1440')
    await page.locator('li[data-rule="tcs_not_sent"] button').click()
    await expect(page.getByRole('button', { name: /Open GST register/ })).toBeVisible()
    await review(page, 'm08-today-money-pane-1440')

    const seen: string[] = []
    page.on('request', r => {
      if (/v_invoice_state|v_order_money|recurring_expenses|rpc\/order_receivables|rpc\/month_end_status/.test(r.url())) seen.push(r.url())
    })
    await openAs(page, 'engineer', '/today')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    for (const rule of ['tcs_not_sent', 'fbr_attention', 'costs_incomplete', 'recurring_due', 'payment_overdue', 'close_month']) {
      await expect(page.locator(`li[data-rule="${rule}"]`)).toHaveCount(0)
    }
    expect(seen, 'engineer must not request money data').toEqual([])
  })

  test('the Today money items fit at 375 and pass axe', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await openAs(page, 'admin', '/today')
    await page.getByRole('radio', { name: /^Money/ }).click()
    await expect(page.locator('li[data-rule="tcs_not_sent"]')).toHaveCount(1)
    await review(page, 'm08-today-money-375')
    expect(await axeViolations(page)).toEqual([])
  })
})
