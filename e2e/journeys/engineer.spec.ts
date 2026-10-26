import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { API_URL, createCompany, karachiDay, must, rest, uniqueName } from '../support/stack'
import { showAllTodo } from '../support/todo'
import { waitForAnimationsToFinish } from '../support/axe'
import { legLoc } from '../orders/fixtures'
import { fe2, ordRef, openPage, pastePage, PNG_B64, readCount, resetCount, roleContext } from './support'

/*
 * P03, the engineer journey: a working day on the phone-sized core of the app, and not one rupee anywhere.
 *
 *   To do shows the planned commissioning, under Tomorrow -> open it -> add a photo and a note to the job ->
 *   mark commissioning done -> mark the goods delivered -> Today no longer lists it.
 *
 * FE-2 targets held at each step:
 *   Today                      0 taps to see the work         Capture (desktop paste)  at most 4 taps (Android 4, iPhone 6)
 *   Commissioning done         1 tap, 0 typed                 Mark delivered           1 tap
 *
 * The money rule is checked over the WHOLE journey, from the network log: every request the engineer's browser makes (URL and body) and every
 * JSON answer it gets. None may touch a money table, view or function, and none may carry a selling price, a supplier price on an order, a
 * spread, or an invoice or payment amount. The order is seeded with prices (and a supplier price) so a leak would have something to carry.
 */

const ENGINEER = 'a0000000-0000-4000-8000-000000000003'

/**
 * A path in the REST or RPC API that an engineer's screens must never ask for. Since the owner decision of 2026-10-22 (engineers see
 * no prices) that includes every read that only carries prices or rates: the ranking, the price memories, the PO pre-fill, the
 * exchange rates and the person's own target.
 */
const MONEY_REQUEST =
  /\/rest\/v1\/(v_order_money|v_order_basis|v_order_items_total|v_payment_net|v_cash_month|v_month_|v_margin|order_costs|expenses|expense_categories|recurring_expenses|payments_in|invoices|closed_months|customer_price_memory|v_fx_latest|fx_rates)\b|\/rpc\/(order_receivables|month_end_status|aging_as_of|payables_as_of|close_month|close_months_through|reopen_month|next_invoice_number|rank_item_quotes|customer_price_memory|supplier_item_memory|po_line_prefill|my_target_progress)\b/
/** Columns that carry a price (selling, supplier, totals: 2026-10-22), a cost, a spread or a payment. */
const MONEY_COLUMN = /unit_price|pkr_unit_price|net_total|gst_total|unit_price_net|supplier_unit_price|quoted_unit_price_net|sell_unit_net|sell_order_number|spread_unit|spread_total|net_amount|gst_amount|amount_pkr|input_tax_pkr|expected_cost_pkr/
/** Words a screen would use for money. */
const MONEY_WORDS = /PKR|GST|Invoic|Margin|Receivable|Spread|Selling price|Payment|Balance|187,400|187400/

type Seen = { requests: string[]; leaks: string[] }

/** Watches every call the browser makes to the API and every JSON body that comes back. */
function watch(context: BrowserContext): { seen: Seen; settle: () => Promise<void> } {
  const seen: Seen = { requests: [], leaks: [] }
  const pending: Promise<void>[] = []
  context.on('request', r => {
    if (r.url().startsWith(API_URL)) seen.requests.push(`${r.method()} ${decodeURIComponent(r.url())} ${r.postData() ?? ''}`)
  })
  context.on('response', r => {
    if (!r.url().startsWith(`${API_URL}/rest/v1/`)) return
    pending.push(
      r
        .text()
        .then(body => {
          const hits = Array.from(new Set(body.match(new RegExp(`"(${MONEY_COLUMN.source})":\\s*(?!null)[^,}\\s]`, 'g')) ?? []))
          if (hits.length) seen.leaks.push(`${decodeURIComponent(r.url())} carried ${hits.join(', ')}`)
        })
        .catch(() => undefined), // a response that was aborted or redirected has no body to check
    )
  })
  return { seen, settle: async () => void (await Promise.all(pending)) }
}

async function seed() {
  const customer = await createCompany(uniqueName('Hub Cement'))
  const supplier = await createCompany(uniqueName('Dubai Instrumentation'), { country: 'United Arab Emirates' })
  const order = (
    await must(
      rest<{ id: string; number: number }[]>('admin', 'orders', {
        method: 'POST',
        body: { company_id: customer.id, owner_id: ENGINEER, ordered_on: karachiDay(-6), needs_commissioning: true, commissioning_planned_on: karachiDay(1), payment_terms_days: 30, notes: 'Gate pass needed 2 days ahead.' },
      }),
    )
  )[0]
  const leg = (
    await must(
      rest<{ id: string }[]>('admin', 'supplier_orders', {
        method: 'POST',
        body: { order_id: order.id, supplier_id: supplier.id, currency: 'USD', reference: 'PI-4471', placed_on: karachiDay(-4), expected_on: karachiDay(2) },
      }),
    )
  )[0]
  await must(
    rest('admin', 'order_items', {
      method: 'POST',
      body: [
        { order_id: order.id, position: 0, description: 'Endress+Hauser Cerabar PMC51 pressure transmitter', qty: 3, unit: 'ea', unit_price_net: 187400, supplier_order_id: leg.id, supplier_unit_price: 612, is_service: false },
        { order_id: order.id, position: 1, description: 'Loop check and commissioning', qty: 1, unit: 'job', unit_price_net: 135000, supplier_order_id: null, supplier_unit_price: null, is_service: true },
      ],
      prefer: 'return=minimal',
    }),
  )
  await must(rest('admin', 'order_engineers', { method: 'POST', body: { order_id: order.id, user_id: ENGINEER }, prefer: 'return=minimal' }))
  return { customer, supplier, order, leg: leg.id }
}

const noMoneyOnScreen = async (page: Page, where: string) => {
  const text = await page.locator('#main').innerText()
  expect(text, `${where}: the engineer's screen must show no money`).not.toMatch(MONEY_WORDS)
}

test('engineer: Today to delivered, and no money anywhere', async ({ browser }, info) => {
  const s = await seed()
  const ref = ordRef(s.order.number)
  const ctx = await roleContext(browser, info, 'engineer')
  const { seen, settle } = watch(ctx)

  // ---- 1. Today shows the commissioning to plan -------------------------------------------------------------------------------------
  const page = await openPage(ctx, '/todo')
  await test.step('To do lists the planned commissioning under Tomorrow, with 0 taps', async () => {
    await expect(page.getByRole('heading', { level: 1, name: 'To do' })).toBeVisible()
    await showAllTodo(page)
    await resetCount(page)
    const row = page.getByRole('region', { name: 'Tomorrow' }).locator('li[data-rule="job_commissioning"]').filter({ hasText: ref })
    await expect(row).toBeVisible()
    await expect(row).toContainText('Commissioning')
    await expect(row).toContainText(s.customer.name)
    fe2('Today: taps to see the engineer\'s work', (await readCount(page)).mouse, 0)
    await expect(page.getByRole('radio', { name: /^Money/ })).toHaveCount(0) // no Money tab on Today
    await noMoneyOnScreen(page, 'Today')

    // Select the row and open the order from the pane.
    await resetCount(page)
    await row.getByRole('button').first().click()
    await page.getByRole('button', { name: new RegExp(`^Open ${ref}`) }).first().click()
    await expect(page).toHaveURL(new RegExp(`/orders/${s.order.id}$`))
    fe2('Today to the order: select the row, Open', (await readCount(page)).mouse, 2)
  })

  // ---- 2. The order page: no price in sight ------------------------------------------------------------------------------------------
  await test.step('the order page shows the work and no money', async () => {
    await expect(page.getByRole('heading', { level: 1 })).toContainText(s.customer.name)
    await expect(page.getByRole('table', { name: 'Order items' })).toBeVisible()
    await expect(legLoc(page, 'A')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Commissioning' })).toBeVisible()
    await expect(page.getByTestId('order-notes')).toContainText('Gate pass needed 2 days ahead.')
    for (const header of ['Unit price', 'Total']) await expect(page.getByRole('columnheader', { name: new RegExp(header) })).toHaveCount(0)
    // the page leads with the engineer's job: the site and the one green button
    await expect(page.getByRole('region', { name: 'Your job' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Issue PO|Record payment|Create invoice|Add expense/ })).toHaveCount(0)
    await noMoneyOnScreen(page, 'the order page')
  })

  // ---- 3. Capture a photo and a note into the order -------------------------------------------------------------------------------------
  await test.step('add a photo and a note to the job', async () => {
    const note = 'Site photo: nameplate on transmitter 1, tag PT-204.'
    // The order has no enquiry, so its job is O-<number>. "Add to this job" takes a paste anywhere on the page: it guesses a note (an
    // engineer is offered only a photo or a note, never a price), and one tap adds the note and the photo.
    await page.goto(`/jobs/O-${s.order.number}`)
    await page.locator('#main').waitFor()
    await expect(page.getByRole('region', { name: 'Add to this job' })).toBeVisible()
    await resetCount(page)
    await pastePage(page, { text: note, file: { name: 'nameplate.png', type: 'image/png', b64: PNG_B64 } })
    await expect(page.getByTestId('guess-line')).toHaveText('Note')
    await expect(page.getByRole('button', { name: 'Supplier price' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Customer answer' })).toHaveCount(0)
    await waitForAnimationsToFinish(page)
    await page.getByRole('button', { name: 'Add note and files' }).click()
    await expect(page.getByRole('status').filter({ hasText: `Added to Job O-${s.order.number}` }).filter({ has: page.getByRole('button', { name: /Undo/ }) })).toBeVisible()
    fe2('Add a photo and a note to the job (after the paste)', (await readCount(page)).mouse, 1)
    const files = await must(rest<{ file_name: string; bucket: string }[]>('admin', `attachments?order_id=eq.${s.order.id}&select=file_name,bucket`))
    expect(files).toEqual([{ file_name: 'nameplate.png', bucket: 'rfq-files' }])
    const notes = await must(rest<{ notes: string | null }[]>('admin', `orders?id=eq.${s.order.id}&select=notes`))
    expect(notes[0].notes).toContain(note)
    expect(notes[0].notes).toContain('Gate pass needed 2 days ahead.') // the note was added to, not replaced
    await page.goto(`/orders/${s.order.id}`)
    await expect(page.getByRole('list', { name: 'Files on this order' }).getByText('nameplate.png')).toBeVisible()
  })

  // ---- 4. Commissioning done, goods delivered -----------------------------------------------------------------------------------------------
  await test.step('commissioning done: 1 tap, 0 typed', async () => {
    await resetCount(page)
    await page.getByRole('button', { name: 'Mark done today' }).click()
    await expect.poll(async () => (await must(rest<{ commissioning_done_on: string | null }[]>('admin', `orders?id=eq.${s.order.id}&select=commissioning_done_on`)))[0].commissioning_done_on).toBe(karachiDay(0))
    const c = await readCount(page)
    fe2('Commissioning done', c.mouse, 1)
    expect(c.keys).toEqual([]) // nothing typed
    await expect(page.getByRole('button', { name: 'Mark done today' })).toHaveCount(0)
  })

  await test.step('goods delivered: 1 tap', async () => {
    await resetCount(page)
    await legLoc(page, 'A').getByRole('button', { name: `Delivered today, ${s.supplier.name}` }).click()
    await expect.poll(async () => (await must(rest<{ delivered_on: string | null }[]>('admin', `supplier_orders?id=eq.${s.leg}&select=delivered_on`)))[0].delivered_on).toBe(karachiDay(0))
    fe2('Mark the goods delivered', (await readCount(page)).mouse, 1)
    await expect(page.getByRole('button', { name: /Received today/ })).toHaveCount(0) // there is no Received step
    await noMoneyOnScreen(page, 'the order page after delivery')
  })

  // ---- 5. Back on Today: the item has gone ------------------------------------------------------------------------------------------------
  await test.step('Today no longer lists the commissioning', async () => {
    await page.goto('/todo')
    await showAllTodo(page)
    await page.locator('#main').waitFor()
    await expect(page.getByRole('heading', { level: 1, name: 'To do' })).toBeVisible()
    await expect(page.locator('li[data-rule="job_commissioning"]').filter({ hasText: ref })).toHaveCount(0)
    await noMoneyOnScreen(page, 'Today at the end of the day')
  })

  // ---- The money rule, over the whole journey -----------------------------------------------------------------------------------------------------
  await test.step('the network log: no money table, view or function, no selling price, no spread', async () => {
    await page.waitForLoadState('networkidle')
    await settle()
    expect(seen.requests.length, 'the log must not be empty, or this proves nothing').toBeGreaterThan(10)
    expect(seen.requests.some(r => r.includes('/orders?') || r.includes('/order_items?'))).toBe(true)
    expect(seen.requests.filter(r => MONEY_REQUEST.test(r)), 'money requests made by the engineer').toEqual([])
    expect(seen.leaks, 'money columns carried in answers to the engineer').toEqual([])
  })

  await ctx.close()
})
