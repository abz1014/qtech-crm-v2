import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { createCompany, karachiDay, must, openAs, rest, uniqueName } from '../support/stack'

/*
 * Delivery challans (migration 0131). End to end against the local CI stack:
 *   - a challan is issued from the order with its own DC- number, downloads as a PDF, and keeps only the lines and quantities picked;
 *   - the stored challan and what the browser receives carry no price;
 *   - numbers go up by one and are unique ignoring case;
 *   - an engineer can issue and read one too.
 */
test.describe.configure({ mode: 'serial' })

interface Challan {
  id: string
  number: string
  lines: Array<Record<string, unknown>>
  deliver_to: string | null
}

async function seedOrder() {
  const company = await createCompany(uniqueName('Challan Customer'))
  const site = (await must(rest<{ id: string }[]>('admin', 'company_sites', { method: 'POST', body: { company_id: company.id, name: 'Plant 2', address: 'Industrial Estate, Wah Cantt' } })))[0]
  const order = (
    await must(rest<{ id: string }[]>('admin', 'orders', { method: 'POST', body: { company_id: company.id, site_id: site.id, ordered_on: karachiDay(-3), needs_commissioning: false, payment_terms_days: 30 } }))
  )[0]
  await must(
    rest('admin', 'order_items', {
      method: 'POST',
      body: [
        { order_id: order.id, position: 0, description: 'Fixture actuator', qty: 6, unit: 'pcs', unit_price_net: 1500 },
        { order_id: order.id, position: 1, description: 'Fixture cable', qty: 40, unit: 'm', unit_price_net: 90 },
        { order_id: order.id, position: 2, description: 'Commissioning', qty: 1, unit_price_net: 5000, is_service: true },
      ],
      prefer: 'return=minimal',
    }),
  )
  return { company, order }
}

const challansOf = (orderId: string) => must(rest<Challan[]>('admin', `delivery_challans?order_id=eq.${orderId}&select=id,number,lines,deliver_to&order=number.asc`))

test('admin issues a part-delivery challan: its own number, a PDF, only the lines picked, no price', async ({ page }) => {
  const s = await seedOrder()
  await openAs(page, 'admin', `/orders/${s.order.id}`)
  const panel = page.getByRole('region', { name: 'Delivery challans' })
  await expect(panel.getByText(/None issued yet/)).toBeVisible()
  await panel.getByRole('button', { name: 'New challan' }).click()
  const dialog = page.getByRole('dialog')
  const lines = dialog.getByRole('list', { name: 'Lines on the challan' }).getByRole('listitem')
  await expect(lines).toHaveCount(2) // the service line is never on a challan
  await expect(dialog.getByRole('textbox', { name: /Deliver to/ })).toHaveValue(/Plant 2\s+Industrial Estate, Wah Cantt/)
  await lines.first().getByRole('textbox').fill('4')
  await lines.nth(1).getByRole('checkbox').click() // the cable stays for the next delivery
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Issue and download' }).click()])
  expect(download.suggestedFilename()).toMatch(/^Delivery-challan-DC-\d{4}\.pdf$/)
  const bytes = await readFile(await download.path())
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')

  const [c] = await challansOf(s.order.id)
  expect(c.number).toMatch(/^DC-\d{4}$/)
  expect(c.lines).toHaveLength(1)
  expect(c.lines[0]).toMatchObject({ description: 'Fixture actuator', qty: 4, unit: 'pcs' })
  expect(JSON.stringify(c)).not.toMatch(/price|1500|\b90\b|gst/i)
  await expect(panel.getByRole('listitem')).toContainText(c.number)

  // the rest goes on a second challan, one number higher
  await panel.getByRole('button', { name: 'New challan' }).click()
  const second = page.getByRole('dialog')
  await second.getByRole('list', { name: 'Lines on the challan' }).getByRole('listitem').first().getByRole('checkbox').click()
  await Promise.all([page.waitForEvent('download'), second.getByRole('button', { name: 'Issue and download' }).click()])
  await expect.poll(async () => (await challansOf(s.order.id)).length).toBe(2)
  const both = await challansOf(s.order.id)
  expect(Number(both[1].number.slice(3))).toBe(Number(both[0].number.slice(3)) + 1)
})

test('numbers are unique ignoring case, a quantity above the order is refused, and an engineer can issue one', async () => {
  const s = await seedOrder()
  const first = await must(rest<Challan>('admin', 'rpc/create_delivery_challan', { method: 'POST', body: { p_order_id: s.order.id } }))
  expect(first.number).toMatch(/^DC-\d{4}$/)
  expect(first.lines).toHaveLength(2) // every goods line at its ordered quantity
  const dup = await rest('admin', 'delivery_challans', { method: 'POST', body: { order_id: s.order.id, number: first.number.toLowerCase(), lines: [{ description: 'x', qty: 1 }] } })
  expect(dup.status).toBe(409)

  const [item] = await must(rest<{ id: string }[]>('admin', `order_items?order_id=eq.${s.order.id}&is_service=eq.false&select=id&order=position.asc`))
  const over = await rest('admin', 'rpc/create_delivery_challan', { method: 'POST', body: { p_order_id: s.order.id, p_lines: [{ item_id: item.id, qty: 7 }] } })
  expect(over.status).toBeGreaterThanOrEqual(400)

  const byEngineer = await rest<Challan>('engineer', 'rpc/create_delivery_challan', { method: 'POST', body: { p_order_id: s.order.id } })
  expect(byEngineer.status).toBe(200)
  expect(JSON.stringify(byEngineer.body)).not.toMatch(/price|1500|gst/i)
  expect(Number(byEngineer.body.number.slice(3))).toBe(Number(first.number.slice(3)) + 1)
  // nobody but an admin deletes one
  expect((await rest('engineer', `delivery_challans?id=eq.${first.id}`, { method: 'DELETE' })).body).toHaveLength(0)
  expect((await rest('sales', `delivery_challans?id=eq.${first.id}`, { method: 'DELETE' })).body).toHaveLength(0)
})
