import { expect, test } from '@playwright/test'
import { createCompany, karachiDay, must, openAs, rest, review, uniqueName } from '../support/stack'
import { axeViolations } from '../support/axe'

/*
 * Forest lane A4 (Money hub; 50-money-hub, 51-to-collect, 52-payments): the Money home hero, the new Payments list (owner gate 2,
 * 13 Nov 2026: one read of payments_in, every paid via, voided ones left out, one month at a time, admin only) and Record payment
 * with no order, which asks "Which order?" first (F-287, F-642). Against the local CI stack, through the real login form.
 */
const today = () => karachiDay(0)
const ref = (n: number) => `ORD-${String(n).padStart(4, '0')}`

async function seedOrder(net: number): Promise<{ id: string; number: number; company: { id: string; name: string } }> {
  const company = await createCompany(uniqueName('Payments Customer'))
  const [order] = await must(rest<{ id: string; number: number }[]>('admin', 'orders', { method: 'POST', body: { company_id: company.id, payment_terms_days: 30 } }))
  await must(
    rest('admin', 'order_items', { method: 'POST', body: { order_id: order.id, position: 0, description: 'Pressure gauge', qty: 1, unit_price_net: net, gst_rate: 18 }, prefer: 'return=minimal' }),
  )
  return { id: order.id, number: order.number, company }
}

const pay = (orderId: string, amount: number, paidVia: 'bank' | 'cash', reference: string | null = null) => {
  const id = crypto.randomUUID()
  return must(rest('admin', 'rpc/record_payment', { method: 'POST', body: { p_id: id, p_order_id: orderId, p_received_on: today(), p_amount: amount, p_reference: reference, p_paid_via: paidVia } })).then(() => id)
}

test('Payments lists this month\'s payments, bank and cash, without the voided one; the previous month is its own page', async ({ page }) => {
  const order = await seedOrder(200000)
  await pay(order.id, 50000, 'bank', `TT-${order.number}`)
  await pay(order.id, 7000, 'cash')
  const voided = await pay(order.id, 1234, 'bank')
  await must(rest('admin', 'rpc/void_payment', { method: 'POST', body: { p_payment_id: voided, p_reason: 'Typed twice' } }))

  await openAs(page, 'admin', '/money')
  await page.getByRole('navigation', { name: 'Money views' }).getByRole('link', { name: 'Payments' }).click()
  await expect(page).toHaveURL(/\/money\/payments$/)
  await expect(page.getByRole('heading', { name: 'Payments', level: 1 })).toBeAttached()
  await expect(page.getByRole('navigation', { name: 'Money views' }).getByRole('link', { name: 'Payments' })).toHaveAttribute('aria-current', 'page')

  const rows = page.getByRole('row').filter({ hasText: order.company.name })
  await expect(rows).toHaveCount(2)
  await expect(rows.filter({ hasText: '50,000' })).toContainText('Bank')
  await expect(rows.filter({ hasText: '50,000' })).toContainText(`TT-${order.number}`)
  await expect(rows.filter({ hasText: '7,000' })).toContainText('Cash')
  await expect(page.getByRole('row').filter({ hasText: '1,234' })).toHaveCount(0)
  await expect(rows.first().getByRole('link', { name: `Open ${ref(order.number)}` })).toHaveAttribute('href', `/orders/${order.id}`)
  await expect(page.getByTestId('payments-count')).toContainText('Voided payments are not listed.')
  expect(await axeViolations(page)).toEqual([])
  await review(page, 'a4-payments-1440')

  // the month rides in the address; a month with nothing says so
  await page.getByRole('button', { name: 'Previous month' }).click()
  await expect(page).toHaveURL(/\/money\/payments\?month=\d{4}-\d{2}$/)
  await expect(page.getByRole('row').filter({ hasText: order.company.name })).toHaveCount(0)
  await page.getByRole('button', { name: 'Next month' }).click()
  await expect(page).toHaveURL(/\/money\/payments$/)
  await expect(rows).toHaveCount(2)
})

test('Record payment with no order asks "Which order?", then opens the form for the picked order and saves', async ({ page }) => {
  const order = await seedOrder(10000)
  await openAs(page, 'admin', '/money/receivables?pay=1')
  const pick = page.getByRole('dialog', { name: 'Which order?' })
  await expect(pick).toBeVisible()
  await expect(pick).toContainText('Record payment, step 1 of 2')
  await pick.getByRole('textbox', { name: 'Search open orders' }).fill(order.company.name)
  const choice = pick.getByRole('button', { name: new RegExp(order.company.name) })
  await expect(choice).toHaveCount(1)
  await expect(choice).toContainText(ref(order.number))
  await choice.click()
  const form = page.getByRole('dialog', { name: 'Record payment' })
  await expect(form).toBeVisible()
  await expect(form).toContainText(ref(order.number))
  await form.getByRole('button', { name: 'Save payment' }).click()
  await expect(form).toBeHidden()
  await expect(page).toHaveURL(/\/money\/receivables$/)
  const paid = await must(rest<{ amount: number }[]>('admin', `payments_in?order_id=eq.${order.id}&voided_at=is.null&select=amount`))
  expect(paid.map(p => Number(p.amount))).toEqual([11800])
})

test('Payments page: Record payment opens the same picker; Cancel closes it and records nothing', async ({ page }) => {
  await openAs(page, 'admin', '/money/payments')
  await page.getByRole('button', { name: 'Record payment' }).click()
  const pick = page.getByRole('dialog', { name: 'Which order?' })
  await expect(pick).toBeVisible()
  await pick.getByRole('button', { name: 'Cancel' }).click()
  await expect(pick).toBeHidden()
})

test('sales have no Payments tab and get the no-access page on its address', async ({ page }) => {
  await openAs(page, 'sales', '/money/receivables')
  await expect(page.getByRole('navigation', { name: 'Money views' }).getByRole('link', { name: 'Payments' })).toHaveCount(0)
  await page.goto('/money/payments')
  await expect(page.getByRole('heading', { name: /is for/ })).toBeVisible()
})

for (const [label, size] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 375, height: 812 }]] as const) {
  test(`Money home at ${label}: the To collect hero, then three numbers; a screenshot for the review`, async ({ page }) => {
    await page.setViewportSize(size)
    await openAs(page, 'admin', '/money')
    const blocks = page.getByTestId('money-blocks')
    await expect(blocks.getByRole('heading', { name: /Customers still owe us|Nothing to collect/ })).toBeVisible()
    await expect(blocks.getByRole('link', { name: 'Open To collect' })).toHaveAttribute('href', '/money/receivables')
    await expect(blocks.getByRole('link')).toHaveCount(4)
    // nothing runs off the side of a phone
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(await axeViolations(page)).toEqual([])
    await page.screenshot({ path: test.info().outputPath(`forest-a4-money-${label}.png`), fullPage: true })
    await review(page, `forest-a4-money-${label}`)
  })
}
