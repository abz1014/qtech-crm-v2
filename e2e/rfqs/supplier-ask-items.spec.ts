import { expect, test, type Page } from '@playwright/test'
import { readClipboardWhen, resetClipboard } from '../support/clipboard'
import { createCompany, createRfq, karachiDay, must, openAs, rest, uniqueName } from '../support/stack'
import { openStage } from '../support/job'

/*
 * Supplier flow D (0140): on an RFQ with several items, a supplier can be asked about only the ticked items, and the RFQ page says
 * which. supplier_inquiries.asked_item_ids holds them; NULL (every inquiry before 0140) still means every item.
 * Every test seeds its own customer, RFQ (three items) and supplier (unique names).
 */

async function seed() {
  const customer = await createCompany(uniqueName('Items Customer'))
  const rfq = await createRfq(customer.id, { due_on: karachiDay(6) })
  const tag = Math.random().toString(36).slice(2, 6)
  const items: { id: string; description: string }[] = []
  for (const [i, description] of [`Flow meter FM${tag} DN50`, `Pressure transmitter PT${tag}`, `Level switch LS${tag}`].entries()) {
    const row = (await must(rest<{ id: string }[]>('admin', 'rfq_items', { method: 'POST', body: { rfq_id: rfq.id, position: i, description, qty: 1 } })))[0]
    items.push({ id: row.id, description })
  }
  const supplier = await createCompany(uniqueName('Items Supplier'))
  return { rfq, items, supplier }
}

const askedOf = (rfqId: string, supplierId: string) =>
  must(rest<{ asked_item_ids: string[] | null; sent_on: string | null }[]>('admin', `supplier_inquiries?rfq_id=eq.${rfqId}&supplier_id=eq.${supplierId}&select=asked_item_ids,sent_on`))

/** The Quotation stage with "Suppliers to ask", the supplier found by search and ticked, and one item unticked. */
async function pickSupplierAndUntick(page: Page, s: Awaited<ReturnType<typeof seed>>, untick: number) {
  await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
  await openStage(page, 'Quotation')
  const card = page.locator('[data-slot="suppliers-to-ask"]')
  await expect(card).toBeVisible()
  await card.getByRole('combobox', { name: 'Search or add a supplier' }).fill(s.supplier.name)
  await page.getByRole('option', { name: new RegExp(s.supplier.name) }).click()
  await expect(card.getByRole('checkbox', { name: s.supplier.name })).toBeChecked()
  const list = card.getByRole('list', { name: 'Items to ask about' })
  for (const [n, it] of s.items.entries()) await expect(list.getByRole('checkbox', { name: `Item ${n + 1}: ${it.description}` })).toBeChecked()
  // The whole row is the tap target (the label stretches over it, as on the supplier rows), so a person taps the row.
  await list.locator('label', { hasText: s.items[untick - 1].description }).click()
  await expect(list.getByRole('checkbox', { name: `Item ${untick}: ${s.items[untick - 1].description}` })).not.toBeChecked()
  await expect(list).toContainText('2 of 3')
  return card
}

test.describe('supplier flow D: asking about some items', () => {
  test('one supplier asked about items 1 and 2: the message lists only those, and item 3 still shows nobody asked', async ({ page }) => {
    const s = await seed()
    const card = await pickSupplierAndUntick(page, s, 3)
    await resetClipboard(page)
    await card.getByRole('button', { name: 'Copy message for 1 supplier' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Message copied' })).toBeVisible()
    const text = await readClipboardWhen(page, s.items[0].description)
    expect(text).toContain(s.items[0].description)
    expect(text).toContain(s.items[1].description)
    expect(text).not.toContain(s.items[2].description)
    await expect.poll(async () => (await askedOf(s.rfq.id, s.supplier.id))[0]?.asked_item_ids).toEqual([s.items[0].id, s.items[1].id])
    const asked = page.locator('[data-slot="suppliers-asked"]')
    await expect(asked).toContainText(s.supplier.name)
    await expect(asked).toContainText('Asked about items 1 and 2 only')
    await expect(page.getByRole('article', { name: 'Item 3' })).toContainText('No supplier has been asked about this item.')
    await expect(page.getByRole('article', { name: 'Item 3' })).not.toContainText(s.supplier.name)
    for (const n of [1, 2]) {
      await expect(page.getByRole('article', { name: `Item ${n}` })).not.toContainText('No supplier has been asked about this item.')
      await expect(page.getByRole('article', { name: `Item ${n}` })).toContainText(s.supplier.name)
    }
  })

  test('Record as asked for the ticked items records only them, with no message copied', async ({ page }) => {
    const s = await seed()
    const card = await pickSupplierAndUntick(page, s, 1)
    await card.getByRole('button', { name: 'Record as asked' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Recorded as asked' })).toBeVisible()
    await expect.poll(async () => (await askedOf(s.rfq.id, s.supplier.id))[0]?.asked_item_ids).toEqual([s.items[1].id, s.items[2].id])
    expect((await askedOf(s.rfq.id, s.supplier.id))[0].sent_on).toBe(karachiDay(0))
    await expect(page.locator('[data-slot="suppliers-asked"]')).toContainText('Asked about items 2 and 3 only')
    await expect(page.getByRole('article', { name: 'Item 1' })).toContainText('No supplier has been asked about this item.')
  })

  test('an ask recorded the old way (for the whole RFQ) still shows every item asked', async ({ page }) => {
    const s = await seed()
    await must(rest('admin', 'supplier_inquiries', { method: 'POST', body: { rfq_id: s.rfq.id, supplier_id: s.supplier.id, sent_on: karachiDay(-2) } }))
    expect((await askedOf(s.rfq.id, s.supplier.id))[0].asked_item_ids).toBeNull()
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    await openStage(page, 'Quotation')
    const asked = page.locator('[data-slot="suppliers-asked"]')
    await expect(asked).toContainText(s.supplier.name)
    await expect(asked).not.toContainText('Asked about items')
    await expect(page.getByText('No supplier has been asked about this item.')).toHaveCount(0)
    for (const n of [1, 2, 3]) await expect(page.getByRole('article', { name: `Item ${n}` })).toContainText(s.supplier.name)
  })
})
