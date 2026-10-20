import { test, type Page } from '@playwright/test'
import { createCompany, karachiDay, must, openAs, rest, uniqueName } from '../support/stack'
import { axeViolations } from '../support/axe'
import { expect, get, shot, tapper } from './fixtures'

/*
 * O02 end to end: a new order from a past one ("WhatsApp order (no RFQ) and repeat order"). The past order is found by company, site,
 * item text, order number or customer PO, and create_repeat_order copies the customer, site, contact, terms, the lines with their last
 * prices and the supplier legs. FE-2 target asserted here: at most 3 interactions after choosing the source order.
 */

const dialogViolations = (page: Page) => axeViolations(page, { landmarks: false })
const dialog = (page: Page) => page.getByRole('dialog')

interface Src {
  tag: string
  company: { id: string; name: string }
  supplier: { id: string; name: string }
  site: { id: string; name: string }
  order: { id: string; number: number }
}

/** A customer's past order: a site, a contact, 30-day terms, two lines with their selling and supplier prices, on one leg (EUR) that was placed and delivered. */
async function seedSource(): Promise<Src> {
  const tag = Math.random().toString(36).slice(2, 7)
  const company = await createCompany(uniqueName(`Repeatco${tag}`))
  const supplier = await createCompany(uniqueName('Alpenmark'), { country: 'Germany' })
  const site = (await must(rest<{ id: string; name: string }[]>('admin', 'company_sites', { method: 'POST', body: { company_id: company.id, name: `Kiln line ${tag}`, address: 'Hub plant' } })))[0]
  const contact = (await must(rest<{ id: string }[]>('admin', 'contacts', { method: 'POST', body: { company_id: company.id, name: 'Mr. Tariq' } })))[0]
  const order = (
    await must(
      rest<{ id: string; number: number }[]>('admin', 'orders', {
        method: 'POST',
        body: { company_id: company.id, site_id: site.id, contact_id: contact.id, customer_po_number: `OLD-${tag}`, ordered_on: karachiDay(-40), payment_terms_days: 45, needs_commissioning: true },
      }),
    )
  )[0]
  const leg = (
    await must(rest<{ id: string }[]>('admin', 'supplier_orders', { method: 'POST', body: { order_id: order.id, supplier_id: supplier.id, currency: 'EUR', placed_on: karachiDay(-38), expected_on: karachiDay(-24), reference: 'PI-77', received_on: karachiDay(-24), delivered_on: karachiDay(-24) } }))
  )[0]
  await must(
    rest('admin', 'order_items', {
      method: 'POST',
      body: [
        { order_id: order.id, position: 0, description: `Belimo damper actuator ${tag}`, qty: 6, unit: 'ea', unit_price_net: 48500, gst_rate: 18, is_service: false, supplier_order_id: leg.id, supplier_unit_price: 214 },
        { order_id: order.id, position: 1, description: `Loop check and commissioning ${tag}`, qty: 1, unit: 'job', unit_price_net: 135000, gst_rate: 18, is_service: true, supplier_order_id: null, supplier_unit_price: null },
      ],
      prefer: 'return=minimal',
    }),
  )
  return { tag, company, supplier, site, order }
}

const ordersOf = (companyId: string) => get<{ id: string; number: number; rfq_id: string | null; site_id: string | null; contact_id: string | null; customer_po_number: string | null; ordered_on: string | null; payment_terms_days: number | null; needs_commissioning: boolean; owner_id: string | null; created_at: string }>(
  `orders?company_id=eq.${companyId}&select=id,number,rfq_id,site_id,contact_id,customer_po_number,ordered_on,payment_terms_days,needs_commissioning,owner_id,created_at&order=number`,
)

test.describe('O02: repeat a past order', () => {
  test('find it by company, then 1 tap to copy it; typing the PO is the only other interaction; a double submit makes one order', async ({ page }) => {
    const s = await seedSource()
    await openAs(page, 'sales', '/orders?owner=all')
    await page.getByRole('button', { name: 'Repeat a past order' }).first().click()
    const d = dialog(page)
    await expect(d.getByRole('heading', { name: 'Repeat a past order' })).toBeVisible()
    await expect(d).toContainText('The customer ordered again, or ordered without an RFQ')
    // the most recent orders are offered before anything is typed; typing narrows them
    await expect(d.getByRole('list', { name: 'Most recent orders' })).toBeVisible()
    await d.getByLabel('Find a past order').fill(s.company.name)
    const hit = d.getByRole('button', { name: new RegExp(`${s.company.name}.*ORD-${String(s.order.number).padStart(4, '0')}`) })
    await expect(hit).toBeVisible()
    await expect(hit).toContainText(s.site.name)
    await expect(hit).toContainText('Belimo damper actuator')
    await expect(hit).toContainText('PO OLD-')
    await shot(page, 'o02-new-order-find-1440')

    await hit.click() // choosing the source order is not counted
    await expect(d.getByTestId('chosen-order')).toContainText(s.company.name)
    await expect(d.getByTestId('chosen-order')).toContainText('2 lines')
    await expect(d.getByRole('button', { name: 'Create order' })).toBeEnabled()
    await shot(page, 'o02-new-order-chosen-1440')

    const t = tapper()
    await t.typed(d.getByLabel('Customer PO number'), `NEW-${s.tag}`)
    await t.doubleTap(d.getByRole('button', { name: 'Create order' }))
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/)
    expect(t.count).toBeLessThanOrEqual(3)

    const all = await ordersOf(s.company.id)
    expect(all).toHaveLength(2)
    const copy = all[1]
    expect(copy.rfq_id).toBeNull()
    expect(copy.site_id).toBe(s.site.id)
    expect(copy.contact_id).not.toBeNull()
    expect(copy.payment_terms_days).toBe(45)
    expect(copy.needs_commissioning).toBe(true)
    expect(copy.customer_po_number).toBe(`NEW-${s.tag}`)
    expect(copy.ordered_on).toBe(karachiDay(0))
    expect(copy.owner_id).not.toBeNull()
    const items = await get<{ description: string; unit_price_net: number; supplier_unit_price: number | null; is_service: boolean; supplier_order_id: string | null }>(
      `order_items?order_id=eq.${copy.id}&select=description,unit_price_net,supplier_unit_price,is_service,supplier_order_id&order=position`,
    )
    expect(items.map(i => Number(i.unit_price_net))).toEqual([48500, 135000])
    expect(Number(items[0].supplier_unit_price)).toBe(214)
    expect(items[0].supplier_order_id).not.toBeNull()
    expect(items[1].supplier_order_id).toBeNull()
    // the leg is the same supplier and currency, with none of the dates: nothing has been ordered yet
    const legs = await get<{ supplier_id: string; currency: string; placed_on: string | null; delivered_on: string | null; reference: string | null }>(`supplier_orders?order_id=eq.${copy.id}&select=supplier_id,currency,placed_on,delivered_on,reference`)
    expect(legs).toEqual([{ supplier_id: s.supplier.id, currency: 'EUR', placed_on: null, delivered_on: null, reference: null }])
    // the new order opens
    await expect(page.getByRole('heading', { level: 1 })).toContainText(s.company.name)
  })

  test('found by site, by item text, by order number and by customer PO', async ({ page }) => {
    const s = await seedSource()
    await openAs(page, 'admin', '/orders?owner=all')
    await page.getByRole('button', { name: 'Repeat a past order' }).first().click()
    const d = dialog(page)
    const input = d.getByLabel('Find a past order')
    const hit = d.getByRole('button', { name: new RegExp(`${s.company.name}.*ORD-${String(s.order.number).padStart(4, '0')}`) })
    for (const q of [s.site.name, `Belimo damper actuator ${s.tag}`, `ORD-${String(s.order.number).padStart(4, '0')}`, `OLD-${s.tag}`]) {
      await input.fill(q)
      await expect(hit).toBeVisible()
    }
    await input.fill(`nothing-like-this-${s.tag}`)
    await expect(d.getByTestId('no-past-orders')).toContainText('No past order matches that')
    // a cancelled order is never offered as a source
    await must(rest('admin', `orders?id=eq.${s.order.id}`, { method: 'PATCH', body: { cancelled_on: karachiDay(0) }, prefer: 'return=minimal' }))
    await input.fill(s.company.name)
    await expect(d.getByTestId('no-past-orders')).toBeVisible()
  })

  test('Repeat order on the company page opens the dialog with that order already chosen', async ({ page }) => {
    const s = await seedSource()
    await openAs(page, 'sales', `/companies/${s.company.id}`)
    const button = page.getByRole('button', { name: `Repeat order ORD-${String(s.order.number).padStart(4, '0')}` })
    await expect(button).toBeVisible()
    await shot(page, 'o02-company-repeat-order-1440')
    await button.click()
    await expect(dialog(page).getByTestId('chosen-order')).toContainText(s.company.name)
    await expect(dialog(page).getByRole('button', { name: 'Choose another' })).toHaveCount(0)
    await dialog(page).getByRole('button', { name: 'Create order' }).click()
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/)
    expect(await ordersOf(s.company.id)).toHaveLength(2)
  })

  test('an engineer is not offered Repeat a past order or Repeat order', async ({ page }) => {
    const s = await seedSource()
    await openAs(page, 'engineer', `/companies/${s.company.id}`)
    await expect(page.getByRole('heading', { name: s.company.name }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /Repeat order/ })).toHaveCount(0)
  })

  for (const width of [1440, 375]) {
    test(`axe (WCAG 2.2 AA) and review screenshots at ${width}: the Repeat a past order dialog`, async ({ page }) => {
      const s = await seedSource()
      await page.setViewportSize({ width, height: width > 800 ? 900 : 812 })
      await openAs(page, 'sales', '/orders?owner=all')
      await page.getByRole('button', { name: 'Repeat a past order' }).first().click()
      await dialog(page).getByLabel('Find a past order').fill(s.company.name)
      await expect(dialog(page).getByRole('button', { name: new RegExp(s.company.name) })).toBeVisible()
      expect(await dialogViolations(page)).toEqual([])
      await dialog(page).getByRole('button', { name: new RegExp(s.company.name) }).click()
      expect(await dialogViolations(page)).toEqual([])
      await shot(page, `o02-new-order-axe-${width}`)
    })
  }
})
