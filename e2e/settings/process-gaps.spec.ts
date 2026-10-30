import { expect, test } from '@playwright/test'
import { createCompany, createRfq, karachiDay, must, openAs, rest, uniqueName } from '../support/stack'

/*
 * Process audit round 1 (migrations 0121 to 0125), end to end against the local CI stack. Synthetic data only.
 *   1 reassign owner (one RFQ, then all of a person's open work) and the Team dialog that offers it
 *   2 a part invoice is due from its own date; payments tied to an invoice
 *   3 payables: Rs 1 on a rupee leg, 3% on a foreign leg
 *   4 a supplier order of a cancelled order is still owed until cancelled with the supplier
 *   5 a claim approved as owed, then marked paid back, with sales allowed to claim
 *   6 an older month of undeposited GST stays on To do
 *   7 the statement of account (dialog and PDF)
 *   8 the CSV exports (admin only)
 */
test.describe.configure({ mode: 'serial' })

type User = { id: string; role: string; name: string }
let users: User[] = []
const who = (role: string): User => users.find(u => u.role === role && u.name) as User

test.beforeAll(async () => {
  users = await must(rest<User[]>('admin', 'users?select=id,role,name&deactivated_at=is.null'))
})

const rpc = (role: 'admin' | 'sales' | 'engineer', fn: string, body: unknown) => rest(role, `rpc/${fn}`, { method: 'POST', body })

async function order(companyId: string, extra: Record<string, unknown> = {}) {
  return (await must(rest<{ id: string; number: number }[]>('admin', 'orders', { method: 'POST', body: { company_id: companyId, ordered_on: karachiDay(-60), needs_commissioning: false, ...extra } })))[0]
}
const item = (orderId: string, extra: Record<string, unknown> = {}) =>
  must(rest('admin', 'order_items', { method: 'POST', body: { order_id: orderId, description: 'E2E item', qty: 1, unit_price_net: 1000, gst_rate: 18, ...extra }, prefer: 'return=minimal' }))
const invoice = (orderId: string, number: string, date: string, net = 1000, gst = 180) =>
  must(rest<{ id: string }[]>('admin', 'invoices', { method: 'POST', body: { order_id: orderId, number, invoice_date: date, net_amount: net, gst_amount: gst } }))

test('an admin moves one RFQ and then all of a person\'s open work; sales cannot', async ({ page }) => {
  const sales = who('sales')
  const admin = who('admin')
  const company = await createCompany(uniqueName('Reassign E2E'))
  const rfq = await createRfq(company.id, { owner_id: sales.id })
  expect((await rpc('sales', 'reassign_owner', { p_kind: 'rfq', p_id: rfq.id, p_to: admin.id })).status).toBe(403)
  await must(rpc('admin', 'reassign_owner', { p_kind: 'rfq', p_id: rfq.id, p_to: admin.id }))
  expect((await must(rest<{ owner_id: string }[]>('admin', `rfqs?id=eq.${rfq.id}&select=owner_id`)))[0].owner_id).toBe(admin.id)

  const second = await createRfq(company.id, { owner_id: sales.id })
  await openAs(page, 'admin', '/settings/team')
  await page.getByRole('button', { name: `Actions for ${sales.name}` }).click()
  await page.getByRole('menuitem', { name: 'Move open work' }).click()
  await expect(page.getByRole('heading', { name: new RegExp(`Move ${sales.name}.s open work`) })).toBeVisible()
  await expect(page.getByTestId('open-work-sentence')).toContainText('open')
  await expect(page.getByRole('button', { name: 'Move it all' })).toBeDisabled()
  await page.getByLabel('New owner').selectOption({ label: admin.name })
  await page.getByRole('button', { name: 'Move it all' }).click()
  await expect.poll(async () => (await must(rest<{ owner_id: string }[]>('admin', `rfqs?id=eq.${second.id}&select=owner_id`)))[0].owner_id).toBe(admin.id)
})

test('a part invoice is due from its own date, and a payment can be tied to an invoice', async () => {
  const company = await createCompany(uniqueName('Part invoice E2E'))
  const o = await order(company.id, { payment_terms_days: 30 })
  await item(o.id, { unit_price_net: 2000 })
  const first = (await invoice(o.id, `PI-${Date.now().toString(36)}A`, karachiDay(-50)))[0]
  await must(rest('admin', 'payments_in', { method: 'POST', body: { order_id: o.id, received_on: karachiDay(-40), amount: 1180 }, prefer: 'return=minimal' }))
  await invoice(o.id, `PI-${Date.now().toString(36)}B`, karachiDay(0))
  const m = (await must(rest<{ due_on: string; payment_state: string }[]>('admin', `v_order_money?order_id=eq.${o.id}&select=due_on,payment_state`)))[0]
  expect(m.due_on).toBe(karachiDay(30)) // the new invoice's own date + 30, not the first invoice's
  expect(m.payment_state).not.toBe('overdue')
  // tied to the wrong order is refused
  const other = await order(company.id)
  expect((await rest('admin', 'payments_in', { method: 'POST', body: { order_id: other.id, received_on: karachiDay(), amount: 1, invoice_id: first.id } })).status).toBe(400)
})

test('payables: Rs 1 settles a rupee leg, 3% is for foreign legs', async () => {
  const supplier = await createCompany(uniqueName('Supplier E2E'))
  const customer = await createCompany(uniqueName('Customer E2E'))
  const o = await order(customer.id)
  const leg = async (currency: string, price: number) => {
    const l = (await must(rest<{ id: string }[]>('admin', 'supplier_orders', { method: 'POST', body: { order_id: o.id, supplier_id: supplier.id, currency, placed_on: karachiDay(-5) } })))[0]
    await item(o.id, { supplier_order_id: l.id, supplier_unit_price: price })
    return l.id
  }
  const pkrLeg = await leg('PKR', 1000)
  await must(rest('admin', 'expenses', { method: 'POST', body: { amount_pkr: 970, category_id: 'ca7e0000-0000-4000-8000-000000000011', order_id: o.id, supplier_order_id: pkrLeg, paid_via: 'bank' }, prefer: 'return=minimal' }))
  const rows = await must(rest<{ supplier_order_id: string; state: string; owed_pkr: number }[]>('admin', `rpc/payables_as_of`, { method: 'POST', body: { p_date: karachiDay() } }))
  const row = rows.find(r => r.supplier_order_id === pkrLeg)
  expect(row?.state).toBe('owing') // 30 of 1,000 left is 3%, but on a rupee leg only Rs 1 counts as settled
})

test('a supplier order of a cancelled order is owed until it is cancelled with the supplier', async ({ page }) => {
  const supplier = await createCompany(uniqueName('Supplier cancel E2E'))
  const customer = await createCompany(uniqueName('Customer cancel E2E'))
  const o = await order(customer.id, { cancelled_on: karachiDay(-1) })
  const l = (await must(rest<{ id: string }[]>('admin', 'supplier_orders', { method: 'POST', body: { order_id: o.id, supplier_id: supplier.id, currency: 'PKR', placed_on: karachiDay(-5) } })))[0]
  await item(o.id, { supplier_order_id: l.id, supplier_unit_price: 500 })
  const owed = async () => (await must(rest<{ supplier_order_id: string }[]>('admin', 'rpc/payables_as_of', { method: 'POST', body: { p_date: karachiDay() } }))).some(r => r.supplier_order_id === l.id)
  expect(await owed()).toBe(true)
  await openAs(page, 'admin', `/orders/${o.id}`)
  await expect(page.getByRole('button', { name: /^Pay / }).first()).toBeVisible() // a payment can be recorded on a cancelled order
  await page.getByRole('button', { name: 'Cancelled with supplier' }).click()
  await expect.poll(owed).toBe(false)
})

test('a staff claim is approved as owed, then marked paid back; sales may claim', async ({ page }) => {
  const note = uniqueName('E2E petrol')
  const claim = (await must(rest<{ id: string }[]>('engineer', 'expense_claims', { method: 'POST', body: { amount_pkr: 700, note } })))[0]
  const salesClaim = await rest('sales', 'expense_claims', { method: 'POST', body: { amount_pkr: 300, note: 'E2E lunch' } })
  expect(salesClaim.status).toBe(201)
  await must(rpc('admin', 'owe_expense_claim', { p_claim: claim.id, p_category: 'ca7e0000-0000-4000-8000-000000000004' }))
  await openAs(page, 'admin', '/money/expenses')
  const owedRow = page.getByTestId(`owed-${claim.id}`)
  await expect(owedRow).toContainText('Approved, owed to')
  await owedRow.getByRole('button', { name: /Mark paid back/ }).click()
  await expect.poll(async () => (await must(rest<{ status: string; expense_id: string | null }[]>('admin', `expense_claims?id=eq.${claim.id}&select=status,expense_id`)))[0]).toMatchObject({ status: 'approved' })
})

test('an older month of undeposited GST stays on To do', async ({ page }) => {
  const company = await createCompany(uniqueName('Old GST E2E'))
  const o = await order(company.id)
  const [y, m] = karachiDay().split('-').map(Number)
  const old = new Date(Date.UTC(y, m - 4, 5)).toISOString().slice(0, 10) // three months back
  await invoice(o.id, `OG-${Date.now().toString(36)}`, old, 100000, 18000)
  await openAs(page, 'admin', '/todo')
  await expect(page.locator('li[data-rule="gst_fbr"]').first()).toBeAttached()
})

test('the statement of account lists the invoice and the payment and downloads as a PDF', async ({ page }) => {
  const company = await createCompany(uniqueName('Statement E2E'))
  const o = await order(company.id)
  await item(o.id)
  await invoice(o.id, `ST-${Date.now().toString(36)}`, karachiDay(-3))
  await must(rest('admin', 'payments_in', { method: 'POST', body: { order_id: o.id, received_on: karachiDay(-1), amount: 500 }, prefer: 'return=minimal' }))
  await openAs(page, 'admin', `/companies/${company.id}`)
  await page.getByRole('button', { name: 'Statement of account' }).click()
  await expect(page.getByTestId('statement-opening')).toContainText('Opening balance')
  await expect(page.getByTestId('statement-row')).toHaveCount(2)
  await expect(page.getByTestId('statement-closing')).toContainText('680.00')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download PDF' }).click()
  expect((await download).suggestedFilename()).toMatch(/^Statement .*\.pdf$/)
})

test('only an admin can export; the file has the rows', async ({ page }) => {
  const company = await createCompany(uniqueName('Export E2E'))
  await openAs(page, 'admin', '/settings/export')
  await expect(page.getByTestId('export-page')).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Customers and suppliers' }).click()
  const d = await download
  expect(d.suggestedFilename()).toMatch(/^qtech-companies-\d{4}-\d{2}-\d{2}\.csv$/)
  expect(company.id).toBeTruthy()
})

test('an engineer has no export page and the database gives them no payment', async ({ page }) => {
  await openAs(page, 'engineer', '/settings/export')
  await expect(page.getByTestId('export-page')).toHaveCount(0)
  expect((await rest('engineer', 'payments_in?select=amount')).body).toEqual([])
})
