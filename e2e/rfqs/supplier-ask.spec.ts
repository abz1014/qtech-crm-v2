import { expect, test, type Page } from '@playwright/test'
import { createCompany, createRfq, karachiDay, must, openAs, rest, uniqueName } from '../support/stack'
import { openStage } from '../support/job'

/*
 * Asking suppliers from the RFQ page without leaving it (owner, 13 Nov 2026): "Search or add a supplier" in Suppliers to ask,
 * "Record as asked" without copying, "Enter reply from another supplier", and a visible "Cannot offer" beside each item's price.
 * Every test seeds its own customer, RFQ and suppliers (unique names).
 */

async function seed(opts: { asked?: boolean } = {}) {
  const customer = await createCompany(uniqueName('Ask Customer'))
  const rfq = await createRfq(customer.id, { due_on: karachiDay(6) })
  const items: { id: string; description: string }[] = []
  for (const [i, description] of [`Flow meter FM${Math.random().toString(36).slice(2, 6)} DN50`, 'Pressure transmitter 0-10 bar'].entries()) {
    const row = (await must(rest<{ id: string }[]>('admin', 'rfq_items', { method: 'POST', body: { rfq_id: rfq.id, position: i, description, qty: 2 } })))[0]
    items.push({ id: row.id, description })
  }
  let asked: { id: string; name: string; inquiryId: string } | null = null
  if (opts.asked) {
    const c = await createCompany(uniqueName('Asked Supplier'))
    const inq = (await must(rest<{ id: string }[]>('admin', 'supplier_inquiries', { method: 'POST', body: { rfq_id: rfq.id, supplier_id: c.id, sent_on: karachiDay(-2) } })))[0]
    asked = { id: c.id, name: c.name, inquiryId: inq.id }
  }
  return { rfq, items, asked }
}

const inquiriesOf = (rfqId: string, supplierId: string) =>
  must(rest<{ id: string; sent_on: string | null }[]>('admin', `supplier_inquiries?rfq_id=eq.${rfqId}&supplier_id=eq.${supplierId}&select=id,sent_on`))

async function openCard(page: Page, rfqId: string) {
  await openAs(page, 'sales', `/rfqs/${rfqId}`)
  await openStage(page, 'Quotation')
  const card = page.locator('[data-slot="suppliers-to-ask"]')
  await expect(card).toBeVisible()
  return card
}

test.describe('supplier ask flow', () => {
  test('a company found by search is ticked and recorded as asked without copying the message', async ({ page }) => {
    const s = await seed()
    const supplier = await createCompany(uniqueName('Found Supplier'))
    const card = await openCard(page, s.rfq.id)
    await card.getByRole('combobox', { name: 'Search or add a supplier' }).fill(supplier.name)
    await page.getByRole('option', { name: new RegExp(supplier.name) }).click()
    await expect(card.getByRole('checkbox', { name: supplier.name })).toBeChecked()
    await card.getByRole('button', { name: 'Record as asked' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Recorded as asked' })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'Message copied' })).toHaveCount(0)
    await expect(page.locator('[data-slot="suppliers-asked"]')).toContainText(supplier.name)
    const made = await inquiriesOf(s.rfq.id, supplier.id)
    expect(made).toHaveLength(1)
    expect(made[0].sent_on).toBe(karachiDay(0))
  })

  test('a name that is not on file is added as a new supplier right there, ticked, and becomes a supplier once asked', async ({ page }) => {
    const s = await seed()
    const name = uniqueName('Brand New Supplier')
    const card = await openCard(page, s.rfq.id)
    await card.getByRole('combobox', { name: 'Search or add a supplier' }).fill(name)
    await page.getByRole('option', { name: `Add “${name}” as a new supplier` }).click()
    await card.getByRole('region', { name: 'New supplier' }).getByRole('button', { name: 'Create and use' }).click()
    await expect(card.getByRole('checkbox', { name })).toBeChecked()
    const created = await must(rest<{ id: string }[]>('admin', `companies?name=eq.${encodeURIComponent(name)}&select=id`))
    expect(created).toHaveLength(1)
    await card.getByRole('button', { name: 'Record as asked' }).click()
    await expect(page.locator('[data-slot="suppliers-asked"]')).toContainText(name)
    expect((await inquiriesOf(s.rfq.id, created[0].id)).length).toBe(1)
    // The role is derived from the inquiry: the same as a supplier added on Companies and then asked.
    const role = await must(rest<{ role: string }[]>('admin', `v_company_roles?company_id=eq.${created[0].id}&select=role`))
    expect(role[0].role).toBe('supplier')
  })

  test('Enter reply from another supplier records them as asked today and opens their reply', async ({ page }) => {
    const s = await seed()
    const supplier = await createCompany(uniqueName('Phoned Supplier'))
    await openCard(page, s.rfq.id)
    await page.getByRole('button', { name: 'Enter reply from another supplier' }).click()
    const picker = page.getByRole('dialog', { name: 'Enter reply from another supplier' })
    await picker.getByRole('combobox', { name: 'Search or add a supplier' }).fill(supplier.name)
    await page.getByRole('option', { name: new RegExp(supplier.name) }).click()
    const reply = page.getByRole('dialog', { name: supplier.name, exact: true })
    await expect(reply).toBeVisible()
    const made = await inquiriesOf(s.rfq.id, supplier.id)
    expect(made).toHaveLength(1)
    expect(made[0].sent_on).toBe(karachiDay(0))
    await reply.getByRole('button', { name: 'PKR', exact: true }).click()
    await reply.getByLabel(`Price for item 1 from ${supplier.name}`).fill('1500')
    await reply.getByRole('button', { name: 'Save reply' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Reply saved' })).toBeVisible()
    await expect.poll(async () => (await must(rest<unknown[]>('admin', `supplier_quote_lines?inquiry_id=eq.${made[0].id}&select=id`))).length).toBe(1)
  })

  test('Cannot offer sits beside each price box, records the reason for that item, and can be taken back', async ({ page }) => {
    const s = await seed({ asked: true })
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    await openStage(page, 'Quotation')
    await page.getByRole('button', { name: `Enter reply, ${s.asked!.name}`, exact: true }).click()
    const reply = page.getByRole('dialog', { name: s.asked!.name, exact: true })
    await expect(reply.getByRole('button', { name: `Cannot offer item 2 from ${s.asked!.name}` })).toBeVisible()
    await reply.getByRole('button', { name: `Cannot offer item 2 from ${s.asked!.name}` }).click()
    await page.getByRole('menuitem', { name: 'Item discontinued' }).click()
    await expect(reply).toContainText('Cannot offer: Item discontinued')
    await expect
      .poll(async () => (await must(rest<{ rfq_item_id: string; reason: string }[]>('admin', `inquiry_item_declines?inquiry_id=eq.${s.asked!.inquiryId}&select=rfq_item_id,reason`))).map(d => [d.rfq_item_id, d.reason]))
      .toEqual([[s.items[1].id, 'discontinued']])
    await reply.getByRole('button', { name: `Take back cannot offer, item 2 from ${s.asked!.name}` }).click()
    await expect.poll(async () => (await must(rest<unknown[]>('admin', `inquiry_item_declines?inquiry_id=eq.${s.asked!.inquiryId}&select=reason`))).length).toBe(0)
  })
})
