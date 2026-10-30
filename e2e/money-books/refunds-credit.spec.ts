import { expect, test } from '@playwright/test'
import { createCompany, karachiDay, must, openAs, rest, uniqueName } from '../support/stack'

/*
 * Customer refunds and credit (migrations 0117 to 0119), end to end against the local CI stack, through the real login form and the same
 * REST door the app uses: an overpayment becomes a credit balance on the company page, Refund pays part of it back (cash out), Apply
 * puts the rest against another order of the same customer (no cash moves), a WHT certificate file clears the missing flag, and sales
 * cannot clear a PSID. Synthetic data only.
 */
const today = () => karachiDay(0)
const unique = () => Math.random().toString(36).slice(2, 8)

interface Order {
  id: string
  number: number
}

async function seedOrder(companyId: string, net: number): Promise<Order> {
  const [order] = await must(rest<{ id: string; number: number }[]>('admin', 'orders', { method: 'POST', body: { company_id: companyId, payment_terms_days: 30 } }))
  await must(rest('admin', 'order_items', { method: 'POST', body: { order_id: order.id, position: 0, description: 'Flow meter DN50', qty: 1, unit_price_net: net, gst_rate: 18 }, prefer: 'return=minimal' }))
  await must(rest('admin', 'invoices', { method: 'POST', body: { order_id: order.id, number: `RC-${unique()}`.toUpperCase(), invoice_date: today(), net_amount: net, gst_amount: Math.round(net * 0.18) }, prefer: 'return=minimal' }))
  return order
}

const pay = (orderId: string, amount: number, over: Record<string, unknown> = {}) =>
  must(rest('admin', 'rpc/record_payment', { method: 'POST', body: { p_id: crypto.randomUUID(), p_order_id: orderId, p_received_on: today(), p_amount: amount, p_reference: null, p_paid_via: 'bank', ...over } }))

test.describe.configure({ mode: 'serial' })

test.describe('customer refunds and credit', () => {
  test('an overpayment is a credit balance: refund part of it, apply the rest to another order, no cash moves for the apply', async ({ page }) => {
    const company = await createCompany(uniqueName('Credit Customer'), { invoice_address: 'Plot 1, Korangi, Karachi', sales_tax_registered: false })
    const a = await seedOrder(company.id, 100000) // gross 118,000
    const b = await seedOrder(company.id, 20000) // gross 23,600
    await pay(a.id, 150000) // overpaid by 32,000

    await openAs(page, 'admin', `/companies/${company.id}`)
    const panel = page.getByRole('region', { name: 'Credit balance' })
    await expect(panel.getByTestId('credit-balance')).toContainText('32,000')

    // Refund 10,000 (short form: amount and date, nothing else typed)
    await panel.getByRole('button', { name: 'Refund' }).click()
    const refund = page.getByRole('dialog').last()
    await expect(refund.getByLabel(/Amount refunded/)).toHaveValue('32,000')
    await refund.getByLabel(/Amount refunded/).fill('10000')
    await refund.getByRole('button', { name: 'Save refund' }).click()
    await expect(page.getByText('Recorded refund')).toBeVisible()
    await expect(panel.getByTestId('credit-balance')).toContainText('22,000')

    const refunds = await must(rest<{ amount: number; paid_via: string; company_id: string }[]>('admin', `customer_refunds?company_id=eq.${company.id}&select=*`))
    expect(refunds).toHaveLength(1)
    expect(Number(refunds[0].amount)).toBe(10000)
    expect(refunds[0].paid_via).toBe('bank')
    const month = `${today().slice(0, 7)}-01`
    const cash = await must(rest<{ refunds_out: number }[]>('admin', `v_cash_month?month=eq.${month}&select=refunds_out`))
    expect(Number(cash[0].refunds_out)).toBeGreaterThanOrEqual(10000)

    // the same refund again is a duplicate until confirmed
    await panel.getByRole('button', { name: 'Refund' }).click()
    const again = page.getByRole('dialog').last()
    await again.getByLabel(/Amount refunded/).fill('10000')
    await again.getByRole('button', { name: 'Save refund' }).click()
    await expect(again.getByTestId('duplicate-refund')).toContainText('Looks like a refund already recorded')
    await again.getByRole('button', { name: 'Cancel' }).click()

    // Apply the remaining 22,000 to order B (owes 23,600)
    const before = await must(rest<{ balance: number; settled: number }[]>('admin', 'rpc/order_receivables', { method: 'POST', body: { p_order_id: b.id } }))
    expect(Number(before[0].balance)).toBe(23600)
    const paymentsBefore = await must(rest<unknown[]>('admin', `payments_in?order_id=eq.${b.id}&select=id`))
    await panel.getByRole('button', { name: /Apply to an order/ }).click()
    const apply = page.getByRole('dialog').last()
    await apply.getByLabel(/Put it against/).selectOption(b.id)
    await expect(apply.getByLabel(/Amount to apply/)).toHaveValue('22,000')
    await apply.getByRole('button', { name: 'Apply credit' }).click()
    await expect(page.getByText('Applied credit')).toBeVisible()

    const after = await must(rest<{ balance: number; settled: number; payment_state: string }[]>('admin', 'rpc/order_receivables', { method: 'POST', body: { p_order_id: b.id } }))
    expect(Number(after[0].balance)).toBe(1600)
    expect(Number(after[0].settled)).toBe(22000)
    expect(after[0].payment_state).toBe('part')
    expect(await must(rest<unknown[]>('admin', `payments_in?order_id=eq.${b.id}&select=id`))).toHaveLength(paymentsBefore.length)
    const money = await must(rest<{ receivable: number; settled: number }[]>('admin', `v_order_money?order_id=eq.${b.id}&select=receivable,settled`))
    expect(Number(money[0].receivable)).toBe(1600)
    expect(Number(money[0].settled)).toBe(22000)
    const credit = await must(rest<{ balance: number; refunded: number; applied: number }[]>('admin', `v_company_credit?company_id=eq.${company.id}&select=*`))
    expect(credit[0]).toMatchObject({ balance: 0, refunded: 10000, applied: 22000 })
    await expect(panel.getByRole('button', { name: 'Refund' })).toHaveCount(0)

    // nobody but the admin sees or writes any of it
    expect(await must(rest<unknown[]>('sales', `customer_refunds?company_id=eq.${company.id}&select=id`))).toHaveLength(0)
    expect(await must(rest<unknown[]>('engineer', `credit_applications?select=id`))).toHaveLength(0)
    const direct = await rest('admin', 'customer_refunds', { method: 'POST', body: { company_id: company.id, amount: 5 } })
    expect(direct.status).toBeGreaterThanOrEqual(400)
    const asSales = await rest('sales', 'rpc/record_refund', { method: 'POST', body: { p_id: crypto.randomUUID(), p_company_id: company.id, p_refunded_on: today(), p_amount: 1 } })
    expect(asSales.status).toBeGreaterThanOrEqual(400)
  })

  test('a refund above the credit is refused by the database', async () => {
    const company = await createCompany(uniqueName('Credit Customer'), { sales_tax_registered: false })
    const o = await seedOrder(company.id, 10000)
    await pay(o.id, 11800 + 500)
    const r = await rest('admin', 'rpc/record_refund', { method: 'POST', body: { p_id: crypto.randomUUID(), p_company_id: company.id, p_refunded_on: today(), p_amount: 501 } })
    expect(r.status).toBe(400)
    expect(JSON.stringify(r.body)).toContain('more than they are owed')
    const ok = await rest('admin', 'rpc/record_refund', { method: 'POST', body: { p_id: crypto.randomUUID(), p_company_id: company.id, p_refunded_on: today(), p_amount: 500, p_paid_via: 'cash' } })
    expect(ok.status).toBeLessThan(300)
  })
})

test.describe('WHT certificate file and clearing a filing', () => {
  test('a certificate file clears the missing flag and opens from the list', async ({ page }) => {
    const company = await createCompany(uniqueName('Wht Customer'), { sales_tax_registered: false })
    const o = await seedOrder(company.id, 100000)
    await pay(o.id, 108000, { p_wht_amount: 10000 })
    await openAs(page, 'admin', '/money/accounts/gst')
    const panel = page.getByTestId('wht-deducted')
    const row = panel.getByRole('listitem').filter({ hasText: company.name })
    await expect(row).toContainText('No certificate yet')
    await row.getByRole('button', { name: /Add the certificate of/ }).click()
    await row.getByLabel('Certificate file').setInputFiles({ name: 'cert.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 synthetic certificate') })
    await row.getByRole('button', { name: 'Save' }).click()
    await expect(row.getByRole('button', { name: /Open the certificate file of/ })).toContainText('cert.pdf')
    await expect(row).not.toContainText('No certificate yet')

    const list = await must(rest<{ certificate_missing: boolean; certificate_path: string | null; certificate_name: string | null }[]>('admin', `v_wht_deducted?company_id=eq.${company.id}&select=*`))
    expect(list[0].certificate_missing).toBe(false)
    expect(list[0].certificate_name).toBe('cert.pdf')
    expect(list[0].certificate_path).toMatch(/^wht\/[0-9a-f-]+\/[0-9a-f-]+\.pdf$/)
    expect(await must(rest<unknown[]>('sales', `v_wht_deducted?select=*`))).toHaveLength(0)
  })

  test('sales cannot clear a PSID or a deposit date; the admin can, and it is audited', async () => {
    const company = await createCompany(uniqueName('Filed Customer'), { sales_tax_registered: false })
    const o = await seedOrder(company.id, 50000)
    const [inv] = await must(rest<{ id: string }[]>('admin', `invoices?order_id=eq.${o.id}&select=id`))
    const psid = `PSID-${unique()}`
    await must(rest('admin', `invoices?id=eq.${inv.id}`, { method: 'PATCH', body: { psid, tax_deposited_on: today() }, prefer: 'return=minimal' }))

    const clearPsid = await rest('sales', `invoices?id=eq.${inv.id}`, { method: 'PATCH', body: { psid: null } })
    expect(clearPsid.status).toBeGreaterThanOrEqual(400)
    expect(JSON.stringify(clearPsid.body)).toContain('Only an admin can clear')
    const clearDate = await rest('sales', `invoices?id=eq.${inv.id}`, { method: 'PATCH', body: { tax_deposited_on: null } })
    expect(clearDate.status).toBeGreaterThanOrEqual(400)
    const still = await must(rest<{ psid: string; tax_deposited_on: string }[]>('admin', `invoices?id=eq.${inv.id}&select=psid,tax_deposited_on`))
    expect(still[0]).toMatchObject({ psid, tax_deposited_on: today() })

    await must(rest('admin', `invoices?id=eq.${inv.id}`, { method: 'PATCH', body: { psid: null }, prefer: 'return=minimal' }))
    const audit = await must(rest<{ old_value: { psid?: string }; new_value: { psid?: string | null } }[]>('admin', `audit_log?table_name=eq.invoices&record_id=eq.${inv.id}&action=eq.update&select=old_value,new_value&order=changed_at.desc&limit=1`))
    expect(audit[0].old_value.psid).toBe(psid)
    expect(audit[0].new_value.psid ?? null).toBeNull()
  })
})
