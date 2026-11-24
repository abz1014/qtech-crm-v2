import { test, type Page } from '@playwright/test'
import { createCompany, createRfq, karachiDay, must, openAs, rest, uniqueName } from '../support/stack'
import { axeViolations } from '../support/axe'
import { markWonButton, orderCreated } from '../support/job'
import { expect, get, shot } from './fixtures'

/*
 * Quote first (owner, 24 Nov 2026: "we just select the supplier we are going with and the price which the supplier quoted"). Mark won
 * needs no supplier reply in the CRM: "Another supplier" on a line searches every company and takes the price it quoted, with its
 * currency. Lines can go to different suppliers, and each supplier in each currency becomes one supplier order (0146).
 */

const dialog = (page: Page) => page.getByRole('dialog')

async function seed() {
  const tag = Math.random().toString(36).slice(2, 6)
  const customer = await createCompany(uniqueName('Quote First Customer'))
  const rfq = await createRfq(customer.id, { due_on: karachiDay(6), customer_ref: `QF-${tag}`, quoted_on: karachiDay(-1) })
  const items = await must(
    rest<{ id: string; position: number }[]>('admin', 'rfq_items', {
      method: 'POST',
      body: [
        { rfq_id: rfq.id, position: 0, description: `Touch panel ${tag}`, qty: 2, quoted_unit_price_net: 95000 },
        { rfq_id: rfq.id, position: 1, description: `Relay ${tag}`, qty: 1, quoted_unit_price_net: 7000 },
      ],
    }),
  )
  items.sort((a, b) => a.position - b.position)
  await must(rest('admin', 'rpc/issue_quotation', { method: 'POST', body: { p_quotation_id: crypto.randomUUID(), p_rfq_id: rfq.id } }))
  // two suppliers nobody asked in the CRM: they are found by name at Mark won
  const a = await createCompany(uniqueName(`Yona Automation ${tag}`), { country: 'China' })
  const b = await createCompany(uniqueName(`Roma Controls ${tag}`), { country: 'China' })
  return { rfq, items, a, b }
}

async function another(page: Page, line: number, name: string) {
  const d = dialog(page)
  await d.getByRole('button', { name: `Supplier for line ${line}` }).click()
  await page.getByRole('option', { name: 'Another supplier' }).click()
  const row = d.getByTestId(`convert-item-${line}-another`)
  await row.getByRole('combobox').fill(name.slice(0, 12))
  await page.getByRole('option', { name: new RegExp(name) }).first().click()
  await expect(row).toContainText(name)
  return row
}

test.describe('Mark won with a supplier typed, no reply entered', () => {
  test('each line names its supplier and price, and the order has one supplier order per supplier', async ({ page }) => {
    const s = await seed()
    await openAs(page, 'sales', `/jobs/${s.rfq.number}`)
    await (await markWonButton(page)).click()
    const d = dialog(page)
    await expect(d.getByRole('heading', { name: 'Mark won' })).toBeVisible()

    // nothing chosen yet: Create order says what is missing
    await d.getByRole('button', { name: 'Supplier for line 1' }).click()
    await page.getByRole('option', { name: 'Another supplier' }).click()
    await d.getByRole('button', { name: 'Create order' }).click()
    await expect(d.getByText('Search or add the supplier for line 1.')).toBeVisible()
    expect(await get(`orders?rfq_id=eq.${s.rfq.id}&select=id`)).toHaveLength(0)

    const one = await another(page, 1, s.a.name)
    await one.getByLabel('Supplier currency, line 1').selectOption('USD')
    await one.getByLabel('Supplier unit price, line 1').fill('35')
    await expect(d.getByTestId('convert-item-1-typed-price')).toContainText('USD 35')
    await another(page, 2, s.b.name)
    await expect(d.getByTestId('convert-item-2-typed-price')).toContainText('Price later')
    await expect(d).toContainText('2 supplier orders')
    await shot(page, 'quote-first-won-typed-1440')
    expect(await axeViolations(page, { landmarks: false })).toEqual([])

    await d.getByRole('button', { name: 'Create order' }).click()
    await orderCreated(page)

    const order = (await get<{ id: string }>(`orders?rfq_id=eq.${s.rfq.id}&select=id`))[0]
    const lines = await get<{ position: number; supplier_unit_price: number | null; supplier_order_id: string | null }>(
      `order_items?order_id=eq.${order.id}&select=position,supplier_unit_price,supplier_order_id&order=position`,
    )
    expect(lines.map(l => (l.supplier_unit_price === null ? null : Number(l.supplier_unit_price)))).toEqual([35, null])
    const legs = await get<{ id: string; supplier_id: string; currency: string | null; inquiry_id: string | null }>(
      `supplier_orders?order_id=eq.${order.id}&select=id,supplier_id,currency,inquiry_id`,
    )
    expect(legs).toHaveLength(2)
    const legA = legs.find(l => l.supplier_id === s.a.id)!
    const legB = legs.find(l => l.supplier_id === s.b.id)!
    expect([legA.currency?.trim(), legA.inquiry_id]).toEqual(['USD', null])
    expect(legB.currency).toBeNull()
    expect(lines.map(l => l.supplier_order_id)).toEqual([legA.id, legB.id])
  })
})
