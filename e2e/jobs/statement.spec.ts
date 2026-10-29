import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { createCompany, createRfq, karachiDay, must, openAs, rest, uniqueName } from '../support/stack'

/*
 * The Comparative Statement (owner request, 2026-10-29): /jobs/<n>/statement, one section per item, one row per supplier that quoted it,
 * with cost, lead time, weight and country of origin, exported as an A4 landscape PDF. It SELECTS NOTHING (no "cheapest", no
 * "recommended", nothing ticked, supplier-name order), and it is admin and sales only: the database refuses an engineer the prices it is
 * made of (0081), and weight and origin are entered where supplier prices are (the reply dialog, a pasted reply). Fictional data only.
 * It runs in the `jobs` suite.
 */

interface Seed {
  rfq: { id: string; number: number }
  customer: { id: string; name: string }
  items: { id: string }[]
  names: { zeta: string; alpha: string; mid: string; silent: string }
  inquiries: { zeta: string; alpha: string; mid: string; silent: string }
}

/** Item 1 (4 pcs) quoted by Zeta (USD 100), Alpha (PKR 9,000) and Mid (EUR 95.50); item 2 (2.5 m) by Zeta only; Silent was asked and never replied. */
async function seed(): Promise<Seed> {
  const customer = await createCompany(uniqueName('Statement Customer'))
  const rfq = await createRfq(customer.id, { due_on: karachiDay(6), customer_ref: `ST${Math.floor(Math.random() * 90000 + 10000)}` })
  const items = await must(
    rest<{ id: string; position: number }[]>('admin', 'rfq_items', {
      method: 'POST',
      body: [
        { rfq_id: rfq.id, position: 0, description: 'Pressure transmitter 0-10 bar, 4-20 mA', qty: 4, unit: 'pcs' },
        { rfq_id: rfq.id, position: 1, description: 'Armoured cable 4 core', qty: 2.5, unit: 'm' },
      ],
    }),
  )
  items.sort((a, b) => a.position - b.position)
  const zeta = await createCompany(uniqueName('Zeta Controls'), { country: 'Germany' })
  const alpha = await createCompany(uniqueName('Alpha Instruments'), { country: 'China' })
  const mid = await createCompany(uniqueName('Mid Supply'), { country: 'Italy' })
  const silent = await createCompany(uniqueName('Silent Trading'), { country: 'UAE' })
  const ask = async (supplierId: string) =>
    (await must(rest<{ id: string }[]>('admin', 'supplier_inquiries', { method: 'POST', body: { rfq_id: rfq.id, supplier_id: supplierId, sent_on: karachiDay(-2) } })))[0].id
  const inquiries = { zeta: await ask(zeta.id), alpha: await ask(alpha.id), mid: await ask(mid.id), silent: await ask(silent.id) }
  await must(
    rest('admin', 'supplier_quote_lines', {
      method: 'POST',
      body: [
        { inquiry_id: inquiries.zeta, rfq_item_id: items[0].id, unit_price: 100, currency: 'USD', lead_time: '3 weeks', weight: 2.5, weight_unit: 'kg', origin: 'Germany' },
        { inquiry_id: inquiries.zeta, rfq_item_id: items[1].id, unit_price: 40, currency: 'USD', lead_time: 'ex-stock' },
        { inquiry_id: inquiries.alpha, rfq_item_id: items[0].id, unit_price: 9000, currency: 'PKR', lead_time: '10 days', weight: 400, weight_unit: 'g', origin: 'China' },
        { inquiry_id: inquiries.mid, rfq_item_id: items[0].id, unit_price: 95.5, currency: 'EUR', lead_time: '6 weeks', weight: 6, weight_unit: 'lb' },
      ],
      prefer: 'return=minimal',
    }),
  )
  return { rfq, customer, items, names: { zeta: zeta.name, alpha: alpha.name, mid: mid.name, silent: silent.name }, inquiries }
}

const rowNames = (page: Page, item: number) => page.locator(`[data-statement-item="${item}"] [data-statement-row]`).evaluateAll(els => els.map(e => e.getAttribute('data-statement-row') ?? ''))

for (const role of ['sales', 'admin'] as const) {
  test(`${role}: the statement has one section per item, suppliers in name order, totals per currency, and selects nothing`, async ({ page }) => {
    const s = await seed()
    await openAs(page, role, `/jobs/${s.rfq.number}/statement`)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Comparative statement')
    const statement = page.getByTestId('statement')
    await expect(statement.locator('[data-statement-item]')).toHaveCount(2)
    await expect(page.locator('[data-statement-item="1"]')).toContainText('Pressure transmitter 0-10 bar, 4-20 mA')
    await expect(page.locator('[data-statement-item="1"]')).toContainText('Quantity 4 pcs')
    await expect(page.locator('[data-statement-item="2"]')).toContainText('Quantity 2.5 m')

    // by supplier name, A to Z (Alpha, Mid, Zeta), though Mid is cheapest in rupees terms and Zeta quoted both items
    expect(await rowNames(page, 1)).toEqual([s.names.alpha, s.names.mid, s.names.zeta])
    expect(await rowNames(page, 2)).toEqual([s.names.zeta])
    await expect(page.getByTestId('statement-order-note')).toContainText('Nothing is selected or recommended')

    // cost, lead time, weight and origin of one row
    const zeta = page.locator('[data-statement-item="1"]').locator(`[data-statement-row="${s.names.zeta}"]`)
    await expect(zeta).toContainText('USD')
    await expect(zeta).toContainText('100.00')
    await expect(zeta).toContainText('400.00') // 4 x 100
    await expect(zeta).toContainText('3 weeks')
    await expect(zeta).toContainText('2.5 kg')
    await expect(zeta).toContainText('10 kg') // 4 x 2.5
    await expect(zeta).toContainText('Germany')
    const alpha = page.locator('[data-statement-item="1"]').locator(`[data-statement-row="${s.names.alpha}"]`)
    await expect(alpha).toContainText('400 g')
    await expect(alpha).toContainText('1,600 g')
    await expect(page.locator('[data-statement-item="1"]').locator(`[data-statement-row="${s.names.mid}"]`)).toContainText('6 lb')

    // totals: per supplier, each in its own currency, never added across currencies
    const totals = page.locator('[data-statement-totals]')
    await expect(totals.locator(`[data-statement-total="${s.names.zeta}"]`)).toContainText('USD')
    await expect(totals.locator(`[data-statement-total="${s.names.zeta}"]`)).toContainText('500.00') // 4 x 100 + 2.5 x 40
    await expect(totals.locator(`[data-statement-total="${s.names.zeta}"]`)).toContainText('2 of 2')
    await expect(totals.locator(`[data-statement-total="${s.names.alpha}"]`)).toContainText('36,000.00')
    await expect(totals.locator(`[data-statement-total="${s.names.alpha}"]`)).toContainText('1 of 2')
    await expect(totals.locator(`[data-statement-total="${s.names.mid}"]`)).toContainText('382.00')

    // no mark, no recommendation, nothing ticked or chosen
    await expect(statement).not.toContainText(/cheap|lowest|best|recommend|winner|preferred/i)
    await expect(page.locator('#main [aria-checked="true"], #main [aria-pressed="true"], #main [aria-selected="true"], #main input:checked')).toHaveCount(0)
    await expect(page.locator('#main [data-recommended], #main [data-lowest], #main [data-best]')).toHaveCount(0)
    // the suppliers that never replied are not listed until asked for
    await expect(page.locator('[data-statement-noreply]')).toHaveCount(0)
    await page.getByRole('checkbox', { name: 'Show suppliers that did not reply' }).click()
    await expect(page.locator(`[data-statement-item="1"] [data-statement-noreply="${s.names.silent}"]`)).toContainText('No reply')
    await expect(page.locator(`[data-statement-item="2"] [data-statement-noreply="${s.names.alpha}"]`)).toContainText('Did not quote this item')
  })
}

test('a column can be sorted by hand, only moves the rows, and the page says so', async ({ page }) => {
  const s = await seed()
  await openAs(page, 'sales', `/jobs/${s.rfq.number}/statement`)
  const first = page.locator('[data-statement-item="1"]')
  await expect(first.getByRole('columnheader', { name: /supplier/i })).toHaveAttribute('aria-sort', 'ascending')
  // unit cost: grouped by currency (EUR, PKR, USD), never compared as numbers across currencies
  await first.getByRole('button', { name: 'Sort by unit cost' }).click()
  await expect(page.getByTestId('statement-order-note')).toContainText('Sorted by unit cost')
  await expect(page.getByTestId('statement-order-note')).toContainText('nothing is selected or recommended')
  expect(await rowNames(page, 1)).toEqual([s.names.mid, s.names.alpha, s.names.zeta])
  await first.getByRole('button', { name: 'Sort by lead time' }).click()
  expect(await rowNames(page, 1)).toEqual([s.names.alpha, s.names.zeta, s.names.mid]) // 10 days, 3 weeks, 6 weeks
  await first.getByRole('button', { name: 'Sort by supplier' }).click()
  expect(await rowNames(page, 1)).toEqual([s.names.alpha, s.names.mid, s.names.zeta])
  await expect(page.getByTestId('statement-order-note')).toContainText('Nothing is selected or recommended')
})

test('Export PDF downloads an A4 landscape PDF named for the job', async ({ page }) => {
  const s = await seed()
  await openAs(page, 'sales', `/jobs/${s.rfq.number}/statement`)
  await expect(page.getByTestId('statement')).toBeVisible()
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.getByRole('button', { name: 'Export PDF' }).click()])
  expect(download.suggestedFilename()).toBe(`Comparative-statement-Job-${s.rfq.number}.pdf`)
  const bytes = readFileSync(await download.path())
  expect(bytes.subarray(0, 4).toString()).toBe('%PDF')
  const text = bytes.toString('latin1')
  expect(text).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+841\.89/)
  expect((text.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThanOrEqual(1)
  await expect(page.getByRole('status').filter({ hasText: 'Comparative statement exported' })).toBeVisible()
})

test('the job page links to the statement for sales; an engineer has no link and the page tells them why, asking for no price', async ({ page }) => {
  const s = await seed()
  await openAs(page, 'sales', `/jobs/${s.rfq.number}`)
  const link = page.getByTestId('open-statement')
  await expect(link).toBeVisible()
  await link.click()
  await expect(page).toHaveURL(new RegExp(`/jobs/${s.rfq.number}/statement$`))
  await expect(page.getByTestId('statement')).toBeVisible()

  // an engineer: no link on the job page, and the address itself shows a notice and asks the database for no price
  await openAs(page, 'engineer', `/jobs/${s.rfq.number}`)
  await page.waitForLoadState('networkidle')
  await expect(page.getByTestId('open-statement')).toHaveCount(0)
  const priced: string[] = []
  page.on('request', r => {
    const u = decodeURIComponent(r.url())
    if (u.includes('/rest/v1/') && /unit_price|weight/.test(u)) priced.push(u)
  })
  await page.goto(`/jobs/${s.rfq.number}/statement`)
  await expect(page.getByTestId('statement-no-access')).toContainText('The comparative statement is for admin and sales')
  await expect(page.getByTestId('statement')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Export PDF' })).toHaveCount(0)
  expect(priced).toEqual([])
})

test('the database refuses an engineer the prices, the weights and the whole table, and still lets them read what has no price', async () => {
  const s = await seed()
  const q = (select: string) => rest('engineer', `supplier_quote_lines?inquiry_id=eq.${s.inquiries.zeta}&select=${select}`)
  for (const select of ['unit_price', 'weight', 'weight_unit', 'unit_price,weight,weight_unit,currency', '*']) {
    const r = await q(select)
    expect([401, 403], `engineer select=${select} is refused, got ${r.status}`).toContain(r.status)
  }
  const ok = await q('id,currency,lead_time,origin')
  expect(ok.status).toBe(200)
  expect(ok.body as unknown[]).toHaveLength(2)
  // sales read them
  const sales = await rest<{ weight: number; weight_unit: string; origin: string }[]>('sales', `supplier_quote_lines?inquiry_id=eq.${s.inquiries.zeta}&weight=not.is.null&select=weight,weight_unit,origin`)
  expect(sales.status).toBe(200)
  expect(sales.body.map(r => [Number(r.weight), r.weight_unit, r.origin])).toEqual([[2.5, 'kg', 'Germany']])
  // and an engineer cannot write them
  const write = await rest('engineer', `supplier_quote_lines?inquiry_id=eq.${s.inquiries.zeta}`, { method: 'PATCH', body: { weight: 9 }, prefer: 'return=minimal' })
  expect([401, 403]).toContain(write.status)
})

test('weight and country of origin are typed beside the prices in the reply dialog, saved, and shown again', async ({ page }) => {
  const s = await seed()
  const name = s.names.silent
  await openAs(page, 'sales', `/jobs/${s.rfq.number}`)
  await page.getByRole('button', { name: `Enter reply, ${name}`, exact: true }).click()
  const d = page.getByRole('dialog')
  await d.getByLabel(`Price for item 1 from ${name}`).fill('250')
  await d.getByText('Weight and country of origin (optional)').click()
  await d.getByLabel(`Weight of one unit, item 1 from ${name}`).fill('1.25')
  await d.getByLabel(`Weight unit, item 1 from ${name}`).selectOption('lb')
  await d.getByLabel(`Country of origin, item 1 from ${name}`).fill('Italy')
  await d.getByRole('button', { name: 'Save reply' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Reply saved' })).toBeVisible()
  const rows = await must(rest<{ unit_price: number; weight: number | null; weight_unit: string; origin: string | null }[]>('admin', `supplier_quote_lines?inquiry_id=eq.${s.inquiries.silent}&select=unit_price,weight,weight_unit,origin`))
  expect(rows.map(r => [Number(r.unit_price), r.weight === null ? null : Number(r.weight), r.weight_unit, r.origin])).toEqual([[250, 1.25, 'lb', 'Italy']])

  // edited later from the same dialog, the saved values are there
  await page.getByRole('button', { name: `Edit reply, ${name}`, exact: true }).click()
  const again = page.getByRole('dialog')
  await expect(again.getByLabel(`Weight of one unit, item 1 from ${name}`)).toHaveValue('1.25')
  await expect(again.getByLabel(`Weight unit, item 1 from ${name}`)).toHaveValue('lb')
  await expect(again.getByLabel(`Country of origin, item 1 from ${name}`)).toHaveValue('Italy')
  await again.getByLabel(`Country of origin, item 1 from ${name}`).fill('Japan')
  await again.getByRole('button', { name: 'Save reply' }).click()
  await expect.poll(async () => (await must(rest<{ origin: string | null }[]>('admin', `supplier_quote_lines?inquiry_id=eq.${s.inquiries.silent}&select=origin`)))[0].origin).toBe('Japan')

  // and the statement shows it
  await page.goto(`/jobs/${s.rfq.number}/statement`)
  const row = page.locator('[data-statement-item="1"]').locator(`[data-statement-row="${name}"]`)
  await expect(row).toContainText('1.25 lb')
  await expect(row).toContainText('5 lb') // 4 x 1.25
  await expect(row).toContainText('Japan')
})

test('a pasted reply that gives a weight and a country of origin saves them with the price', async ({ page }) => {
  const customer = await createCompany(uniqueName('Kohsar Cement'))
  const rfq = await createRfq(customer.id, { due_on: karachiDay(6), customer_ref: `W${Math.floor(Math.random() * 90000 + 10000)}` })
  const [item] = await must(rest<{ id: string }[]>('admin', 'rfq_items', { method: 'POST', body: { rfq_id: rfq.id, position: 0, description: 'Ultrasonic flowmeter RST 1158S', qty: 2, unit: 'nos' } }))
  const rhein = await createCompany(`Rhein Automation ${Date.now().toString(36)}`, { country: 'Germany' })
  const inquiry = (await must(rest<{ id: string }[]>('admin', 'supplier_inquiries', { method: 'POST', body: { rfq_id: rfq.id, supplier_id: rhein.id, sent_on: karachiDay(-2) } })))[0]
  await openAs(page, 'sales', `/jobs/${rfq.number}`)
  await expect(page.getByRole('region', { name: 'Add to this job' })).toBeVisible()
  const message = [`${rhein.name.split(' ').slice(0, 2).join(' ')}: dear Ayesha, our offer`, '1) Ultrasonic flowmeter RST 1158S EUR 3610 - 8 weeks, net wt 4.5 kg, made in Germany'].join('\n')
  await page.evaluate(t => {
    const dt = new DataTransfer()
    dt.setData('text/plain', t)
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, message)
  await expect(page.getByTestId('guess-line')).toHaveText(`Supplier price from ${rhein.name}`)
  await page.getByRole('button', { name: /^Accept \d+ prices?$/ }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Reply saved' })).toBeVisible()
  const rows = await must(rest<{ rfq_item_id: string; unit_price: number; weight: number | null; weight_unit: string; origin: string | null }[]>('admin', `supplier_quote_lines?inquiry_id=eq.${inquiry.id}&select=rfq_item_id,unit_price,weight,weight_unit,origin`))
  expect(rows.map(r => [r.rfq_item_id, Number(r.unit_price), r.weight === null ? null : Number(r.weight), r.weight_unit, r.origin])).toEqual([[item.id, 3610, 4.5, 'kg', 'Germany']])
})
