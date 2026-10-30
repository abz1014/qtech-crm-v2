import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { createCompany, karachiDay, must, openAs, rest, uniqueName } from '../support/stack'

/*
 * Money integrity (migrations 0112 to 0116), end to end against the local CI stack, through the real login form and the same REST
 * door the app uses: void and credit note (screen, register, PDF), a concurrent over-invoice refused, a filed invoice that cannot be
 * edited, the duplicate payment warning, the FX typo confirm and a payment with withholding tax. Synthetic data only.
 */
const today = () => karachiDay(0)
const unique = () => Math.random().toString(36).slice(2, 8)

interface Order {
  id: string
  number: number
  company: { id: string; name: string }
}

async function seedOrder(net = 100000): Promise<Order> {
  const company = await createCompany(uniqueName('Integrity Customer'), { invoice_address: 'Plot 1, Korangi, Karachi', sales_tax_registered: false })
  const [order] = await must(rest<{ id: string; number: number }[]>('admin', 'orders', { method: 'POST', body: { company_id: company.id, payment_terms_days: 30 } }))
  await must(rest('admin', 'order_items', { method: 'POST', body: { order_id: order.id, position: 0, description: 'Flow meter DN50', qty: 1, unit_price_net: net, gst_rate: 18 }, prefer: 'return=minimal' }))
  return { id: order.id, number: order.number, company }
}

const invoiceBody = (order: Order, over: Record<string, unknown> = {}) => ({
  order_id: order.id,
  number: `INT-${unique()}`.toUpperCase(),
  invoice_date: today(),
  net_amount: 100000,
  gst_amount: 18000,
  ...over,
})

const makeInvoice = (order: Order, over: Record<string, unknown> = {}) =>
  must(rest<{ id: string; number: string }[]>('admin', 'invoices', { method: 'POST', body: invoiceBody(order, over) })).then(r => r[0])

test.describe.configure({ mode: 'serial' })

test.describe('void and credit notes (C1)', () => {
  test('void from the invoice screen: the number stays in the register at 0 and the order is open again', async ({ page }) => {
    const order = await seedOrder()
    const inv = await makeInvoice(order)
    await openAs(page, 'admin', `/money/gst-register?invoice=${inv.id}`)
    await page.getByRole('button', { name: 'Void invoice' }).click()
    const dialog = page.getByRole('dialog').last()
    await expect(dialog.getByRole('button', { name: 'Void invoice' })).toBeDisabled()
    await dialog.getByLabel('Reason for voiding').fill('Wrong customer')
    await dialog.getByRole('button', { name: 'Void invoice' }).click()
    await expect(page.getByText(`Voided invoice ${inv.number}`)).toBeVisible()

    const row = await must(rest<{ net_amount: number; gst_amount: number; voided_at: string | null; voided_net: number; void_reason: string }[]>('admin', `invoices?id=eq.${inv.id}&select=*`))
    expect(row[0]).toMatchObject({ net_amount: 0, gst_amount: 0, voided_net: 100000, void_reason: 'Wrong customer' })
    expect(row[0].voided_at).not.toBeNull()
    const rec = await must(rest<{ balance: number }[]>('admin', 'rpc/order_receivables', { method: 'POST', body: { p_order_id: order.id } }))
    expect(Number(rec[0].balance)).toBe(118000)

    await page.goto('/money/gst-register')
    await expect(page.getByRole('row', { name: new RegExp(inv.number) })).toContainText('Void')
  })

  test('a filed invoice cannot be voided: the dialog points to a credit note', async ({ page }) => {
    const order = await seedOrder()
    const inv = await makeInvoice(order, { psid: `PSID-${unique()}` })
    await openAs(page, 'admin', `/money/gst-register?invoice=${inv.id}`)
    await expect(page.getByTestId('invoice-filed-line')).toContainText('issue a credit note')
    await page.getByRole('button', { name: 'Void invoice' }).click()
    const dialog = page.getByRole('dialog').last()
    await expect(dialog.getByTestId('void-blocked')).toContainText('Issue a credit note instead')
    await expect(dialog.getByRole('button', { name: 'Create credit note' })).toBeVisible()
    const r = await rest('admin', 'rpc/void_invoice', { method: 'POST', body: { p_invoice_id: inv.id, p_reason: 'try' } })
    expect(r.status).toBe(400)
    expect(JSON.stringify(r.body)).toContain('credit note')
  })

  test('credit note: issued from the invoice, in the register as a negative line, with a PDF', async ({ page }) => {
    const order = await seedOrder()
    const inv = await makeInvoice(order, { psid: `PSID-${unique()}` })
    await openAs(page, 'admin', `/money/gst-register?invoice=${inv.id}`)
    await page.getByRole('button', { name: 'Create credit note' }).click()
    const dialog = page.getByRole('dialog').last()
    await dialog.getByLabel('Amount to credit').fill('40000')
    await expect(dialog.getByTestId('credit-note-gst')).toContainText('7,200')
    await dialog.getByLabel('Reason for the credit note').fill('Part returned')
    await dialog.getByRole('button', { name: 'Issue credit note' }).click()
    await expect(page.getByText(/Credit note CN-\d{4} issued/)).toBeVisible()

    const notes = await must(rest<{ id: string; number: string; net_amount: number; gst_amount: number }[]>('admin', `credit_notes?invoice_id=eq.${inv.id}&select=*`))
    expect(notes).toHaveLength(1)
    expect(Number(notes[0].gst_amount)).toBe(7200)
    const rec = await must(rest<{ balance: number }[]>('admin', 'rpc/order_receivables', { method: 'POST', body: { p_order_id: order.id } }))
    expect(Number(rec[0].balance)).toBe(118000 - 47200)

    // the GST register lists it as a negative line
    const reg = await must(rest<{ row_kind: string; net_amount: number; gst_amount: number; number: string }[]>('admin', `v_gst_register?number=eq.${notes[0].number}&select=*`))
    expect(reg[0]).toMatchObject({ row_kind: 'credit_note', net_amount: -40000, gst_amount: -7200 })
    await page.goto('/money/gst-register')
    await expect(page.getByRole('row', { name: new RegExp(notes[0].number) })).toContainText('Credit note')

    // its PDF
    await page.getByRole('row', { name: new RegExp(inv.number) }).first().click()
    // no pop-up in the test browser: the app then downloads the file instead (CreditNotePdfButton)
    await page.evaluate(() => {
      window.open = () => null
    })
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 45_000 }), page.getByRole('button', { name: 'Print credit note' }).click()])
    expect(download.suggestedFilename()).toBe(`${notes[0].number}.pdf`)
    const bytes = readFileSync((await download.path()) as string)
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(bytes.length).toBeGreaterThan(2000)
  })

  test('the totals agree after a void and a credit note: receivables, the GST month and the register', async () => {
    const order = await seedOrder()
    const a = await makeInvoice(order, { net_amount: 40000, gst_amount: 7200 })
    await makeInvoice(order, { net_amount: 60000, gst_amount: 10800 })
    await must(rest('admin', 'rpc/void_invoice', { method: 'POST', body: { p_invoice_id: a.id, p_reason: 'Duplicate' } }))
    const cn = await must(rest<{ credit_note_id: string }[]>('admin', 'rpc/create_credit_note', { method: 'POST', body: { p_invoice_id: (await must(rest<{ id: string }[]>('admin', `invoices?order_id=eq.${order.id}&voided_at=is.null&select=id`)))[0].id, p_net: 10000, p_reason: 'Discount' } }))
    expect(cn).toHaveLength(1)
    const rec = await must(rest<{ gross_target: number }[]>('admin', 'rpc/order_receivables', { method: 'POST', body: { p_order_id: order.id } }))
    const money = await must(rest<{ gross_target: number; net_sale: number }[]>('admin', `v_order_money?order_id=eq.${order.id}&select=gross_target,net_sale`))
    expect(Number(rec[0].gross_target)).toBe(70800 - 11800)
    expect(Number(money[0].gross_target)).toBe(Number(rec[0].gross_target))
    expect(Number(money[0].net_sale)).toBe(50000)
  })
})

test.describe('invoice rules in the database (H1, H2, H3)', () => {
  test('two people invoicing the same order at once: only one gets through', async () => {
    const order = await seedOrder()
    const [x, y] = await Promise.all([
      rest('admin', 'invoices', { method: 'POST', body: invoiceBody(order) }),
      rest('sales', 'invoices', { method: 'POST', body: invoiceBody(order) }),
    ])
    expect([x.status, y.status].sort()).toEqual([201, 400])
    const refused = x.status === 400 ? x : y
    expect(JSON.stringify(refused.body)).toContain('left to invoice')
    const rows = await must(rest<unknown[]>('admin', `invoices?order_id=eq.${order.id}&select=id`))
    expect(rows).toHaveLength(1)
  })

  test('a wrong GST and an invoice number in other capitals are refused', async () => {
    const order = await seedOrder()
    const bad = await rest('admin', 'invoices', { method: 'POST', body: invoiceBody(order, { gst_amount: 5 }) })
    expect(bad.status).toBe(400)
    expect(JSON.stringify(bad.body)).toContain('does not match')
    const inv = await makeInvoice(order, { net_amount: 50000, gst_amount: 9000 })
    const dup = await rest('admin', 'invoices', { method: 'POST', body: invoiceBody(order, { number: inv.number.toLowerCase(), net_amount: 50000, gst_amount: 9000 }) })
    expect(dup.status).toBe(409)
  })

  test('a filed invoice (PSID or tax deposit) cannot have its number, date or amounts edited', async () => {
    const order = await seedOrder()
    const inv = await makeInvoice(order, { psid: `PSID-${unique()}` })
    const r = await rest('admin', `invoices?id=eq.${inv.id}`, { method: 'PATCH', body: { net_amount: 90000, gst_amount: 16200 } })
    expect(r.status).toBe(400)
    expect(JSON.stringify(r.body)).toContain('Issue a credit note')
    const ok = await rest('admin', `invoices?id=eq.${inv.id}`, { method: 'PATCH', body: { notes: 'still editable' } })
    expect(ok.status).toBe(200)
  })

  test('someone else changed the invoice first: the save says so and writes nothing (M1)', async ({ page }) => {
    const order = await seedOrder()
    const inv = await makeInvoice(order)
    await openAs(page, 'admin', `/money/gst-register?invoice=${inv.id}`)
    await expect(page.getByLabel('Notes')).toBeVisible()
    await must(rest('sales', `invoices?id=eq.${inv.id}`, { method: 'PATCH', body: { notes: 'sales note' } }))
    await page.getByLabel('Notes').fill('admin note')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText(/Someone else changed this invoice/)).toBeVisible()
    const row = await must(rest<{ notes: string }[]>('admin', `invoices?id=eq.${inv.id}&select=notes`))
    expect(row[0].notes).toBe('sales note')
  })
})

test.describe('typing slips (M4, M7) and withholding tax', () => {
  test('a payment that looks recorded already warns, and records only when confirmed', async ({ page }) => {
    const order = await seedOrder()
    await makeInvoice(order)
    const pay = (id: string, confirm: boolean) =>
      rest('admin', 'rpc/record_payment', { method: 'POST', body: { p_id: id, p_order_id: order.id, p_received_on: today(), p_amount: 5000, p_reference: null, p_paid_via: 'bank', p_confirm_duplicate: confirm } })
    expect((await pay(crypto.randomUUID(), false)).status).toBeLessThan(300)
    await openAs(page, 'admin', `/money/receivables?pay=1&order=${order.id}`)
    const dialog = page.getByRole('dialog').last()
    await dialog.getByLabel(/Amount received/).fill('5000')
    await dialog.getByRole('button', { name: 'Save payment' }).click()
    await expect(page.getByTestId('duplicate-payment')).toContainText('Looks like a payment already recorded on')
    await dialog.getByRole('checkbox', { name: 'Record it anyway' }).check()
    await dialog.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByText('Recorded payment')).toBeVisible()
    const rows = await must(rest<unknown[]>('admin', `payments_in?order_id=eq.${order.id}&select=id`))
    expect(rows).toHaveLength(2)
  })

  test('an exchange rate far from the latest needs a confirm', async () => {
    const code = 'XQ' + 'ABCDEFGHJKLMNPRSTUVWXYZ'[Math.floor(Math.random() * 23)]
    await must(rest('admin', 'fx_rates', { method: 'POST', body: { currency: code, rate_pkr: 280, as_of: karachiDay(-1), source: 'auto' }, prefer: 'return=minimal' }))
    const far = await rest('admin', 'rpc/set_fx_rate', { method: 'POST', body: { p_currency: code, p_rate_pkr: 28 } })
    expect(far.status).toBe(400)
    expect(JSON.stringify(far.body)).toContain('20 percent')
    const ok = await rest('admin', 'rpc/set_fx_rate', { method: 'POST', body: { p_currency: code, p_rate_pkr: 28, p_confirm: true } })
    expect(ok.status).toBeLessThan(300)
  })

  test('withholding tax settles the invoice with the cash, is not cash in, and is listed with a missing-certificate flag', async ({ page }) => {
    const order = await seedOrder()
    await makeInvoice(order)
    await must(rest('admin', 'rpc/record_payment', { method: 'POST', body: { p_id: crypto.randomUUID(), p_order_id: order.id, p_received_on: today(), p_amount: 108000, p_reference: null, p_paid_via: 'bank', p_wht_amount: 10000 } }))
    const rec = await must(rest<{ balance: number; payment_state: string }[]>('admin', 'rpc/order_receivables', { method: 'POST', body: { p_order_id: order.id } }))
    expect(Number(rec[0].balance)).toBe(0)
    expect(rec[0].payment_state).toBe('settled')
    const cash = await must(rest<{ amount: number }[]>('admin', `v_payment_net?order_id=eq.${order.id}&select=amount`))
    expect(Number(cash[0].amount)).toBe(108000)
    await openAs(page, 'admin', '/money/accounts/gst')
    const panel = page.getByTestId('wht-deducted')
    await expect(panel).toContainText(order.company.name)
    await expect(panel.getByTestId('wht-missing')).toBeVisible()
    const eng = await rest<unknown[]>('engineer', 'v_wht_deducted?select=*')
    expect(eng.body ?? []).toHaveLength(0)
  })
})
