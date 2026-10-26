import { expect, test, type Page } from '@playwright/test'
import { createCompany, karachiDay, must, openAs, review, rest, uniqueName } from '../support/stack'
import { showAllTodo } from '../support/todo'
import { axeViolations } from '../support/axe'
import { readClipboardWhen, resetClipboard } from '../support/clipboard'

/*
 * M09 (payment-reminder panel beside Who owes us, the old Receivables) and M08 (Today v3 money rules), end to end on the local CI stack.
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
    // At 1440 the table fits beside the panel with no sideways scroll, and the panel stops short of the page edge.
    expect(await page.evaluate(() => Array.from(document.querySelectorAll('table')).every(t => !t.parentElement || t.parentElement.scrollWidth <= t.parentElement.clientWidth + 1))).toBe(true)
    const box = await panel.boundingBox()
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(1440 - 16)
    await review(page, 'm09-receivables-reminder-1440')

    await page.evaluate(() => {
      const w = window as unknown as { __keys: string[]; __mouse: number }
      w.__keys = []
      w.__mouse = 0
      document.addEventListener('keydown', e => e.key.length > 1 && w.__keys.push(e.key), true)
      document.addEventListener('mousedown', () => (w.__mouse += 1), true)
    })
    await resetClipboard(page)
    await panel.getByRole('button', { name: 'Copy and mark reminded' }).click() // the one tap
    await expect(panel.getByText(/Reminder 1 recorded today/)).toBeVisible()
    const c = await page.evaluate(() => ({ keys: (window as unknown as { __keys: string[] }).__keys, mouse: (window as unknown as { __mouse: number }).__mouse }))
    expect(c).toEqual({ keys: [], mouse: 1 })
    await readClipboardWhen(page, `Sales Tax Invoice ${s.invoiceNumber}`)
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

  test('Open in WhatsApp is a wa.me link with the text filled in and marks nothing; Mark reminded stamps, Undo takes it back', async ({ page }) => {
    const s = await seedOverdue()
    await openAs(page, 'admin', '/money/receivables')
    await pick(page, s)
    const panel = page.getByTestId('reminder-panel')
    // Record the link instead of leaving the app for wa.me.
    await page.evaluate(() => {
      const w = window as unknown as { opened: string[] }
      w.opened = []
      HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
        w.opened.push(this.href)
      }
    })
    await panel.getByRole('button', { name: 'Open in WhatsApp' }).click()
    const opened = await page.evaluate(() => (window as unknown as { opened: string[] }).opened)
    expect(opened).toHaveLength(1)
    expect(opened[0]).toMatch(/^https:\/\/wa\.me\/923005550118\?text=[^&]+$/)
    expect(decodeURIComponent(opened[0].split('?text=')[1])).toContain('Mr. Faisal Qureshi')
    expect(await invoiceRow(s.invoiceId)).toEqual({ last_reminded_on: null, reminder_count: 0 }) // opening never marks
    await panel.getByRole('button', { name: 'Mark reminded', exact: true }).click()
    await expect(panel.getByText(/Reminder 1 recorded today/)).toBeVisible()
    await expect.poll(() => invoiceRow(s.invoiceId)).toEqual({ last_reminded_on: today(), reminder_count: 1 })
    await panel.getByRole('button', { name: 'Undo' }).click()
    await expect(panel.getByRole('button', { name: 'Copy and mark reminded' })).toBeVisible()
    await expect.poll(() => invoiceRow(s.invoiceId)).toEqual({ last_reminded_on: null, reminder_count: 0 })
  })

  test('a reminded order leaves Today for Waiting, and the Receivables row says when it was reminded', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const s = await seedOverdue()
    await openAs(page, 'admin', '/todo')
    await showAllTodo(page)
    await expect(page.locator('li[data-rule="payment_overdue"]:not([data-waiting])').filter({ hasText: s.company.name })).toBeVisible()
    await page.goto('/money/receivables')
    await pick(page, s)
    await page.getByTestId('reminder-panel').getByRole('button', { name: 'Copy and mark reminded' }).click()
    await expect(page.getByText(/Reminder 1 recorded today/)).toBeVisible()
    await page.waitForTimeout(10_500) // the undo window closes and the screen re-reads
    await expect(page.getByRole('row', { name: new RegExp(s.company.name) })).toContainText('Reminded today')
    await page.goto('/todo')
    await showAllTodo(page)
    // Waiting starts collapsed (R2-08): open it to see the reminded order
    await page.getByRole('region', { name: 'Waiting' }).getByRole('button', { name: /^Chased, waiting · \d+/ }).click()
    await expect(page.locator('li[data-rule="payment_overdue"][data-waiting]').filter({ hasText: s.company.name })).toHaveCount(1)
    await expect(page.locator('li[data-rule="payment_overdue"]:not([data-waiting])').filter({ hasText: s.company.name })).toHaveCount(0)
  })

  test('Receivables has no sideways scroll at 1536 (all columns beside the panel), 1440 and 1360 (Gross and Settled folded) or 1280 (panel under the table)', async ({ page }) => {
    await seedOverdue()
    await openAs(page, 'admin', '/money/receivables')
    await expect(page.getByTestId('reminder-text')).toBeVisible()
    const measure = () =>
      page.evaluate(() => {
        const t = document.querySelector('table')
        const w = t?.parentElement
        return { scroll: w?.scrollWidth ?? 0, client: w?.clientWidth ?? 0, columns: Array.from(document.querySelectorAll('table thead th')).filter(th => (th as HTMLElement).offsetParent !== null).length, page: document.documentElement.scrollWidth, view: window.innerWidth }
      })
    // round 3: no Actions column (Record payment lives in the panel)
    for (const [width, columns] of [[1536, 6], [1440, 4], [1360, 4], [1280, 6]] as const) {
      // Payment + Last reminder are one Next step column (R2-06)
      await page.setViewportSize({ width, height: 900 })
      await page.waitForTimeout(300)
      const m = await measure()
      console.log(`MEASURE ${width}`, JSON.stringify(m))
      expect(m.scroll, `table scrolls sideways at ${width}`).toBeLessThanOrEqual(m.client + 1)
      if (m.page > m.view) {
        const wide = await page.evaluate(() =>
          Array.from(document.querySelectorAll('body *'))
            .filter(e => e.getBoundingClientRect().right > window.innerWidth + 0.5)
            .slice(0, 6)
            .map(e => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 60)} right=${Math.round(e.getBoundingClientRect().right)}`),
        )
        console.log(`OVERFLOW ${width}`, JSON.stringify(wide))
      }
      expect(m.page, `page scrolls sideways at ${width}`).toBeLessThanOrEqual(m.view)
      expect(m.columns, `visible columns at ${width}`).toBe(columns)
    }
  })

  test('an order not yet overdue gets the plain sentence and no message', async ({ page }) => {
    const s = await seedOverdue({ invoiceDate: karachiDay(-5) })
    await openAs(page, 'admin', '/money/receivables')
    await pick(page, s)
    const panel = page.getByTestId('reminder-panel')
    await expect(panel.getByText('Not overdue yet.')).toBeVisible()
    await expect(panel.getByTestId('reminder-text')).toHaveCount(0)
  })

  test('sales get the panel on Who owes us (one name for both roles)', async ({ page }) => {
    const s = await seedOverdue()
    await openAs(page, 'sales', '/money/receivables')
    await pick(page, s)
    await expect(page.getByTestId('reminder-text')).toContainText(s.invoiceNumber)
    await review(page, 'm09-order-balances-reminder-sales-1440')
  })

  test('an engineer reaches neither the screen nor the RPC', async ({ page }) => {
    const s = await seedOverdue()
    const seen: string[] = []
    page.on('request', r => {
      if (/stamp_payment_reminder|rpc\/order_receivables|\/rest\/v1\/invoices/.test(r.url())) seen.push(r.url())
    })
    await openAs(page, 'engineer', '/money/gst-register')
    await expect(page.getByRole('heading', { name: /Money is for admins and sales/ })).toBeVisible()
    await page.goto('/money/receivables')
    await expect(page.getByRole('heading', { name: /Money is for admins and sales/ })).toBeVisible()
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
  const tcs = 'li[data-rule="tcs_not_sent"]'

  test('admin sees the TCS item as one rolled-up row that opens the register', async ({ page }) => {
    // An invoice from 10 days ago with no courier date: "n invoices not sent by TCS" (one rolled-up item).
    await seedOverdue({ invoiceDate: karachiDay(-10) })
    await openAs(page, 'admin', '/todo')
    await showAllTodo(page)
    await expect(page.locator(tcs)).toHaveCount(1)
    await expect(page.locator(tcs)).toContainText(/\d+ invoices? not sent by TCS/)
    // Redesign phase 0: a roll-up chore is listed, not counted, and Money carries no number (the one badge is Today's)
    await expect(page.getByRole('navigation', { name: 'Main' }).first().getByRole('link', { name: 'Money', exact: true })).toBeVisible()
    await review(page, 'm08-today-money-1440')
    await page.locator(`${tcs} button`).first().click()
    await expect(page.getByRole('button', { name: /Open Invoices & GST/ })).toBeVisible()
    await review(page, 'm08-today-money-pane-1440')
  })

  test('sales see the TCS item but not the admin-only money items', async ({ page }) => {
    await openAs(page, 'sales', '/todo')
    await showAllTodo(page)
    await expect(page.locator(tcs)).toHaveCount(1)
    for (const rule of ['costs_incomplete', 'recurring_due', 'close_month']) await expect(page.locator(`li[data-rule="${rule}"]`)).toHaveCount(0)
  })

  test('the engineer sees no money item and makes no money request', async ({ page }) => {
    const seen: string[] = []
    page.on('request', r => {
      if (/v_invoice_state|v_order_money|recurring_expenses|rpc\/order_receivables|rpc\/month_end_status/.test(r.url())) seen.push(r.url())
    })
    await openAs(page, 'engineer', '/todo')
    await showAllTodo(page)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Main' }).first().getByRole('link', { name: /Money/ })).toHaveCount(0) // E-SH-01
    for (const rule of ['tcs_not_sent', 'fbr_attention', 'costs_incomplete', 'recurring_due', 'payment_overdue', 'close_month']) {
      await expect(page.locator(`li[data-rule="${rule}"]`)).toHaveCount(0)
    }
    expect(seen, 'engineer must not request money data').toEqual([])
  })

  test('the Today money items fit at 375 and pass axe', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await openAs(page, 'admin', '/todo')
    await showAllTodo(page)
    await expect(page.locator(tcs)).toHaveCount(1)
    await review(page, 'm08-today-money-375')
    expect(await axeViolations(page)).toEqual([])
  })
})
