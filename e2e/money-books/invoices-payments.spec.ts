import { expect, test, type Page } from '@playwright/test'
import { createCompany, karachiDay, must, openAs, review, rest, uniqueName } from '../support/stack'
import { openStage, stagesOf } from '../support/job'
import { axeViolations } from '../support/axe'

/*
 * M01 and M02 end to end, against the local CI stack: invoices and the GST register, payments in and receivables, through the
 * real login form as the fixture users.
 *
 * FE-2 targets asserted here (BUILD_PLAN M01, M02):
 *   Create invoice                 2 taps (open, Create), nothing typed; the number is the next in the series, the date is today
 *   Record payment, full           2 taps (open, Save), nothing typed; the amount is the balance due, the date is today
 *   Month stamping                 at most 3 taps + 1 PSID paste (tick the month, Invoice posted, [paste PSID + Enter], Deposited)
 * plus: GST is 18% or exempt, a refused number, the receipt upload, sales seeing the register and balances but no payment rows,
 * the engineer seeing none of it (network log and RLS), and axe (WCAG 2.2 AA) at 1440 and 375.
 */
const today = () => karachiDay(0)
const unique = () => Math.random().toString(36).slice(2, 8)

interface OrderSeed {
  id: string
  number: number
  company: { id: string; name: string }
}

/** An order with one line (so a gross to invoice and collect): net `net`, GST 18% unless `rate` says otherwise. */
async function seedOrder(net = 100000, rate = 18): Promise<OrderSeed> {
  const company = await createCompany(uniqueName('Money Customer'))
  const [order] = await must(rest<{ id: string; number: number }[]>('admin', 'orders', { method: 'POST', body: { company_id: company.id, payment_terms_days: 30 } }))
  await must(
    rest('admin', 'order_items', { method: 'POST', body: { order_id: order.id, position: 0, description: 'Flow meter DN50', qty: 1, unit_price_net: net, gst_rate: rate }, prefer: 'return=minimal' }),
  )
  return { id: order.id, number: order.number, company }
}

interface InvoiceRow {
  id: string
  number: string
  invoice_date: string
  net_amount: number
  gst_amount: number
  tcs_sent_on: string | null
  psid: string | null
  tax_deposited_on: string | null
  tax_deposit_amount: number | null
  wasif_receipt_on: string | null
  order_id: string | null
}

const seedInvoice = (order: OrderSeed | null, over: Record<string, unknown> = {}) =>
  must(
    rest<InvoiceRow[]>('admin', 'invoices', {
      method: 'POST',
      body: { number: `E2E-${unique()}`, invoice_date: today(), net_amount: 100000, gst_amount: 18000, ...(order ? { order_id: order.id } : { company_id: undefined }), ...over },
    }),
  ).then(r => r[0])

const invoicesOf = (orderId: string) => must(rest<InvoiceRow[]>('admin', `invoices?order_id=eq.${orderId}&select=*&order=created_at`))

async function nextNumber(): Promise<string> {
  const rows = await must(rest<{ next_number: string }[]>('admin', 'rpc/next_invoice_number', { method: 'POST', body: {} }))
  return rows[0].next_number
}

async function receivable(orderId: string) {
  const rows = await must(rest<{ balance: number; settled: number; payment_state: string }[]>('admin', 'rpc/order_receivables', { method: 'POST', body: { p_order_id: orderId } }))
  return rows[0]
}

/** Named keys and mouse presses a person makes, counted from the page itself after `start`. */
async function startCounting(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __keys: string[]; __mouse: number }
    w.__keys = []
    w.__mouse = 0
    document.addEventListener('keydown', e => e.key.length > 1 && !['Control', 'Shift', 'Alt', 'Meta'].includes(e.key) && w.__keys.push(e.key), true)
    document.addEventListener('mousedown', () => (w.__mouse += 1), true)
  })
}
const counted = (page: Page) => page.evaluate(() => ({ keys: (window as unknown as { __keys: string[] }).__keys, mouse: (window as unknown as { __mouse: number }).__mouse }))

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8DwnwEJMDEgAVwcAEVXAgJQ6mHVAAAAAElFTkSuQmCC', 'base64')

test.describe.configure({ mode: 'serial' })

test.describe('invoices and the GST register (M01)', () => {
  test('create invoice from the order: 2 taps, nothing typed, number pre-filled, amounts from the lines', async ({ page }) => {
    const order = await seedOrder(1949800)
    await seedInvoice(null, { company_id: order.company.id, number: 'INV-7000' }).catch(() => undefined)
    const expected = await nextNumber()
    await openAs(page, 'admin', `/orders/${order.id}`)
    await openStage(page, 'Invoice')
    await stagesOf(page).getByRole('button', { name: 'Create invoice' }).click() // tap 1
    const dialog = page.getByRole('dialog', { name: 'Create invoice' })
    await expect(dialog.getByRole('textbox', { name: 'Invoice number' })).toHaveValue(expected)
    await expect(dialog.getByText(/Next after /)).toBeVisible()
    await expect(dialog.getByText('GST, 18%')).toBeVisible()
    await expect(dialog.getByText('1,949,800')).toBeVisible()
    await expect(dialog.getByText('350,964')).toBeVisible()
    await expect(dialog.getByText('2,300,764')).toBeVisible()
    await expect(dialog.getByText(/30 days from invoice/)).toBeVisible()
    await review(page, 'm01-create-invoice-1440')
    await startCounting(page)
    await dialog.getByRole('button', { name: 'Create invoice' }).click() // tap 2
    await expect(page.getByRole('dialog')).toBeHidden()
    const c = await counted(page)
    expect(c.mouse).toBe(1)
    expect(c.keys).toEqual([])
    const [inv] = await invoicesOf(order.id)
    expect(inv).toMatchObject({ number: expected, invoice_date: today(), net_amount: 1949800, gst_amount: 350964 })
    // the next number moves on
    expect(await nextNumber()).not.toBe(expected)
  })

  test('GST is 18% or exempt: exempt makes it zero, and no other rate is offered', async ({ page }) => {
    const order = await seedOrder(250000)
    await openAs(page, 'admin', `/money/gst-register?new=1&order=${order.id}`)
    const dialog = page.getByRole('dialog', { name: 'Create invoice' })
    await expect(dialog.getByText('GST, 18%')).toBeVisible()
    await dialog.getByRole('button', { name: /Edit the amounts/ }).click()
    await expect(dialog.getByRole('radio')).toHaveText(['18%', 'Exempt'])
    await dialog.getByRole('radio', { name: 'Exempt' }).click()
    await expect(dialog.getByText('GST, exempt')).toBeVisible()
    await dialog.getByRole('button', { name: 'Create invoice' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    const [inv] = await invoicesOf(order.id)
    expect(inv).toMatchObject({ net_amount: 250000, gst_amount: 0 })
  })

  test('a number already in the register is refused under the field and nothing is lost', async ({ page }) => {
    const order = await seedOrder()
    const taken = await seedInvoice(null, { company_id: order.company.id })
    await openAs(page, 'admin', `/money/gst-register?new=1&order=${order.id}`)
    const dialog = page.getByRole('dialog', { name: 'Create invoice' })
    const number = dialog.getByRole('textbox', { name: 'Invoice number' })
    await number.fill(taken.number)
    await dialog.getByRole('button', { name: 'Create invoice' }).click()
    await expect(dialog.getByText('This invoice number is already in the register. Use the next one.')).toBeVisible()
    await expect(number).toHaveValue(taken.number)
    expect(await invoicesOf(order.id)).toHaveLength(0)
  })

  test('month stamping: tick the month, then one tap per step and one PSID paste, writing today to every ticked invoice', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    // three invoices in a month of their own, three months back, none of them filed yet
    const d = new Date(`${today()}T12:00:00Z`)
    d.setUTCMonth(d.getUTCMonth() - 3, 1)
    const key = d.toISOString().slice(0, 7)
    const label = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(d)
    const co = await createCompany(uniqueName('Stamp Customer'))
    const tag = unique()
    const seeded = []
    for (const [i, day] of ['05', '12', '20'].entries()) {
      seeded.push(await seedInvoice(null, { company_id: co.id, number: `ST-${tag}-${i}`, invoice_date: `${key}-${day}`, net_amount: 100000 + i * 1000, gst_amount: 18000 + i * 180 }))
    }
    await openAs(page, 'admin', '/money/gst-register')
    const group = page.getByRole('checkbox', { name: new RegExp(`Select all in ${label} · \\d+ invoices`) })
    await expect(group).toBeVisible()
    await expect(page.getByText(`ST-${tag}-0`)).toBeVisible()
    await expect(page.getByText(/invoice, tax not deposited/).first()).toBeVisible() // an earlier month, not deposited
    await review(page, 'm01-gst-register-1440')
    await page.evaluate(psid => navigator.clipboard.writeText(psid), `PSID${tag}`)
    await startCounting(page)
    await group.click() // tap 1: tick the month
    const bar = page.getByTestId('batch-bar')
    await expect(bar).toContainText('ticked')
    await review(page, 'm01-month-stamping-1440')
    await bar.getByRole('button', { name: 'Invoice posted today' }).click() // tap 2
    await expect(page.getByText(/sent to the customer today/).first()).toBeVisible()
    await page.getByRole('textbox', { name: 'PSID', exact: true }).focus()
    await page.keyboard.press('Control+V') // the one paste
    await page.keyboard.press('Enter')
    await expect(page.getByText(new RegExp(`given PSID PSID${tag}`)).first()).toBeVisible()
    await bar.getByRole('button', { name: 'Deposited today' }).click() // tap 3
    await expect(page.getByText(/deposited today/).first()).toBeVisible()
    const c = await counted(page)
    expect(c.mouse).toBe(3) // at most 3 taps, plus the PSID paste (keyboard)
    expect(c.keys).toEqual(['Enter'])
    const rows = await must(rest<InvoiceRow[]>('admin', `invoices?id=in.(${seeded.map(s => s.id).join(',')})&select=*&order=invoice_date`))
    expect(rows).toHaveLength(3)
    for (const r of rows) {
      expect(r.tcs_sent_on).toBe(today())
      expect(r.psid).toBe(`PSID${tag}`)
      expect(r.tax_deposited_on).toBe(today())
    }
    // the deposit amount defaults to the GST amount
    expect(rows.map(r => Number(r.tax_deposit_amount))).toEqual([18000, 18180, 18360])
  })

  test('Undo takes a stamp back inside its toast', async ({ page }) => {
    const co = await createCompany(uniqueName('Undo Customer'))
    const inv = await seedInvoice(null, { company_id: co.id })
    await openAs(page, 'admin', '/money/gst-register')
    await page.getByRole('checkbox', { name: `Select ${inv.number}` }).click()
    await page.getByTestId('batch-bar').getByRole('button', { name: 'Invoice posted today' }).click()
    await expect(page.getByText(/sent to the customer today/).first()).toBeVisible()
    await expect.poll(async () => (await must(rest<InvoiceRow[]>('admin', `invoices?id=eq.${inv.id}&select=tcs_sent_on`)))[0].tcs_sent_on).toBe(today())
    await page.getByRole('button', { name: /^Undo/ }).first().click()
    await expect.poll(async () => (await must(rest<InvoiceRow[]>('admin', `invoices?id=eq.${inv.id}&select=tcs_sent_on`)))[0].tcs_sent_on).toBeNull()
  })

  test('the FBR receipt is uploaded to gst-receipts from the invoice and dates the receipt step', async ({ page }) => {
    const co = await createCompany(uniqueName('Receipt Customer'))
    const inv = await seedInvoice(null, { company_id: co.id })
    await openAs(page, 'admin', '/money/gst-register')
    await page.getByRole('row', { name: new RegExp(inv.number) }).getByText(co.name).click()
    const dialog = page.getByRole('dialog', { name: `Invoice ${inv.number}` })
    await expect(dialog).toBeVisible()
    await dialog.locator('input[type=file]').setInputFiles({ name: 'fbr-receipt.png', mimeType: 'image/png', buffer: PNG })
    await expect(dialog.getByRole('button', { name: 'fbr-receipt.png', exact: true })).toBeVisible()
    const [att] = await must(rest<{ bucket: string; path: string }[]>('admin', `attachments?invoice_id=eq.${inv.id}&select=bucket,path`))
    expect(att.bucket).toBe('gst-receipts')
    expect(att.path.startsWith(`${inv.id}/`)).toBe(true)
    const [after] = await must(rest<InvoiceRow[]>('admin', `invoices?id=eq.${inv.id}&select=wasif_receipt_on`))
    expect(after.wasif_receipt_on).toBe(today())
  })

  test('T1: one receipt for a PSID covers every invoice of that PSID, so FBR attention clears for the whole group', async ({ page }) => {
    const co = await createCompany(uniqueName('Group Receipt Customer'))
    const psid = `PSID-${unique()}`.toUpperCase()
    const group = { company_id: co.id, psid, tax_deposited_on: today(), tcs_sent_on: today() }
    const a = await seedInvoice(null, group)
    const b = await seedInvoice(null, group)
    const lone = await seedInvoice(null, { company_id: co.id, psid: `${psid}-OTHER`, tax_deposited_on: today() })
    const exceptions = async () =>
      Object.fromEntries(
        (await must(rest<{ invoice_id: string; fbr_exception: boolean }[]>('admin', `v_invoice_state?invoice_id=in.(${a.id},${b.id},${lone.id})&select=invoice_id,fbr_exception`))).map(r => [r.invoice_id, r.fbr_exception]),
      )
    // deposited with no receipt: all three are flagged
    expect(await exceptions()).toEqual({ [a.id]: true, [b.id]: true, [lone.id]: true })

    await openAs(page, 'admin', '/money/gst-register')
    await page.getByRole('row', { name: new RegExp(a.number) }).getByText(co.name).click()
    const dialog = page.getByRole('dialog', { name: `Invoice ${a.number}` })
    await expect(dialog.getByText('One receipt covers every invoice with this PSID.')).toBeVisible()
    await dialog.locator('input[type=file]').setInputFiles({ name: 'group-receipt.png', mimeType: 'image/png', buffer: PNG })
    await expect(dialog.getByRole('button', { name: 'group-receipt.png', exact: true })).toBeVisible()

    // one upload, one file, two invoices dated, the other PSID untouched
    const stamped = await must(rest<InvoiceRow[]>('admin', `invoices?id=in.(${a.id},${b.id},${lone.id})&select=id,wasif_receipt_on`))
    expect(Object.fromEntries(stamped.map(r => [r.id, r.wasif_receipt_on]))).toEqual({ [a.id]: today(), [b.id]: today(), [lone.id]: null })
    expect(await must(rest<unknown[]>('admin', `attachments?invoice_id=in.(${a.id},${b.id})&select=id`))).toHaveLength(1)
    expect(await exceptions()).toEqual({ [a.id]: false, [b.id]: false, [lone.id]: true })

    // the other invoice of the group shows the same receipt, marked as shared
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await page.getByRole('row', { name: new RegExp(b.number) }).getByText(co.name).click()
    const second = page.getByRole('dialog', { name: `Invoice ${b.number}` })
    await expect(second.getByRole('button', { name: 'group-receipt.png', exact: true })).toBeVisible()
    await expect(second.getByText('same PSID')).toBeVisible()
  })
})

test.describe('payments in and receivables (M02)', () => {
  test('record payment, in full: 2 taps, the amount is the balance due and the date is today', async ({ page }) => {
    const order = await seedOrder(100000)
    await seedInvoice(order, { net_amount: 100000, gst_amount: 18000 })
    await must(rest('admin', 'payments_in', { method: 'POST', body: { order_id: order.id, amount: 50000, received_on: karachiDay(-10) }, prefer: 'return=minimal' }))
    await openAs(page, 'admin', `/orders/${order.id}`)
    await openStage(page, 'Invoice')
    await stagesOf(page).getByRole('button', { name: 'Record payment' }).first().click() // tap 1
    const dialog = page.getByRole('dialog', { name: 'Record payment' })
    await expect(dialog.getByRole('textbox', { name: 'Amount received, PKR' })).toHaveValue('68,000')
    await expect(dialog.getByText(`Balance due on ORD-${String(order.number).padStart(4, '0')}`)).toBeVisible()
    await expect(dialog.getByTestId('payment-note')).toContainText('This settles the order: PKR 68,000 of 118,000 gross, after the payment of 50,000')
    await review(page, 'm02-record-payment-1440')
    await startCounting(page)
    await dialog.getByRole('button', { name: 'Save payment' }).click() // tap 2
    await expect(page.getByRole('dialog')).toBeHidden()
    const c = await counted(page)
    expect(c.mouse).toBe(1)
    expect(c.keys).toEqual([])
    const pays = await must(rest<{ amount: number; received_on: string; paid_via: string; credited_user_id: string }[]>('admin', `payments_in?order_id=eq.${order.id}&select=*&order=created_at`))
    expect(pays.map(p => Number(p.amount))).toEqual([50000, 68000])
    expect(pays[1]).toMatchObject({ received_on: today(), paid_via: 'bank', credited_user_id: 'a0000000-0000-4000-8000-000000000001' })
    expect(await receivable(order.id)).toMatchObject({ balance: 0, payment_state: 'settled' })
  })

  test('a smaller amount is a part payment, from To collect, and says what stays due', async ({ page }) => {
    const order = await seedOrder(200000)
    await seedInvoice(order, { net_amount: 200000, gst_amount: 36000 })
    await openAs(page, 'admin', '/money/receivables')
    // Record payment lives in the picked order's panel (round 3): pick the row (its balance cell), then the panel's button
    await page.getByRole('row').filter({ hasText: `ORD-${String(order.number).padStart(4, '0')}` }).getByRole('cell').nth(1).click()
    await page.getByTestId('reminder-panel').getByRole('button', { name: 'Record payment' }).click()
    const dialog = page.getByRole('dialog', { name: 'Record payment' })
    const amount = dialog.getByRole('textbox', { name: 'Amount received, PKR' })
    await expect(amount).toHaveValue('236,000')
    await amount.fill('100,000')
    await expect(dialog.getByTestId('payment-note')).toContainText('PKR 136,000 will still be due')
    await dialog.getByRole('button', { name: 'Save payment' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    expect(await receivable(order.id)).toMatchObject({ balance: 136000, settled: 100000, payment_state: 'part' })
  })

  test('To collect shows balances by status with the figures on top, and a deep link opens Record payment', async ({ page }) => {
    const order = await seedOrder(100000)
    await seedInvoice(order, { net_amount: 100000, gst_amount: 18000, invoice_date: karachiDay(-60) })
    await openAs(page, 'admin', '/money/receivables')
    const row = page.getByRole('row', { name: new RegExp(order.company.name) })
    await expect(row).toBeVisible()
    await expect(row).toContainText('118,000')
    await expect(row.getByText(/days overdue/)).toBeVisible()
    await expect(page.getByText('Outstanding', { exact: true })).toBeVisible()
    await review(page, 'm02-receivables-1440')
    await page.getByRole('radio', { name: /Overdue/ }).click()
    await expect(row).toBeVisible()
    await page.goto(`/money/receivables?pay=1&order=${order.id}`)
    await expect(page.getByRole('dialog', { name: 'Record payment' })).toBeVisible()
  })

  test('Money home opens on four numbers and To collect leads to To collect; on a phone a card opens its reminder sheet with Record payment and Open order', async ({ page }) => {
    const order = await seedOrder(100000)
    await seedInvoice(order, { net_amount: 100000, gst_amount: 18000, invoice_date: karachiDay(-60) })
    await openAs(page, 'admin', '/money')
    await expect(page.getByTestId('money-blocks')).toBeVisible()
    await page.getByTestId('money-blocks').getByRole('link', { name: /^To collect/ }).click()
    await expect(page).toHaveURL(/\/money\/receivables$/)
    await expect(page.getByRole('heading', { name: 'To collect', level: 1 })).toBeAttached()
    await page.setViewportSize({ width: 375, height: 812 })
    const card = page.locator('tr[data-card]').filter({ hasText: order.company.name })
    await expect(card).toBeVisible()
    await startCounting(page)
    // round 3: one action per card; tapping it opens the order's reminder as a sheet, with Record payment and Open order
    await card.click() // tap 1
    const sheet = page.getByRole('dialog', { name: order.company.name })
    await expect(sheet.getByRole('link', { name: 'Open order' })).toHaveAttribute('href', `/orders/${order.id}`)
    await sheet.getByRole('button', { name: 'Record payment' }).click() // tap 2
    const dialog = page.getByRole('dialog', { name: 'Record payment' })
    await expect(dialog.getByRole('textbox', { name: 'Amount received, PKR' })).toHaveValue('118,000')
    await dialog.getByRole('button', { name: 'Save payment' }).click() // tap 3
    await expect(dialog).toBeHidden()
    expect((await counted(page)).mouse).toBe(3)
    expect(await receivable(order.id)).toMatchObject({ balance: 0, payment_state: 'settled' })
  })

  test('sales see the register and the order balances, not payment rows, and cannot record a payment', async ({ page }) => {
    const order = await seedOrder(100000)
    const inv = await seedInvoice(order, { net_amount: 100000, gst_amount: 18000 })
    await must(rest('admin', 'payments_in', { method: 'POST', body: { order_id: order.id, amount: 30000 }, prefer: 'return=minimal' }))
    const seen: string[] = []
    page.on('request', r => {
      if (/\/rest\/v1\/(payments_in|expenses|expense_categories|recurring_expenses)/.test(r.url())) seen.push(r.url())
    })
    await openAs(page, 'sales', '/money/gst-register')
    await expect(page.getByText(inv.number).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'More' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Create invoice' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Expenses/ })).toHaveCount(0)
    await review(page, 'm01-gst-register-sales-1440')
    // sales stamp too (Today sends them the TCS and FBR items): the ticks, the toggles and the FBR column stay; Net and GST go
    await expect(page.getByRole('checkbox', { name: `Select ${inv.number}` })).toBeVisible()
    await expect(page.getByRole('radio', { name: /Not sent yet/ })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: /Next step/ })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Net', exact: true })).toHaveCount(0)
    await page.getByRole('checkbox', { name: `Select ${inv.number}` }).click()
    await page.getByTestId('batch-bar').getByRole('button', { name: 'Invoice posted today' }).click()
    await expect.poll(async () => (await must(rest<InvoiceRow[]>('admin', `invoices?id=eq.${inv.id}&select=tcs_sent_on`)))[0].tcs_sent_on).toBe(today())
    await page.getByRole('link', { name: /^To collect/ }).click()
    const row = page.getByRole('row', { name: new RegExp(order.company.name) })
    await expect(row).toContainText('88,000') // the balance: 118,000 less 30,000
    await expect(page.getByRole('button', { name: /Record payment/ })).toHaveCount(0)
    await review(page, 'm02-order-balances-sales-1440')
    expect(seen, 'sales must not fetch payment rows or expense data').toEqual([])
    // Row Level Security answers the same way
    expect((await rest<unknown[]>('sales', 'payments_in?select=id')).body).toEqual([])
    expect((await rest('sales', 'payments_in', { method: 'POST', body: { order_id: order.id, amount: 1 } })).status).toBeGreaterThanOrEqual(400)
    expect((await rest<unknown[]>('sales', 'rpc/order_receivables', { method: 'POST', body: {} })).status).toBeLessThan(300)
  })

  test('the engineer gets no access to Money and the database refuses the engineer too', async ({ page }) => {
    const seen: string[] = []
    page.on('request', r => {
      if (/\/rest\/v1\/(invoices|v_gst_register|payments_in)|rpc\/(order_receivables|next_invoice_number)/.test(r.url())) seen.push(r.url())
    })
    await openAs(page, 'engineer', '/money/gst-register')
    await expect(page.getByRole('heading', { name: /Money is for admins and sales/ })).toBeVisible()
    await page.goto('/money/receivables')
    await expect(page.getByRole('heading', { name: /Money is for admins and sales/ })).toBeVisible()
    expect(seen, 'engineer must not fetch money data').toEqual([])
    expect((await rest<unknown[]>('engineer', 'v_gst_register?select=invoice_id')).body).toEqual([])
    expect((await rest('engineer', 'rpc/order_receivables', { method: 'POST', body: {} })).status).toBeGreaterThanOrEqual(400)
    expect((await rest('engineer', 'rpc/next_invoice_number', { method: 'POST', body: {} })).status).toBeGreaterThanOrEqual(400)
    expect((await rest('engineer', 'invoices', { method: 'POST', body: { number: 'X-1', company_id: undefined, net_amount: 1, gst_amount: 0 } })).status).toBeGreaterThanOrEqual(400)
  })

  test('axe at 1440: register, receivables and both dialogs', async ({ page }) => {
    const order = await seedOrder(100000)
    await seedInvoice(order, { net_amount: 100000, gst_amount: 18000 })
    await openAs(page, 'admin', '/money/gst-register')
    await expect(page.getByText(/All \d+ invoices? shown/)).toBeVisible()
    expect(await axeViolations(page)).toEqual([])
    await page.getByRole('checkbox', { name: /Select all in/ }).first().click()
    expect(await axeViolations(page)).toEqual([])
    await page.goto('/money/receivables')
    await expect(page.getByText(/open orders?$/).first()).toBeVisible()
    expect(await axeViolations(page)).toEqual([])
    await page.goto(`/money/gst-register?new=1&order=${order.id}`)
    await expect(page.getByRole('textbox', { name: 'Invoice number' })).toBeVisible()
    expect(await axeViolations(page, { landmarks: false })).toEqual([])
    await page.goto(`/money/receivables?pay=1&order=${order.id}`)
    await expect(page.getByRole('textbox', { name: 'Amount received, PKR' })).toBeVisible()
    expect(await axeViolations(page, { landmarks: false })).toEqual([])
  })

  test('axe at 375: register and receivables as cards, and both dialogs as sheets', async ({ page }) => {
    const order = await seedOrder(100000)
    await seedInvoice(order, { net_amount: 100000, gst_amount: 18000 })
    await page.setViewportSize({ width: 375, height: 812 })
    await openAs(page, 'admin', '/money/gst-register')
    await expect(page.getByRole('heading', { name: 'GST register', level: 2 })).toBeVisible()
    await page.waitForLoadState('networkidle')
    await review(page, 'm01-gst-register-375')
    expect(await axeViolations(page)).toEqual([])
    await page.goto('/money/receivables')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: 'Balances', level: 2 })).toBeVisible()
    // round 3: one row of short tabs on a phone (Reports beside the page action): none is off-screen, nothing scrolls sideways
    for (const t of await page.getByRole('navigation', { name: 'Money views' }).getByRole('link').all()) await expect(t).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
    await review(page, 'm02-receivables-375')
    expect(await axeViolations(page)).toEqual([])
    await page.goto(`/money/gst-register?new=1&order=${order.id}`)
    await expect(page.getByRole('textbox', { name: 'Invoice number' })).toBeVisible()
    expect(await axeViolations(page, { landmarks: false })).toEqual([])
    await page.goto(`/money/receivables?pay=1&order=${order.id}`)
    await expect(page.getByRole('textbox', { name: 'Amount received, PKR' })).toBeVisible()
    expect(await axeViolations(page, { landmarks: false })).toEqual([])
  })
})
