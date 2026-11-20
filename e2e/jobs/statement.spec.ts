import { readFileSync } from 'node:fs'
import { read, utils } from 'xlsx'
import { expect, test, type Page } from '@playwright/test'
import { createCompany, createRfq, karachiDay, must, openAs, rest, uniqueName } from '../support/stack'

/*
 * The Comparative Statement (owner request, 2026-10-29): one section per item, one row per supplier that quoted it, with cost, lead
 * time, weight and country of origin. Since 2026-11-16 (owner) it is only downloaded, as an Excel file or an A4 landscape PDF, from the
 * job page; the old /jobs/<n>/statement address opens the job page. It SELECTS NOTHING (no "cheapest", no
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
        { inquiry_id: inquiries.zeta, rfq_item_id: items[1].id, unit_price: 40, currency: 'USD', lead_time: 'ex-stock', weight: null, weight_unit: 'kg', origin: null },
        { inquiry_id: inquiries.alpha, rfq_item_id: items[0].id, unit_price: 9000, currency: 'PKR', lead_time: '10 days', weight: 400, weight_unit: 'g', origin: 'China' },
        { inquiry_id: inquiries.mid, rfq_item_id: items[0].id, unit_price: 95.5, currency: 'EUR', lead_time: '6 weeks', weight: 6, weight_unit: 'lb', origin: null },
      ],
      prefer: 'return=minimal',
    }),
  )
  return { rfq, customer, items, names: { zeta: zeta.name, alpha: alpha.name, mid: mid.name, silent: silent.name }, inquiries }
}

/**
 * Downloads the statement as Excel from the job page and reads its "Details" sheet back as rows (header: 1, blanks as null). The
 * first sheet, "Side by side" (owner, 20 Nov 2026), has one row per item and a column pair per supplier: its supplier headings are
 * checked here to be in name order.
 */
async function downloadExcel(page: Page, jobNumber: number): Promise<unknown[][]> {
  const box = page.getByTestId('statement-downloads')
  await expect(box.getByRole('button', { name: 'Download Excel' })).toBeEnabled()
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), box.getByRole('button', { name: 'Download Excel' }).click()])
  expect(download.suggestedFilename()).toBe(`Comparative-statement-Job-${jobNumber}.xlsx`)
  const bytes = readFileSync(await download.path())
  expect(bytes.subarray(0, 2).toString()).toBe('PK') // a real .xlsx (a zip), not a CSV
  const wb = read(bytes, { type: 'buffer' })
  expect(wb.SheetNames).toEqual(['Side by side', 'Details'])
  const side = utils.sheet_to_json<unknown[]>(wb.Sheets['Side by side'], { header: 1, blankrows: true, defval: null })
  const head = side.find(r => r[0] === 'No.') ?? []
  expect(head.slice(0, 6)).toEqual(['No.', 'Item', 'Brand', 'Part / model', 'Qty', 'Unit'])
  const suppliers = head.slice(6).filter((x): x is string => typeof x === 'string')
  expect(suppliers).toEqual([...suppliers].sort((x, y) => x.localeCompare(y, 'en', { sensitivity: 'base' })))
  return utils.sheet_to_json<unknown[]>(wb.Sheets['Details'], { header: 1, blankrows: true, defval: null })
}

// The grid's columns in the Excel file (src/features/statement/excel/workbook.ts COLUMNS).
const C = { no: 0, item: 1, qty: 3, unit: 4, supplier: 5, currency: 6, unitCost: 7, total: 8, lead: 9, weight: 10, totalWeight: 11, origin: 12, note: 13 }

for (const role of ['sales', 'admin'] as const) {
  test(`${role}: the job page has only the two downloads; the Excel file has one row per quote, suppliers in name order, totals per currency, and selects nothing`, async ({ page }) => {
    const s = await seed()
    await openAs(page, role, `/jobs/${s.rfq.number}`)
    const box = page.getByTestId('statement-downloads')
    await expect(box.getByRole('heading', { name: 'Comparative statement' })).toBeVisible()
    await expect(box.getByRole('button')).toHaveText(['Download Excel', 'Download PDF'])
    await expect(page.locator('[data-statement-item], [data-statement-row], [data-testid="statement"]')).toHaveCount(0) // no table on screen
    await expect(page.getByTestId('open-statement')).toHaveCount(0)

    const rows = await downloadExcel(page, s.rfq.number)
    expect(rows[3][0]).toBe('Comparative statement')
    expect(rows[4][0]).toBe(`Job / RFQ: Job ${s.rfq.number} (RFQ-${String(s.rfq.number).padStart(4, '0')})`)
    expect(rows[5][0]).toBe(`Customer: ${s.customer.name}`)
    expect(rows[9]).toEqual(['No.', 'Item', 'Specification', 'Qty', 'Unit', 'Supplier', 'Currency', 'Unit cost', 'Total cost', 'Lead time', 'Unit weight', 'Total weight', 'Country of origin', 'Note'])
    const quotes = (n: number) => rows.slice(10).filter(r => r[C.no] === n && r[C.supplier] !== null)
    // by supplier name, A to Z (Alpha, Mid, Zeta), though Zeta quoted both items
    expect(quotes(1).map(r => r[C.supplier])).toEqual([s.names.alpha, s.names.mid, s.names.zeta])
    expect(quotes(2).map(r => r[C.supplier])).toEqual([s.names.zeta])
    // cost, lead time, weight and origin of one row, numbers as numbers
    const zeta = quotes(1)[2]
    expect([zeta[C.item], zeta[C.qty], zeta[C.unit], zeta[C.currency], zeta[C.unitCost], zeta[C.total], zeta[C.lead], zeta[C.weight], zeta[C.totalWeight], zeta[C.origin]]).toEqual([
      'Pressure transmitter 0-10 bar, 4-20 mA', 4, 'pcs', 'USD', 100, 400, '3 weeks', 2.5, 10, 'Germany',
    ])
    expect([quotes(1)[0][C.currency], quotes(1)[0][C.unitCost], quotes(1)[0][C.total], quotes(1)[0][C.weight]]).toEqual(['PKR', 9000, 36000, 400])
    expect([quotes(1)[1][C.currency], quotes(1)[1][C.weight], quotes(1)[1][C.origin]]).toEqual(['EUR', 6, null])
    expect(quotes(2)[0][C.qty]).toBe(2.5)
    // the suppliers that did not reply or did not quote are one line under the item, not quote rows
    const notes = (n: number) => rows.slice(10).filter(r => r[C.no] === n && r[C.supplier] === null).map(r => r[C.note])
    expect(notes(1)).toEqual([`No reply: ${s.names.silent}`])
    expect(notes(2)).toEqual([`No reply: ${s.names.silent}. Did not quote: ${s.names.alpha}, ${s.names.mid}`])
    // totals: per supplier, each in its own currency, never added across currencies
    const at = rows.findIndex(r => r[C.item] === 'Totals by supplier')
    const totals = rows.slice(at + 2).filter(r => r[C.supplier] !== null)
    expect(totals.map(r => [r[C.supplier], r[C.currency], r[C.total], r[C.lead]])).toEqual([
      [s.names.alpha, 'PKR', 36000, '1 of 2'],
      [s.names.mid, 'EUR', 382, '1 of 2'],
      [s.names.zeta, 'USD', 500, '2 of 2'], // 4 x 100 + 2.5 x 40
    ])
    // no mark, no recommendation
    expect(JSON.stringify(rows)).not.toMatch(/cheap|lowest|best|recommend|winner|preferred/i)
    await expect(page.getByRole('status').filter({ hasText: 'Comparative statement downloaded' })).toBeVisible()
  })
}

test('Download PDF downloads an A4 landscape PDF named for the job', async ({ page }) => {
  const s = await seed()
  await openAs(page, 'sales', `/jobs/${s.rfq.number}`)
  const button = page.getByTestId('statement-downloads').getByRole('button', { name: 'Download PDF' })
  await expect(button).toBeEnabled()
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), button.click()])
  expect(download.suggestedFilename()).toBe(`Comparative-statement-Job-${s.rfq.number}.pdf`)
  const bytes = readFileSync(await download.path())
  expect(bytes.subarray(0, 4).toString()).toBe('%PDF')
  const text = bytes.toString('latin1')
  expect(text).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+841\.89/)
  expect((text.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThanOrEqual(1)
  await expect(page.getByRole('status').filter({ hasText: 'Comparative statement downloaded' })).toBeVisible()
})

test('the old statement address opens the job page; an engineer has no downloads and asks for no price', async ({ page }) => {
  const s = await seed()
  await openAs(page, 'sales', `/jobs/${s.rfq.number}/statement`)
  await expect(page).toHaveURL(new RegExp(`/jobs/${s.rfq.number}$`))
  await expect(page.getByTestId('statement-downloads').getByRole('button')).toHaveText(['Download Excel', 'Download PDF'])

  // an engineer: no downloads on the job page, and the old address asks the database for no price either
  await page.context().clearCookies()
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  const priced: string[] = []
  page.on('request', r => {
    const u = decodeURIComponent(r.url())
    if (u.includes('/rest/v1/') && /unit_price|weight/.test(u)) priced.push(u)
  })
  await openAs(page, 'engineer', `/jobs/${s.rfq.number}`)
  await page.waitForLoadState('networkidle')
  await expect(page.locator('[data-slot="items"]')).toBeVisible()
  await expect(page.getByTestId('statement-downloads')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Download (Excel|PDF)$/ })).toHaveCount(0)
  await page.goto(`/jobs/${s.rfq.number}/statement`)
  await expect(page).toHaveURL(new RegExp(`/jobs/${s.rfq.number}$`))
  await page.waitForLoadState('networkidle')
  await expect(page.getByTestId('statement-downloads')).toHaveCount(0)
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
  await d.getByLabel(`Lead time, item 1 from ${name}`).fill('3 weeks')
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

  // and the statement's Excel file has it
  const sheet = await downloadExcel(page, s.rfq.number)
  const row = sheet.slice(10).find(r => r[C.no] === 1 && r[C.supplier] === name)
  expect([row?.[C.unitCost], row?.[C.weight], row?.[C.totalWeight], row?.[C.origin]]).toEqual([250, 1.25, 5, 'Japan'])
})

test('a pasted reply that gives a weight and a country of origin saves them with the price', async ({ page }) => {
  const customer = await createCompany(uniqueName('Kohsar Cement'))
  const rfq = await createRfq(customer.id, { due_on: karachiDay(6), customer_ref: `W${Math.floor(Math.random() * 90000 + 10000)}` })
  const [item, second] = await must(
    rest<{ id: string }[]>('admin', 'rfq_items', {
      method: 'POST',
      body: [
        { rfq_id: rfq.id, position: 0, description: 'Ultrasonic flowmeter RST 1158S', qty: 2, unit: 'nos' },
        { rfq_id: rfq.id, position: 1, description: 'Clamp-on transducer pair DN50', qty: 2, unit: 'nos' },
      ],
    }),
  )
  const rhein = await createCompany(`Rhein Automation ${Date.now().toString(36)}`, { country: 'Germany' })
  const inquiry = (await must(rest<{ id: string }[]>('admin', 'supplier_inquiries', { method: 'POST', body: { rfq_id: rfq.id, supplier_id: rhein.id, sent_on: karachiDay(-2) } })))[0]
  await openAs(page, 'sales', `/jobs/${rfq.number}`)
  await page.getByRole('button', { name: /^Add to this job/ }).click()
  await expect(page.getByRole('region', { name: 'Add to this job' })).toBeVisible()
  const message = [`${rhein.name.split(' ').slice(0, 2).join(' ')}: dear Ayesha, our offer`, '1) Ultrasonic flowmeter RST 1158S EUR 3610 - 8 weeks, net wt 4.5 kg, made in Germany', '2) Clamp-on transducer pair DN50 EUR 980 - 8 weeks, net wt 900 g'].join('\n')
  await page.evaluate(t => {
    const dt = new DataTransfer()
    dt.setData('text/plain', t)
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, message)
  await expect(page.getByTestId('guess-line')).toHaveText(`Supplier price from ${rhein.name}`)
  await page.getByRole('button', { name: /^Accept \d+ prices?$/ }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Reply saved' })).toBeVisible()
  const rows = await must(rest<{ rfq_item_id: string; unit_price: number; weight: number | null; weight_unit: string; origin: string | null }[]>('admin', `supplier_quote_lines?inquiry_id=eq.${inquiry.id}&select=rfq_item_id,unit_price,weight,weight_unit,origin&order=unit_price.desc`))
  expect(rows.map(r => [r.rfq_item_id, Number(r.unit_price), r.weight === null ? null : Number(r.weight), r.weight_unit, r.origin])).toEqual([
    [item.id, 3610, 4.5, 'kg', 'Germany'],
    [second.id, 980, 900, 'g', null],
  ])
})

for (const [w, h] of [[320, 640], [375, 812], [1440, 900]] as const) {
  test(`at ${w} px the two downloads fit inside the page and the Issue quotation dialog (stacked on a phone, one row on desktop): no sideways scroll`, async ({ page }) => {
    const s = await seed()
    await page.setViewportSize({ width: w, height: h })
    await openAs(page, 'sales', `/jobs/${s.rfq.number}`)
    const box = page.getByTestId('statement-downloads')
    const excel = await box.getByRole('button', { name: 'Download Excel' }).boundingBox()
    const pdf = await box.getByRole('button', { name: 'Download PDF' }).boundingBox()
    expect(excel && pdf).toBeTruthy()
    if (w >= 768) {
      expect(Math.abs((excel?.y ?? 0) - (pdf?.y ?? 1))).toBeLessThanOrEqual(1) // one row, Excel then PDF
      expect(pdf?.x ?? 0).toBeGreaterThan(excel?.x ?? 0)
    } else {
      expect(pdf?.y ?? 0).toBeGreaterThan((excel?.y ?? 0) + (excel?.height ?? 0) - 1) // stacked, PDF under Excel, same width
      expect(Math.abs((pdf?.width ?? 0) - (excel?.width ?? 1))).toBeLessThanOrEqual(1)
    }
    for (const b of [excel, pdf]) {
      expect(b?.x ?? -1).toBeGreaterThanOrEqual(0)
      expect((b?.x ?? 0) + (b?.width ?? w + 1)).toBeLessThanOrEqual(w)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
    await box.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `review-shots/statement-export/job-page-${w}.png` })

    // the Issue quotation dialog: one compact line with the same two downloads, inside the dialog
    await page.goto(`/jobs/${s.rfq.number}?issue=1`)
    const inline = page.getByRole('dialog').getByTestId('statement-downloads')
    await expect(inline.getByRole('button')).toHaveText(['Download Excel', 'Download PDF'])
    const dialogBox = await page.getByRole('dialog').boundingBox()
    for (const name of ['Download Excel', 'Download PDF']) {
      const b = await inline.getByRole('button', { name }).boundingBox()
      expect((b?.x ?? 0) + (b?.width ?? 0)).toBeLessThanOrEqual((dialogBox?.x ?? 0) + (dialogBox?.width ?? w))
    }
    await inline.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `review-shots/statement-export/issue-quotation-${w}.png` })
  })
}
