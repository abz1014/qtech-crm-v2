import { expect, test, type Page } from '@playwright/test'
import { createCompany, createRfq, karachiDay, must, rest, rfqRef, uniqueName } from '../support/stack'
import { fetchStoredPdf, pdfIsValid, pdfText } from '../support/pdf'
import { legLoc, setProfile } from '../orders/fixtures'
import { fe2, todayHas, monthOf, noShareApi, openPage, ordRef, pastePage, readCount, resetCount, roleContext } from './support'
import { readClipboardWhen } from '../support/clipboard'

/*
 * P03, the sales journey: one working day from a WhatsApp enquiry to a payment on the books, through the real screens, on the CI stack.
 *
 *   paste the enquiry -> new RFQ -> float to two suppliers (the enquiry text is copied) -> add a question and ask the customer ->
 *   enter the supplier replies (one typed, one pasted) -> the ranked comparison -> issue the quotation PDF -> the bid is marked sent
 *   (and a verbal bid is marked sent in one tap) -> chase the customer -> mark won, converting with rank 1 pre-picked and one split ->
 *   issue the supplier PO -> create the invoice -> (admin) record the payment -> the month-end checklist shows it.
 *
 * Every step reads its interaction count from the browser (mouse presses and named keys, see support.ts) and holds it to the FE-2 target:
 *   New RFQ              at most 3 actions + 1 paste        Float                 at most 2 taps
 *   Supplier reply       at most 1 typed price per item, then 1 tap; or paste + accept, at most 2
 *   Ranked comparison    0 taps                             Issue quotation       at most 1 price per item + 2 taps (Issue, Share)
 *   Mark bid sent        1 tap                              Chase                 1 tap
 *   Win (no changes)     2 taps; with one split: + 1 tap + 1 quantity typed
 *   Issue PO (priced)    2 taps                             Invoice               2 taps, nothing typed
 *   Full payment         2 taps, nothing typed
 * Data that is not part of the day (the customer, the suppliers and what they supplied before, the exchange rates) is made through the
 * API as the admin; everything the salesperson does is done on screen.
 */

const letters = () => Math.random().toString(36).slice(2, 6).replace(/[0-9]/g, c => 'abcdefghij'[Number(c)])
const dialog = (page: Page) => page.getByRole('dialog')
const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text })
const region = (page: Page, name: string) => page.getByRole('region', { name })

type Co = { id: string; name: string }

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

async function post<T = { id: string }>(table: string, body: unknown): Promise<T> {
  return (await must(rest<T[]>('admin', table, { method: 'POST', body })))[0]
}

async function setRates(): Promise<void> {
  for (const r of [
    { currency: 'USD', rate_pkr: 280, as_of: karachiDay(0) },
    { currency: 'EUR', rate_pkr: 300, as_of: karachiDay(0) },
  ]) {
    await must(rest('admin', 'fx_rates?on_conflict=currency,as_of,source', { method: 'POST', body: { ...r, source: 'manual' }, prefer: 'resolution=merge-duplicates,return=minimal' }))
  }
}

interface Seed {
  customer: Co
  alpen: Co // Germany: quotes in EUR, the reply is typed
  lahore: Co // Pakistan, last replied in USD: the reply is pasted
  brand1: string
  brand2: string
  model1: string
  model2: string
  email: string
}

/** A customer, two suppliers who have each supplied both items before, rates for today, and the company profile the PDFs need. */
async function seed(): Promise<Seed> {
  await setProfile(true)
  await setRates()
  const tag = letters()
  const brand1 = `Zetaflow${tag}`
  const brand2 = `Qmeter${tag}`
  const model1 = `QZ${Math.floor(1000 + Math.random() * 9000)}`
  const model2 = `QP${Math.floor(1000 + Math.random() * 9000)}`
  const b1 = await post('brands', { name: brand1, kind: 'brand' })
  const b2 = await post('brands', { name: brand2, kind: 'brand' })

  const customer = await createCompany(uniqueName('Journey Customer'), { city: 'Mianwali' })
  await post('contacts', { company_id: customer.id, name: 'Mr. Kamran Zafar', job_title: 'Procurement Manager' })
  const alpen = await createCompany(uniqueName('Alpenmark Controls'), { country: 'Germany' })
  const lahore = await createCompany(uniqueName('Lahore Process Controls'), { country: 'Pakistan' })
  await must(
    rest('admin', 'company_brands', {
      method: 'POST',
      body: [alpen, lahore].flatMap(c => [b1, b2].map(b => ({ company_id: c.id, brand_id: b.id }))),
      prefer: 'return=minimal',
    }),
  )

  // What each supplier supplied before: an earlier order of both models, bought through them. That earns the pre-tick at intake.
  const past = await createCompany(uniqueName('Earlier Customer'))
  for (const sup of [alpen, lahore]) {
    const order = await post<{ id: string }>('orders', { company_id: past.id })
    const leg = await post('supplier_orders', { order_id: order.id, supplier_id: sup.id })
    await must(
      rest('admin', 'order_items', {
        method: 'POST',
        body: [
          { order_id: order.id, position: 0, description: `${brand1} ${model1} electromagnetic flow meter`, brand_id: b1.id, unit_price_net: 100, supplier_order_id: leg.id },
          { order_id: order.id, position: 1, description: `${brand2} ${model2} pressure transmitter`, brand_id: b2.id, unit_price_net: 100, supplier_order_id: leg.id },
        ],
        prefer: 'return=minimal',
      }),
    )
  }
  // The Pakistani supplier's last reply was in USD, which is where its pre-filled currency comes from (Germany maps to EUR on its own).
  const earlier = await createRfq(past.id)
  const eItem = await post('rfq_items', { rfq_id: earlier.id, description: 'Earlier item', qty: 1 })
  const eInq = await post('supplier_inquiries', { rfq_id: earlier.id, supplier_id: lahore.id, sent_on: karachiDay(-40) })
  await must(rest('admin', 'supplier_quote_lines', { method: 'POST', body: { inquiry_id: eInq.id, rfq_item_id: eItem.id, unit_price: 50, currency: 'USD' }, prefer: 'return=minimal' }))

  const email = [
    'Dear Sir, please quote the following for our plant:',
    `1) ${brand1} ${model1} electromagnetic flow meter DN50 - 4 nos`,
    `2) ${brand2} ${model2} pressure transmitter 0-10 bar - 2 nos`,
    'Regards, Kamran Zafar',
  ].join('\n')
  return { customer, alpen, lahore, brand1, brand2, model1, model2, email }
}

test('sales: from a WhatsApp enquiry to a payment on the books', async ({ browser }, info) => {
  const s = await seed()
  const salesCtx = await roleContext(browser, info, 'sales')
  await noShareApi(salesCtx)
  const adminCtx = await roleContext(browser, info, 'admin')
  const today = karachiDay(0)
  let rfq = { id: '', number: 0 }
  let order = { id: '', number: 0 }
  let page!: Page

  // ---- 1. Paste the enquiry: a new RFQ -------------------------------------------------------------------------------------------
  await test.step('paste the enquiry: company, paste, Looks right', async () => {
    page = await openPage(salesCtx, '/rfqs/new')
    await expect(page.getByRole('heading', { name: 'New RFQ', level: 1 })).toBeVisible()
    await resetCount(page)
    let actions = 0
    await page.getByRole('combobox', { name: 'Company' }).fill(s.customer.name)
    actions++
    await page.getByRole('option', { name: new RegExp(s.customer.name) }).click()
    actions++
    await pastePage(page, { text: s.email }) // the one paste
    await expect(page.getByText('2 items found').first()).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Quantity of item 1' })).toHaveValue('4 nos')
    await expect(page.getByRole('textbox', { name: 'Quantity of item 2' })).toHaveValue('2 nos')
    await page.getByRole('button', { name: 'Looks right: find suppliers' }).click()
    actions++
    fe2('New RFQ: company (2) + Looks right, after 1 paste', actions, 3)
    fe2('New RFQ: mouse presses', (await readCount(page)).mouse, 3)
  })

  // ---- 2. Float to the suppliers: the enquiry text is copied --------------------------------------------------------------------
  await test.step('float to both suppliers: Write the enquiry, Copy and mark floated', async () => {
    // Both suppliers supplied both items before, so both are ticked with nothing tapped.
    await expect(page.getByRole('checkbox', { name: s.alpen.name })).toBeChecked()
    await expect(page.getByRole('checkbox', { name: s.lahore.name })).toBeChecked()
    await resetCount(page)
    await page.getByRole('button', { name: 'Write the enquiry' }).click()
    await expect(page.getByRole('heading', { name: /Enquiry to 2 suppliers/ })).toBeVisible()
    await page.getByRole('button', { name: 'Copy & mark floated to 2' }).click()
    await expect(page.getByText(/is out for prices/)).toBeVisible()
    fe2('Float to 2 suppliers: Write the enquiry, Copy and mark floated', (await readCount(page)).mouse, 2)

    const rows = await must(rest<{ id: string; number: number; owner_id: string }[]>('admin', `rfqs?company_id=eq.${s.customer.id}&select=id,number,owner_id`))
    expect(rows).toHaveLength(1)
    rfq = rows[0]
    expect(rows[0].owner_id).toBe('a0000000-0000-4000-8000-000000000002') // the salesperson, with nothing typed
    const text = await readClipboardWhen(page, `our ref *${rfqRef(rfq.number)}*`)
    expect(text).not.toContain('####')
    expect(text).toContain(`${s.brand1} ${s.model1} electromagnetic flow meter DN50, 4 nos`)
    expect(text).toContain(`${s.brand2} ${s.model2} pressure transmitter 0-10 bar, 2 nos`)
    const inquiries = await must(rest<{ supplier_id: string; sent_on: string | null }[]>('admin', `supplier_inquiries?rfq_id=eq.${rfq.id}&select=supplier_id,sent_on`))
    expect(inquiries.map(i => i.supplier_id).sort()).toEqual([s.alpen.id, s.lahore.id].sort())
    expect(inquiries.every(i => i.sent_on === today)).toBe(true)

    // Hand-off: floated, so "not floated" is gone. The enquiries went out a week ago (the date is moved back), so both suppliers are due a chase.
    await todayHas(salesCtx, 'not_floated', [rfqRef(rfq.number)], false)
    await must(rest('admin', `supplier_inquiries?rfq_id=eq.${rfq.id}`, { method: 'PATCH', body: { sent_on: karachiDay(-7) }, prefer: 'return=minimal' }))
    await todayHas(salesCtx, 'chase_supplier', [rfqRef(rfq.number), s.alpen.name], true)
    await todayHas(salesCtx, 'chase_supplier', [rfqRef(rfq.number), s.lahore.name], true)
  })

  // ---- 3. The RFQ page: ask the customer a question ----------------------------------------------------------------------------
  await test.step('open the RFQ and ask the customer a question: 1 paste + 1 tap, then 1 tap to copy', async () => {
    const open = page.getByRole('link', { name: `Open ${rfqRef(rfq.number)}` })
    if (await open.count()) await open.first().click()
    else await page.goto(`/rfqs/${rfq.id}`)
    await expect(page.getByRole('heading', { level: 1, name: new RegExp(`RFQ-0*${rfq.number}`) })).toBeVisible()
    const panel = page.locator('[data-slot="clarifications"]')
    await resetCount(page)
    await panel.getByRole('textbox', { name: 'Add questions' }).fill('Flange rating and line size on the process line, please?') // the paste
    await panel.getByRole('button', { name: 'Add question', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: /questions? added/i }).first()).toBeVisible()
    fe2('Add a question: 1 paste + 1 tap', (await readCount(page)).mouse, 1)
    await resetCount(page)
    await panel.getByRole('button', { name: 'Copy questions for customer' }).click()
    await expect(toast(page, 'Questions copied')).toBeVisible()
    fe2('Copy the question for the customer', (await readCount(page)).mouse, 1)
    await readClipboardWhen(page, 'Flange rating and line size on the process line')
    const [q] = await must(rest<{ ask_count: number }[]>('admin', `clarifications?rfq_id=eq.${rfq.id}&select=ask_count`))
    expect(q.ask_count).toBe(1)
    // Hand-off: asked eight days ago (moved back), so the customer is due a chase.
    await must(rest('admin', `clarifications?rfq_id=eq.${rfq.id}`, { method: 'PATCH', body: { first_asked_at: daysAgo(8), last_asked_at: daysAgo(8) }, prefer: 'return=minimal' }))
    await todayHas(salesCtx, 'chase_customer', [rfqRef(rfq.number)], true)
  })

  // ---- 4. Supplier replies: one typed, one pasted -------------------------------------------------------------------------------
  await test.step('enter the replies: typed prices and one tap; a pasted reply and one accept', async () => {
    const linesOf = (supplierId: string) =>
      must(
        rest<{ unit_price: number; currency: string; fx_rate_pkr: number | null }[]>(
          'admin',
          `supplier_quote_lines?select=unit_price,currency,fx_rate_pkr,supplier_inquiries!inner(supplier_id,rfq_id)&supplier_inquiries.rfq_id=eq.${rfq.id}&supplier_inquiries.supplier_id=eq.${supplierId}&order=unit_price`,
        ),
      )
    // Alpenmark: the currency follows the supplier (EUR, usual for Germany); two prices typed, one Save reply.
    const a = region(page, s.alpen.name)
    await expect(a.getByText(/EUR, usual for Germany/)).toBeVisible()
    await resetCount(page)
    let typed = 0
    await a.getByLabel(`Price for item 1 from ${s.alpen.name}`).fill('90')
    typed++
    await a.getByLabel(`Price for item 2 from ${s.alpen.name}`).fill('200')
    typed++
    await a.getByRole('button', { name: 'Save reply' }).click()
    await expect(toast(page, 'Reply saved')).toBeVisible()
    fe2('Supplier reply, typed: prices typed (one per item)', typed, 2)
    fe2('Supplier reply, typed: taps after the prices', (await readCount(page)).mouse, 1)
    const aLines = await linesOf(s.alpen.id)
    expect(aLines.map(l => [Number(l.unit_price), l.currency, Number(l.fx_rate_pkr)])).toEqual([
      [90, 'EUR', 300],
      [200, 'EUR', 300],
    ])

    // Lahore: the reply as the supplier wrote it, pasted from the clipboard; nothing is saved until Accept.
    const b = region(page, s.lahore.name)
    await page.evaluate(t => navigator.clipboard.writeText(t), ['Dear Sir,', `${s.model1} DN50 - USD 100.00 each, 3 weeks`, `${s.model2} 0-10 bar - USD 190.00 each, 2 weeks`, 'Regards'].join('\n'))
    await resetCount(page)
    await b.getByRole('button', { name: 'Paste reply' }).click()
    await expect(b.getByText('Read from their reply')).toBeVisible()
    expect(await linesOf(s.lahore.id)).toHaveLength(0)
    await b.getByRole('button', { name: 'Accept 2 offers' }).click()
    await expect(toast(page, 'Reply saved')).toBeVisible()
    fe2('Supplier reply, pasted: Paste reply + Accept', (await readCount(page)).mouse, 2)
    const bLines = await linesOf(s.lahore.id)
    expect(bLines.map(l => [Number(l.unit_price), l.currency, Number(l.fx_rate_pkr)])).toEqual([
      [100, 'USD', 280],
      [190, 'USD', 280],
    ])
  })

  await test.step('hand-off: both suppliers replied, so no supplier chase; the customer chase is one tap on Today', async () => {
    await todayHas(salesCtx, 'chase_supplier', [rfqRef(rfq.number)], false)
    const t = await openPage(salesCtx, '/today')
    const row = t.locator('li[data-rule="chase_customer"]').filter({ hasText: rfqRef(rfq.number) })
    await expect(row).toBeVisible()
    await row.getByRole('button').first().click() // selecting a row is not a chase
    const pane = t.getByRole('region', { name: new RegExp(rfqRef(rfq.number)) })
    await expect(pane.getByTestId('draft-text')).toContainText('Flange rating and line size')
    await resetCount(t)
    await pane.getByRole('button', { name: 'Copy message and mark chased' }).click()
    await expect(t.getByRole('status').filter({ hasText: `Copied. ${rfqRef(rfq.number)} marked chased.` })).toBeVisible()
    fe2('Chase the customer from Today', (await readCount(t)).mouse, 1)
    await readClipboardWhen(t, 'Flange rating and line size')
    await t.close()
  })

  // ---- 5. The ranked comparison: 0 taps -----------------------------------------------------------------------------------------
  await test.step('the ranked comparison is on the page with 0 taps', async () => {
    await resetCount(page)
    // Item 1: Alpenmark EUR 90 = PKR 27,000, Lahore USD 100 = PKR 28,000 (3.7% dearer: outside the 2% band). Item 2: Lahore USD 190 = 53,200 beats Alpenmark 60,000.
    const rank = async (item: string) => {
      const art = page.getByRole('article', { name: item })
      await expect(art.locator('li[data-ranked]')).toHaveCount(2)
      return {
        order: await art.locator('li[data-ranked]').evaluateAll(els => els.map(e => e.getAttribute('data-ranked'))),
        names: await art.locator('li[data-ranked]').allInnerTexts(),
        art,
      }
    }
    const one = await rank('Item 1')
    expect(one.order).toEqual(['1', '2'])
    expect(one.names[0]).toContain(s.alpen.name)
    expect(one.names[1]).toContain(s.lahore.name)
    await expect(one.art.locator('[data-rank-note]')).toBeVisible()
    await expect(one.art.locator('[data-sell-note]')).toContainText('No selling price yet') // nothing is quoted yet, so no spread is invented
    const two = await rank('Item 2')
    expect(two.order).toEqual(['1', '2'])
    expect(two.names[0]).toContain(s.lahore.name)
    expect(two.names[1]).toContain(s.alpen.name)
    fe2('Ranked comparison: taps to see it', (await readCount(page)).mouse, 0)
  })

  // ---- 6. Issue the quotation PDF --------------------------------------------------------------------------------------------------
  await test.step('issue the quotation: one price per item, Issue, Share', async () => {
    await resetCount(page)
    await page.locator('[data-slot="issue-quotation"]').getByRole('button', { name: /Issue/ }).click()
    await expect(page.getByRole('list', { name: 'Items to quote' })).toBeVisible()
    const d = dialog(page)
    await expect(d.getByLabel('Addressed to')).toContainText('Mr. Kamran Zafar')
    let typed = 0
    await d.getByLabel('Unit price, net PKR, item 1').fill('34000')
    typed++
    await d.getByLabel('Unit price, net PKR, item 2').fill('66000')
    typed++
    // 4 x 34,000 + 2 x 66,000 = 268,000 net; GST 18% = 48,240; gross 316,240.
    await expect(d.getByTestId('total-net')).toHaveText('PKR 268,000')
    await expect(d.getByTestId('total-gst')).toHaveText('PKR 48,240')
    await expect(d.getByTestId('total-gross')).toHaveText('PKR 316,240')
    await d.getByRole('button', { name: 'Issue quotation' }).click()
    await expect(d.getByTestId('pdf-ready')).toBeVisible({ timeout: 30_000 })
    const download = page.waitForEvent('download')
    await d.getByRole('button', { name: 'Share' }).click()
    const file = await download
    const c = await readCount(page)
    fe2('Issue quotation: prices typed (one per item)', typed, 2)
    // The dialog is opened from the header (1), then Issue and Share are the 2 taps of the FE-2 line.
    fe2('Issue quotation: Issue + Share, with the one tap that opens the dialog', c.mouse, 3)
    await d.getByRole('button', { name: 'Done' }).click()

    // With a selling price in, the salesperson's comparison shows the spread (an engineer's never does). Opening the reasons is optional.
    const first = page.getByRole('article', { name: 'Item 1' }).locator('li[data-ranked="1"]')
    const reasons = first.getByRole('button', { name: `Show reasons for ${s.alpen.name}` })
    if (await reasons.count()) await reasons.click()
    await expect(first).toContainText('Spread ≈ PKR 7,000 each, PKR 28,000 for 4, against our quoted PKR 34,000')

    const [q] = await must(
      rest<{ id: string; number: number; issued_on: string; net_total: number; gst_total: number; pdf_path: string | null }[]>('admin', `quotations?rfq_id=eq.${rfq.id}&select=id,number,issued_on,net_total,gst_total,pdf_path`),
    )
    expect(Number(q.net_total)).toBe(268000)
    expect(Number(q.gst_total)).toBe(48240)
    const ref = `QT-${q.issued_on.slice(2, 4)}-${String(q.number).padStart(4, '0')}`
    expect(file.suggestedFilename()).toBe(`${ref}-R0.pdf`)
    const stored = await fetchStoredPdf('sales', 'generated-docs', q.pdf_path as string)
    expect(pdfIsValid(stored)).toBe(true)
    const text = stored ? pdfText(stored) : null
    if (text) {
      expect(text).toContain(ref)
      expect(text).toContain('PKR 316,240')
      expect(text).toContain(s.customer.name)
    }
  })

  // ---- 7. The bid is sent -------------------------------------------------------------------------------------------------------------
  await test.step('mark bid sent: issuing the PDF already marked it, a verbal bid is one tap', async () => {
    for (const rule of ['not_floated', 'chase_supplier', 'bid_due', 'chase_customer'] as const) await todayHas(salesCtx, rule, [rfqRef(rfq.number)], false)
    const quoted = await must(rest<{ quoted_on: string | null }[]>('admin', `rfqs?id=eq.${rfq.id}&select=quoted_on`))
    expect(quoted[0].quoted_on).toBe(today) // issuing the quotation sent the bid: no further tap is needed
    await expect(page.getByRole('button', { name: 'Mark bid sent' })).toHaveCount(0)

    // The sales person also quotes by phone: that bid has no PDF, and "Mark bid sent" is the one tap.
    const verbal = await createRfq(s.customer.id, { due_on: karachiDay(5), owner_id: 'a0000000-0000-4000-8000-000000000002' })
    await post('rfq_items', { rfq_id: verbal.id, position: 0, description: `Spare gasket set ${letters()}`, qty: 1 })
    // Hand-off: it has not been floated and its bid is due in five days: both reminders are listed until the bid is sent.
    await todayHas(salesCtx, 'not_floated', [rfqRef(verbal.number)], true)
    await todayHas(salesCtx, 'bid_due', [rfqRef(verbal.number)], true)
    const side = await openPage(salesCtx, `/rfqs/${verbal.id}`)
    await resetCount(side)
    await side.getByRole('button', { name: 'Mark bid sent' }).click()
    await expect(toast(side, 'Marked bid sent')).toBeVisible()
    fe2('Mark bid sent (a verbal bid)', (await readCount(side)).mouse, 1)
    const after = await must(rest<{ quoted_on: string | null }[]>('admin', `rfqs?id=eq.${verbal.id}&select=quoted_on`))
    expect(after[0].quoted_on).toBe(today)
    await side.close()
    await todayHas(salesCtx, 'not_floated', [rfqRef(verbal.number)], false)
    await todayHas(salesCtx, 'bid_due', [rfqRef(verbal.number)], false)
  })

  // ---- 8. Chase the customer -------------------------------------------------------------------------------------------------------
  await test.step('chase the customer: Copy chase text is one tap', async () => {
    await page.reload() // the Today chase was made on another page
    const panel = page.locator('[data-slot="clarifications"]')
    await expect(panel.getByText('Asked ×2')).toBeVisible() // the Today chase was the second ask
    await resetCount(page)
    await panel.getByRole('button', { name: 'Copy chase text' }).click()
    await expect(toast(page, 'Chase text copied')).toBeVisible()
    fe2('Chase the customer', (await readCount(page)).mouse, 1)
    await readClipboardWhen(page, `our ref *${rfqRef(rfq.number)}*`)
    await expect.poll(async () => (await must(rest<{ ask_count: number }[]>('admin', `clarifications?rfq_id=eq.${rfq.id}&select=ask_count`)))[0].ask_count).toBe(3)
  })

  // ---- 9. Won: convert with rank 1 pre-picked and one split ------------------------------------------------------------------------
  await test.step('mark won: rank 1 pre-picked on every line, one item split across two suppliers', async () => {
    await resetCount(page)
    await page.locator('[data-slot="mark-won"]').getByRole('button', { name: 'Mark won' }).click()
    const d = dialog(page)
    await expect(d.getByRole('heading', { name: 'Mark won' })).toBeVisible()
    // Rank 1 is already chosen for each line, with the reason under the name; nothing was tapped for it.
    await expect(d.getByRole('button', { name: 'Supplier for line 1' })).toContainText(s.alpen.name)
    await expect(d.getByRole('button', { name: 'Supplier for line 2' })).toContainText(s.lahore.name)
    await expect(d.getByRole('button', { name: 'Supplier for line 1' })).toContainText('Best price')
    await expect(d.getByText('Creates 2 order lines.')).toBeVisible()
    // Split line 1 (4 pieces): the next-ranked supplier is offered for part 2; one quantity typed, the first part takes the remainder.
    await d.getByRole('button', { name: 'Split this item, line 1' }).click()
    await expect(d.getByRole('button', { name: 'Supplier for part 2, line 1' })).toContainText(s.lahore.name)
    await d.getByLabel('Quantity, part 2, line 1').fill('1')
    const typed = 1
    await expect(d.getByLabel('Quantity, part 1, line 1')).toHaveValue('3')
    await expect(d.getByTestId('convert-item-1-sum')).toContainText('3 + 1 = 4')
    await expect(d.getByText('Creates 3 order lines.')).toBeVisible()
    await d.getByRole('button', { name: 'Create order' }).click()
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/)
    const taps = (await readCount(page)).mouse
    // Mark won + Create order are the 2 taps of an unchanged win; the split adds Split this item (1 tap) and the quantity (1 typed).
    fe2('Win with one split: taps (Mark won, Split this item, Create order)', taps, 3)
    fe2('Win with one split: quantities typed', typed, 1)

    const orders = await must(rest<{ id: string; number: number }[]>('admin', `orders?rfq_id=eq.${rfq.id}&select=id,number`))
    expect(orders).toHaveLength(1)
    order = orders[0]
    const lines = await must(
      rest<{ qty: number; unit_price_net: number; supplier_unit_price: number | null; supplier_order_id: string | null }[]>('admin', `order_items?order_id=eq.${order.id}&select=qty,unit_price_net,supplier_unit_price,supplier_order_id&order=position,created_at`),
    )
    expect(lines.map(l => [Number(l.qty), Number(l.unit_price_net), Number(l.supplier_unit_price)])).toEqual([
      [3, 34000, 90],
      [1, 34000, 100],
      [2, 66000, 190],
    ])
    const legs = await must(rest<{ id: string; supplier_id: string }[]>('admin', `supplier_orders?order_id=eq.${order.id}&select=id,supplier_id`))
    expect(legs.map(l => l.supplier_id).sort()).toEqual([s.alpen.id, s.lahore.id].sort())
    await expect(page.getByText('split across 2 suppliers').first()).toBeVisible()
    // Hand-off: two legs, neither ordered from the supplier yet.
    await todayHas(salesCtx, 'place_po', [ordRef(order.number), s.alpen.name], true)
    await todayHas(salesCtx, 'place_po', [ordRef(order.number), s.lahore.name], true)
  })

  // ---- 10. The supplier PO ---------------------------------------------------------------------------------------------------------------
  await test.step('issue the supplier PO to Alpenmark: every line priced, 2 taps, nothing typed', async () => {
    const letter = (await legLoc(page, 'A').innerText()).includes(s.alpen.name) ? 'A' : 'B'
    expect((await legLoc(page, letter).innerText()).includes(s.alpen.name)).toBe(true)
    await resetCount(page)
    await legLoc(page, letter).getByRole('button', { name: `Issue PO, leg ${letter}` }).click()
    const d = dialog(page)
    await expect(d.getByRole('heading', { name: 'Issue purchase order' })).toBeVisible()
    await expect(d.getByTestId('po-missing')).toHaveCount(0) // the supplier price came with the rank-1 quote
    await expect(d.getByTestId('po-source-1')).toContainText('order')
    await d.getByRole('button', { name: 'Issue PO' }).click()
    await expect(dialog(page)).toHaveCount(0, { timeout: 30_000 })
    await expect(page.getByText(/^Issued PO-\d\d-\d{4} · R0/)).toBeVisible()
    fe2('Issue PO (every line priced): Issue PO on the leg, Issue PO in the dialog', (await readCount(page)).mouse, 2)

    const [po] = await must(
      rest<{ id: string; number: number; currency: string; total: number; pdf_path: string | null }[]>('admin', `purchase_orders?select=id,number,currency,total,pdf_path&supplier_order_id=eq.${(await legIdOf(order.id, s.alpen.id))}`),
    )
    expect(po.currency).toBe('EUR')
    expect(Number(po.total)).toBe(270) // 3 x EUR 90
    const stored = await fetchStoredPdf('sales', 'generated-docs', po.pdf_path as string)
    expect(pdfIsValid(stored)).toBe(true)
    const text = stored ? pdfText(stored) : null
    if (text) {
      expect(text).toContain('Purchase order')
      expect(text).toContain(s.alpen.name)
      expect(text).toContain('EUR 270.00')
    }
    await expect(legLoc(page, letter).getByTestId(`leg-${letter}-state`)).toContainText('On order')
    // Hand-off: Alpenmark is placed, Lahore is still to place.
    await todayHas(salesCtx, 'place_po', [ordRef(order.number), s.alpen.name], false)
    await todayHas(salesCtx, 'place_po', [ordRef(order.number), s.lahore.name], true)
  })

  await test.step('goods: late is raised, delivered clears it, and delivered-not-invoiced takes over', async () => {
    const alpenLeg = await legIdOf(order.id, s.alpen.id)
    const lahoreLeg = await legIdOf(order.id, s.lahore.id)
    // The expected date of the goods passes (moved back three days).
    await must(rest('admin', `supplier_orders?id=eq.${alpenLeg}`, { method: 'PATCH', body: { expected_on: karachiDay(-3) }, prefer: 'return=minimal' }))
    await todayHas(salesCtx, 'goods_late', [s.alpen.name], true)
    // Lahore is ordered with one tap, then it is late too.
    const letterOf = async (name: string) => ((await legLoc(page, 'A').innerText()).includes(name) ? 'A' : 'B')
    const lLetter = await letterOf(s.lahore.name)
    const aLetter = await letterOf(s.alpen.name)
    await resetCount(page)
    await legLoc(page, lLetter).getByRole('button', { name: `Mark placed, leg ${lLetter}` }).click()
    await expect.poll(async () => (await must(rest<{ placed_on: string | null }[]>('admin', `supplier_orders?id=eq.${lahoreLeg}&select=placed_on`)))[0].placed_on).toBe(today)
    fe2('Mark placed', (await readCount(page)).mouse, 1)
    await todayHas(salesCtx, 'place_po', [ordRef(order.number), s.lahore.name], false)
    await must(rest('admin', `supplier_orders?id=eq.${lahoreLeg}`, { method: 'PATCH', body: { expected_on: karachiDay(-2) }, prefer: 'return=minimal' }))
    await todayHas(salesCtx, 'goods_late', [s.lahore.name], true)
    // Delivered: one tap each, and nothing is late any more.
    for (const [letter, id] of [[aLetter, alpenLeg], [lLetter, lahoreLeg]] as const) {
      await resetCount(page)
      await legLoc(page, letter).getByRole('button', { name: `Delivered today, leg ${letter}` }).click()
      await expect.poll(async () => (await must(rest<{ delivered_on: string | null }[]>('admin', `supplier_orders?id=eq.${id}&select=delivered_on`)))[0].delivered_on).toBe(today)
      fe2('Mark delivered', (await readCount(page)).mouse, 1)
    }
    await todayHas(salesCtx, 'goods_late', [s.alpen.name], false)
    await todayHas(salesCtx, 'goods_late', [s.lahore.name], false)
    await todayHas(salesCtx, 'delivered_not_invoiced', [ordRef(order.number)], true)
  })

  // ---- 11. The invoice ----------------------------------------------------------------------------------------------------------------------
  await test.step('create the invoice: 2 taps, nothing typed', async () => {
    await resetCount(page)
    await page.locator('[data-slot="order-actions"]').getByRole('button', { name: 'Create invoice' }).click()
    const d = page.getByRole('dialog', { name: 'Create invoice' })
    await expect(d.getByRole('textbox', { name: 'Invoice number' })).toHaveValue(/.+/)
    await expect(d.getByText('GST, 18%')).toBeVisible()
    await expect(d.getByText('268,000')).toBeVisible()
    await d.getByRole('button', { name: 'Create invoice' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    const c = await readCount(page)
    fe2('Create invoice: open + Create', c.mouse, 2)
    expect(c.keys).toEqual([]) // nothing typed
    const [inv] = await must(rest<{ net_amount: number; gst_amount: number; invoice_date: string }[]>('admin', `invoices?order_id=eq.${order.id}&select=net_amount,gst_amount,invoice_date`))
    expect(inv).toMatchObject({ invoice_date: today })
    expect(Number(inv.net_amount)).toBe(268000)
    expect(Number(inv.gst_amount)).toBe(48240)
    await todayHas(salesCtx, 'delivered_not_invoiced', [ordRef(order.number)], false)
    // Hand-off: the invoice is dated forty-five days back on thirty-day terms (the dates are moved), so the payment is fifteen days overdue.
    await must(rest('admin', `orders?id=eq.${order.id}`, { method: 'PATCH', body: { payment_terms_days: 30 }, prefer: 'return=minimal' }))
    await must(rest('admin', `invoices?order_id=eq.${order.id}`, { method: 'PATCH', body: { invoice_date: karachiDay(-45) }, prefer: 'return=minimal' }))
    await todayHas(salesCtx, 'payment_overdue', [ordRef(order.number), 'Payment 15 days overdue'], true)
  })

  // ---- 12. Admin records the payment ---------------------------------------------------------------------------------------------------------
  await test.step('(admin) record the payment in full: 2 taps, the amount is the balance due', async () => {
    const admin = await openPage(adminCtx, `/orders/${order.id}`)
    await expect(admin.getByText(ordRef(order.number)).first()).toBeVisible()
    await resetCount(admin)
    await admin.locator('[data-slot="order-actions"]').getByRole('button', { name: 'Record payment' }).click()
    const d = admin.getByRole('dialog', { name: 'Record payment' })
    await expect(d.getByRole('textbox', { name: 'Amount received, PKR' })).toHaveValue('316,240')
    await d.getByRole('button', { name: 'Save payment' }).click()
    await expect(admin.getByRole('dialog')).toBeHidden()
    const c = await readCount(admin)
    fe2('Record payment in full: open + Save', c.mouse, 2)
    expect(c.keys).toEqual([])
    const pays = await must(rest<{ amount: number; received_on: string }[]>('admin', `payments_in?order_id=eq.${order.id}&select=amount,received_on`))
    expect(pays.map(p => [Number(p.amount), p.received_on])).toEqual([[316240, today]])
    const rec = await must(rest<{ balance: number; payment_state: string }[]>('admin', 'rpc/order_receivables', { method: 'POST', body: { p_order_id: order.id } }))
    expect(rec[0]).toMatchObject({ balance: 0, payment_state: 'settled' })
    await todayHas(salesCtx, 'payment_overdue', [ordRef(order.number)], false)

    // ---- 13. The month-end checklist shows it -----------------------------------------------------------------------------------------------
    const month = monthOf(today)
    await admin.goto(`/money/month-end?month=${month.key}`)
    await admin.locator('#main').waitFor()
    // The current month cannot be closed yet, but its checks already count what the day produced: a bank payment not yet ticked against a
    // statement, and an invoice with no FBR deposit date.
    const bank = admin.getByTestId('check-bank_unticked')
    await expect(bank).toBeVisible()
    await expect(bank).not.toHaveAttribute('data-clear', /.*/)
    await expect(bank.locator('span.num').first()).not.toHaveText('0')
    const fbr = admin.getByTestId('check-fbr_pending')
    await expect(fbr).not.toHaveAttribute('data-clear', /.*/)
    await expect(fbr.locator('span.num').first()).not.toHaveText('0')
    await admin.close()
  })

  await salesCtx.close()
  await adminCtx.close()
})

async function legIdOf(orderId: string, supplierId: string): Promise<string> {
  const legs = await must(rest<{ id: string }[]>('admin', `supplier_orders?order_id=eq.${orderId}&supplier_id=eq.${supplierId}&select=id`))
  expect(legs).toHaveLength(1)
  return legs[0].id
}
