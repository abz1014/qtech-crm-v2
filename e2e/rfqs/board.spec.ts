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

  // One closed RFQ found only by its item text, made first so it is the oldest of ours (never on the first page).
  const oldCompany = await createCompany(`Board old ${fx.tag}`)
  const old = (await must(rest<{ id: string; number: number }[]>('admin', 'rfqs', { method: 'POST', body: { company_id: oldCompany.id, owner_id: admin, closed_on: day(-1), close_reason: 'price', received_on: day(-400) } })))[0]
  await must(rest('admin', 'rfq_items', { method: 'POST', body: { rfq_id: old.id, position: 0, description: `Rosemount gauge ${fx.tag} 0-16 bar`, qty: 1 }, prefer: 'return=minimal' }))
  fx.ids.old = old.id
  fx.numbers.old = old.number
  fx.names.old = oldCompany.name

  // 27 closed RFQs: one more than a page.
  const closedCompany = await createCompany(`Board closed ${fx.tag}`)
  await must(
    rest('admin', 'rfqs', {
      method: 'POST',
      body: Array.from({ length: 27 }, () => ({ company_id: closedCompany.id, owner_id: admin, closed_on: day(-1), close_reason: 'price' })),
    }),
  )
  closedTotalAtLeast = 28
}

const row = (page: Page, key: string) => page.getByRole('row').filter({ hasText: fx.names[key] })

/** The one filter: chips on a tablet and up, a select on a phone. */
async function show(page: Page, label: string, value: string) {
  const width = page.viewportSize()?.width ?? 1440
  if (width < 768) await page.getByRole('combobox', { name: 'Show RFQs' }).selectOption(value)
  else await page.getByRole('radio', { name: new RegExp(`^${label}`) }).click()
}

/** The screen's own content never scrolls sideways (the shell around it has its own test, shell-overflow.spec.ts). */
async function noSidewaysScroll(page: Page) {
  const m = await page.evaluate(() => {
    const main = document.querySelector('#main')
    return { scroll: main?.scrollWidth ?? 0, client: main?.clientWidth ?? 0, right: main?.getBoundingClientRect().right ?? 0, view: window.innerWidth }
  })
  expect(m.scroll, 'the content scrolls sideways').toBeLessThanOrEqual(m.client + 1)
  expect(m.right, 'the content is wider than the window').toBeLessThanOrEqual(m.view + 1)
}

test.beforeAll(async () => {
  test.setTimeout(120_000)
  await seed()
})

test.describe('open RFQs', () => {
  test('sales lands on Mine, ordered by due date then priority, each row with what was asked and one next step', async ({ page }) => {
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
    await expect(overdue.getByText('Needs suppliers', { exact: true })).toBeVisible()
    await expect(overdue.getByText('Nobody asked yet', { exact: true })).toBeVisible()
    await expect(overdue.getByText('Item 1 of priority', { exact: true })).toBeVisible() // what was asked, before the code
    await expect(overdue).toContainText(rfqRef(fx.numbers.priority))
    await expect(overdue).toContainText(`their ref BRD-${fx.tag}-P`)
    await expect(row(page, 'awaiting').getByText('Waiting for prices', { exact: true })).toBeVisible()
    await expect(row(page, 'awaiting').getByText('Asked 1 supplier', { exact: true })).toBeVisible()
    await expect(row(page, 'nooffer').getByText('Every supplier asked said no', { exact: true })).toBeVisible()
    // One state column: no Sourcing, Questions or Bid chips, no density switch.
    await expect(page.getByRole('columnheader', { name: 'Next step' })).toBeVisible()
    for (const gone of ['Sourcing', 'Questions', 'Bid']) await expect(page.getByRole('columnheader', { name: gone, exact: true })).toHaveCount(0)
    await expect(page.getByRole('radio', { name: 'Compact' })).toHaveCount(0)
    await review(page, 'board-mine-1440')
  })

  test('All shows everyone, each with the next step and what is behind it', async ({ page }) => {
    await openAs(page, 'sales', '/rfqs')
    await page.getByRole('radio', { name: 'All' }).click()
    const partly = row(page, 'partly')
    await expect(partly.getByText('Waiting for prices', { exact: true })).toBeVisible()
    await expect(partly.getByText('1 of 2 items priced · waiting on the customer for 1 answer', { exact: true })).toBeVisible()
    await expect(partly.getByText('Item 1 of partly + 1 more', { exact: true })).toBeVisible()
    const covered = row(page, 'covered')
    await expect(covered.getByText('Quotation sent', { exact: true })).toBeVisible()
    await expect(covered.getByText(/^Sent \w{3} \d{1,2} \w{3}$/)).toBeVisible()
    await expect(row(page, 'toask').getByText('Nobody asked yet · 1 question to ask the customer', { exact: true })).toBeVisible()
    await expect(row(page, 'partly').getByRole('img', { name: /./ }).first()).toBeVisible() // owner avatar
    await review(page, 'board-all-1440')
  })

  test('the one next-step filter narrows the rows, its needs-you counts follow the owner switch, and it lives in the address', async ({ page }) => {
    await openAs(page, 'admin', '/rfqs') // admin opens on All
    await expect(page.getByRole('radio', { name: 'All' })).toBeChecked()
    await expect(page.getByRole('radio', { name: 'All open' })).toBeChecked()
    await show(page, 'Quotation sent', 'sent')
    await expect(row(page, 'covered')).toBeVisible()
    await expect(row(page, 'awaiting')).toHaveCount(0)
    await expect(page).toHaveURL(/show=sent/)
    await review(page, 'board-step-sent-1440')

    await show(page, 'Waiting for prices', 'prices')
    await expect(row(page, 'awaiting')).toBeVisible()
    await expect(row(page, 'partly')).toBeVisible()
    await expect(row(page, 'covered')).toHaveCount(0)

    // Only the steps that wait on us carry a number ("needs you"); it equals the rows the choice shows.
    await expect(page.getByRole('radio', { name: 'Waiting for prices' })).toBeVisible()
    const label = await page.getByRole('radio', { name: /^Needs suppliers/ }).innerText()
    const n = Number(/(\d+)/.exec(label)?.[1])

    await show(page, 'Needs suppliers', 'suppliers')
    await expect(page.getByRole('table', { name: 'Open RFQs' }).locator('tbody tr[data-di]')).toHaveCount(n)
    await expect(row(page, 'toask')).toBeVisible()
    await expect(row(page, 'nooffer')).toBeVisible()
    await expect(row(page, 'awaiting')).toHaveCount(0)
  })

  test('New RFQ opens the intake screen', async ({ page }) => {
    await openAs(page, 'sales', '/rfqs')
    await expect(page.getByRole('button', { name: 'New RFQ' })).toHaveAttribute('aria-keyshortcuts', 'N')
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

test.describe('toolbar: filter box, the one filter, nav counts', () => {
  for (const [w, h] of [
    [1440, 900],
    [375, 812],
  ] as const) {
    test(`filter, no-match and the top-bar RFQs count at ${w}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h })
      await openAs(page, 'admin', '/rfqs')
      await expect(row(page, 'covered')).toBeVisible()
      await review(page, `board-toolbar-${w}`)
      await noSidewaysScroll(page)

      if (w >= 1280) {
        // The top bar reads "RFQs <n>", named "RFQs, n need you": a count means "needs you", so n is the RFQ items on the
        // admin's own Today, never more than the open RFQs the board lists (its lede: "12 open · 4 need you · 3 overdue").
        const link = page.getByRole('navigation', { name: 'Main' }).first().getByRole('link', { name: /^RFQs, \d+ need you$/ })
        await expect(link).toBeVisible()
        const needs = Number(/^RFQs, (\d+)/.exec((await link.getAttribute('aria-label')) ?? '')?.[1])
        await expect(page.getByRole('radio', { name: 'All open' })).toBeChecked()
        const lede = page.getByText(/^\d+ open( · \d+ need you)?( · \d+ overdue)?$/)
        await expect(lede).toBeVisible()
        const open = Number(/^(\d+) open/.exec(await lede.innerText())?.[1])
        expect(open).toBeGreaterThanOrEqual(6)
        expect(needs).toBeGreaterThan(0)
        expect(needs).toBeLessThanOrEqual(open)
        await expect(page.getByRole('navigation', { name: 'Main' }).first().getByRole('link', { name: /^Today, \d+ need you$/ })).toBeVisible()
      } else {
        // A phone gets the same one filter as a select, not a strip that scrolls sideways; Mine or All is in the Filters sheet.
        await expect(page.getByRole('combobox', { name: 'Show RFQs' })).toBeVisible()
        await expect(page.getByRole('radio', { name: /^All open/ })).toBeHidden()
        await expect(page.getByRole('radiogroup', { name: 'Whose RFQs' })).toHaveCount(0)
        await page.getByRole('button', { name: /^Filters/ }).click()
        await expect(page.getByRole('dialog', { name: 'Filter RFQs' }).getByRole('radiogroup', { name: 'Whose RFQs' })).toBeVisible()
        await page.getByRole('dialog', { name: 'Filter RFQs' }).getByRole('button', { name: /^Show \d+ RFQs?$/ }).click()
      }

      const box = page.getByRole('textbox', { name: 'Search RFQs' })
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
      await expect(page).toHaveURL(/q=Belimo/)
      await expect(page.getByText('Nothing matches "Belimo zzz"')).toBeVisible()
      await expect(page.getByText('Searched open RFQs by number, customer, their reference and item.')).toBeVisible()
      await review(page, `board-nomatch-${w}`)
      expect(await axeViolations(page)).toEqual([])
      await page.getByRole('table', { name: 'Open RFQs' }).getByRole('button', { name: 'Clear search' }).click()
      await expect(row(page, 'covered')).toBeVisible()
      // The filter also reads what was asked.
      await box.fill('Item 1 of partly')
      await expect(row(page, 'partly')).toBeVisible()
      await expect(row(page, 'covered')).toHaveCount(0)
      await box.press('Escape')
    })
  }
})

test.describe('closed and won', () => {
  test('pages through closed RFQs 25 at a time', async ({ page }) => {
    await openAs(page, 'sales', '/rfqs')
    await page.getByRole('radio', { name: /^Closed/ }).click()
    await expect(page).toHaveURL(/show=closed/)
    await expect(page.getByText(/^Showing 1 to 25 of \d+$/)).toBeVisible()
    const body = page.getByRole('table', { name: 'Closed and won RFQs' }).locator('tbody tr[data-di]')
    await expect(body).toHaveCount(25)
    await expect(body.first()).toContainText('Closed')
    await expect(body.first()).toContainText('Price')
    await expect(page.getByRole('button', { name: 'Previous' })).toBeDisabled()
    await review(page, 'board-closed-1440')

    const total = Number(/of (\d+)$/.exec((await page.getByText(/^Showing 1 to 25 of \d+$/).innerText()).trim())?.[1])
    expect(total).toBeGreaterThanOrEqual(closedTotalAtLeast)
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(page).toHaveURL(/page=2/)
    await expect(page.getByText(new RegExp(`^Showing 26 to ${Math.min(50, total)} of ${total}$`))).toBeVisible()
    await page.getByRole('button', { name: 'Previous' }).click()
    await expect(page.getByText(/^Showing 1 to 25 of/)).toBeVisible()
  })

  test('the search box searches every closed RFQ on the server: by item text, by company, by number', async ({ page }) => {
    await openAs(page, 'admin', '/rfqs?show=closed')
    const body = page.getByRole('table', { name: 'Closed and won RFQs' }).locator('tbody tr[data-di]')
    await expect(body.first()).toBeVisible()
    await expect(row(page, 'old')).toHaveCount(0) // a year old: not on the first page
    const box = page.getByRole('textbox', { name: 'Search RFQs' })
    await box.fill(`Rosemount gauge ${fx.tag}`)
    await expect(row(page, 'old')).toBeVisible()
    await expect(body).toHaveCount(1)
    await expect(row(page, 'old')).toContainText(`Rosemount gauge ${fx.tag} 0-16 bar`)
    await review(page, 'board-closed-search-1440')
    await box.fill(`Board closed ${fx.tag}`)
    await expect(page.getByText(/^Showing 1 to 25 of 27$/)).toBeVisible()
    await box.fill(rfqRef(fx.numbers.old))
    await expect(row(page, 'old')).toBeVisible()
    await box.fill('zz no such thing zz')
    await expect(page.getByText('Nothing matches "zz no such thing zz"')).toBeVisible()
    await expect(page.getByText('Searched every closed RFQ by number, customer, their reference and item.')).toBeVisible()
    // the search is in the address: a reload keeps it
    await page.reload()
    await expect(page.getByRole('textbox', { name: 'Search RFQs' })).toHaveValue('zz no such thing zz')
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
    await expect(page.getByText('No open RFQs')).toBeVisible()
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

test.describe('accessibility (axe, WCAG 2.2 AA) and phones', () => {
  for (const [w, h] of [
    [1440, 900],
    [375, 812],
    [320, 640],
  ] as const) {
    test(`open board and closed list at ${w}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h })
      await openAs(page, 'sales', '/rfqs?owner=all')
      await expect(row(page, 'covered')).toBeVisible()
      if (w < 768) {
        await review(page, `board-${w}`)
        // Phone cards: every row is at least 44px tall, and a tap on the card opens the RFQ.
        const cards = page.getByRole('table', { name: 'Open RFQs' }).locator('tr[data-card]')
        expect(await cards.count()).toBeGreaterThan(3)
        for (const box of await cards.evaluateAll(els => els.map(e => e.getBoundingClientRect().height))) expect(box).toBeGreaterThanOrEqual(44)
        await expect(row(page, 'covered')).toContainText('Quotation sent')
      }
      await noSidewaysScroll(page)
      expect(await axeViolations(page)).toEqual([])

      await show(page, 'Closed', 'closed')
      await expect(page.getByRole('table', { name: 'Closed and won RFQs' }).locator('tbody tr[data-di]').first()).toBeVisible()
      if (w < 768) await review(page, `board-closed-${w}`)
      await noSidewaysScroll(page)
      expect(await axeViolations(page)).toEqual([])
    })
  }
})

test.describe('Value column (O-11)', () => {
  test('sales sees what was asked and the quoted net; an engineer sees what was asked and no money is requested for them', async ({ page }) => {
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
    await expect(page.getByRole('columnheader', { name: 'Value (PKR net)' })).toBeVisible()
    const row = page.getByRole('row').filter({ hasText: name })
    await expect(row.getByText('Priced item + 1 more')).toBeVisible()
    await expect(row.getByText('3,000')).toBeVisible()
    await review(page, 'board-value-1440')
  })

  test('engineer: what was asked yes, Value never, and the quoted prices are not even fetched', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    const urls: string[] = []
    page.on('request', r => urls.push(r.url()))
    await openAs(page, 'engineer', '/rfqs?owner=all')
    await expect(page.getByRole('columnheader', { name: 'Next step' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Value (PKR net)' })).toHaveCount(0)
    expect(urls.some(u => u.includes('quoted_unit_price_net'))).toBe(false)
    await ctx.close()
  })
})
