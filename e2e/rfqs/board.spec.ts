import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { expect, test, type Page } from '@playwright/test'
import { createCompany, karachiDay, must, openAs, review, rest, rfqRef, uniqueName } from '../support/stack'

/*
 * R06 end to end, against the local CI stack: the RFQ board over a fixture set of RFQs spread across the
 * sourcing, clarification and bid states, with axe at 1440 and 375 and the review screenshots.
 * Other suites share this database, so every assertion looks at the fixture's own rows (by their unique
 * company names), never at the whole table.
 */
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')

async function axeViolations(page: Page): Promise<string[]> {
  await page.evaluate(axeSource)
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: Document, opts: object) => Promise<{ violations: Array<{ id: string; impact: string | null; help: string; nodes: Array<{ target: unknown; failureSummary?: string }> }> }> } }).axe
    const result = await axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
      resultTypes: ['violations'],
    })
    return result.violations.flatMap(v => v.nodes.map(n => `${v.id} (${v.impact}) ${JSON.stringify(n.target)}: ${(n.failureSummary ?? v.help).replace(/\s+/g, ' ')}`))
  })
}

interface Fx {
  tag: string
  ids: Record<string, string>
  numbers: Record<string, number>
  names: Record<string, string>
}
const fx: Fx = { tag: '', ids: {}, numbers: {}, names: {} }
let sales = ''
let admin = ''
let closedTotalAtLeast = 0

async function seed() {
  const users = await must(rest<{ id: string; role: string }[]>('admin', 'users?select=id,role'))
  sales = users.find(u => u.role === 'sales')!.id
  admin = users.find(u => u.role === 'admin')!.id
  fx.tag = Math.random().toString(36).slice(2, 6)
  const supplier = await createCompany(uniqueName('R06 Supplier'))
  const day = (n: number) => karachiDay(n)

  const make = async (key: string, owner: string, extra: Record<string, unknown>, items = 1) => {
    const name = `Board ${key} ${fx.tag}`
    const company = await createCompany(name)
    const rfq = (await must(rest<{ id: string; number: number }[]>('admin', 'rfqs', { method: 'POST', body: { company_id: company.id, owner_id: owner, ...extra } })))[0]
    const itemRows = await must(
      rest<{ id: string }[]>('admin', 'rfq_items', {
        method: 'POST',
        body: Array.from({ length: items }, (_, i) => ({ rfq_id: rfq.id, position: i, description: `Item ${i + 1} of ${key}`, qty: 1 })),
      }),
    )
    fx.ids[key] = rfq.id
    fx.numbers[key] = rfq.number
    fx.names[key] = name
    return { rfq, itemRows }
  }
  const inquire = async (rfqId: string, body: Record<string, unknown>) =>
    (await must(rest<{ id: string }[]>('admin', 'supplier_inquiries', { method: 'POST', body: { rfq_id: rfqId, supplier_id: supplier.id, ...body } })))[0]
  const price = (inquiryId: string, itemId: string) =>
    must(rest('admin', 'supplier_quote_lines', { method: 'POST', body: { inquiry_id: inquiryId, rfq_item_id: itemId, unit_price: 120, currency: 'USD' } }))

  // Same due date, one priority: the priority RFQ must come first even though it has the higher number.
  await make('plain', sales, { due_on: day(-3), customer_ref: `BRD-${fx.tag}-A` })
  await make('priority', sales, { due_on: day(-3), is_priority: true, customer_ref: `BRD-${fx.tag}-P` })
  const awaiting = await make('awaiting', sales, { due_on: day(2) })
  await inquire(awaiting.rfq.id, { sent_on: day(0) })
  const nooffer = await make('nooffer', sales, { due_on: day(12) })
  await inquire(nooffer.rfq.id, { no_offer_on: day(0) })
  // Admin's: partly covered with a customer question waiting, and covered with the bid sent.
  const partly = await make('partly', admin, { due_on: day(5) }, 2)
  const pi = await inquire(partly.rfq.id, { sent_on: day(-4) })
  await price(pi.id, partly.itemRows[0].id)
  await must(
    rest('admin', 'clarifications', {
      method: 'POST',
      body: { rfq_id: partly.rfq.id, question: 'Which range?', first_asked_at: new Date(Date.now() - 3 * 86_400_000).toISOString(), last_asked_at: new Date(Date.now() - 3 * 86_400_000).toISOString(), ask_count: 1 },
    }),
  )
  const covered = await make('covered', admin, { due_on: day(9), quoted_on: day(-1) })
  const ci = await inquire(covered.rfq.id, { sent_on: day(-5) })
  await price(ci.id, covered.itemRows[0].id)
  await make('toask', admin, {})
  await must(rest('admin', 'clarifications', { method: 'POST', body: { rfq_id: fx.ids.toask, question: 'Voltage?' } }))

  // 27 closed RFQs: one more than a page.
  const closedCompany = await createCompany(`Board closed ${fx.tag}`)
  await must(
    rest('admin', 'rfqs', {
      method: 'POST',
      body: Array.from({ length: 27 }, () => ({ company_id: closedCompany.id, owner_id: admin, closed_on: day(-1), close_reason: 'price' })),
    }),
  )
  closedTotalAtLeast = 27
}

const row = (page: Page, key: string) => page.getByRole('row').filter({ hasText: fx.names[key] })

test.beforeAll(async () => {
  test.setTimeout(120_000)
  await seed()
})

test.describe('open RFQs', () => {
  test('sales lands on Mine, ordered by due date then priority, with the state chips', async ({ page }) => {
    await openAs(page, 'sales', '/rfqs')
    await expect(page.getByRole('heading', { name: 'RFQs', level: 1 })).toBeVisible()
    await expect(page.getByRole('radio', { name: /^Mine/ })).toBeChecked()
    await expect(row(page, 'priority')).toBeVisible()

    // Our fixture rows, in on-screen order: priority before plain (same due date), then +2 days, then +12.
    const names = await page.getByRole('table', { name: 'Open RFQs' }).locator('tbody tr[data-di]').allInnerTexts()
    const ours = names.map(t => Object.keys(fx.names).find(k => t.includes(fx.names[k]))).filter(Boolean)
    expect(ours).toEqual(['priority', 'plain', 'awaiting', 'nooffer'])

    // The admin's RFQs are not on Mine.
    await expect(row(page, 'partly')).toHaveCount(0)

    const overdue = row(page, 'priority')
    await expect(overdue.getByText('3 days overdue')).toHaveClass(/text-tone-danger-fg/)
    await expect(overdue.getByText('Not floated', { exact: true })).toBeVisible()
    await expect(overdue).toContainText(rfqRef(fx.numbers.priority))
    await expect(overdue).toContainText(`their ref BRD-${fx.tag}-P`)
    await expect(row(page, 'awaiting').getByText('Awaiting offers')).toBeVisible()
    await expect(row(page, 'nooffer').getByText('No offer anywhere')).toBeVisible()
    await review(page, 'board-mine-1440')
  })

  test('All shows everyone, with coverage, question and bid chips', async ({ page }) => {
    await openAs(page, 'sales', '/rfqs')
    await page.getByRole('radio', { name: /^All/ }).click()
    const partly = row(page, 'partly')
    await expect(partly.getByText('Partly covered')).toBeVisible()
    await expect(partly.getByText('1 of 2')).toBeVisible()
    await expect(partly.getByText('Waiting on customer')).toBeVisible()
    await expect(partly.getByText('To bid', { exact: true })).toBeVisible()
    const covered = row(page, 'covered')
    await expect(covered.getByText('Covered', { exact: true })).toBeVisible()
    await expect(covered.getByText('Bid sent', { exact: true })).toBeVisible()
    await expect(row(page, 'toask').getByText('To ask', { exact: true })).toBeVisible()
    await expect(row(page, 'partly').getByRole('img', { name: /./ }).first()).toBeVisible() // owner avatar
    await review(page, 'board-all-1440')
  })

  test('the state filter narrows the rows and its counts follow the owner switch', async ({ page }) => {
    await openAs(page, 'admin', '/rfqs') // admin opens on All
    await expect(page.getByRole('radio', { name: /^All/ }).first()).toBeChecked()
    await page.getByRole('radio', { name: /^Covered/ }).click()
    await expect(row(page, 'covered')).toBeVisible()
    await expect(row(page, 'awaiting')).toHaveCount(0)
    await expect(page).toHaveURL(/state=covered/)
    await review(page, 'board-state-covered-1440')

    await page.getByRole('radio', { name: /^Out for offers/ }).click()
    await expect(row(page, 'awaiting')).toBeVisible()
    await expect(row(page, 'partly')).toBeVisible()
    await expect(row(page, 'covered')).toHaveCount(0)

    // The count on the segment equals the rows the filter shows.
    const label = await page.getByRole('radio', { name: /^Out for offers/ }).innerText()
    const n = Number(/(\d+)\s*$/.exec(label.trim())?.[1])
    await expect(page.getByRole('table', { name: 'Open RFQs' }).locator('tbody tr[data-di]')).toHaveCount(n)
  })

  test('a row opens the RFQ at /rfqs/:id', async ({ page }) => {
    await openAs(page, 'engineer', '/rfqs')
    await row(page, 'covered').getByRole('link', { name: fx.names.covered }).click()
    await expect(page).toHaveURL(new RegExp(`/rfqs/${fx.ids.covered}$`))
    await expect(page.getByTestId('rfq-id')).toHaveText(fx.ids.covered)
  })

  test('Mine with nothing assigned reads as done, and offers everyone’s RFQs', async ({ page }) => {
    await openAs(page, 'engineer', '/rfqs?owner=mine')
    await expect(page.getByText('None of your RFQs are open. Nice.')).toBeVisible()
    await review(page, 'board-mine-empty-1440')
    await page.getByRole('button', { name: /Show everyone/ }).click()
    await expect(row(page, 'covered')).toBeVisible()
  })
})

test.describe('closed and won', () => {
  test('pages through closed RFQs 25 at a time', async ({ page }) => {
    await openAs(page, 'sales', '/rfqs')
    await page.getByRole('tab', { name: /Closed and won/ }).click()
    await expect(page).toHaveURL(/tab=closed/)
    await expect(page.getByText(/^Showing 1 to 25 of \d+$/)).toBeVisible()
    const body = page.getByRole('table', { name: 'Closed and won RFQs' }).locator('tbody tr[data-di]')
    await expect(body).toHaveCount(25)
    await expect(body.first()).toContainText('Closed')
    await expect(body.first()).toContainText('Price')
    await expect(page.getByRole('button', { name: 'Previous' })).toBeDisabled()
    await review(page, 'board-closed-1440')

    const total = Number(/of (\d+)$/.exec((await page.getByText(/^Showing 1 to 25 of \d+$/).innerText()).trim())?.[1])
    expect(total).toBeGreaterThanOrEqual(closedTotalAtLeast)
    await page.getByRole('button', { name: 'Next' }).click()
    await expect(page).toHaveURL(/page=2/)
    await expect(page.getByText(new RegExp(`^Showing 26 to ${Math.min(50, total)} of ${total}$`))).toBeVisible()
    await page.getByRole('button', { name: 'Previous' }).click()
    await expect(page.getByText(/^Showing 1 to 25 of/)).toBeVisible()
  })
})

test.describe('palette', () => {
  test('finds an RFQ by number, by the customer ref and by company name', async ({ page }) => {
    await openAs(page, 'sales', '/today')
    for (const [text, key] of [
      [String(fx.numbers.awaiting), 'awaiting'],
      [`BRD-${fx.tag}-P`, 'priority'],
      [fx.names.covered, 'covered'],
    ] as const) {
      await page.keyboard.press('Control+k')
      await page.getByRole('combobox').fill(text)
      const hit = page.getByRole('option', { name: new RegExp(`${rfqRef(fx.numbers[key])} ${fx.names[key]}`) })
      await expect(hit).toBeVisible()
      if (key === 'priority') await review(page, 'board-palette-1440')
      await hit.click()
      await expect(page).toHaveURL(new RegExp(`/rfqs/${fx.ids[key]}$`))
    }
  })
})

test.describe('loading, empty and error states', () => {
  test('goal state: nothing open', async ({ page }) => {
    await page.route(/\/rest\/v1\/(v_rfq_state|rfqs)\?.*(outcome=eq\.open|closed_on=is\.null)/, route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await openAs(page, 'admin', '/rfqs')
    await expect(page.getByText('No open RFQs. Nice.')).toBeVisible()
    await review(page, 'board-empty-1440')
    expect(await axeViolations(page)).toEqual([])
  })

  test('loading shows skeleton rows, not a blank page', async ({ page }) => {
    await page.route(/\/rest\/v1\/v_rfq_state\?.*outcome=eq\.open/, async route => {
      await new Promise(r => setTimeout(r, 2500))
      await route.continue()
    })
    await openAs(page, 'admin', '/rfqs')
    await expect(page.getByRole('table', { name: 'Open RFQs' })).toBeVisible()
    await expect(page.locator('.skeleton').first()).toBeVisible()
    await review(page, 'board-loading-1440')
    await expect(row(page, 'covered')).toBeVisible({ timeout: 15_000 })
  })

  test('error says nothing was changed and Try again recovers', async ({ page }) => {
    let fail = true
    await page.route(/\/rest\/v1\/v_rfq_state\?.*outcome=eq\.open/, route =>
      fail ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'down' }) }) : route.continue(),
    )
    await openAs(page, 'admin', '/rfqs')
    await expect(page.getByText("Couldn't load the RFQs")).toBeVisible()
    await review(page, 'board-error-1440')
    fail = false
    await page.getByRole('button', { name: /Try again/ }).click()
    await expect(row(page, 'covered')).toBeVisible()
  })
})

test.describe('accessibility (axe, WCAG 2.2 AA)', () => {
  for (const [w, h] of [
    [1440, 900],
    [375, 812],
  ] as const) {
    test(`open board and closed tab at ${w}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h })
      await openAs(page, 'sales', '/rfqs?owner=all')
      await expect(row(page, 'covered')).toBeVisible()
      if (w === 375) await review(page, 'board-375')
      expect(await axeViolations(page)).toEqual([])

      await page.getByRole('tab', { name: /Closed and won/ }).click()
      await expect(page.getByRole('table', { name: 'Closed and won RFQs' }).locator('tbody tr[data-di]').first()).toBeVisible()
      if (w === 375) await review(page, 'board-closed-375')
      expect(await axeViolations(page)).toEqual([])
    })
  }
})
