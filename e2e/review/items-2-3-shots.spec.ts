import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { createCompany, createRfq, karachiDay, must, openAs, rest, uniqueName, type Role } from '../support/stack'
import { openStage } from '../support/job'
import { api } from '../verify-roles/lib'
import { seedWorld, type World } from '../verify-roles/fixtures'

/*
 * THROWAWAY review screenshots (branch shots/items-2-3, never merged): supplier flow D (PR #30) and search_all without supplier
 * PO numbers for an engineer (PR #4), full page at 1440x900, 375x812 (phone emulation) and 320 (phone, for a and c only).
 * Written to test-results/review-shots/items23/ (the shard uploads test-results), with overflow.json: the horizontal overflow of
 * every shot. No assertions beyond reaching the screens.
 */
const DIR = 'test-results/review-shots/items23'
const BASE = 'http://127.0.0.1:4173'
const overflow: Record<string, { scrollWidth: number; innerWidth: number; wide: string[] }> = {}

test.setTimeout(600_000)

interface Width { tag: string; width: number; height: number; phone: boolean }
const DESKTOP: Width = { tag: 'desktop', width: 1440, height: 900, phone: false }
const PHONE: Width = { tag: 'phone375', width: 375, height: 812, phone: true }
const PHONE320: Width = { tag: 'phone320', width: 320, height: 700, phone: true }

async function ctx(browser: Browser, w: Width): Promise<BrowserContext> {
  return browser.newContext({
    baseURL: BASE,
    viewport: { width: w.width, height: w.height },
    isMobile: w.phone,
    hasTouch: w.phone,
    deviceScaleFactor: w.phone ? 2 : 1,
    locale: 'en-GB',
    timezoneId: 'Asia/Karachi',
    serviceWorkers: 'block',
    permissions: ['clipboard-read', 'clipboard-write'],
  })
}

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(DIR, { recursive: true })
  await page.waitForTimeout(400)
  overflow[name] = await page.evaluate(() => {
    const iw = window.innerWidth
    const wide: string[] = []
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && (r.right > iw + 1 || r.left < -1) && wide.length < 15) {
        const cs = getComputedStyle(el)
        if (cs.position === 'fixed' && r.left >= 0) continue
        wide.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className).slice(0, 60)} [${Math.round(r.left)}..${Math.round(r.right)}] "${(el.textContent ?? '').trim().slice(0, 40)}"`)
      }
    }
    return { scrollWidth: document.documentElement.scrollWidth, innerWidth: iw, wide }
  })
  await page.screenshot({ path: `${DIR}/${name}.png`, fullPage: true })
  writeFileSync(`${DIR}/overflow.json`, JSON.stringify(overflow, null, 2))
}

async function crop(page: Page, selector: ReturnType<Page['locator']>, name: string): Promise<void> {
  mkdirSync(DIR, { recursive: true })
  await selector.scrollIntoViewIfNeeded()
  await selector.screenshot({ path: `${DIR}/${name}.png` })
}

/** A customer, an RFQ with three items, a brand on item 3 carried by a supplier nobody asked (so it is suggested). */
async function seedRfq(label: string) {
  const customer = await createCompany(uniqueName(`${label} Customer`))
  const rfq = await createRfq(customer.id, { due_on: karachiDay(6) })
  const tag = Math.random().toString(36).slice(2, 6)
  const items: { id: string; description: string }[] = []
  for (const [i, description] of [`Flow meter FM${tag} DN50 electromagnetic, PTFE liner`, `Pressure transmitter PT${tag} 0-10 bar`, `Level switch LS${tag} vibrating fork`].entries()) {
    const row = (await must(rest<{ id: string }[]>('admin', 'rfq_items', { method: 'POST', body: { rfq_id: rfq.id, position: i, description, qty: i + 1 } })))[0]
    items.push({ id: row.id, description })
  }
  const brand = (await must(rest<{ id: string }[]>('admin', 'brands', { method: 'POST', body: { name: `Zetabrand${tag}`, kind: 'brand' } })))[0]
  await must(rest('admin', `rfq_items?id=eq.${items[2].id}`, { method: 'PATCH', body: { brand_id: brand.id } }))
  const carrier = await createCompany(uniqueName('Carrier Instruments Trading'))
  await must(rest('admin', 'company_brands', { method: 'POST', body: { company_id: carrier.id, brand_id: brand.id } }))
  const supplier = await createCompany(uniqueName('Items Supplier Engineering'))
  return { rfq, items, carrier, supplier }
}

let notAsked: Awaited<ReturnType<typeof seedRfq>>
let partly: Awaited<ReturnType<typeof seedRfq>>
let world: World
let poNumber: number

test.beforeAll(async () => {
  notAsked = await seedRfq('ShotsA')
  partly = await seedRfq('ShotsC')
  await must(rest('admin', 'supplier_inquiries', {
    method: 'POST',
    body: { rfq_id: partly.rfq.id, supplier_id: partly.supplier.id, sent_on: karachiDay(-1), asked_item_ids: [partly.items[0].id, partly.items[1].id] },
  }))
  world = await seedWorld('SH')
  poNumber = 910000 + Math.floor(Math.random() * 89999)
  const leg = await api('admin', '/rest/v1/supplier_orders', { method: 'POST', body: { order_id: world.order.id, supplier_id: world.supplier.id, currency: 'PKR' }, prefer: 'return=representation' })
  expect(leg.status, `fixture supplier order ${leg.text}`).toBeLessThan(300)
  const po = await api('admin', '/rest/v1/purchase_orders', {
    method: 'POST',
    body: { supplier_order_id: (leg.body as Array<{ id: string }>)[0].id, number: poNumber, revision: 0, currency: 'PKR', total: 0, lines: [{ qty: 1, unit_price: 1 }] },
    prefer: 'return=minimal',
  })
  expect(po.status, `fixture purchase order ${po.text}`).toBeLessThan(300)
})

/** (a): Suppliers to ask, the carrier ticked, item 3 unticked so the ticks show both states. */
async function shotA(browser: Browser, w: Width) {
  const c = await ctx(browser, w)
  const page = await c.newPage()
  await openAs(page, 'sales', `/rfqs/${notAsked.rfq.id}`)
  await openStage(page, 'Quotation')
  const card = page.locator('[data-slot="suppliers-to-ask"]')
  await expect(card).toBeVisible()
  const list = card.getByRole('list', { name: 'Items to ask about' })
  await expect(list).toBeVisible()
  const carrierRow = card.locator('label', { hasText: notAsked.carrier.name })
  if (await carrierRow.count()) await carrierRow.first().click()
  await list.locator('label', { hasText: notAsked.items[2].description }).click()
  await expect(list).toContainText('2 of 3')
  await card.scrollIntoViewIfNeeded()
  await shot(page, `item2-a-suppliers-to-ask-${w.tag}`)
  await crop(page, card, `item2-a-suppliers-to-ask-${w.tag}-card`)
  await c.close()
}

/** (b) to (e) on the RFQ where one supplier was asked about items 1 and 2 only. */
async function shotBtoE(browser: Browser, w: Width, only: 'all' | 'c') {
  const c = await ctx(browser, w)
  const page = await c.newPage()
  await openAs(page, 'sales', `/rfqs/${partly.rfq.id}`)
  await openStage(page, 'Quotation')
  const asked = page.locator('[data-slot="suppliers-asked"]')
  await expect(asked).toContainText('Asked about items 1 and 2 only')
  await asked.scrollIntoViewIfNeeded()
  await shot(page, `item2-c-suppliers-asked-partly-${w.tag}`)
  await crop(page, asked, `item2-c-suppliers-asked-partly-${w.tag}-panel`)
  if (only === 'c') return c.close()

  const item3 = page.getByRole('article', { name: 'Item 3' })
  // Phone: the item is folded to its header until tapped. Shoot the folded state first, then open it.
  const head = item3.locator('header button[aria-expanded]')
  if ((await head.count()) && (await head.getAttribute('aria-expanded')) === 'false') {
    await item3.scrollIntoViewIfNeeded()
    await shot(page, `item2-d-item-nobody-asked-${w.tag}-folded`)
    await head.click()
  }
  await expect(item3).toContainText('No supplier has been asked about this item.')
  await item3.scrollIntoViewIfNeeded()
  await shot(page, `item2-d-item-nobody-asked-${w.tag}`)
  await crop(page, page.locator('[data-slot="items"]'), `item2-d-item-nobody-asked-${w.tag}-items`)

  await asked.getByRole('button', { name: 'Ask more suppliers' }).click()
  const dialog = page.getByRole('dialog', { name: /Ask more suppliers/ })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('list', { name: 'Items to ask about' })).toBeVisible()
  await shot(page, `item2-b-ask-more-dialog-${w.tag}`)
  await page.screenshot({ path: `${DIR}/item2-b-ask-more-dialog-${w.tag}-viewport.png` })
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  await asked.getByRole('button', { name: `Enter reply, ${partly.supplier.name}` }).click()
  const reply = page.getByRole('dialog').first()
  await expect(reply).toBeVisible()
  await page.waitForTimeout(600)
  await shot(page, `item2-e-reply-dialog-partly-asked-${w.tag}`)
  await page.screenshot({ path: `${DIR}/item2-e-reply-dialog-partly-asked-${w.tag}-viewport.png` })
  await c.close()
}

async function openPalette(page: Page) {
  await expect(async () => {
    const dialog = page.getByRole('dialog', { name: 'Search or jump to' })
    if (!(await dialog.isVisible())) {
      const btn = page.getByRole('button', { name: /^Search( or jump to)?$/ }).filter({ visible: true }).first()
      if (await btn.count()) await btn.click()
      else await page.keyboard.press('Control+k')
    }
    await expect(dialog).toBeVisible({ timeout: 1500 })
  }).toPass({ timeout: 15_000 })
}

/** (f)/(g): the palette searched for the supplier PO number, as an engineer (nothing) and as an admin (the PO). */
async function shotSearch(browser: Browser, w: Width, role: Role, letter: 'f' | 'g') {
  const c = await ctx(browser, w)
  const page = await c.newPage()
  await openAs(page, role, '/todo')
  await openPalette(page)
  const term = `PO-${poNumber}`
  const answered = page.waitForResponse(r => r.url().includes('/rpc/search_all') && (r.request().postData() ?? '').includes(String(poNumber)))
  await page.getByRole('dialog', { name: 'Search or jump to' }).getByRole('combobox').fill(term)
  await answered
  await page.waitForTimeout(800)
  await shot(page, `item3-${letter}-${role}-search-supplier-po-${w.tag}`)
  await page.screenshot({ path: `${DIR}/item3-${letter}-${role}-search-supplier-po-${w.tag}-viewport.png` })
  await c.close()
}

for (const w of [DESKTOP, PHONE]) {
  test(`item 2 (a) Suppliers to ask with item ticks @ ${w.tag}`, async ({ browser }) => shotA(browser, w))
  test(`item 2 (b)-(e) partly asked supplier @ ${w.tag}`, async ({ browser }) => shotBtoE(browser, w, 'all'))
  test(`item 3 (f) engineer search @ ${w.tag}`, async ({ browser }) => shotSearch(browser, w, 'engineer', 'f'))
  test(`item 3 (g) admin search @ ${w.tag}`, async ({ browser }) => shotSearch(browser, w, 'admin', 'g'))
}
test('item 2 (a) @ phone320', async ({ browser }) => shotA(browser, PHONE320))
test('item 2 (c) @ phone320', async ({ browser }) => shotBtoE(browser, PHONE320, 'c'))
