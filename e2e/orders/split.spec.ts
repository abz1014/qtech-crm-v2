import { test, type Page } from '@playwright/test'
import { createCompany, createRfq, karachiDay, must, openAs, rest, uniqueName } from '../support/stack'
import { axeViolations } from '../support/axe'
import { expect, get, legLoc, setProfile, shot, tapper } from './fixtures'

/*
 * A8 (O08, O09): splitting an RFQ item across suppliers, end to end against the local CI stack, as the fixture users through the real
 * login form. Every test makes its own customer, RFQ, suppliers and order.
 *
 * Interaction counts asserted (BUILD_PLAN FE-2, Amendment A8):
 *   convert with no changes            2 taps (Mark won, Create order), nothing typed, every item on its rank-1 quote
 *   split in the convert dialog        on top of those 2: Split this item (1) + 1 quantity typed when the offered next-ranked supplier is fine;
 *                                      3 taps + 1 quantity typed when another supplier is picked (Split this item, open the picker, choose)
 *   Split line on the order page       4 taps + 1 quantity typed (Edit GST and lines, Split line on the row, choose the supplier, Split line in the dialog)
 *   re-issue a changed PO              1 tap on the indicator, then Issue in the dialog
 *   edit the selling price of a group  1 tap + 1 typed, once for every part
 * and the owner's rules: parts that do not add up only warn; an engineer never gets a selling price, a spread, a supplier price or the
 * ranking (no request carries them); there is no Received step.
 */

const dialog = (page: Page) => page.getByRole('dialog')
const dialogViolations = (page: Page) => axeViolations(page, { landmarks: false })

interface Seed {
  tag: string
  customer: { id: string; name: string }
  rfq: { id: string; number: number }
  items: { id: string; description: string }[]
  /** Ranked for item 1 (same currency, so no rates are needed): s1 is 400 (rank 1), s2 is 405 (1.25% above: inside the 2% band), s3 is 450. */
  s1: { id: string; name: string }
  s2: { id: string; name: string }
  s3: { id: string; name: string }
  lines: Record<string, string>
}

/** An RFQ of two priced items: item 1 (4 pieces) quoted by three suppliers, item 2 (2 pieces) by one. */
async function seed(): Promise<Seed> {
  const tag = Math.random().toString(36).slice(2, 6)
  const customer = await createCompany(uniqueName('Split Customer'))
  // quoted_on: the quotation is out (marked sent by phone), so Mark won is the RFQ page's one green button (UX audit 2026-10-19).
  const rfq = await createRfq(customer.id, { due_on: karachiDay(6), customer_ref: `RFQ-${tag}`, quoted_on: karachiDay(-1) })
  const items = await must(
    rest<{ id: string; description: string; position: number }[]>('admin', 'rfq_items', {
      method: 'POST',
      body: [
        { rfq_id: rfq.id, position: 0, description: `Pressure transmitter ${tag}`, qty: 4, quoted_unit_price_net: 134000 },
        { rfq_id: rfq.id, position: 1, description: `Flow meter ${tag}`, qty: 2, quoted_unit_price_net: 612000 },
      ],
    }),
  )
  items.sort((a, b) => a.position - b.position)
  // Mark won prices the order from the issued quotation, not from rfq_items.
  await must(rest('admin', 'rpc/issue_quotation', { method: 'POST', body: { p_quotation_id: crypto.randomUUID(), p_rfq_id: rfq.id } }))
  const s1 = await createCompany(uniqueName('Metro Process Controls'), { country: 'UAE' })
  const s2 = await createCompany(uniqueName('Indus Instrumentation'), { country: 'UAE' })
  const s3 = await createCompany(uniqueName('Lahore Process Controls'), { country: 'Pakistan' })
  const inq = async (supplierId: string) =>
    (await must(rest<{ id: string }[]>('admin', 'supplier_inquiries', { method: 'POST', body: { rfq_id: rfq.id, supplier_id: supplierId, sent_on: karachiDay(-3) } })))[0].id
  const [i1, i2, i3] = [await inq(s1.id), await inq(s2.id), await inq(s3.id)]
  const ql = await must(
    rest<{ id: string; inquiry_id: string; rfq_item_id: string }[]>('admin', 'supplier_quote_lines', {
      method: 'POST',
      body: [
        { inquiry_id: i1, rfq_item_id: items[0].id, unit_price: 400, currency: 'USD', lead_time: '2 wks' },
        { inquiry_id: i2, rfq_item_id: items[0].id, unit_price: 405, currency: 'USD', lead_time: '3 wks' },
        { inquiry_id: i3, rfq_item_id: items[0].id, unit_price: 450, currency: 'USD', lead_time: 'ex-stock' },
        { inquiry_id: i1, rfq_item_id: items[1].id, unit_price: 1985, currency: 'USD', lead_time: '4 wks' },
      ],
    }),
  )
  const line = (inquiry: string, item: string) => ql.find(l => l.inquiry_id === inquiry && l.rfq_item_id === item)!.id
  return { tag, customer, rfq, items, s1, s2, s3, lines: { s1x: line(i1, items[0].id), s2x: line(i2, items[0].id), s3x: line(i3, items[0].id), s1y: line(i1, items[1].id) } }
}

interface OrderLine {
  id: string
  description: string
  qty: number
  unit_price_net: number
  supplier_unit_price: number | null
  supplier_order_id: string | null
  rfq_item_id: string | null
}
const orderLines = (orderId: string) =>
  get<OrderLine>(`order_items?order_id=eq.${orderId}&select=id,description,qty,unit_price_net,supplier_unit_price,supplier_order_id,rfq_item_id&order=position,created_at`)
const orderFor = async (rfqId: string) => (await get<{ id: string; number: number }>(`orders?rfq_id=eq.${rfqId}&select=id,number`))[0]

/** Converts the seeded RFQ straight through the RPC with item 1 split 3 + 1 (s1 and s2), as a person would in the dialog. */
async function seedSplitOrder(): Promise<Seed & { order: { id: string; number: number } }> {
  const s = await seed()
  await must(
    rest('sales', 'rpc/convert_rfq_to_order', {
      method: 'POST',
      body: {
        p_order_id: crypto.randomUUID(),
        p_rfq_id: s.rfq.id,
        p_items: [
          { rfq_item_id: s.items[0].id, quote_line_id: s.lines.s1x, qty: 3 },
          { rfq_item_id: s.items[0].id, quote_line_id: s.lines.s2x, qty: 1 },
          { rfq_item_id: s.items[1].id },
        ],
      },
    }),
  )
  return { ...s, order: await orderFor(s.rfq.id) }
}

const markWon = (page: Page) => page.locator('[data-slot="mark-won"]').getByRole('button', { name: 'Mark won' })
const partQty = (page: Page, part: number, line = 1) => dialog(page).getByLabel(`Quantity, part ${part}, line ${line}`)

test.describe('O08: the convert dialog ranks, pre-assigns and splits', () => {
  test('nothing changed: 2 taps, 0 typed, every item on its rank-1 quote with the reason, and the order has one line per item', async ({ page }) => {
    const s = await seed()
    const t = tapper()
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    await t.tap(markWon(page))
    const d = dialog(page)
    await expect(d.getByRole('heading', { name: 'Mark won' })).toBeVisible()

    // rank 1 by price; s2 is inside the 2% band, so s1 reads "Within 2%" (a tie decided by record), and the single-quote item reads "Best price"
    await expect(d.getByRole('button', { name: 'Supplier for line 1' })).toContainText(s.s1.name)
    await expect(d.getByRole('button', { name: 'Supplier for line 1' })).toContainText('Best price')
    await expect(d.getByRole('button', { name: 'Supplier for line 2' })).toContainText(s.s1.name)
    await expect(d.getByRole('button', { name: 'Supplier for line 2' })).toContainText('Best price')
    await expect(d.getByText('Creates 2 order lines.')).toBeVisible()
    await shot(page, 'a8-convert-nothing-changed-1440')

    await t.tap(d.getByRole('button', { name: 'Create order' }))
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/)
    expect(t.count).toBe(2) // Mark won, Create order: nothing typed

    const order = await orderFor(s.rfq.id)
    const lines = await orderLines(order.id)
    expect(lines.map(l => [Number(l.qty), Number(l.supplier_unit_price)])).toEqual([
      [4, 400],
      [2, 1985],
    ])
    // both items sit on the rank-1 supplier's one leg
    expect(new Set(lines.map(l => l.supplier_order_id)).size).toBe(1)
  })

  test('split an item: Split this item (1) + the quantity typed; the first part takes the remainder; each part gets its own leg; the order total does not change', async ({ page }) => {
    const s = await seed()
    const t = tapper()
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    await t.tap(markWon(page))
    const d = dialog(page)

    await t.tap(d.getByRole('button', { name: 'Split this item, line 1' }))
    // the offered part is the next ranked supplier (s2), with no quantity yet: Create order waits for it
    await expect(d.getByRole('button', { name: 'Supplier for part 2, line 1' })).toContainText(s.s2.name)
    await expect(d.getByRole('button', { name: 'Create order' })).toBeDisabled()
    await t.typed(partQty(page, 2), '1')
    await expect(partQty(page, 1)).toHaveValue('3')
    await expect(d.getByText('remainder, auto')).toBeVisible()
    await expect(d.getByTestId('convert-item-1-sum')).toContainText('3 + 1 = 4')
    await expect(d.getByText('Creates 3 order lines.')).toBeVisible()
    await expect(d.getByRole('alert')).toHaveCount(0)
    await shot(page, 'a8-convert-split-1440')

    await t.tap(d.getByRole('button', { name: 'Create order' }))
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/)
    // Mark won (2 with Create order) + Split this item (1) + the quantity typed (1)
    expect(t.count).toBe(4)

    const order = await orderFor(s.rfq.id)
    const lines = await orderLines(order.id)
    expect(lines.map(l => [Number(l.qty), Number(l.supplier_unit_price), Number(l.unit_price_net)])).toEqual([
      [3, 400, 134000],
      [1, 405, 134000],
      [2, 1985, 612000],
    ])
    const legs = await get<{ id: string; supplier_id: string }>(`supplier_orders?order_id=eq.${order.id}&select=id,supplier_id`)
    expect(legs.map(l => l.supplier_id).sort()).toEqual([s.s1.id, s.s2.id].sort())
    // same total as the unsplit order: 4 x 134,000 + 2 x 612,000
    expect(lines.reduce((sum, l) => sum + Number(l.qty) * Number(l.unit_price_net), 0)).toBe(4 * 134000 + 2 * 612000)

    // the order page groups the two parts under the one item
    await expect(page.getByText('split across 2 suppliers').first()).toBeVisible()
  })

  test('split with another supplier picked: Split this item, open the picker, choose = 3 taps, plus the quantity typed', async ({ page }) => {
    const s = await seed()
    const t = tapper()
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    await t.tap(markWon(page))
    const d = dialog(page)
    await t.tap(d.getByRole('button', { name: 'Split this item, line 1' }))
    await t.tap(d.getByRole('button', { name: 'Supplier for part 2, line 1' }))
    // the picker lists the ranked quotes with the reason; a supplier used by the other part cannot be picked again
    await expect(page.getByRole('option', { name: new RegExp(s.s1.name) })).toBeDisabled()
    await expect(page.getByRole('option', { name: new RegExp(s.s3.name) })).toContainText('above the best')
    await shot(page, 'a8-convert-picker-1440')
    await t.tap(page.getByRole('option', { name: new RegExp(s.s3.name) }))
    await t.typed(partQty(page, 2), '1')
    expect(t.count).toBe(1 + 1 + 1 + 1 + 1) // Mark won, Split this item, picker, choose, quantity
    await t.tap(d.getByRole('button', { name: 'Create order' }))
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/)

    const order = await orderFor(s.rfq.id)
    const lines = await orderLines(order.id)
    expect(lines.slice(0, 2).map(l => [Number(l.qty), Number(l.supplier_unit_price)])).toEqual([
      [3, 400],
      [1, 450],
    ])
  })

  test('parts that do not add up only warn: the warning is plain, nothing is blocked, and the order is made as typed', async ({ page }) => {
    const s = await seed()
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    await markWon(page).click()
    const d = dialog(page)
    await d.getByRole('button', { name: 'Split this item, line 1' }).click()
    await partQty(page, 1).fill('3')
    await partQty(page, 2).fill('2')
    await expect(d.getByRole('alert')).toContainText('Parts add up to 5, but the item is 4.')
    await expect(d.getByRole('alert')).toContainText('Nothing is blocked')
    await expect(d.getByRole('button', { name: 'Create order' })).toBeEnabled()
    await shot(page, 'a8-convert-split-warning-1440')
    await d.getByRole('button', { name: 'Create order' }).click()
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/)
    const lines = await orderLines((await orderFor(s.rfq.id)).id)
    expect(lines.slice(0, 2).map(l => Number(l.qty))).toEqual([3, 2])
  })

  test('removing a part takes the item back to one supplier; the same supplier cannot be split against itself (22023 from the database)', async ({ page }) => {
    const s = await seed()
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    await markWon(page).click()
    const d = dialog(page)
    await d.getByRole('button', { name: 'Split this item, line 1' }).click()
    await d.getByRole('button', { name: 'Remove part 2, line 1' }).click()
    await expect(d.getByRole('button', { name: 'Supplier for line 1' })).toContainText(s.s1.name)
    await expect(d.getByText('Creates 2 order lines.')).toBeVisible()
    await d.getByRole('button', { name: 'Cancel' }).click()

    // the database refuses one quote line used twice for an item
    const refused = await rest('sales', 'rpc/convert_rfq_to_order', {
      method: 'POST',
      body: {
        p_order_id: crypto.randomUUID(),
        p_rfq_id: s.rfq.id,
        p_items: [
          { rfq_item_id: s.items[0].id, quote_line_id: s.lines.s1x, qty: 3 },
          { rfq_item_id: s.items[0].id, quote_line_id: s.lines.s1x, qty: 1 },
          { rfq_item_id: s.items[1].id },
        ],
      },
    })
    expect(refused.status).toBe(400)
  })
})

test.describe('lifecycle audit fixes: commissioning toggle and default expected date', () => {
  test('Needs commissioning starts off for plain goods and one tap turns it on; the order keeps it', async ({ page }) => {
    const s = await seed()
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    await markWon(page).click()
    const d = dialog(page)
    const box = d.getByRole('checkbox', { name: 'Needs commissioning' })
    await expect(box).not.toBeChecked()
    await box.click()
    await d.getByRole('button', { name: 'Create order' }).click()
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/)
    const order = await orderFor(s.rfq.id)
    expect((await get<{ needs_commissioning: boolean }>(`orders?id=eq.${order.id}&select=needs_commissioning`))[0].needs_commissioning).toBe(true)
  })

  test('a hand-added supplier order gets an expected date when it is placed (30 days assumed, no lead time), shown as an editable date', async ({ page }) => {
    const s = await seedSplitOrder()
    const leg = (await must(rest<{ id: string }[]>('admin', 'supplier_orders', { method: 'POST', body: { order_id: s.order.id, supplier_id: s.s3.id, currency: 'PKR' } })))[0]
    await openAs(page, 'sales', `/orders/${s.order.id}`)
    const legs = await get<{ id: string }>(`supplier_orders?order_id=eq.${s.order.id}&select=id&order=created_at`)
    const letter = String.fromCharCode(65 + legs.findIndex(l => l.id === leg.id))
    const card = legLoc(page, letter)
    // not placed and no PO: "Mark placed, no PO" is in the row's menu, Issue PO on the row
    await card.getByRole('button', { name: `More for ${s.s3.name}` }).click()
    await page.getByRole('menuitem', { name: 'Mark placed, no PO' }).click()
    await expect(card).toContainText('30 days assumed')
    await expect.poll(async () => (await get<{ expected_on: string | null }>(`supplier_orders?id=eq.${leg.id}&select=expected_on`))[0].expected_on).toBe(karachiDay(30))
    // an editable date, like any other
    await expect(card.getByRole('button', { name: new RegExp(`Expected date, ${s.s3.name}`) })).toBeVisible()
  })

  test('a supplier order placed by issuing its PO also gets the default expected date', async ({ page }) => {
    await setProfile(true)
    const s = await seedSplitOrder()
    const legs = await get<{ id: string; supplier_id: string; expected_on: string | null }>(`supplier_orders?order_id=eq.${s.order.id}&select=id,supplier_id,expected_on&order=created_at`)
    const leg = legs.find(l => l.supplier_id === s.s1.id)!
    await must(rest('admin', `supplier_orders?id=eq.${leg.id}`, { method: 'PATCH', body: { expected_on: null }, prefer: 'return=minimal' }))
    await must(rest('admin', 'rpc/issue_purchase_order', { method: 'POST', body: { p_po_id: crypto.randomUUID(), p_supplier_order_id: leg.id } }))
    await openAs(page, 'sales', `/orders/${s.order.id}`)
    await expect.poll(async () => (await get<{ expected_on: string | null }>(`supplier_orders?id=eq.${leg.id}&select=expected_on`))[0].expected_on).not.toBeNull()
  })
})

test.describe('O09: the order page shows a split item, splits a line, edits the group price and flags a changed PO', () => {
  test('the two parts are grouped under "split across 2 suppliers", numbered 1, 1a, 1b, and one selling price edits both', async ({ page }) => {
    const s = await seedSplitOrder()
    const t = tapper()
    await openAs(page, 'sales', `/orders/${s.order.id}`)
    const items = page.getByRole('region', { name: 'Items' })
    await expect(items.getByText('split across 2 suppliers')).toBeVisible()
    await expect(items.getByText('Part 1 of 2')).toBeVisible()
    await expect(items.getByText('Part 2 of 2')).toBeVisible()
    await expect(items.getByText('1a')).toBeVisible()
    await expect(items.getByText('1b')).toBeVisible()
    // five columns (UX audit 2026-10-19); the unit price on a plain line
    await expect(items.getByRole('columnheader', { name: 'Unit price (PKR)' })).toBeVisible()
    await expect(items.getByRole('columnheader', { name: 'Supplier' })).toBeVisible()
    await expect(items.getByRole('row', { name: /Flow meter/ })).toContainText('612,000')
    await shot(page, 'a8-order-split-group-1440')

    // one tap on Edit price, one value typed (Enter saves): both parts change in one statement
    await t.tap(items.getByRole('button', { name: /^Edit price, Pressure transmitter/ }))
    await t.typed(items.getByRole('textbox', { name: /^Selling price before GST, PKR, Pressure transmitter/ }), '140000')
    await page.keyboard.press('Enter')
    await expect(page.getByText('Selling price changed')).toBeVisible()
    expect(t.count).toBe(2)
    const lines = await orderLines(s.order.id)
    expect(lines.slice(0, 2).map(l => Number(l.unit_price_net))).toEqual([140000, 140000])
    expect(Number(lines[2].unit_price_net)).toBe(612000)
  })

  test('Split line: 4 taps + 1 quantity typed; the new part lands with the chosen supplier and the order total does not change', async ({ page }) => {
    const s = await seedSplitOrder()
    const t = tapper()
    const before = await orderLines(s.order.id)
    await openAs(page, 'sales', `/orders/${s.order.id}`)
    // move 1 of part 1 (3 pieces, s1) to the third-ranked supplier; the row actions are behind "Edit GST and lines"
    await t.tap(page.getByRole('button', { name: 'Edit GST and lines' }))
    await t.tap(page.getByRole('button', { name: 'Split line 1a' }))
    const d = dialog(page)
    await expect(d.getByRole('heading', { name: /Split line/ })).toBeVisible()
    await t.typed(d.getByLabel('Quantity to move'), '1')
    await t.tap(d.getByRole('radio', { name: `Move to ${s.s3.name}` }))
    await expect(d.getByTestId('split-result')).toContainText(`2 stay with ${s.s1.name}, 1 moves to`)
    await shot(page, 'a8-order-split-line-dialog-1440')
    await t.tap(d.getByRole('button', { name: 'Split line' }))
    await expect(page.getByText('Line split')).toBeVisible()
    expect(t.count).toBe(5) // Edit GST and lines (1), Split line (2), the supplier (3), Split line in the dialog (4), the quantity typed

    const after = await orderLines(s.order.id)
    expect(after).toHaveLength(before.length + 1)
    expect(after.reduce((sum, l) => sum + Number(l.qty) * Number(l.unit_price_net), 0)).toBe(before.reduce((sum, l) => sum + Number(l.qty) * Number(l.unit_price_net), 0))
    const moved = after.find(l => !before.some(b => b.id === l.id))!
    expect(Number(moved.qty)).toBe(1)
    expect(Number(moved.supplier_unit_price)).toBe(450)
    expect(moved.rfq_item_id).toBe(s.items[0].id)
    // the item is now split across 3 suppliers
    await expect(page.getByText('split across 3 suppliers')).toBeVisible()
    // the supplier that was not on the order before has a new supplier order, labelled as coming from the split
    await expect(page.getByText('New, from the split').first()).toBeVisible()
  })

  test('a refused split says why and changes nothing (a quantity of the whole line)', async ({ page }) => {
    const s = await seedSplitOrder()
    await openAs(page, 'sales', `/orders/${s.order.id}`)
    await page.getByRole('button', { name: 'Edit GST and lines' }).click()
    await page.getByRole('button', { name: 'Split line 1a' }).click()
    const d = dialog(page)
    await d.getByLabel('Quantity to move').fill('3')
    await expect(d.getByText(/not including either/)).toBeVisible()
    await expect(d.getByRole('button', { name: 'Split line' })).toBeDisabled()
  })

  test('lines changed since PO: the supplier order says so after a split, one tap re-issues, and the indicator goes', async ({ page }) => {
    await setProfile(true)
    const s = await seedSplitOrder()
    const legs = await get<{ id: string; supplier_id: string }>(`supplier_orders?order_id=eq.${s.order.id}&select=id,supplier_id&order=created_at`)
    const legS1 = legs.find(l => l.supplier_id === s.s1.id)!
    await must(rest('admin', 'rpc/issue_purchase_order', { method: 'POST', body: { p_po_id: crypto.randomUUID(), p_supplier_order_id: legS1.id } }))
    await openAs(page, 'sales', `/orders/${s.order.id}`)
    await expect(legLoc(page, 'A').getByTestId('leg-A-po')).toHaveText(/^PO-\d\d-\d{4} · R0$/)
    await expect(page.getByTestId('leg-A-changed')).toHaveCount(0)

    // move 1 of the 3 pieces on leg A to supplier 3 through the database (what the dialog does), then reload
    const part1 = (await orderLines(s.order.id))[0]
    await must(rest('sales', 'rpc/split_order_item', { method: 'POST', body: { p_item_id: part1.id, p_qty: 1, p_supplier_id: s.s3.id, p_currency: 'USD', p_supplier_unit_price: 450 } }))
    await page.reload()
    // the order's panels draw after the page (lazy chunks, perf2), so give the indicator longer than the default 5 s
    await legLoc(page, 'A').waitFor({ timeout: 20_000 })
    const changed = page.getByTestId('leg-A-changed')
    await expect(changed).toContainText('Lines changed since', { timeout: 20_000 })
    await expect(changed).toContainText('was ×3, now ×2')
    await shot(page, 'a8-order-changed-since-po-1440')

    // 1 tap on the indicator opens the Issue dialog on that leg; issuing R1 clears it
    const t = tapper()
    await t.tap(changed.getByRole('button', { name: `Revise PO, ${s.s1.name}` }))
    await expect(dialog(page).getByRole('heading', { name: /Issue|Re-issue/ })).toBeVisible()
    await t.tap(dialog(page).getByRole('button', { name: /^Issue (PO|R1)/ }).last())
    await expect(page.getByTestId('leg-A-changed')).toHaveCount(0)
    await expect(legLoc(page, 'A').getByTestId('leg-A-po')).toHaveText(/ · R1$/)
  })

  test('there is no Received step on a supplier order: Mark placed, then Delivered today', async ({ page }) => {
    const s = await seedSplitOrder()
    await openAs(page, 'sales', `/orders/${s.order.id}`)
    await expect(page.getByRole('button', { name: /Received/ })).toHaveCount(0)
    await expect(legLoc(page, 'A').getByRole('button', { name: /^Issue PO/ })).toBeVisible()
    await legLoc(page, 'A').getByRole('button', { name: /^More for/ }).click()
    await expect(page.getByRole('menuitem', { name: 'Mark placed, no PO' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /Received/ })).toHaveCount(0)
  })

  test('an engineer sees the split item and legs but no selling price, supplier price, spread, ranking, Split line or Edit price, and no request carries them', async ({ page }) => {
    const s = await seedSplitOrder()
    const urls: string[] = []
    page.on('request', r => urls.push(decodeURIComponent(r.url())))
    await openAs(page, 'engineer', `/orders/${s.order.id}`)
    const items = page.getByRole('region', { name: 'Items' })
    await expect(items.getByText('split across 2 suppliers')).toBeVisible()
    await expect(page.getByRole('button', { name: /Split line|Edit price|Revise PO/ })).toHaveCount(0)
    await expect(items.getByText(/Unit price|Unit net/)).toHaveCount(0)
    await expect(items.getByText(/Supplier unit price/)).toHaveCount(0)
    const bad = urls.filter(u => /unit_price_net|supplier_unit_price|rank_item_quotes|sell_unit|spread|purchase_orders\?.*lines|split_order_item/.test(u))
    expect(bad).toEqual([])
  })

  test('an engineer asking the database for the ranking is refused (0081: no price of any kind for an engineer)', async () => {
    const s = await seed()
    const asEngineer = await rest('engineer', 'rpc/rank_item_quotes', { method: 'POST', body: { p_rfq_id: s.rfq.id } })
    expect(asEngineer.status).toBe(403)
    const asSales = await must(rest<Array<{ sell_unit_net: number | null }>>('sales', 'rpc/rank_item_quotes', { method: 'POST', body: { p_rfq_id: s.rfq.id } }))
    expect(asSales.some(r => r.sell_unit_net !== null)).toBe(true)
  })
})

for (const width of [1440, 375]) {
  test(`axe (WCAG 2.2 AA) and review screenshots at ${width}: the split convert dialog, a split order, the Split line dialog`, async ({ page }) => {
    const s = await seed()
    await page.setViewportSize({ width, height: width > 800 ? 1000 : 812 })
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    await markWon(page).click()
    const d = dialog(page)
    await d.getByRole('button', { name: 'Split this item, line 1' }).click()
    await partQty(page, 2).fill('1')
    expect(await dialogViolations(page)).toEqual([])
    await shot(page, `a8-convert-split-${width}`)
    await d.getByRole('button', { name: 'Supplier for part 2, line 1' }).click()
    await shot(page, `a8-convert-picker-${width}`)
    await page.keyboard.press('Escape')
    await d.getByRole('button', { name: 'Create order' }).click()
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/)
    await expect(page.getByText('split across 2 suppliers').first()).toBeVisible()
    await expect(legLoc(page, 'A')).toBeVisible()
    expect(await axeViolations(page)).toEqual([])
    await shot(page, `a8-order-split-${width}`)

    // the Split line dialog; on a phone the row action is in the card, so open it from the first part either way
    await page.getByRole('button', { name: 'Edit GST and lines' }).click()
    await page.getByRole('button', { name: /^Split line 1a/ }).first().click()
    await expect(dialog(page).getByRole('heading', { name: /Split line/ })).toBeVisible()
    await dialog(page).getByLabel('Quantity to move').fill('1')
    expect(await dialogViolations(page)).toEqual([])
    await shot(page, `a8-split-line-dialog-${width}`)
  })
}
