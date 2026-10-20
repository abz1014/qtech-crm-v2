import { expect, test, type Page } from '@playwright/test'
import { createCompany, karachiDay, must, openAs, review, rest, rfqRef, uniqueName } from '../support/stack'
import { axeViolations } from '../support/axe'

/*
 * R06 end to end, against the local CI stack: the RFQ board over a fixture set of RFQs spread across the
 * sourcing, clarification and bid states, with axe at 1440 and 375 and the review screenshots.
 * Other suites share this database, so every assertion looks at the fixture's own rows (by their unique
 * company names), never at the whole table.
 */

/* axe over the whole page, shell included: WCAG 2.2 AA plus best-practice rules, zero violations. */

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
    await page.getByRole('radio', { name: /^All\s*\d+$/ }).click()
    const partly = row(page, 'partly')
    await expect(partly.getByText('Partly covered')).toBeVisible()
    await expect(partly.getByText('1 of 2')).toBeVisible()
    await expect(partly.getByText('Waiting on customer')).toBeVisible()
    await expect(partly.getByText('To bid', { exact: true })).toBeVisible()
    const covered = row(page, 'covered')
    await expect(covered.getByText(/^Covered/)).toBeVisible()
    await expect(covered.getByText('Bid sent', { exact: true })).toBeVisible()
    await expect(row(page, 'toask').getByText(/^To ask/)).toBeVisible()
    await expect(row(page, 'partly').getByRole('img', { name: /./ }).first()).toBeVisible() // owner avatar
    await review(page, 'board-all-1440')
  })

  test('the state filter narrows the rows and its counts follow the owner switch', async ({ page }) => {
    await openAs(page, 'admin', '/rfqs') // admin opens on All
    await expect(page.getByRole('radio', { name: /^All\s*\d+$/ })).toBeChecked()
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

  test('New RFQ opens the intake screen', async ({ page }) => {
    await openAs(page, 'sales', '/rfqs')
    await page.getByRole('button', { name: 'New RFQ' }).click()
    await expect(page).toHaveURL(/\/rfqs\/new$/)
  })

  test('a row opens the RFQ at /rfqs/:id', async ({ page }) => {
    await openAs(page, 'engineer', '/rfqs')
    await row(page, 'covered').getByRole('link', { name: fx.names.covered }).click()
    await expect(page).toHaveURL(new RegExp(`/rfqs/${fx.ids.covered}$`))
    await expect(page.getByRole('heading', { level: 1, name: /RFQ-\d+/ })).toBeVisible() // the RFQ detail page (R07)
  })

  test('Mine with nothing assigned reads as done, and offers everyone’s RFQs', async ({ page }) => {
    await openAs(page, 'engineer', '/rfqs?owner=mine')
    await expect(page.getByText('None of your RFQs are open. Nice.')).toBeVisible()
    await review(page, 'board-mine-empty-1440')
    await page.getByRole('button', { name: /Show everyone/ }).click()
    await expect(row(page, 'covered')).toBeVisible()
  })
})

test.describe('toolbar: filter box, Open and Closed switch, density, nav counts', () => {
  for (const [w, h] of [
    [1440, 900],
    [375, 812],
  ] as const) {
    test(`filter, no-match, compact and the top-bar RFQs count at ${w}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h })
      await openAs(page, 'admin', '/rfqs')
      await expect(row(page, 'covered')).toBeVisible()
      await review(page, `board-toolbar-${w}`)

      if (w >= 1280) {
        // The top bar reads "RFQs <n>": since the owner decision of 2026-10-19 a count means "needs you", so n is the RFQ items
        // on the admin's own Today, never more than the open RFQs the board lists.
        const link = page.getByRole('navigation', { name: 'Main' }).first().getByRole('link', { name: /^RFQs\s*\d+$/ })
        await expect(link).toBeVisible()
        const needs = Number(/(\d+)$/.exec((await link.innerText()).trim())?.[1])
        const seg = page.getByRole('radio', { name: /^Open\s*\d+$/ })
        await expect(seg).toBeChecked()
        const open = Number(/(\d+)$/.exec((await seg.innerText()).trim())?.[1])
        expect(open).toBeGreaterThanOrEqual(6)
        expect(needs).toBeGreaterThan(0)
        expect(needs).toBeLessThanOrEqual(open)
        await expect(page.getByRole('navigation', { name: 'Main' }).first().getByRole('link', { name: /^Today\s*\d+$/ })).toBeVisible()
      }

      const box = page.getByRole('textbox', { name: 'Filter RFQs' })
      await page.keyboard.press('/')
      await expect(box).toBeFocused()
      await box.fill(String(fx.numbers.covered))
      await expect(row(page, 'covered')).toBeVisible()
      await expect(row(page, 'awaiting')).toHaveCount(0)
      await review(page, `board-filter-${w}`)
      await box.press('Escape')
      await expect(box).toHaveValue('')
      await expect(row(page, 'awaiting')).toBeVisible()

      await box.fill('Belimo zzz')
      await expect(page.getByText('No RFQs match “Belimo zzz”')).toBeVisible()
      await review(page, `board-nomatch-${w}`)
      expect(await axeViolations(page)).toEqual([])
      await page.getByRole('button', { name: 'Clear filter' }).click()
      await expect(row(page, 'covered')).toBeVisible()

      await page.getByRole('radio', { name: 'Compact' }).click()
      await expect(page.getByRole('radio', { name: 'Compact' })).toBeChecked()
      await review(page, `board-compact-${w}`)
      expect(await axeViolations(page)).toEqual([])
      await page.reload()
      await expect(page.getByRole('radio', { name: 'Compact' })).toBeChecked() // remembered on this device
      await page.getByRole('radio', { name: 'Comfortable' }).click()
    })
  }
})

test.describe('closed and won', () => {
  test('pages through closed RFQs 25 at a time', async ({ page }) => {
    await openAs(page, 'sales', '/rfqs')
    await page.getByRole('radio', { name: /^Closed/ }).click()
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
      await page.goto('/today') // a fresh page each time, so the shortcut never meets a closing palette
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
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
    await expect(page.getByText('Every bid is in')).toBeVisible()
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

  test('error says the changes are safe, shows a reference, and Try again recovers', async ({ page }) => {
    let fail = true
    await page.route(/\/rest\/v1\/v_rfq_state\?.*outcome=eq\.open/, route =>
      fail ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'down' }) }) : route.continue(),
    )
    await openAs(page, 'admin', '/rfqs')
    await expect(page.getByText('Couldn’t load RFQs')).toBeVisible()
    await expect(page.getByText('Your changes are safe. Check your connection and try again.')).toBeVisible()
    await expect(page.getByText(/^Request failed · .+ · reference [0-9a-f]{6}$/)).toBeVisible()
    await review(page, 'board-error-1440')
    await page.setViewportSize({ width: 375, height: 812 })
    await review(page, 'board-error-375')
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
      if (w === 375) {
        await review(page, 'board-375')
        // Phone cards: every row is at least 44px tall, and a tap on the card opens the RFQ.
        const cards = page.getByRole('table', { name: 'Open RFQs' }).locator('tr[data-card]')
        expect(await cards.count()).toBeGreaterThan(3)
        for (const box of await cards.evaluateAll(els => els.map(e => e.getBoundingClientRect().height))) expect(box).toBeGreaterThanOrEqual(44)
      }
      expect(await axeViolations(page)).toEqual([])

      await page.getByRole('radio', { name: /^Closed/ }).click()
      await expect(page.getByRole('table', { name: 'Closed and won RFQs' }).locator('tbody tr[data-di]').first()).toBeVisible()
      if (w === 375) await review(page, 'board-closed-375')
      expect(await axeViolations(page)).toEqual([])
    })
  }
})

test.describe('Items and Value columns (O-11)', () => {
  test('sales sees the item count and the quoted net; an engineer sees the count only and no money is requested for them', async ({ page }) => {
    const users = await must(rest<{ id: string; role: string }[]>('admin', 'users?select=id,role'))
    const owner = users.find(u => u.role === 'sales')!.id
    const name = uniqueName('Board value')
    const company = await createCompany(name)
    const rfq = (await must(rest<{ id: string; number: number }[]>('admin', 'rfqs', { method: 'POST', body: { company_id: company.id, owner_id: owner, due_on: karachiDay(4) } })))[0]
    await must(
      rest('admin', 'rfq_items', {
        method: 'POST',
        body: [
          { rfq_id: rfq.id, position: 0, description: 'Priced item', qty: 2, quoted_unit_price_net: 1500 },
          { rfq_id: rfq.id, position: 1, description: 'Unpriced item', qty: 1, quoted_unit_price_net: null },
        ],
        prefer: 'return=minimal',
      }),
    )

    await openAs(page, 'sales', '/rfqs?owner=all')
    await expect(page.getByRole('columnheader', { name: 'Items' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Value (PKR net)' })).toBeVisible()
    const row = page.getByRole('row').filter({ hasText: name })
    await expect(row.getByText('3,000')).toBeVisible()
    await review(page, 'board-value-1440')
  })

  test('engineer: Items yes, Value never, and the quoted prices are not even fetched', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    const urls: string[] = []
    page.on('request', r => urls.push(r.url()))
    await openAs(page, 'engineer', '/rfqs?owner=all')
    await expect(page.getByRole('columnheader', { name: 'Items' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Value (PKR net)' })).toHaveCount(0)
    expect(urls.some(u => u.includes('quoted_unit_price_net'))).toBe(false)
    await ctx.close()
  })
})
