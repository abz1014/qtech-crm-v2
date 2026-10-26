import { expect, test, type Page } from '@playwright/test'
import { openAs } from '../support/stack'
import { seedWorld, type World } from './fixtures'
import { moneyKeysIn, service } from './lib'
import { CURRENCY_AMOUNT, ENGINEER_MONEY_WORDS, GST_AMOUNT, MONEY_REQUEST } from './routes'

/*
 * Engineer price safety on the screens and calls the redesign added (verify-roles; owner decision 2026-10-22: no price, rate,
 * total, GST or PKR amount reaches an engineer, in the DOM or in the network):
 *   - the command palette, which now also finds jobs (and, for the office, invoice numbers, customer POs and quotations)
 *   - the Jobs list, a Job page, the Job page with a priced file on it, and New enquiry
 *   - the one search the Jobs box and Ctrl K share (it must not reveal an invoice, a customer PO or a priced file by its number)
 * Every JSON answer the browser receives is scanned for a money-looking key with a value, and every request for a money table,
 * view or function is a failure. The crawl in roles.spec.ts covers every route; this file goes deeper where a search or a file
 * could leak by content.
 */
let world: World
let po: string

test.setTimeout(300_000)

test.beforeAll(async () => {
  world = await seedWorld('ES')
  // A customer PO on the enquiry, tagged has_prices as the app tags it (0100): an engineer must not even see its name.
  po = `customer-order-${world.tag}.pdf`
  const row = await service('/rest/v1/attachments', {
    method: 'POST',
    body: { bucket: 'rfq-files', path: `${world.tag}/${po}`, file_name: po, mime_type: 'application/pdf', size_bytes: 24, rfq_id: world.rfq.id, has_prices: true },
    prefer: 'return=representation',
  })
  expect(row.status, 'fixture priced file').toBeLessThan(300)
})

interface Watch {
  leaks: string[]
  requests: string[]
}

function watch(page: Page): Watch {
  const w: Watch = { leaks: [], requests: [] }
  page.on('request', r => {
    const u = r.url()
    if (/\/rest\/v1\//.test(u) && MONEY_REQUEST.test(new URL(u).pathname)) w.requests.push(`${r.method()} ${new URL(u).pathname}`)
  })
  page.on('response', async r => {
    const u = new URL(r.url())
    if (!/\/rest\/v1\//.test(u.pathname) || !(r.headers()['content-type'] ?? '').includes('json')) return
    const body = await r.json().catch(() => null)
    // items_total is a COUNT of items (v_rfq_state), not an amount
    for (const key of moneyKeysIn(body)) if (!/\.items_total$/.test(key)) w.leaks.push(`${u.pathname}${key}`)
  })
  return w
}

const moneyIn = (text: string): string[] => [
  ...(text.match(new RegExp(ENGINEER_MONEY_WORDS.source, 'g')) ?? []).map(x => `word "${x}"`),
  ...(text.match(new RegExp(CURRENCY_AMOUNT.source, 'g')) ?? []).map(x => `amount "${x}"`),
  ...(text.match(GST_AMOUNT) ?? []).map(x => `gst "${x}"`),
]

async function openPalette(page: Page) {
  await page.locator('#main').waitFor()
  await expect(async () => {
    if (!(await page.getByRole('dialog', { name: 'Search or jump to' }).isVisible())) await page.keyboard.press('Control+k')
    await expect(page.getByRole('dialog', { name: 'Search or jump to' })).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 10_000 })
}

test('engineer: the palette finds the job and the customer, and shows no invoice, no customer PO and no money', async ({ page }) => {
  const w = watch(page)
  await openAs(page, 'engineer', '/todo')
  await openPalette(page)
  const input = page.getByRole('combobox')
  const dialog = page.getByRole('dialog', { name: 'Search or jump to' })

  await input.fill(`Job ${world.rfq.number}`)
  await expect(page.getByRole('option', { name: new RegExp(`Job ${world.rfq.number} · ${world.company.name}`) })).toBeVisible()
  expect(moneyIn(await dialog.innerText()), 'the job row').toEqual([])

  await input.fill(world.company.name)
  await expect(page.getByRole('option', { name: new RegExp(world.company.name) }).first()).toBeVisible()
  expect(moneyIn(await dialog.innerText()), 'the customer rows').toEqual([])

  // The office finds an invoice or a customer PO by its number; an engineer must get nothing for them, not even the order they sit on.
  for (const secret of [`INV-${world.tag}`, `${world.tag}-PO`]) {
    const answered = page.waitForResponse(r => r.url().includes('/rpc/search_all') && (r.request().postData() ?? '').includes(secret))
    await input.fill(secret)
    await answered
    // the palette's own "Add “…” as a new company" action echoes the typed text: that is not a finding
    const found = dialog.getByRole('option').filter({ hasNotText: /as a new company|^New RFQ for/ })
    await expect(found, `engineer: "${secret}" finds nothing (no invoice, no order)`).toHaveCount(0)
  }
  expect(w.requests, 'no request for a money table, view or function').toEqual([])
  expect([...new Set(w.leaks)], 'no money key with a value in any answer').toEqual([])
})

test('engineer: Jobs list and Job page show no amount, no money word, and not the priced file', async ({ page }) => {
  const w = watch(page)
  await openAs(page, 'engineer', `/jobs?q=${encodeURIComponent(world.tag)}`)
  await expect(page.getByRole('row', { name: new RegExp(`Job ${world.rfq.number}\\b`) }).first()).toBeVisible()
  expect(moneyIn(await page.locator('#main').innerText()), 'Jobs list').toEqual([])

  await page.goto(`/jobs/${world.rfq.number}`)
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`Job ${world.rfq.number}`)
  await page.waitForLoadState('networkidle').catch(() => undefined)
  const text = await page.locator('#main').innerText()
  expect(moneyIn(text), 'Job page').toEqual([])
  expect(text, 'the customer PO file is hidden from an engineer (has_prices)').not.toContain(po)
  expect(text, 'the customer PO number is not shown').not.toContain(`${world.tag}-PO`)
  await expect(page.getByRole('region', { name: 'Money for this job' })).toHaveCount(0)
  expect(w.requests, 'no request for a money table, view or function').toEqual([])
  expect([...new Set(w.leaks)], 'no money key with a value in any answer').toEqual([])
})

test('admin sees the same file on the Job page, with the toggle', async ({ page }) => {
  await openAs(page, 'admin', `/jobs/${world.rfq.number}`)
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`Job ${world.rfq.number}`)
  await expect(page.getByText(po)).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Has prices: hide from engineers' }).first()).toBeChecked()
})

test('engineer: New enquiry opens with no price anywhere', async ({ page }) => {
  const w = watch(page)
  await openAs(page, 'engineer', '/enquiries/new')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.waitForLoadState('networkidle').catch(() => undefined)
  expect(moneyIn(await page.locator('#main').innerText()), 'New enquiry').toEqual([])
  expect(w.requests).toEqual([])
  expect([...new Set(w.leaks)]).toEqual([])
})
