import { test, type Locator } from '@playwright/test'
import { fetchStoredPdf, pdfIsValid, pdfText } from '../../support/pdf'
import { api } from '../../verify-roles/lib'
import { as, db, num, rpcAs, USER } from '../../verify/support/db'
import { karachiDay, letters, post, postMany, setProfile, setRates } from '../../verify/support/fixtures'
import { openMarkWon } from '../../verify/support/session'
import { amount } from '../../verify/support/text'
import { T, today, slashDate, addDays, flat, same, r2, orderRef, obs, want, lineMath, totalsOf, newPage, until, toast, undoIn, actions, legRows, legRowByCcy, ITEMS, seedCast, reply, winRpc, PRICE, standardReplies, SELL, issueQuote, itemsOf, legsOf, orderRow, orderTotal, stateOf, rfqState, posOf, winUi, issueUi, seedImported, seedImportedOrder, liveOrder, issuePoRpc, todayItems, spy, PRICE_STRINGS, repeatVia, type Cast, type RankRow } from './jobflow-support'
import { ctxAs, layout, probe, settle, shot, visit } from './support'

/*
 * Exploratory hunt, "job flow": the whole life of a job, RFQ -> quotation -> won -> order -> supplier orders / POs -> delivery ->
 * commissioning -> invoice -> payment, walked the way the app (or the legacy import) really produces the data.
 *
 * SEEDING RULES. Only what the app or the import would really write is seeded:
 *   - rfq_items.quoted_unit_price_net is NEVER set directly. A quotation is issued the way the dialog does it (the issue_quotation
 *     function with p_lines) or through the dialog itself, so the prices on the RFQ are the ones a quotation carried.
 *   - supplier replies are rows in supplier_inquiries / supplier_quote_lines (what Save reply writes).
 *   - an imported RFQ carries a legacy_source marker, legacy_flags and quoted_on and has NO quotation and NO quoted price; its quote
 *     lines carry currency_unverified (and item_guessed on a multi-item RFQ, where every quote is attached to the first item).
 *   - orders are made by Mark won (the dialog, or convert_rfq_to_order with the payload the dialog builds), never by inserting rows.
 *
 * Every step is a probe (a failure is written down with a screenshot and the test goes on); a wrong answer that is not an
 * exception is a `want` (an observation). Confirmed bugs are pinned as test.fail('HW-n') in bugs.spec.ts.
 *
 * Fictional data: customer "Indus Fibre Mills"; supplier A "Lahore Switchgear" (PKR); supplier B "Gulf Instrumentation FZE" (USD and
 * EUR); items 1 Schneider LC1D25 contactor x10, 2 Siemens S7-1200 PLC x1, 3 E+H PMC71 pressure transmitter x2, 4 level switch x4
 * (no supplier price), 5 "Commissioning and loop check" x1 (a service).
 *
 *   S1  full quote in the app, two suppliers, mixed currencies, Mark won, order
 *   S2  partial quote: R0 covers items 1-4, R1 covers items 1-2
 *   S3  imported RFQ marked quotation sent (1 item, 3 items), no quotation
 *   S4  in-app Mark quotation sent, Undo, then Mark won
 *   S5  FX: a 5 day old rate, a 40 day old rate, PO and payables in USD, Margins in PKR, the rate stamped on the quote line
 *   S6  split an item between two suppliers
 *   S7  PO per supplier order: prefill, PDFs, revise, a line assigned later, an unpriced line
 *   S8  delivery: partial, Delivered today and Undo, double click, expected date, delivered before the PO
 *   S9  commissioning on a 375 px phone, no prices for the engineer, invoice reminder held until done
 *   S10 invoice (full, part, mixed GST, before delivery), numbering, payments (part, rest, over), Who owes us, PDF
 *   S11 cancel and reorder
 *   S12 repeat order from delivered / cancelled / imported orders, then a PO
 *   S13 roles
 *   S14 robustness: double click, two tabs, back/reload with the dialog open, 375 px
 */


// ------------------------------------------------------------------------------------------------ S1: full quote, two suppliers, mixed currencies

test('jobflow S1: a full quote issued in the app, two suppliers in three currencies, Mark won, the order', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const c = await seedCast()
  await standardReplies(c)
  const sales = await ctxAs(browser, info, 'sales', 'desktop')
  const page = await newPage(sales, info, 'S1 sales')
  await visit(page, info, `/rfqs/${c.rfq.id}`)

  const want5 = totalsOf(SELL.map((price, i) => ({ qty: ITEMS[i].qty, price, gst: i === 4 ? 0 : 18 })))
  const dlg = await issueUi(page, info, 'S1', { 0: SELL[0], 1: SELL[1], 2: SELL[2], 3: SELL[3], 4: SELL[4] }, { exemptItem: 4, payment: '30 days from invoice', delivery: 'To site, 3 weeks' })
  await probe(info, page, 'S1 the quotation dialog totals equal the hand-worked totals', async () => {
    want(info, 'S1 quote totals', dlg.net.includes(amount(want5.net)) && dlg.gross.includes(amount(want5.gross)), `dialog net/gross "${dlg.net}" "${dlg.gross}" != ${amount(want5.net)} / ${amount(want5.gross)}`)
    const q = await db.one<{ net_total: number; gst_total: number; lines: unknown[] }>(`quotations?rfq_id=eq.${c.rfq.id}&select=net_total,gst_total,lines`)
    want(info, 'S1 quote totals', same(num(q.net_total), want5.net) && same(num(q.gst_total), want5.gst), `stored quotation net/gst ${q.net_total}/${q.gst_total} != ${want5.net}/${want5.gst}`)
    const s = await rfqState(c.rfq.id)
    want(info, 'S1 rfq state', s.bid_state === 'bid_sent' && s.outcome === 'open', `after issuing: ${JSON.stringify(s)}`)
  })

  await probe(info, page, 'S1 the quotation PDF carries the totals and the exempt service line', async () => {
    const q = await db.one<{ pdf_path: string | null }>(`quotations?rfq_id=eq.${c.rfq.id}&select=pdf_path`)
    const pdf = q.pdf_path ? await fetchStoredPdf('sales', 'generated-docs', q.pdf_path) : null
    want(info, 'S1 quotation PDF', pdfIsValid(pdf), 'the quotation has no valid stored PDF')
    const text = pdf ? pdfText(pdf) : null
    if (!text) return
    for (const needle of [amount(want5.gross, { always: true }), amount(want5.net, { always: true }), amount(want5.gst, { always: true }), 'Commissioning and loop check', c.customer.name, '30 days from invoice']) want(info, 'S1 quotation PDF', flat(text).includes(needle), `the quotation PDF lacks "${needle}"`, flat(text).slice(0, 500))
  })

  await page.reload()
  await settle(page)
  const PO = `PO-${letters(5).toUpperCase()}`
  const won = await winUi(page, info, 'S1', async d => {
    await d.getByLabel(/^Customer PO number/).fill(PO)
    want(info, 'S1 dialog', /Creates 5 order lines/.test(flat(await d.innerText())), 'the dialog does not say "Creates 5 order lines"', flat(await d.innerText()).slice(0, 300))
    const needs = await d.getByRole('checkbox', { name: /Needs commissioning/ }).getAttribute('aria-checked')
    want(info, 'S1 dialog', needs === 'true', `"Needs commissioning" is ${needs}, the guess from "Commissioning and loop check" should switch it on`)
    const terms = await d.getByLabel('Payment terms in days').inputValue()
    want(info, 'S1 dialog', terms === '30', `payment terms in the dialog are "${terms}", the quotation says 30 days from invoice`)
    await shot(page, 'S1-mark-won-dialog')
  })
  want(info, 'S1 dialog totals', won.totals.includes(amount(want5.net)) && won.totals.includes(amount(want5.gst)) && won.totals.includes(amount(want5.gross)), `Mark won dialog totals "${won.totals}" != net ${amount(want5.net)} GST ${amount(want5.gst)} gross ${amount(want5.gross)}`)
  want(info, 'S1 dialog legs', /3 supplier orders/.test(won.legsText), `the dialog says "${won.legsText}", expected 3 supplier orders (A PKR, B USD, B EUR)`)
  if (!won.orderId) return void (await sales.close())
  const id = won.orderId

  await probe(info, page, 'S1 the order matches the quote', async () => {
    const items = await itemsOf(id)
    want(info, 'S1 order items', items.length === 5, `${items.length} order lines, expected 5`)
    items.forEach((it, i) => {
      want(info, `S1 order line ${i + 1}`, same(num(it.unit_price_net), SELL[i]) && num(it.qty) === ITEMS[i].qty && num(it.gst_rate) === (i === 4 ? 0 : 18), `line ${i + 1}: qty ${it.qty} x ${it.unit_price_net} GST ${it.gst_rate}, quoted ${ITEMS[i].qty} x ${SELL[i]} GST ${i === 4 ? 0 : 18}`)
    })
    const legs = await legsOf(id)
    want(info, 'S1 legs', legs.length === 3, `${legs.length} supplier orders, expected 3`, legs.map(l => `${l.currency}`))
    const ccy = legs.map(l => l.currency).sort().join(',')
    want(info, 'S1 legs', ccy === 'EUR,PKR,USD', `supplier order currencies ${ccy}, expected EUR,PKR,USD`)
    want(info, 'S1 supplier prices', num(items[0]?.supplier_unit_price) === PRICE.a1 && num(items[1]?.supplier_unit_price) === PRICE.b2usd && num(items[2]?.supplier_unit_price) === PRICE.b3eur, `supplier unit prices ${items.map(i => i.supplier_unit_price).join(',')}`)
    want(info, 'S1 line 4', items[3]?.supplier_order_id === null && items[3]?.is_service === false, 'line 4 (level switch, no supplier price) is not an unsourced goods line', items[3])
    want(info, 'S1 line 5 service', items[4]?.supplier_order_id === null, 'the service line has a supplier order', items[4])
    want(info, 'S1 line 5 is a service', items[4]?.is_service === true, 'the "Commissioning and loop check" line is saved as a goods line (is_service false) although the dialog read it as commissioning: the order then waits for a supplier for it', { is_service: items[4]?.is_service })
    const t = await orderTotal(id)
    want(info, 'S1 totals', same(t.net, want5.net) && same(t.gst, want5.gst) && same(t.gross, want5.gross), `v_order_items_total ${JSON.stringify(t)} != ${JSON.stringify({ net: want5.net, gst: want5.gst, gross: want5.gross })}`)
    const o = await orderRow(id)
    want(info, 'S1 order header', o.rfq_id === c.rfq.id && o.payment_terms_days === 30 && o.needs_commissioning === true, `order header ${JSON.stringify(o)}`)
    const s = await rfqState(c.rfq.id)
    want(info, 'S1 rfq state', s.outcome === 'won', `v_rfq_state.outcome after Mark won is ${s.outcome}`)
    const st = await stateOf(id)
    obs(info, 'S1 order state after Mark won', `goods_state ${st.goods_state}, commissioning ${st.commissioning_state}, invoicing ${st.invoicing_state}`)
    want(info, 'S1 customer PO', (await orderRow(id)).customer_po_number === PO, 'the customer PO typed in the dialog is not on the order')
    const found = (await rpcAs<{ kind: string; id: string }[]>('sales', 'search_all', { q: PO, lim: 25 })).body ?? []
    want(info, 'S1 search', found.some(f => f.kind === 'order' && f.id === id), `search for the customer PO ${PO} does not find the order`, found.slice(0, 5))
    const today3 = await todayItems(sales, info, 'place_po', orderRef(num((await orderRow(id)).number)))
    want(info, 'S1 Today', today3.count === 3, `Today lists ${today3.count} "place PO" items for the new order, expected 3 (A, B USD, B EUR)`)
  })

  await probe(info, page, 'S1 the order page: header totals equal the dialog totals', async () => {
    await settle(page)
    const table = page.getByRole('table', { name: 'Order items' })
    const footer = flat(await table.getByRole('row').filter({ hasText: /Total before GST/ }).innerText({ timeout: T }))
    const bar = flat(await page.getByTestId('items-gst-summary').innerText({ timeout: T }))
    want(info, 'S1 order page', footer.includes(amount(want5.net)), `items footer "${footer}" lacks net ${amount(want5.net)}`)
    want(info, 'S1 order page', bar.includes(amount(want5.gst)) && bar.includes(amount(want5.gross)), `GST bar "${bar}" lacks GST ${amount(want5.gst)} / gross ${amount(want5.gross)}`)
    const names = await page.getByRole('listitem', { name: /^Supplier order,/ }).evaluateAll(els => els.map(e => e.getAttribute('aria-label')))
    want(info, 'S1 legs on the page', names.length === 3, `${names.length} supplier order rows on the page`, names)
    if (names.length === 3 && names[1] === names[2]) obs(info, 'S1 legs on the page', 'the USD and EUR supplier orders of Gulf Instrumentation have the same accessible name ("Supplier order, ...", "Issue PO, ...", "Delivered today, ..."): a screen reader or a test cannot tell them apart', names)
    want(info, 'S1 link to the RFQ', (await page.locator(`#main a[href="/rfqs/${c.rfq.id}"]`).count()) > 0, 'the order page has no link back to the RFQ (or its quotation) it was made from')
    await layout(page, info, 'S1 order page desktop')
    await shot(page, 'S1-order-page')
    const text = flat(await page.locator('#main').innerText())
    want(info, 'S1 order page', !/Some goods have no supplier yet|goods lines? ha(s|ve) no supplier yet/.test(text), 'the order page says goods have no supplier yet (level switch and the commissioning service line are both unsourced goods lines)', text.match(/[^.]*no supplier yet[^.]*/)?.[0])
  })
  await sales.close()
})

// ------------------------------------------------------------------------------------------------ S1b: the two words in the supplier picker

test('jobflow S1b: "Not sourced yet" and "Service, no supplier" chosen in the Mark won dialog are what the order gets', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const c = await seedCast({ items: 2 })
  await reply(c.rfq.id, c.supA, [
    { itemId: c.items[0].id, price: 8200, currency: 'PKR' },
    { itemId: c.items[1].id, price: 150000, currency: 'PKR' },
  ])
  await reply(c.rfq.id, c.supB, [{ itemId: c.items[0].id, price: 8600, currency: 'PKR' }])
  await issueQuote(c, { only: [0, 1] })
  const sales = await ctxAs(browser, info, 'sales', 'desktop')
  const page = await newPage(sales, info, 'S1b sales')
  await visit(page, info, `/rfqs/${c.rfq.id}`)
  const won = await winUi(page, info, 'S1b', async d => {
    await d.getByTestId('convert-item-1').getByRole('button', { name: /Supplier for line 1/ }).click()
    await page.getByRole('option', { name: /^Not sourced yet/ }).click()
    await d.getByTestId('convert-item-2').getByRole('button', { name: /Supplier for line 2/ }).click()
    await page.getByRole('option', { name: /^Service, no supplier/ }).click()
    await shot(page, 'S1b-dialog-not-sourced-and-service')
  })
  await probe(info, null, 'S1b the order', async () => {
    if (!won.orderId) return
    const items = await itemsOf(won.orderId)
    want(info, 'S1b not sourced', items[0]?.supplier_order_id === null && items[0]?.supplier_unit_price === null, `line 1 was left "Not sourced yet" in the dialog, but the order gave it a supplier (supplier price ${items[0]?.supplier_unit_price}): the database picks the rank-1 quote when none is named`, items[0])
    want(info, 'S1b service', items[1]?.is_service === true && items[1]?.supplier_order_id === null && items[1]?.supplier_unit_price === null, 'line 2 was marked Service in the dialog; the order line is not a clean service line', items[1])
    const legs = await legsOf(won.orderId)
    want(info, 'S1b legs', legs.length === 0, `${legs.length} supplier orders were made although nothing was sourced`, legs.map(l => l.currency))
  })
  await sales.close()
})

// ------------------------------------------------------------------------------------------------ S1c: payment terms

test('jobflow S1c: the payment terms in Mark won follow the quotation, else the last order of the customer', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const sales = await ctxAs(browser, info, 'sales', 'desktop')
  const page = await newPage(sales, info, 'S1c sales')
  const texts: [string | null, string][] = [
    ['50% advance, balance 15 days after delivery', '15'],
    ['100% advance', '0'],
    ['Net 45', '45'],
    ['30 days from invoice, 10% retention released after 60 days', '30'],
    [null, '45'],
  ]
  const first = await liveOrder({ service5: true, leaveOut4: true, terms: 45 })
  for (const [terms, expected] of texts) {
    // a new RFQ for the same customer
    const r = await post<{ id: string; number: number }>('rfqs', { company_id: first.c.customer.id, owner_id: USER.sales, due_on: karachiDay(5) })
    const it = await postMany<{ id: string; position: number; description: string }>('rfq_items', [{ rfq_id: r.id, position: 0, description: ITEMS[0].description, qty: 2, unit: 'nos', gst_rate: 18 }])
    await reply(r.id, first.c.supA, [{ itemId: it[0].id, price: 8200, currency: 'PKR' }])
    const c: Cast = { customer: first.c.customer, supA: first.c.supA, supB: first.c.supB, rfq: r, items: [{ ...it[0], qty: 2 }] }
    await issueQuote(c, { only: [0], payment: terms })
    await probe(info, page, `S1c terms "${terms}"`, async () => {
      await visit(page, info, `/rfqs/${r.id}`)
      await openMarkWon(page)
      const d = page.getByRole('dialog')
      await d.getByRole('group', { name: 'Suppliers by line' }).waitFor({ timeout: T })
      await page.waitForTimeout(600)
      const got = await d.getByLabel('Payment terms in days').inputValue()
      want(info, 'S1c terms', got === expected, `quotation payment terms "${terms}" pre-fill ${got} days, expected ${expected}`)
      await page.keyboard.press('Escape')
    })
  }
  await sales.close()
})

// ------------------------------------------------------------------------------------------------ S1d: site and contact

test('jobflow S1d: the customer site and contact on the RFQ follow it to the order and the engineer page', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const c = await seedCast({ items: 2 })
  const site = await post<{ id: string }>('company_sites', { company_id: c.customer.id, name: 'Fibre plant 2', address: 'Plot 14, Sundar Industrial Estate, Lahore' })
  const contact = await post<{ id: string }>('contacts', { company_id: c.customer.id, name: 'Mr. Tariq Mehmood', phone: '0300 5551234' })
  await db.patch(`rfqs?id=eq.${c.rfq.id}`, { site_id: site.id, contact_id: contact.id })
  await reply(c.rfq.id, c.supA, [{ itemId: c.items[0].id, price: 8200, currency: 'PKR' }])
  await reply(c.rfq.id, c.supB, [{ itemId: c.items[1].id, price: 520, currency: 'USD' }])
  const q = await issueQuote(c, { only: [0, 1] })
  want(info, 'S1d quote', q.status < 300, `issue_quotation refused ${q.status}`)
  const w = await winRpc(c, { needs: true })
  want(info, 'S1d won', w.status < 300, `Mark won refused ${w.status} ${JSON.stringify(w.body).slice(0, 200)}`)
  const o = await db.one<{ site_id: string | null; contact_id: string | null }>(`orders?id=eq.${w.orderId}&select=site_id,contact_id`)
  want(info, 'S1d site and contact', o.site_id === site.id && o.contact_id === contact.id, `the order has site ${o.site_id} and contact ${o.contact_id}; the RFQ had ${site.id} and ${contact.id}`)
  await db.insert('order_engineers', [{ order_id: w.orderId, user_id: USER.engineer }])
  const eng = await ctxAs(browser, info, 'engineer', 'phone')
  const p = await newPage(eng, info, 'S1d engineer')
  await probe(info, p, 'S1d the engineer sees the site and the contact phone', async () => {
    await visit(p, info, `/orders/${w.orderId}`)
    const text = await p.locator('body').innerText()
    want(info, 'S1d engineer', /Fibre plant 2/.test(text) && /0300 5551234/.test(text), 'the engineer page does not show the site name and the contact phone', flat(text).slice(0, 400))
    await shot(p, 'S1d-engineer-site')
  })
  await eng.close()
})

// ------------------------------------------------------------------------------------------------ S2: partial quote R0 (1-4), R1 (1-2)

test('jobflow S2: a revision that quotes fewer items: Mark won must not use R0 prices for the items R1 dropped', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const c = await seedCast({ items: 4 })
  await reply(c.rfq.id, c.supA, [
    { itemId: c.items[0].id, price: 8200, currency: 'PKR' },
    { itemId: c.items[2].id, price: 150000, currency: 'PKR' },
    { itemId: c.items[3].id, price: 24000, currency: 'PKR' },
  ])
  await reply(c.rfq.id, c.supB, [{ itemId: c.items[1].id, price: 520, currency: 'USD' }])
  const r0 = await issueQuote(c, { only: [0, 1, 2, 3] })
  want(info, 'S2 R0', r0.status < 300, `R0 refused ${r0.status} ${JSON.stringify(r0.body).slice(0, 200)}`)
  const r1 = await issueQuote(c, { only: [0, 1], prices: { 0: 9500, 1: 185000 } })
  want(info, 'S2 R1', r1.status < 300, `R1 refused ${r1.status} ${JSON.stringify(r1.body).slice(0, 200)}`)
  const qs = await db.rows<{ revision: number; lines: { rfq_item_id: string }[] }>(`quotations?rfq_id=eq.${c.rfq.id}&select=revision,lines&order=revision`)
  want(info, 'S2 quotations', qs.length === 2 && qs[1].lines.length === 2, `quotations ${qs.map(q => `R${q.revision}:${q.lines.length} lines`).join(' ')}`)

  const sales = await ctxAs(browser, info, 'sales', 'desktop')
  const page = await newPage(sales, info, 'S2 sales')
  await visit(page, info, `/rfqs/${c.rfq.id}`)
  const won = await winUi(page, info, 'S2')
  await probe(info, page, 'S2 items 3 and 4 are left out', async () => {
    const left = await page.getByTestId('convert-item-3-left-out').count().catch(() => 0)
    want(info, 'S2 dialog', won.text.includes('Creates 2 order lines'), `the dialog for the R1 quotation (items 1-2) says: "${won.text.match(/Creates \d+ order lines?\./)?.[0]}", items 3 and 4 still carry their R0 price (${left} left out)`, won.text.slice(0, 400))
    if (won.orderId) {
      const items = await itemsOf(won.orderId)
      want(info, 'S2 order', items.length === 2, `the order has ${items.length} lines; R1 quoted 2`, items.map(i => `${i.description} @ ${i.unit_price_net}`))
      want(info, 'S2 prices', items.slice(0, 2).every((it, i) => same(num(it.unit_price_net), i === 0 ? 9500 : 185000)), `order prices ${items.map(i => i.unit_price_net)} != R1 prices 9500, 185000`)
    }
  })
  await sales.close()
})

// ------------------------------------------------------------------------------------------------ S3: imported RFQ marked quotation sent

for (const n of [1, 3]) {
  test(`jobflow S3: an imported RFQ marked quotation sent (${n} item${n > 1 ? 's' : ''}, one legacy quote line, no quotation): is Mark won usable?`, async ({ browser }, info) => {
    await setProfile(true)
    await setRates()
    const imp = await seedImported(n)
    const sales = await ctxAs(browser, info, 'sales', 'desktop')
    const page = await newPage(sales, info, `S3-${n} sales`)
    await visit(page, info, `/rfqs/${imp.rfq.id}`)
    await probe(info, page, `S3-${n} the RFQ page`, async () => {
      const s = await rfqState(imp.rfq.id)
      want(info, `S3-${n} state`, s.bid_state === 'bid_sent' && !s.is_overdue, `imported RFQ with quoted_on: ${JSON.stringify(s)}`)
      const text = flat(await page.locator('#main').innerText())
      obs(info, `S3-${n} RFQ page`, `next step text: ${text.match(/Follow up[^.]*\.[^.]*\./)?.[0] ?? text.slice(0, 200)}`)
      await shot(page, `S3-${n}-imported-rfq`)
    })
    const won = await winUi(page, info, `S3-${n}`)
    await probe(info, page, `S3-${n} what the dialog offers`, async () => {
      want(info, `S3-${n} dialog`, won.created, `Mark won on an imported RFQ marked quotation sent cannot create an order: every line reads "Not in the quotation. Left out of the order." and Create order is disabled; the dialog does not say what to do`, won.text.slice(0, 500))
      const d = page.getByRole('dialog')
      if (await d.count()) {
        const priceInputs = await d.getByRole('spinbutton').count()
        const hints = /issue (a )?quotation|type (a|the) (selling )?price|enter (a|the) (selling )?price/i.test(await d.innerText())
        want(info, `S3-${n} dialog`, priceInputs > 0 || hints || won.created, 'the dialog offers no selling-price field and no hint to issue a quotation first')
        await shot(page, `S3-${n}-mark-won-imported`)
        await page.keyboard.press('Escape')
      }
    })
    // The way round it: issue a quotation for the first item (the only one the legacy quote is attached to), then Mark won.
    await probe(info, page, `S3-${n} after a quotation is issued for item 1: what the dialog says about the unverified legacy quote`, async () => {
      const cast = { customer: imp.customer, supA: imp.sup, supB: imp.sup, rfq: imp.rfq, items: imp.items.map((x, i) => ({ ...x, description: ITEMS[i].description, qty: ITEMS[i].qty })) } as Cast
      const q = await issueQuote(cast, { only: [0] })
      want(info, `S3-${n} issue`, q.status < 300, `issue_quotation on the imported RFQ refused: ${q.status} ${JSON.stringify(q.body).slice(0, 200)}`)
      await visit(page, info, `/rfqs/${imp.rfq.id}`)
      const w2 = await winUi(page, info, `S3-${n}b`)
      want(info, `S3-${n}b dialog`, /unverified|check the currency|guess|legacy|imported/i.test(w2.text), 'the dialog gives no sign that the supplier price is an imported one whose currency was never verified' + (n > 1 ? ' and whose item was guessed (item_guessed)' : ''), w2.text.slice(0, 600))
      if (w2.orderId) {
        const legs = await legsOf(w2.orderId)
        const items = await itemsOf(w2.orderId)
        obs(info, `S3-${n}b order`, `the order took the unverified quote as a real supplier order: ${legs.map(l => l.currency).join(',')} at ${items.map(i => i.supplier_unit_price).join(',')}`)
      }
    })
    await sales.close()
  })
}

// ------------------------------------------------------------------------------------------------ S4: in-app Mark quotation sent, Undo

test('jobflow S4: Mark quotation sent after one supplier reply, Undo, and Mark won on a verbally quoted RFQ', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const c = await seedCast({ items: 3 })
  await reply(c.rfq.id, c.supA, [{ itemId: c.items[0].id, price: PRICE.a1, currency: 'PKR' }])
  const sales = await ctxAs(browser, info, 'sales', 'desktop')
  const page = await newPage(sales, info, 'S4 sales')
  await visit(page, info, `/rfqs/${c.rfq.id}`)

  const menu = async (label: string | RegExp) => {
    await page.getByRole('button', { name: 'More', exact: true }).first().click({ timeout: T })
    await page.getByRole('menuitem', { name: label }).click({ timeout: T })
  }
  await probe(info, page, 'S4 Mark quotation sent', async () => {
    const before = await rfqState(c.rfq.id)
    want(info, 'S4 before', before.bid_state === 'to_bid', `bid_state before is ${before.bid_state}`)
    await menu(/^Mark quotation sent/)
    const t = await until(() => rfqState(c.rfq.id), s => s.quoted_on !== null)
    want(info, 'S4 sent', t.quoted_on === today && t.bid_state === 'bid_sent', `after Mark quotation sent: ${JSON.stringify(t)}`)
    await toast(page, /Marked quotation sent/).first().waitFor({ timeout: T })
    const text = flat(await page.locator('#main').innerText())
    want(info, 'S4 sent page', /Follow up with/.test(text), 'the Next step does not say "Follow up with ..." after Mark quotation sent', text.slice(0, 300))
    await shot(page, 'S4-marked-sent')
  })
  await probe(info, page, 'S4 Undo takes it back', async () => {
    await undoIn(toast(page, /Marked quotation sent/)).click({ timeout: T })
    const t = await until(() => rfqState(c.rfq.id), s => s.quoted_on === null)
    want(info, 'S4 undo', t.quoted_on === null && t.bid_state === 'to_bid', `after Undo: ${JSON.stringify(t)}`)
    await page.waitForTimeout(2500)
    const text = flat(await page.locator('#main').innerText())
    want(info, 'S4 undo page', !/Follow up with/.test(text), 'the page still reads as quotation sent 2.5 s after Undo', text.slice(0, 300))
  })
  await probe(info, page, 'S4 mark sent again (no PDF) and Mark won', async () => {
    await menu(/^Mark quotation sent/)
    await until(() => rfqState(c.rfq.id), s => s.quoted_on !== null)
    await page.reload()
    await settle(page)
  })
  const won = await winUi(page, info, 'S4')
  want(info, 'S4 dialog', won.created, 'a quotation marked sent without a PDF (a verbal one) cannot be won: no line has a selling price, Create order is disabled and nothing says how to continue', won.text.slice(0, 500))
  await sales.close()
})


// ------------------------------------------------------------------------------------------------ S5: exchange rates

test('jobflow S5: a 5 day old rate prices in PKR, a 40 day old rate leaves the quote unranked; the PO and payables stay in USD, Margins in PKR', async ({ browser }, info) => {
  await setProfile(true)
  const setRate = async (cur: string, rate: number, daysAgo: number) => {
    await db.del(`fx_rates?currency=eq.${cur}`)
    await db.insert('fx_rates', [{ currency: cur, rate_pkr: rate, as_of: karachiDay(-daysAgo), source: 'manual' }])
  }
  const sales = await ctxAs(browser, info, 'sales', 'desktop')
  const page = await newPage(sales, info, 'S5 sales')

  // ---- (a) the rate is 5 days old (fresh)
  await setRate('USD', 280, 5)
  const c = await seedCast({ items: 2 })
  const a = await reply(c.rfq.id, c.supA, [{ itemId: c.items[1].id, price: 120000, currency: 'PKR' }])
  const b = await reply(c.rfq.id, c.supB, [{ itemId: c.items[1].id, price: 410, currency: 'USD', lead: '10 days' }])
  await issueQuote(c, { only: [1], prices: { 1: 150000 } })
  await probe(info, null, 'S5a the rate is stamped on the quote line and PKR = price x rate', async () => {
    const lines = await db.rows<{ id: string; currency: string; fx_rate_pkr: number | null; fx_rate_on: string | null }>(`supplier_quote_lines?id=in.(${[...a.lineIds, ...b.lineIds].join(',')})&select=id,currency,fx_rate_pkr,fx_rate_on`)
    const usd = lines.find(l => l.currency === 'USD')
    const pkr = lines.find(l => l.currency === 'PKR')
    want(info, 'S5a stamp', num(usd?.fx_rate_pkr) === 280 && usd?.fx_rate_on === karachiDay(-5), `the USD quote line was stamped ${usd?.fx_rate_pkr} on ${usd?.fx_rate_on}; expected 280 on ${karachiDay(-5)} (the rate in force)`, usd)
    want(info, 'S5a stamp', num(pkr?.fx_rate_pkr) === 1 && pkr?.fx_rate_on === today, `the PKR quote line was stamped ${pkr?.fx_rate_pkr} on ${pkr?.fx_rate_on}`, pkr)
    const rank = (await rpcAs<RankRow[]>('sales', 'rank_item_quotes', { p_rfq_id: c.rfq.id })).body ?? []
    const rb = rank.find(r => r.currency === 'USD')
    const ra = rank.find(r => r.currency === 'PKR')
    want(info, 'S5a rank', same(num(rb?.pkr_unit_price), 410 * 280), `USD 410 at 280 is PKR ${rb?.pkr_unit_price}, expected ${410 * 280}`, rb)
    want(info, 'S5a rank', rb?.rank === 1 && ra?.rank === 2, `ranks: USD ${rb?.rank}, PKR ${ra?.rank}; PKR 114,800 beats 120,000 so the USD supplier is 1`, rank.map(r => `${r.currency}:${r.rank}`))
  })

  await visit(page, info, `/rfqs/${c.rfq.id}`)
  const won = await winUi(page, info, 'S5a', async d => {
    const t = flat(await d.getByTestId('convert-item-2').innerText())
    want(info, 'S5a dialog', t.includes('114,800'), 'the Mark won row does not show the USD quote as about PKR 114,800', t)
  })
  if (won.orderId) {
    const id = won.orderId
    const legs = await legsOf(id)
    const usdLeg = legs.find(l => l.currency === 'USD')
    await probe(info, null, 'S5a the PO and payables are in USD, the margin cost in PKR', async () => {
      if (!usdLeg) return void obs(info, 'S5a legs', `no USD supplier order was made (${legs.map(l => l.currency)})`)
      const issued = await issuePoRpc(usdLeg.id)
      want(info, 'S5a PO', issued.status < 300, `Issue PO refused ${issued.status} ${JSON.stringify(issued.body).slice(0, 200)}`)
      const pos = await posOf(usdLeg.id)
      want(info, 'S5a PO', pos.length === 1 && pos[0].currency === 'USD' && same(num(pos[0].total), 410), `PO ${JSON.stringify(pos.map(p => [p.currency, p.total]))}, expected USD 410 (1 x 410)`)
      const pay = (await db.adminRpc<{ supplier_order_id: string; currency: string; committed: number; fx_rate: number | null; committed_pkr: number | null; state: string }[]>('payables_as_of', { p_date: today })).find(r => r.supplier_order_id === usdLeg.id)
      want(info, 'S5a payables', !!pay && pay.currency === 'USD' && same(num(pay.committed), 410) && same(num(pay.committed_pkr), 114800), `We owe: ${JSON.stringify(pay)}; expected USD 410 = PKR 114,800 at 280`)
      const admin = await ctxAs(browser, info, 'admin', 'desktop')
      const ap = await newPage(admin, info, 'S5a admin')
      await visit(ap, info, `/orders/${id}`)
      const text = flat(await ap.locator('#main').innerText())
      want(info, 'S5a Margin', text.includes('114,800'), 'the order page (admin) does not show the PKR cost 114,800 of the USD supplier order', text.match(/Margin[^]{0,400}/)?.[0])
      await visit(ap, info, '/money/margins')
      await shot(ap, 'S5a-margins')
      await admin.close()
    })
  }

  // ---- (b) the rate is 40 days old (unusable)
  await setRate('USD', 275, 40)
  const c2 = await seedCast({ items: 2 })
  const a2 = await reply(c2.rfq.id, c2.supA, [{ itemId: c2.items[1].id, price: 120000, currency: 'PKR' }])
  const b2 = await reply(c2.rfq.id, c2.supB, [{ itemId: c2.items[1].id, price: 410, currency: 'USD' }])
  await issueQuote(c2, { only: [1], prices: { 1: 150000 } })
  await probe(info, null, 'S5b a 40 day old rate: stamped as it was, the quote is unranked', async () => {
    const lines = await db.rows<{ currency: string; fx_rate_pkr: number | null; fx_rate_on: string | null }>(`supplier_quote_lines?id=in.(${[...a2.lineIds, ...b2.lineIds].join(',')})&select=currency,fx_rate_pkr,fx_rate_on`)
    const usd = lines.find(l => l.currency === 'USD')
    want(info, 'S5b stamp', num(usd?.fx_rate_pkr) === 275 && usd?.fx_rate_on === karachiDay(-40), `stamped ${usd?.fx_rate_pkr} on ${usd?.fx_rate_on}`)
    const rank = (await rpcAs<RankRow[]>('sales', 'rank_item_quotes', { p_rfq_id: c2.rfq.id })).body ?? []
    const rb = rank.find(r => r.currency === 'USD')
    want(info, 'S5b rank', rb?.rank === null && rb?.pkr_unit_price === null && rb?.comparable === false, `a 40 day old rate still ranks the USD quote: ${JSON.stringify(rb)}`)
  })
  await visit(page, info, `/rfqs/${c2.rfq.id}`)
  const won2 = await winUi(page, info, 'S5b', async d => {
    const row = flat(await d.getByTestId('convert-item-2').innerText())
    want(info, 'S5b dialog', /no rate|out of date|old|unusable|not comparable|unranked/i.test(row), 'with a 40 day old rate the row says nothing about the USD quote being unranked', row)
    await d.getByTestId('convert-item-2').getByRole('button', { name: /Supplier for line 2/ }).click()
    const list = flat(await page.getByRole('listbox').innerText())
    want(info, 'S5b picker', /no rate|rate|old|unranked|cannot compare|not comparable/i.test(list) && list.includes('USD'), 'the picker gives no message for the unranked USD quote', list)
    await shot(page, 'S5b-picker')
    await page.keyboard.press('Escape')
  })
  if (won2.orderId) {
    const legs = await legsOf(won2.orderId)
    want(info, 'S5b order', legs.length === 1 && legs[0].currency === 'PKR', `with the USD quote unranked the order goes to ${legs.map(l => l.currency)}; the PKR supplier is the only comparable one`)
  }
  await sales.close()
  await db.del('fx_rates?currency=eq.USD')
  await setRates()
})

// ------------------------------------------------------------------------------------------------ S6: split an item between two suppliers

test('jobflow S6: split 6 units to A and 4 to B: one selling price, two supplier orders, the quantities add up', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const c = await seedCast({ items: 1 })
  await reply(c.rfq.id, c.supA, [{ itemId: c.items[0].id, price: 8200, currency: 'PKR' }])
  await reply(c.rfq.id, c.supB, [{ itemId: c.items[0].id, price: 31, currency: 'USD' }])
  await issueQuote(c, { only: [0] })
  const sales = await ctxAs(browser, info, 'sales', 'desktop')
  const page = await newPage(sales, info, 'S6 sales')
  await visit(page, info, `/rfqs/${c.rfq.id}`)
  const won = await winUi(page, info, 'S6', async d => {
    await d.getByRole('button', { name: 'Split this item, line 1' }).click()
    await d.getByLabel('Quantity, part 2, line 1').fill('4')
    const sum = flat(await d.getByTestId('convert-item-1-sum').innerText())
    want(info, 'S6 dialog', /6 \+ 4 = 10 of 10/.test(sum), `the split sum reads "${sum}", expected 6 + 4 = 10 of 10`)
    const totals = flat(await d.getByRole('group', { name: 'Order totals' }).innerText())
    want(info, 'S6 dialog', totals.includes(amount(98000)), `the dialog totals "${totals}" lack the net 98,000 (10 x 9,800)`)
    want(info, 'S6 dialog', /Creates 2 order lines/.test(flat(await d.innerText())), 'the dialog does not say "Creates 2 order lines"')
    await shot(page, 'S6-split-dialog')
  })
  if (!won.orderId) return void (await sales.close())
  const id = won.orderId
  await probe(info, page, 'S6 two lines, two supplier orders, quantities add up', async () => {
    const items = await itemsOf(id)
    const legs = await legsOf(id)
    want(info, 'S6 order', items.length === 2 && legs.length === 2, `${items.length} lines, ${legs.length} supplier orders`)
    const qtys = items.map(i => num(i.qty)).sort((x, y) => x - y)
    want(info, 'S6 order', qtys.join(',') === '4,6', `part quantities ${qtys}, expected 4 and 6`)
    want(info, 'S6 order', items.every(i => same(num(i.unit_price_net), 9800)), `unit prices ${items.map(i => i.unit_price_net)}; one selling price 9,800 on both parts`)
    const a = items.find(i => num(i.qty) === 6)
    const b = items.find(i => num(i.qty) === 4)
    const la = legs.find(l => l.id === a?.supplier_order_id)
    const lb = legs.find(l => l.id === b?.supplier_order_id)
    want(info, 'S6 order', la?.currency === 'PKR' && lb?.currency === 'USD' && num(a?.supplier_unit_price) === 8200 && num(b?.supplier_unit_price) === 31, `part A ${la?.currency} ${a?.supplier_unit_price}, part B ${lb?.currency} ${b?.supplier_unit_price}`)
    const t = await orderTotal(id)
    want(info, 'S6 totals', same(t.net, 98000) && same(t.gst, 17640), `order totals ${JSON.stringify(t)}, expected net 98,000 GST 17,640`)
  })
  await probe(info, page, 'S6 one selling price edits both parts', async () => {
    await settle(page)
    const text = flat(await page.locator('#main').innerText())
    const table = flat(await page.getByRole('table', { name: 'Order items' }).innerText().catch(() => ''))
    want(info, 'S6 page', /split across 2 suppliers/.test(text) || /split across 2 suppliers/.test(table), 'the order page does not say the item is split across 2 suppliers', { table: table.slice(0, 500), main: text.slice(0, 300) })
    await page.getByRole('button', { name: 'Edit GST and lines' }).click({ timeout: T })
    await page.getByRole('button', { name: /^Edit price, Schneider/ }).first().click({ timeout: T })
    const box = page.getByRole('textbox', { name: /^Selling price before GST/ })
    await box.fill('9900')
    await page.getByRole('button', { name: /^Save price/ }).click()
    const items = await until(() => itemsOf(id), r => r.every(i => same(num(i.unit_price_net), 9900)))
    want(info, 'S6 price', items.every(i => same(num(i.unit_price_net), 9900)), `after editing the price the lines read ${items.map(i => i.unit_price_net)}`)
    const t = await orderTotal(id)
    want(info, 'S6 price', same(t.net, 99000), `order net after the edit ${t.net}, expected 99,000`)
  })
  await sales.close()
})

// ------------------------------------------------------------------------------------------------ S7: a PO per supplier order

test('jobflow S7: PO per supplier order: prefill, PDFs in PKR, USD and EUR, revise, the unsourced line, an unpriced line', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const L = await liveOrder({ service5: true })
  const sales = await ctxAs(browser, info, 'sales', 'desktop')
  const page = await newPage(sales, info, 'S7 sales')
  await visit(page, info, `/orders/${L.id}`)

  await probe(info, null, 'S7 po_line_prefill: prices and where they came from', async () => {
    for (const [name, leg, price, ccy] of [['A', L.A, PRICE.a1, 'PKR'], ['B USD', L.BU, PRICE.b2usd, 'USD'], ['B EUR', L.BE, PRICE.b3eur, 'EUR']] as const) {
      const r = await rpcAs<{ order_item_id: string; unit_price: number | null; price_source: string | null; qty: number }[]>('sales', 'po_line_prefill', { p_supplier_order_id: leg.id })
      const rows = r.body ?? []
      want(info, `S7 prefill ${name}`, r.status < 300 && rows.length === 1 && same(num(rows[0].unit_price), price), `prefill ${r.status} ${JSON.stringify(rows).slice(0, 300)}, expected one line at ${ccy} ${price}`)
    }
  })

  for (const [name, leg, ccy, total] of [
    ['A', L.A, 'PKR', 82000],
    ['B USD', L.BU, 'USD', 520],
    ['B EUR', L.BE, 'EUR', 1280],
  ] as const) {
    await probe(info, page, `S7 Issue PO in the dialog: ${name}`, async () => {
      await page.reload()
      await settle(page)
      const sup = name === 'A' ? L.c.supA.name : L.c.supB.name
      // two supplier orders of B have the same name: take the one that shows the currency
      const row = await legRowByCcy(page, sup, ccy, ccy === 'PKR' ? 1 : 2)
      await row.getByRole('button', { name: `Issue PO, ${sup}` }).click({ timeout: T })
      const d = page.getByRole('dialog')
      await d.getByRole('heading', { name: 'Issue purchase order' }).waitFor({ timeout: T })
      await d.getByTestId('po-total').waitFor({ timeout: T })
      const shown = flat(await d.getByTestId('po-total').innerText())
      want(info, `S7 ${name} dialog`, shown.includes(amount(total, { always: true })), `PO dialog total "${shown}", expected ${ccy} ${amount(total, { always: true })}`)
      await d.getByRole('button', { name: 'Issue PO', exact: true }).click()
      await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 30_000 })
      const pos = await until(() => posOf(leg.id), r => !!r[0]?.pdf_path, 20_000)
      want(info, `S7 ${name} PO`, pos.length === 1 && pos[0].currency === ccy && same(num(pos[0].total), total), `stored PO ${JSON.stringify(pos.map(p => [p.number, p.revision, p.currency, p.total]))}`)
      const pdf = pos[0]?.pdf_path ? await fetchStoredPdf('sales', 'generated-docs', pos[0].pdf_path) : null
      want(info, `S7 ${name} PDF`, pdfIsValid(pdf), 'the stored PO PDF is not a valid PDF')
      const text = pdf ? pdfText(pdf) : null
      if (text) {
        want(info, `S7 ${name} PDF`, flat(text).includes(`${ccy} ${amount(total, { always: true })}`), `PO PDF lacks "${ccy} ${amount(total, { always: true })}"`, flat(text).slice(0, 600))
        for (const sell of [amount(SELL[0]), amount(SELL[1]), amount(SELL[2]), L.c.customer.name]) want(info, `S7 ${name} PDF`, !flat(text).includes(sell), `the PO to the supplier shows our selling price or the customer: "${sell}"`)
      }
      const leg2 = (await legsOf(L.id)).find(l => l.id === leg.id)!
      want(info, `S7 ${name} placed`, leg2.placed_on === today && leg2.expected_on !== null, `after the PO the supplier order is placed ${leg2.placed_on}, expected ${leg2.expected_on}`)
    })
  }

  await probe(info, page, 'S7 revise the PO of A: same number, R1, the new price; payables use the latest revision', async () => {
    const [r0] = await posOf(L.A.id)
    const revise = await rpcAs<string>('sales', 'issue_purchase_order', {
      p_po_id: crypto.randomUUID(),
      p_supplier_order_id: L.A.id,
      p_lines: [{ order_item_id: L.items[0].id, unit_price: 8000, qty: 10 }],
    })
    want(info, 'S7 revise', revise.status < 300, `revise refused ${revise.status} ${JSON.stringify(revise.body).slice(0, 200)}`)
    const pos = await posOf(L.A.id)
    want(info, 'S7 revise', pos.length === 2 && pos[1].number === r0?.number && pos[1].revision === 1 && same(num(pos[1].total), 80000), `POs ${JSON.stringify(pos.map(p => [p.number, p.revision, p.total]))}`)
    const it = (await itemsOf(L.id))[0]
    want(info, 'S7 revise', same(num(it.supplier_unit_price), 8000), `the order line's supplier price is ${it.supplier_unit_price} after revising to 8,000`)
    const pay = (await db.adminRpc<{ supplier_order_id: string; committed: number }[]>('payables_as_of', { p_date: today })).find(r => r.supplier_order_id === L.A.id)
    want(info, 'S7 revise', same(num(pay?.committed), 80000), `We owe A: committed ${pay?.committed}, expected the latest revision 80,000`)
    await page.reload()
    await settle(page)
    const chip = flat(await legRows(page, L.c.supA.name).first().locator('[data-testid$="-po"]').innerText().catch(() => ''))
    want(info, 'S7 revise', /R1/.test(chip), `the PO chip of A reads "${chip}", expected R1`)
  })

  await probe(info, page, 'S7 a goods line left "Not sourced yet" has a way to be given a supplier later', async () => {
    const unsourced = L.items.filter(i => !i.is_service && i.supplier_order_id === null)
    obs(info, 'S7 unsourced lines', `${unsourced.length} unsourced goods lines on the order (${unsourced.map(i => i.description).join(', ')})`)
    await page.reload()
    await settle(page)
    await page.getByRole('button', { name: 'Edit GST and lines' }).click({ timeout: T })
    const row = page.getByRole('table', { name: 'Order items' }).getByRole('row').filter({ hasText: 'Level switch' })
    if (!(await row.count())) return obs(info, 'S7 unsourced', 'there is no Level switch line on the order (the dialog left it out)')
    const controls = await row.first().getByRole('button').evaluateAll(els => els.map(e => e.getAttribute('aria-label') || (e as HTMLElement).innerText))
    const selects = await row.first().getByRole('combobox', { name: /supplier|source/i }).count()
    want(info, 'S7 unsourced', selects > 0 || controls.some(x => /supplier|assign|source/i.test(x ?? '')), `a goods line with no supplier has no control to give it one (buttons: ${controls.join(' | ')}; the only select is the GST rate)`, controls)
    await shot(page, 'S7-unsourced-line-edit-mode')
    const text = flat(await page.locator('#main').innerText())
    obs(info, 'S7 unsourced', `order page sentence: ${text.match(/[^.]*no supplier yet[^.]*/)?.[0] ?? 'none'}`)
    const st = await stateOf(L.id)
    want(info, 'S7 unsourced', st.goods_state !== 'to_source', `goods_state is ${st.goods_state} while the other three supplier orders are placed: the order cannot move on`)
  })

  await probe(info, null, 'S7 a PO with an unpriced line is refused', async () => {
    await db.add('order_items', { order_id: L.id, position: 9, description: 'M12 cable set', qty: 3, unit: 'nos', unit_price_net: 1500, gst_rate: 18, is_service: false, supplier_order_id: L.BE.id })
    const r = await rpcAs<string>('sales', 'issue_purchase_order', { p_po_id: crypto.randomUUID(), p_supplier_order_id: L.BE.id })
    want(info, 'S7 unpriced', r.status >= 400, `Issue PO with a line that has no price was accepted (${r.status}), the PO would carry a gap`)
    const pre = (await rpcAs<{ unit_price: number | null; description: string }[]>('sales', 'po_line_prefill', { p_supplier_order_id: L.BE.id })).body ?? []
    want(info, 'S7 unpriced', pre.some(p => p.unit_price === null), 'po_line_prefill gives no empty price for the unpriced line', pre)
  })
  await sales.close()
})

// ------------------------------------------------------------------------------------------------ S8: delivery

test('jobflow S8: delivery: partial, Delivered today and Undo, the expected date from the lead time, delivered before the PO', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const L = await liveOrder({ service5: true, leaveOut4: true })
  for (const leg of [L.A, L.BU, L.BE]) {
    const r = await issuePoRpc(leg.id)
    want(info, 'S8 PO', r.status < 300, `PO refused ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`)
  }
  const legs = await legsOf(L.id)
  const byId = Object.fromEntries(legs.map(l => [l.id, l]))
  await probe(info, null, 'S8 expected date = placed + the longest lead time the supplier quoted', async () => {
    // A: ex-stock = 0 days; B USD: "2 weeks" = 14; B EUR: "3-4 weeks" = 28
    for (const [name, leg, days] of [['A ex-stock', L.A, 0], ['B USD 2 weeks', L.BU, 14], ['B EUR 3-4 weeks', L.BE, 28]] as const) {
      const got = byId[leg.id]
      want(info, `S8 expected ${name}`, got.expected_on === addDays(today, days), `expected date ${got.expected_on}, placed ${got.placed_on}; ${days} days after today is ${addDays(today, days)}`)
    }
  })
  const sales = await ctxAs(browser, info, 'sales', 'desktop')
  const page = await newPage(sales, info, 'S8 sales')
  await visit(page, info, `/orders/${L.id}`)
  await probe(info, page, 'S8 Delivered today on A: part delivered', async () => {
    const row = legRows(page, L.c.supA.name).first()
    await row.getByRole('button', { name: `Delivered today, ${L.c.supA.name}` }).click({ timeout: T })
    const d = await until(async () => (await legsOf(L.id)).find(l => l.id === L.A.id)!, l => l.delivered_on !== null)
    want(info, 'S8 delivered', d.delivered_on === today && d.received_on === today, `after Delivered today: delivered ${d.delivered_on} received ${d.received_on}`)
    const s = await until(() => stateOf(L.id), v => v.goods_state !== 'on_order')
    want(info, 'S8 part delivered', /part/.test(s.goods_state), `goods_state with one of three suppliers delivered is ${s.goods_state}`)
    await page.reload()
    await settle(page)
    const cell = flat(await page.getByRole('group', { name: 'State of this order' }).innerText({ timeout: T }))
    obs(info, 'S8 part delivered', `Goods cell: ${cell.slice(0, 160)}`)
    await shot(page, 'S8-part-delivered')
  })
  await probe(info, page, 'S8 Undo restores the dates exactly', async () => {
    const before = (await legsOf(L.id)).find(l => l.id === L.A.id)!
    const row = await legRowByCcy(page, L.c.supB.name, 'USD', 2)
    const b0 = (await legsOf(L.id)).find(l => l.id === L.BU.id)!
    await row.getByRole('button', { name: `Delivered today, ${L.c.supB.name}` }).click({ timeout: T })
    await until(async () => (await legsOf(L.id)).find(l => l.id === L.BU.id)!, l => l.delivered_on !== null)
    await undoIn(toast(page, /Marked delivered/)).click({ timeout: 8000 })
    const back = await until(async () => (await legsOf(L.id)).find(l => l.id === L.BU.id)!, l => l.delivered_on === null)
    want(info, 'S8 Undo', back.delivered_on === null && back.received_on === null && back.placed_on === b0.placed_on && back.expected_on === b0.expected_on, 'Undo did not restore the dates', { b0, back })
    want(info, 'S8 Undo', before.delivered_on === today, 'A lost its delivery when B was undone')
  })
  await probe(info, null, 'S8 delivered before the PO: the PO is issued on a supplier order that is already delivered', async () => {
    const x = await liveOrder({ service5: true, leaveOut4: true })
    await db.patch(`supplier_orders?id=eq.${x.A.id}`, { delivered_on: karachiDay(-3), received_on: karachiDay(-3) })
    const r = await issuePoRpc(x.A.id)
    const leg = (await legsOf(x.id)).find(l => l.id === x.A.id)!
    want(info, 'S8 delivered before PO', !(leg.placed_on !== null && leg.delivered_on !== null && leg.placed_on > leg.delivered_on), `the PO (${r.status}) sets placed ${leg.placed_on} AFTER the goods were delivered ${leg.delivered_on}`, leg)
  })
  await probe(info, page, 'S8 deliver the rest: delivered, and Today asks for the invoice', async () => {
    await db.patch(`supplier_orders?id=eq.${L.BU.id}`, { delivered_on: today, received_on: today })
    await db.patch(`supplier_orders?id=eq.${L.BE.id}`, { delivered_on: today, received_on: today })
    const s = await stateOf(L.id)
    want(info, 'S8 all delivered', s.goods_state === 'delivered', `goods_state with all supplier orders delivered is ${s.goods_state}`)
    const t = await todayItems(sales, info, 'delivered_not_invoiced', orderRef(L.number))
    want(info, 'S8 Today', t.count === 1, `Today lists ${t.count} "delivered, not invoiced" items for ${orderRef(L.number)}, expected 1`)
  })
  await sales.close()
})

// ------------------------------------------------------------------------------------------------ S9: commissioning on a phone

test('jobflow S9: commissioning: sales plans it, the engineer marks it done on a 375 px phone, no price reaches the engineer, the invoice reminder waits', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const L = await liveOrder({ service5: true, leaveOut4: true, needs: true })
  const sales = await ctxAs(browser, info, 'sales', 'desktop')
  const sp = await newPage(sales, info, 'S9 sales')
  await visit(sp, info, `/orders/${L.id}`)
  await probe(info, sp, 'S9 sales plans the commissioning for the engineer', async () => {
    const section = sp.getByRole('region', { name: 'Commissioning' })
    await section.getByRole('button', { name: 'Edit', exact: true }).click({ timeout: T })
    const d = sp.getByRole('dialog')
    const planned = d.getByRole('textbox', { name: 'Planned on' })
    await planned.fill(slashDate(today))
    await planned.press('Enter')
    await d.getByRole('combobox', { name: 'Assign an engineer' }).selectOption({ label: 'Test Engineer' })
    await until(() => db.rows(`order_engineers?order_id=eq.${L.id}&select=user_id`), r => r.length === 1)
    await d.getByRole('button', { name: 'Save' }).click()
    const o = await until(() => orderRow(L.id), r => r.commissioning_planned_on !== null)
    want(info, 'S9 plan', o.commissioning_planned_on === today, `planned on ${o.commissioning_planned_on}`)
    want(info, 'S9 plan', (await stateOf(L.id)).commissioning_state === 'planned', 'commissioning_state is not planned')
  })
  for (const leg of [L.A, L.BU, L.BE]) await db.patch(`supplier_orders?id=eq.${leg.id}`, { placed_on: addDays(today, -5), delivered_on: addDays(today, -1), received_on: addDays(today, -1) })

  await probe(info, null, 'S9 delivered but commissioning not done: no invoice reminder yet', async () => {
    const s = await stateOf(L.id)
    want(info, 'S9 state', s.goods_state === 'delivered' && s.commissioning_state === 'planned', `state ${JSON.stringify(s)}`)
    const t = await todayItems(sales, info, 'delivered_not_invoiced', orderRef(L.number))
    want(info, 'S9 held', t.count === 0 || t.waiting === t.count, `Today asks for the invoice (${t.count} items, ${t.waiting} waiting) while the commissioning is still to do`)
  })

  const eng = await ctxAs(browser, info, 'engineer', 'phone')
  const ep = await newPage(eng, info, 'S9 engineer')
  const log = spy(ep)
  await probe(info, ep, 'S9 the engineer opens the order on a 375 px phone', async () => {
    await visit(ep, info, `/orders/${L.id}`)
    await layout(ep, info, 'S9 engineer phone order')
    await shot(ep, 'S9-engineer-phone-order')
    const text = await ep.locator('body').innerText()
    const found = PRICE_STRINGS.filter(p => text.includes(p))
    want(info, 'S9 DOM', found.length === 0, `the engineer's page shows prices: ${found.join(', ')}`)
    if (/\b(PKR|USD|EUR)\b/.test(text)) obs(info, 'S9 DOM', 'the engineer page names a currency (a chip on each supplier order), no amount', text.match(/.{0,40}\b(PKR|USD|EUR)\b.{0,40}/)?.[0])
  })
  await probe(info, ep, 'S9 the engineer marks it done in one tap', async () => {
    const button = ep.getByRole('button', { name: 'Mark done today' }).first()
    await button.waitFor({ timeout: T })
    const box = await button.boundingBox()
    want(info, 'S9 tap target', !!box && box.height >= 40, `Mark done today is ${box?.width}x${box?.height} px on the phone`)
    await button.click()
    const o = await until(() => orderRow(L.id), r => r.commissioning_done_on !== null)
    want(info, 'S9 done', o.commissioning_done_on === today, `commissioning_done_on is ${o.commissioning_done_on}`)
    want(info, 'S9 done', (await stateOf(L.id)).commissioning_state === 'done', 'commissioning_state is not done')
    await shot(ep, 'S9-engineer-done')
  })
  await ep.waitForTimeout(1200)
  want(info, 'S9 network', log.urls.filter(u => ['/rest/v1/payments_in', '/rest/v1/invoices', '/rest/v1/rpc/order_receivables', '/rest/v1/rpc/rank_item_quotes', '/rest/v1/rpc/po_line_prefill', '/rest/v1/v_fx_latest'].some(p => u.includes(p))).length === 0, 'the engineer page asked for money endpoints', log.urls.filter(u => /payments_in|invoices|order_receivables|rank_item|po_line|fx_latest/.test(u)).slice(0, 5))
  want(info, 'S9 network', log.leaks.length === 0, `the database answered the engineer with money values: ${[...new Set(log.leaks)].slice(0, 8).join(', ')}`)
  await probe(info, null, 'S9 done: the invoice reminder is now due', async () => {
    const t = await todayItems(sales, info, 'delivered_not_invoiced', orderRef(L.number))
    want(info, 'S9 reminder', t.count === 1 && t.waiting === 0, `after the job is done Today lists ${t.count} invoice reminders (${t.waiting} waiting), expected 1 active`)
  })
  await eng.close()
  await sales.close()
})

// ------------------------------------------------------------------------------------------------ S10: invoice, payment

test('jobflow S10: invoice: the dialog on a mixed GST order, part and rest, numbering, payments, Who owes us, the PDF', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  await db.patch('company_profile?id=eq.1', { strn: '1234567890123' })
  const L = await liveOrder({ service5: true, leaveOut4: true, terms: 30 })
  await db.patch(`companies?id=eq.${L.c.customer.id}`, { ntn: '7654321-0', strn: '3277876543210', sales_tax_registered: true, invoice_address: 'Plot 9, Sundar Industrial Estate, Raiwind Road, Lahore' })
  const lines = [
    { qty: 10, price: SELL[0], gst: 18 },
    { qty: 1, price: SELL[1], gst: 18 },
    { qty: 2, price: SELL[2], gst: 18 },
    { qty: 1, price: SELL[4], gst: 0 },
  ]
  const M = totalsOf(lines)
  const admin = await ctxAs(browser, info, 'admin', 'desktop')
  const ap = await newPage(admin, info, 'S10 admin')
  const invoicesOf = (id: string) => db.rows<{ id: string; number: string; net_amount: number; gst_amount: number; invoice_date: string }>(`invoices?order_id=eq.${id}&select=id,number,net_amount,gst_amount,invoice_date&order=created_at`)

  await probe(info, ap, 'S10 invoice before delivery: is it offered, and what does the order say after', async () => {
    await db.patch(`company_profile?id=eq.1`, { legal_name: 'Q-Tech Solutions (Pvt) Ltd' })
    await visit(ap, info, `/orders/${L.id}`)
    const primary = flat(await actions(ap).innerText().catch(() => ''))
    obs(info, 'S10 before delivery', `the order header offers: ${primary.slice(0, 200)}`)
    const inMore = await ap.getByRole('button', { name: /^More( actions)?$/ }).first().click().then(() => ap.getByRole('menuitem', { name: 'Create invoice' }).count()).catch(() => 0)
    obs(info, 'S10 before delivery', `Create invoice in the More menu before the goods are delivered: ${inMore > 0}`)
    await ap.keyboard.press('Escape')
  })

  await db.patch(`orders?id=eq.${L.id}`, { ordered_on: karachiDay(-2) })
  for (const leg of [L.A, L.BU, L.BE]) await db.patch(`supplier_orders?id=eq.${leg.id}`, { placed_on: addDays(today, -6), delivered_on: addDays(today, -1), received_on: addDays(today, -1) })
  const nextBefore = (await db.adminRpc<{ next_number: string }[]>('next_invoice_number', {}))[0].next_number

  await probe(info, ap, 'S10 part invoice: the first line (whole line, 18%), then the rest', async () => {
    await visit(ap, info, `/orders/${L.id}`)
    await actions(ap).getByRole('button', { name: 'Create invoice' }).click({ timeout: T })
    const d = ap.getByRole('dialog', { name: 'Create invoice' })
    await d.getByText(/Edit the amounts/).click({ timeout: T })
    const lineGst = totalsOf([lines[0]])
    await d.getByRole('textbox', { name: 'Net amount, PKR' }).fill(String(lineGst.net))
    await d.getByRole('radio', { name: '18%' }).click().catch(() => undefined)
    const num1 = await d.getByRole('textbox', { name: 'Invoice number' }).inputValue()
    want(info, 'S10 numbering', num1 === nextBefore, `the dialog proposes invoice number ${num1}, the series says ${nextBefore}`)
    await d.getByRole('button', { name: 'Create invoice', exact: true }).click()
    await d.waitFor({ state: 'hidden', timeout: T })
    const inv = await until(() => invoicesOf(L.id), r => r.length === 1)
    want(info, 'S10 part invoice', inv.length === 1 && same(num(inv[0].net_amount), lineGst.net) && same(num(inv[0].gst_amount), lineGst.gst), `first invoice ${JSON.stringify(inv)}, expected net ${lineGst.net} GST ${lineGst.gst}`)
    const s = await stateOf(L.id)
    want(info, 'S10 part invoice', s.invoicing_state === 'part', `invoicing_state ${s.invoicing_state} after a part invoice`)
  })
  const rest = totalsOf(lines.slice(1))
  const openInvoice = async () => {
    await actions(ap).getByRole('button', { name: 'Create invoice' }).click({ timeout: T })
    const d = ap.getByRole('dialog', { name: 'Create invoice' })
    await d.getByRole('textbox', { name: 'Invoice number' }).waitFor({ timeout: T })
    await ap.waitForTimeout(2000)
    return d
  }
  const figures = async (d: Locator) => flat(await d.locator('dl').first().innerText())
  await probe(info, ap, 'S10 the rest, straight after the first invoice (same page, no reload): the dialog opens with what is left', async () => {
    const d = await openInvoice()
    const text = await figures(d)
    want(info, 'S10 rest same page', text.includes(amount(rest.net)) && text.includes(amount(rest.gst)), `the Create invoice dialog opened again on the same page after a part invoice shows "${text}" and not what is left (net ${amount(rest.net)}, GST ${amount(rest.gst)})`, flat(await d.innerText()).slice(0, 300))
    await shot(ap, 'S10-second-invoice-dialog-same-page')
    await d.getByRole('button', { name: 'Cancel' }).click()
  })
  await probe(info, ap, 'S10 the rest after a reload: net and GST of the other lines (the exempt service line carries no GST)', async () => {
    await ap.reload()
    await settle(ap)
    const d = await openInvoice()
    const text = await figures(d)
    want(info, 'S10 rest reload', text.includes(amount(rest.net)) && text.includes(amount(rest.gst)), `after a reload the Create invoice dialog shows "${text}" and not what is left (net ${amount(rest.net)}, GST ${amount(rest.gst)})`, flat(await d.innerText()).slice(0, 300))
    const num2 = await d.getByRole('textbox', { name: 'Invoice number' }).inputValue()
    const prev = (await invoicesOf(L.id))[0]?.number
    want(info, 'S10 numbering', Number(num2.replace(/\D/g, '')) === Number(String(prev).replace(/\D/g, '')) + 1, `the second invoice is proposed as ${num2} after ${prev}`)
    await d.getByRole('button', { name: 'Create invoice', exact: true }).click()
    await ap.waitForTimeout(2500)
    if (await d.isVisible()) {
      obs(info, 'S10 rest create', `Create invoice with the pre-filled amounts did not close the dialog: ${flat(await d.innerText()).slice(0, 400)}`)
      await d.getByText(/Edit the amounts/).click()
      await d.getByRole('textbox', { name: 'Net amount, PKR' }).fill(String(rest.net))
      await d.getByRole('button', { name: 'Create invoice', exact: true }).click()
    }
    await d.waitFor({ state: 'hidden', timeout: T })
    const inv = await until(() => invoicesOf(L.id), r => r.length === 2)
    const net = r2(inv.reduce((s, i) => s + num(i.net_amount), 0))
    const gst = inv.reduce((s, i) => s + num(i.gst_amount), 0)
    want(info, 'S10 rest', same(net, M.net) && same(gst, M.gst), `invoices total net ${net} GST ${gst}, the order is net ${M.net} GST ${M.gst}`, inv)
    want(info, 'S10 rest', (await stateOf(L.id)).invoicing_state === 'fully_invoiced', 'the order is not fully invoiced after the rest')
  })
  await probe(info, ap, 'S10 payments: part, the rest, over; the due date on Who owes us', async () => {
    const rec = async () => (await db.adminRpc<{ gross_target: number; settled: number; balance: number; overpaid_by: number; payment_state: string; due_on: string | null }[]>('order_receivables', { p_order_id: L.id }))[0]
    const r0 = await rec()
    want(info, 'S10 due', r0?.due_on === addDays(today, 30), `the due date is ${r0?.due_on}; invoice date ${today} + 30 days is ${addDays(today, 30)}`)
    want(info, 'S10 gross', same(num(r0?.gross_target), M.gross), `receivable gross ${r0?.gross_target}, order gross ${M.gross}`)
    await db.rows<unknown>('payments_in?limit=1')
    const pay = async (value: number) => {
      await ap.reload()
      await settle(ap)
      const button = actions(ap).getByRole('button', { name: 'Record payment', exact: true }).first()
      if (await button.isVisible().catch(() => false)) await button.click()
      else {
        await ap.getByRole('button', { name: /^More( actions)?$/ }).first().click()
        await ap.getByRole('menuitem', { name: 'Record payment' }).click()
      }
      const d = ap.getByRole('dialog', { name: 'Record payment' })
      await d.getByRole('textbox', { name: 'Amount received, PKR' }).fill(String(value))
      await d.getByRole('button', { name: 'Save payment' }).click()
      await d.waitFor({ state: 'hidden', timeout: T })
    }
    await pay(100000)
    const r1 = await until(rec, v => num(v?.settled) > 0)
    want(info, 'S10 part payment', same(num(r1?.balance), M.gross - 100000) && r1?.payment_state === 'part', `after 100,000: ${JSON.stringify(r1)}`)
    await pay(r2(M.gross - 100000))
    const r2_ = await until(rec, v => v?.payment_state === 'settled')
    want(info, 'S10 rest payment', r2_?.payment_state === 'settled' && num(r2_?.balance) === 0, `after the rest: ${JSON.stringify(r2_)}`)
    await pay(500)
    const r3 = await until(rec, v => num(v?.overpaid_by) > 0)
    want(info, 'S10 over payment', same(num(r3?.overpaid_by), 500), `after paying 500 too much: ${JSON.stringify(r3)}`)
  })
  await probe(info, ap, 'S10 Who owes us for an open order shows the right balance and due date', async () => {
    const X = await liveOrder({ service5: true, leaveOut4: true, terms: 45 })
    for (const leg of [X.A, X.BU, X.BE]) await db.patch(`supplier_orders?id=eq.${leg.id}`, { placed_on: addDays(today, -6), delivered_on: addDays(today, -1), received_on: addDays(today, -1) })
    const t = (await db.view<{ gross: number }>(`v_order_items_total?order_id=eq.${X.id}&select=gross`))[0]
    await db.insert('invoices', [{ order_id: X.id, company_id: X.c.customer.id, number: (await db.adminRpc<{ next_number: string }[]>('next_invoice_number', {}))[0].next_number, invoice_date: today, net_amount: totalsOf(lines).net, gst_amount: totalsOf(lines).gst }])
    await visit(ap, info, `/money/receivables?q=${encodeURIComponent(X.c.customer.name)}`)
    const row = flat(await ap.getByRole('row').filter({ hasText: X.c.customer.name }).first().innerText({ timeout: T }).catch(() => ''))
    want(info, 'S10 Who owes us', row.includes(amount(num(t.gross))), `Who owes us row "${row}" lacks the balance ${amount(num(t.gross))}`)
    const due = addDays(today, 45)
    want(info, 'S10 Who owes us', new RegExp(`${Number(due.slice(8, 10))} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(due.slice(5, 7)) - 1]}|${slashDate(due)}`).test(row), `Who owes us row does not show the due date ${due} (45 days)`, row)
  })
  await probe(info, ap, 'S10 invoice PDF text', async () => {
    await visit(ap, info, `/orders/${L.id}`)
    await ap.getByRole('button', { name: 'Print invoice' }).first().click({ timeout: T })
    const d = ap.getByRole('dialog', { name: 'Sales tax invoice' })
    const dl = d.getByRole('button', { name: /^(Download|Share)$/ })
    await dl.waitFor({ timeout: T })
    await shot(ap, 'S10-invoice-dialog')
    if (await dl.isDisabled()) return obs(info, 'S10 invoice PDF', 'Download is disabled', flat(await d.innerText()).slice(0, 500))
    const [download] = await Promise.all([ap.waitForEvent('download', { timeout: 30_000 }), dl.click()])
    const path = await download.path()
    const buf = path ? (await import('node:fs')).readFileSync(path) : null
    want(info, 'S10 invoice PDF', pdfIsValid(buf), 'the downloaded invoice is not a valid PDF')
    const text = buf ? pdfText(buf) : null
    if (text) {
      const [one, two] = await invoicesOf(L.id)
      obs(info, 'S10 invoice PDF', 'pdftotext of the downloaded invoice (for review)', text.slice(0, 1800))
      const which = flat(text).includes(two.number) ? two : one
      const mine = which === two ? lines.slice(1) : lines.slice(0, 1)
      const m = totalsOf(mine)
      for (const needle of ['Sales Tax Invoice', which.number, 'Indus Fibre Mills', amount(m.net, { always: true }), amount(m.gst, { always: true }), amount(m.gross, { always: true }), 'NTN', '1234567890123', 'Plot 9, Sundar Industrial Estate'])
        want(info, 'S10 invoice PDF', flat(text).includes(needle), `invoice PDF of ${which.number} lacks "${needle}"`)
      for (const l of mine) want(info, 'S10 invoice PDF', flat(text).includes(amount(lineMath(l).net, { always: true })), `invoice PDF lacks the line value ${amount(lineMath(l).net, { always: true })}`)
      want(info, 'S10 invoice PDF', which.number === two.number, `the Print invoice dialog offers ${which.number} first, not the latest ${two.number}`)
    }
  })
  await admin.close()
})

// ------------------------------------------------------------------------------------------------ S11: cancel and reorder

test('jobflow S11: cancel an order with a PO sent, the RFQ is open again, Mark won again: no double payables, no duplicated commissioning, the same customer PO', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const PO = `PO-${letters(5).toUpperCase()}`
  const L = await liveOrder({ service5: true, leaveOut4: true, needs: true })
  await db.patch(`orders?id=eq.${L.id}`, { customer_po_number: PO })
  await db.insert('order_engineers', [{ order_id: L.id, user_id: USER.engineer }])
  await db.patch(`orders?id=eq.${L.id}`, { commissioning_planned_on: addDays(today, 3) })
  const poA = await issuePoRpc(L.A.id)
  want(info, 'S11 PO', poA.status < 300, `PO refused ${poA.status}`)
  const pos = await posOf(L.A.id)
  const poRef = `PO-${today.slice(2, 4)}-${String(pos[0]?.number ?? 0).padStart(4, '0')}`

  const admin = await ctxAs(browser, info, 'admin', 'desktop')
  const ap = await newPage(admin, info, 'S11 admin')
  const outcomes = async () => (await db.view<{ outcome: string; rfqs: number }>('v_report_rfq_outcomes?select=outcome,rfqs')).filter(o => o.outcome === 'won').reduce((n, o) => n + num(o.rfqs), 0)
  const wonBefore = await outcomes()
  await visit(ap, info, `/orders/${L.id}`)
  await probe(info, ap, 'S11 cancel with a PO sent: the dialog names the PO', async () => {
    await ap.getByRole('button', { name: /^More( actions)?$/ }).first().click({ timeout: T })
    await ap.getByRole('menuitem', { name: 'Cancel order' }).click({ timeout: T })
    const d = ap.getByRole('dialog', { name: 'Cancel this order' })
    const sent = flat(await d.getByTestId('cancel-sent-pos').innerText({ timeout: T }).catch(() => ''))
    want(info, 'S11 cancel dialog', sent.includes(poRef) && sent.includes(L.c.supA.name), `the dialog's sent-PO list is "${sent}", expected ${poRef} to ${L.c.supA.name}`)
    await shot(ap, 'S11-cancel-dialog')
    await d.getByRole('radio', { name: 'The customer cancelled the PO' }).click()
    await d.getByRole('button', { name: 'Cancel order', exact: true }).click()
    const o = await until(() => orderRow(L.id), r => r.cancelled_on !== null)
    want(info, 'S11 cancel', o.cancelled_on === today, `cancelled_on ${o.cancelled_on}`)
  })
  await probe(info, ap, 'S11 the RFQ is open again: state, stage chip, Today', async () => {
    const s = await rfqState(L.c.rfq.id)
    want(info, 'S11 rfq state', s.outcome === 'open' && s.bid_state === 'bid_sent', `after the cancel the RFQ reads ${JSON.stringify(s)}, expected open / bid_sent`)
    await visit(ap, info, `/rfqs/${L.c.rfq.id}`)
    const text = flat(await ap.locator('#main').innerText())
    want(info, 'S11 rfq page', !/Won\./.test(text) && /Mark won/.test(text), 'the RFQ page after the cancel still reads Won or does not offer Mark won', text.slice(0, 300))
    want(info, 'S11 rfq page', !new RegExp(`Open ${orderRef(L.number)}`).test(text), 'the RFQ page still links to the cancelled order as its order')
    const chips = (await ap.locator('#main [data-status]').allInnerTexts()).map(flat)
    want(info, 'S11 stage chip', chips.some(c => /Quotation sent/.test(c)) && !chips.some(c => /Won/.test(c)), `the stage chip after the cancel reads ${JSON.stringify(chips)}, expected "Quotation sent"`)
    const wonAfter = await outcomes()
    want(info, 'S11 outcomes report', wonAfter === wonBefore - 1, `the RFQ outcomes report counts ${wonBefore} won RFQs before the cancel and ${wonAfter} after it, expected one fewer`)
    await shot(ap, 'S11-rfq-after-cancel')
    const t = await todayItems(admin, info, 'plan_commissioning', orderRef(L.number))
    want(info, 'S11 Today', t.count === 0, `Today still asks to plan the commissioning of the cancelled ${orderRef(L.number)}`)
  })
  // The customer sends the same PO again: Mark won with the same customer PO number (the cancelled order still holds it)
  await visit(ap, info, `/rfqs/${L.c.rfq.id}`)
  const same_ = await winUi(ap, info, 'S11 same PO', async d => {
    await d.getByLabel(/^Customer PO number/).fill(PO)
  })
  await probe(info, ap, 'S11 same customer PO after the cancel', async () => {
    const err = flat(await ap.getByRole('dialog').getByRole('alert').innerText().catch(() => ''))
    want(info, 'S11 same PO again', same_.created, `Mark won again with the same customer PO ${PO} cannot create the order. The dialog says: "${err}" (the PO is held by the CANCELLED ${orderRef(L.number)}; the message names neither the PO nor that order)`)
    want(info, 'S11 same PO again', same_.created || /cancel|ORD-\d{4}|PO/i.test(err.replace(/^Couldn't create the order/, '')), 'the refusal does not say which order holds the PO', err)
    if (!same_.created) await ap.keyboard.press('Escape')
  })
  // ... and Mark won with no PO (to be added later)
  await visit(ap, info, `/rfqs/${L.c.rfq.id}`)
  const won = same_.created ? same_ : await winUi(ap, info, 'S11')
  await probe(info, ap, 'S11 the second order', async () => {
    if (!won.orderId) return void obs(info, 'S11 second order', 'the second order could not be made')
    const id2 = won.orderId
    await probe(info, ap, 'S11 the customer PO can be added to the new order later', async () => {
      const upd = await as('admin', `orders?id=eq.${id2}`, { method: 'PATCH', body: { customer_po_number: PO }, prefer: 'return=minimal' })
      want(info, 'S11 add the PO later', upd.status < 300, `adding the customer PO ${PO} to the new order afterwards is refused (${upd.status} ${JSON.stringify(upd.body).slice(0, 120)}): the cancelled ${orderRef(L.number)} keeps the number for ever`)
    })
    const legs1 = await legsOf(L.id)
    const legs2 = await legsOf(id2)
    want(info, 'S11 reuse', legs2.length === 3, `the second order has ${legs2.length} supplier orders`)
    const shared = legs2.filter(l => legs1.some(x => x.inquiry_id === l.inquiry_id))
    obs(info, 'S11 legs reuse the inquiry', `${shared.length} of ${legs2.length} new supplier orders point at the same supplier inquiry as the cancelled order's`)
    const issued = await issuePoRpc(legs2.find(l => l.supplier_id === L.c.supA.id)!.id)
    want(info, 'S11 PO again', issued.status < 300, `PO on the new order refused ${issued.status}`)
    const pay = await db.adminRpc<{ order_id: string; supplier_id: string; committed: number; owed_pkr: number | null }[]>('payables_as_of', { p_date: today })
    const mine = pay.filter(p => p.supplier_id === L.c.supA.id)
    want(info, 'S11 payables', mine.length === 1 && mine[0].order_id === id2, `We owe supplier A: ${mine.length} rows (${mine.map(m => m.order_id === id2 ? 'new' : m.order_id === L.id ? 'cancelled' : '?').join(', ')}), expected only the new order`)
    const eng = await db.rows<unknown>(`order_engineers?order_id=eq.${id2}&select=user_id`)
    const o2 = await orderRow(id2)
    obs(info, 'S11 commissioning', `new order needs_commissioning ${o2.needs_commissioning}, planned ${o2.commissioning_planned_on}, engineers ${eng.length}`)
    const t1 = await todayItems(admin, info, 'plan_commissioning', orderRef(L.number))
    const t2 = await todayItems(admin, info, 'plan_commissioning', orderRef(o2.number))
    want(info, 'S11 commissioning', t1.count === 0, `Today asks to plan the commissioning of the CANCELLED ${orderRef(L.number)}`)
    obs(info, 'S11 commissioning', `plan-commissioning on Today for the new order (goods not placed yet): ${t2.count}`)
    const s = await rfqState(L.c.rfq.id)
    want(info, 'S11 rfq state', s.outcome === 'won', `RFQ outcome after Mark won again is ${s.outcome}`)
    const total = await orderTotal(id2)
    const total1 = await orderTotal(L.id)
    obs(info, 'S11 totals', `new order gross ${total.gross}, the cancelled order's ${total1.gross} (the new one has ${(await itemsOf(id2)).length} lines, the cancelled ${(await itemsOf(L.id)).length})`)
    // What the next RFQ for the same customer is told about the price last sold
    const next = await post<{ id: string }>('rfqs', { company_id: L.c.customer.id, owner_id: USER.sales })
    await postMany('rfq_items', [{ rfq_id: next.id, position: 0, description: ITEMS[0].description, qty: 5, unit: 'nos', gst_rate: 18 }])
    const mem = (await rpcAs<{ sold_price: number | null; sold_order_number: number | null }[]>('sales', 'customer_price_memory', { p_rfq_id: next.id })).body ?? []
    const sold = mem.filter(m => m.sold_price !== null)
    want(info, 'S11 price memory', sold.length === 1 && sold[0].sold_order_number === num((await orderRow(id2)).number), `the price memory for the next RFQ names ${JSON.stringify(sold.map(s => s.sold_order_number))}; expected only the live ${orderRef(num((await orderRow(id2)).number))}`)
    // Reopen the cancelled order while the new one is live: two live orders for one RFQ.
    await visit(ap, info, `/orders/${L.id}`)
    await ap.getByRole('button', { name: /^More( actions)?$/ }).first().click({ timeout: T })
    const reopen = ap.getByRole('menuitem', { name: 'Reopen order' })
    if (await reopen.count()) {
      await reopen.click()
      await ap.waitForTimeout(1500)
      const live = await db.rows<{ id: string }>(`orders?rfq_id=eq.${L.c.rfq.id}&cancelled_on=is.null&select=id`)
      want(info, 'S11 reopen', live.length === 1, `Reopen order on the cancelled order left ${live.length} live orders for one RFQ (both carry the same goods and both owe the suppliers)`)
      const pay2 = await db.adminRpc<{ order_id: string; supplier_id: string }[]>('payables_as_of', { p_date: today })
      obs(info, 'S11 reopen', `payables rows for supplier A after the reopen: ${pay2.filter(p => p.supplier_id === L.c.supA.id).length}`)
    } else obs(info, 'S11 reopen', 'no Reopen order in the menu of the cancelled order')
  })
  await admin.close()
})

// ------------------------------------------------------------------------------------------------ S12: repeat orders


test('jobflow S12: repeat an order: from a delivered one, a cancelled one, an imported one with unknown prices; then a PO', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const sales = await ctxAs(browser, info, 'sales', 'desktop')
  const page = await newPage(sales, info, 'S12 sales')

  // ---- a delivered order
  const L = await liveOrder({ service5: true, leaveOut4: true, needs: true })
  for (const leg of [L.A, L.BU, L.BE]) await db.patch(`supplier_orders?id=eq.${leg.id}`, { placed_on: addDays(today, -9), expected_on: addDays(today, -3), delivered_on: addDays(today, -2), received_on: addDays(today, -2) })
  await db.patch(`orders?id=eq.${L.id}`, { commissioning_planned_on: addDays(today, -2), commissioning_done_on: addDays(today, -1) })
  const poA = `REP-${letters(5).toUpperCase()}`
  const r1 = await repeatVia(page, info, 'S12 delivered', L.number, L.c.customer.name, poA)
  await probe(info, null, 'S12 the copy of a delivered order', async () => {
    if (!r1) return
    const [src, copy] = [await itemsOf(L.id), await itemsOf(r1)]
    want(info, 'S12 copy', copy.length === src.length && copy.every((c, i) => same(num(c.unit_price_net), num(src[i].unit_price_net)) && num(c.qty) === num(src[i].qty) && c.is_service === src[i].is_service), 'the copied lines differ from the source', copy.map(c => `${c.description} ${c.qty} x ${c.unit_price_net}`))
    const legs = await legsOf(r1)
    want(info, 'S12 copy', legs.length === 3 && legs.every(l => l.placed_on === null && l.delivered_on === null && l.expected_on === null), 'the copied supplier orders carry dates or are missing', legs)
    const o = await orderRow(r1)
    want(info, 'S12 copy', o.rfq_id === null && o.cancelled_on === null && o.commissioning_done_on === null && o.commissioning_planned_on === null && o.needs_commissioning === true, `copied header ${JSON.stringify(o)}`)
    want(info, 'S12 copy', copy.every(c => c.rfq_item_id === null), 'a copied line still points at the old RFQ item')
    const st = await stateOf(r1)
    obs(info, 'S12 copy state', `goods_state ${st.goods_state}, commissioning ${st.commissioning_state}`)
    const pos = await issuePoRpc(legs.find(l => l.currency === 'USD')!.id)
    want(info, 'S12 PO on the copy', pos.status < 300, `a PO on the copied USD supplier order is refused: ${pos.status} ${JSON.stringify(pos.body).slice(0, 160)}`)
  })

  // ---- a cancelled order, from the customer's company page (which lists cancelled orders with a Repeat order button)
  const C = await liveOrder({ service5: true, leaveOut4: true })
  await db.patch(`orders?id=eq.${C.id}`, { cancelled_on: today, cancel_reason: 'customer_cancelled' })
  await probe(info, page, 'S12 repeat a CANCELLED order from the company page', async () => {
    await visit(page, info, `/companies/${C.c.customer.id}`)
    const button = page.getByRole('button', { name: `Repeat order ${orderRef(C.number)}` })
    const offered = (await button.count()) > 0
    want(info, 'S12 cancelled', !offered, `the company page offers "Repeat order" on the CANCELLED ${orderRef(C.number)}; a copy of a cancelled order carries no warning that it was cancelled`)
    if (!offered) return
    await button.first().click()
    const d = page.getByRole('dialog')
    const text = flat(await d.innerText())
    want(info, 'S12 cancelled', /cancel/i.test(text), 'the Repeat dialog for a cancelled order never says the source was cancelled', text.slice(0, 300))
    await d.getByRole('button', { name: 'Create order' }).click()
    await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/, { timeout: 30_000 })
    const id = /orders\/([0-9a-f-]{36})/.exec(page.url())?.[1]
    obs(info, 'S12 cancelled', `a repeat of the cancelled order was created without a warning: ${id}`)
  })
  await probe(info, null, 'S12 create_repeat_order itself on a cancelled order', async () => {
    const r = await rpcAs<string>('sales', 'create_repeat_order', { p_order_id: crypto.randomUUID(), p_from_order_id: C.id })
    want(info, 'S12 cancelled rpc', r.status >= 400, `create_repeat_order copied a CANCELLED order (${r.status}) with no check`)
  })

  // ---- an imported order with unknown / null prices
  const imp = await seedImportedOrder()
  const cust = imp.customer
  const poB = `REP-${letters(5).toUpperCase()}`
  const r3 = await repeatVia(page, info, 'S12 imported', imp.number, cust.name, poB)
  await probe(info, null, 'S12 the copy of an imported order', async () => {
    if (!r3) return
    const copy = await itemsOf(r3)
    const o = await orderRow(r3)
    const flags = (await db.one<{ legacy_flags: string[] }>(`orders?id=eq.${r3}&select=legacy_flags`)).legacy_flags
    want(info, 'S12 imported', !copy.some(c => same(num(c.unit_price_net), 125000)) || flags.includes('value_basis_unknown'), 'the repeat of an order whose price basis is unknown (GST in or out?) copied the old figure 125,000 as a plain net price and dropped the warning', { flags, prices: copy.map(c => c.unit_price_net) })
    want(info, 'S12 imported', !copy.some(c => num(c.unit_price_net) === 0), 'the repeat of an imported order copied a line priced 0 as a normal line', copy.map(c => `${c.description} ${c.unit_price_net}`))
    const legs = await legsOf(r3)
    want(info, 'S12 imported', legs.every(l => l.currency !== null), 'the copied supplier order of the imported order has no currency', legs.map(l => l.currency))
    const st = await stateOf(r3)
    obs(info, 'S12 imported', `copy state ${JSON.stringify(st)}, terms ${o.payment_terms_days}`)
    // then a PO on the copied leg
    const legId = legs[0]?.id
    if (legId) {
      const pre = await rpcAs<{ unit_price: number | null }[]>('sales', 'po_line_prefill', { p_supplier_order_id: legId })
      obs(info, 'S12 imported PO', `po_line_prefill ${pre.status}: ${JSON.stringify(pre.body).slice(0, 200)}`)
      const issued = await issuePoRpc(legId)
      obs(info, 'S12 imported PO', `Issue PO on the copied leg (no currency, no supplier prices): ${issued.status} ${JSON.stringify(issued.body).slice(0, 200)}`)
      await visit(page, info, `/orders/${r3}`)
      const b = page.getByRole('listitem', { name: /^Supplier order,/ }).first().getByRole('button', { name: /^Issue PO,/ })
      if (await b.count()) {
        await b.click()
        const d = page.getByRole('dialog')
        await d.getByRole('heading', { name: 'Issue purchase order' }).waitFor({ timeout: T })
        const txt = flat(await d.innerText())
        want(info, 'S12 imported PO dialog', /currency/i.test(txt) && (await d.getByLabel('Currency').count()) > 0, 'the Issue PO dialog on a supplier order with no currency has no Currency field', txt.slice(0, 300))
        await shot(page, 'S12-imported-po-dialog')
      }
    }
  })
  await sales.close()
})

// ------------------------------------------------------------------------------------------------ S13: roles

test('jobflow S13: roles: the engineer sees no price at any step (also by ?won=1 and ?issue=1 in the address), sales cannot record a payment', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const L = await liveOrder({ service5: true, leaveOut4: true, needs: true })
  await issuePoRpc(L.A.id)
  await db.insert('order_engineers', [{ order_id: L.id, user_id: USER.engineer }])
  const eng = await ctxAs(browser, info, 'engineer', 'desktop')
  const phone = await ctxAs(browser, info, 'engineer', 'phone')
  const paths = [
    ['the RFQ', `/rfqs/${L.c.rfq.id}`],
    ['the RFQ with ?won=1', `/rfqs/${L.c.rfq.id}?won=1`],
    ['the RFQ with ?issue=1', `/rfqs/${L.c.rfq.id}?issue=1`],
    ['the order', `/orders/${L.id}`],
    ['the order with ?won=1', `/orders/${L.id}?won=1`],
    ['the orders list', '/orders?owner=all'],
    ['the RFQ board', '/rfqs'],
    ['Today', '/today'],
  ] as const
  for (const [label, path] of paths) {
    for (const [vp, ctx] of [['desktop', eng], ['phone', phone]] as const) {
      await probe(info, null, `S13 engineer ${vp}: ${label}`, async () => {
        const p = await newPage(ctx, info, `S13 engineer ${label}`)
        const log = spy(p)
        await visit(p, info, path)
        await p.waitForTimeout(800)
        const text = await p.locator('body').innerText()
        const found = PRICE_STRINGS.filter(s => text.includes(s))
        want(info, `S13 ${label} ${vp}`, found.length === 0, `the engineer's page shows prices: ${found.join(', ')}`)
        want(info, `S13 ${label} ${vp}`, (await p.getByRole('dialog').filter({ hasText: /Create order|Issue quotation|Mark won/ }).count()) === 0, 'an engineer got the Mark won or Issue quotation dialog by the address')
        want(info, `S13 ${label} ${vp}`, log.leaks.length === 0, `the database answered the engineer with money: ${[...new Set(log.leaks)].slice(0, 6).join(', ')}`)
        const bad = log.urls.filter(u => /payments_in|\/invoices|order_receivables|rank_item_quotes|po_line_prefill|v_fx_latest|\/fx_rates|customer_price_memory|supplier_item_memory/.test(u))
        want(info, `S13 ${label} ${vp}`, bad.length === 0, `the engineer's page asked for ${bad.slice(0, 3).join(' | ')}`)
        await p.close()
      })
    }
  }
  await probe(info, null, 'S13 the engineer API: every table of the job, column by column', async () => {
    const calls: [string, string][] = [
      ['order_items', `/rest/v1/order_items?order_id=eq.${L.id}&select=*`],
      ['rfq_items', `/rest/v1/rfq_items?rfq_id=eq.${L.c.rfq.id}&select=*`],
      ['quotations', `/rest/v1/quotations?rfq_id=eq.${L.c.rfq.id}&select=*`],
      ['supplier_quote_lines', `/rest/v1/supplier_quote_lines?select=*&limit=5`],
      ['purchase_orders', `/rest/v1/purchase_orders?select=*&limit=5`],
      ['v_order_state', `/rest/v1/v_order_state?order_id=eq.${L.id}&select=*`],
      ['v_order_items_total', `/rest/v1/v_order_items_total?order_id=eq.${L.id}&select=*`],
    ]
    for (const [name, path] of calls) {
      const r = await api('engineer', path)
      const rows = Array.isArray(r.body) ? r.body : []
      const leaks = rows.flatMap(row => Object.entries(row as Record<string, unknown>).filter(([k, v]) => v !== null && v !== 0 && /(price|total|net|gross|gst_total|amount)/i.test(k) && !/gst_rate/.test(k)).map(([k]) => k))
      want(info, `S13 api ${name}`, r.status >= 400 || leaks.length === 0, `the engineer reads ${name} (${r.status}) with ${[...new Set(leaks)].join(', ')}`)
    }
  })
  await probe(info, null, 'S13 sales: no Payment received on the order, in the header or the menu', async () => {
    await db.insert('invoices', [{ order_id: L.id, company_id: L.c.customer.id, number: (await db.adminRpc<{ next_number: string }[]>('next_invoice_number', {}))[0].next_number, invoice_date: today, net_amount: 1000, gst_amount: 180 }])
    const sales = await ctxAs(browser, info, 'sales', 'desktop')
    const p = await newPage(sales, info, 'S13 sales')
    await visit(p, info, `/orders/${L.id}`)
    want(info, 'S13 sales', (await p.getByRole('button', { name: /Record payment/ }).count()) === 0, 'sales sees a Record payment button')
    await p.getByRole('button', { name: /^More( actions)?$/ }).first().click().catch(() => undefined)
    want(info, 'S13 sales', (await p.getByRole('menuitem', { name: /Record payment/ }).count()) === 0, 'sales sees Record payment in the More menu')
    await p.keyboard.press('Escape')
    const r = await rpcAs<unknown>('sales', 'order_receivables', { p_order_id: L.id })
    obs(info, 'S13 sales', `sales may read order_receivables (${r.status}); creating a payment as sales: ${(await as_('sales', 'payments_in', { order_id: L.id, amount: 10, received_on: today, paid_via: 'bank' })).status}`)
    await visit(p, info, '/money/receivables')
    await sales.close()
  })
  await eng.close()
  await phone.close()
})

const as_ = (role: 'sales' | 'admin' | 'engineer', table: string, body: unknown) => as(role, table, { method: 'POST', body })

// ------------------------------------------------------------------------------------------------ S14: robustness

test('jobflow S14: double click Create order, two tabs on one RFQ, reload and Back with the dialog open, the dialog and the order on a 375 px phone', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const c = await seedCast({ items: 3 })
  await standardReplies(c)
  await issueQuote(c, { only: [0, 1, 2] })
  const sales = await ctxAs(browser, info, 'sales', 'desktop')
  const p1 = await newPage(sales, info, 'S14 tab 1')
  const p2 = await newPage(sales, info, 'S14 tab 2')
  await visit(p1, info, `/rfqs/${c.rfq.id}`)
  await visit(p2, info, `/rfqs/${c.rfq.id}`)

  await probe(info, p1, 'S14 reload and Back with the Mark won dialog open', async () => {
    await openMarkWon(p1)
    await p1.getByRole('dialog').getByRole('heading', { name: 'Mark won' }).waitFor({ timeout: T })
    await p1.reload()
    await settle(p1)
    const reopened = await p1.getByRole('dialog').count()
    obs(info, 'S14 reload', `after a reload the Mark won dialog is ${reopened ? 'open again (the address carries ?won=1)' : 'closed'}`)
    await p1.keyboard.press('Escape')
    await p1.goBack()
    await p1.waitForTimeout(800)
    obs(info, 'S14 Back', `after closing the dialog and going Back the page is ${p1.url()}`)
    await visit(p1, info, `/rfqs/${c.rfq.id}`)
    want(info, 'S14 no order yet', (await db.rows(`orders?rfq_id=eq.${c.rfq.id}&select=id`)).length === 0, 'an order exists after only opening, reloading and going Back')
  })

  await probe(info, p2, 'S14 tab 2 opens Mark won and types a customer PO', async () => {
    await openMarkWon(p2)
    const d = p2.getByRole('dialog')
    await d.getByRole('group', { name: 'Suppliers by line' }).waitFor({ timeout: T })
    await d.getByLabel(/^Customer PO number/).fill('TAB-TWO-PO')
  })
  const orderIdFrom = (u: string) => /orders\/([0-9a-f-]{36})/.exec(u)?.[1] ?? null
  await probe(info, p1, 'S14 tab 1: double click Create order', async () => {
    await openMarkWon(p1)
    const d = p1.getByRole('dialog')
    await d.getByRole('group', { name: 'Suppliers by line' }).waitFor({ timeout: T })
    await d.getByLabel(/^Customer PO number/).fill('TAB-ONE-PO')
    await d.getByRole('button', { name: 'Create order' }).dblclick()
    await p1.waitForURL(/\/orders\/[0-9a-f-]{36}$/, { timeout: 30_000 })
    await p1.waitForTimeout(1500)
    const orders = await db.rows<{ id: string; customer_po_number: string | null }>(`orders?rfq_id=eq.${c.rfq.id}&select=id,customer_po_number`)
    want(info, 'S14 double click', orders.length === 1, `a double click on Create order made ${orders.length} orders`)
    want(info, 'S14 order lines', (await itemsOf(orders[0]?.id ?? '')).length === 3, 'the order does not have the 3 quoted lines')
  })
  await probe(info, p2, 'S14 tab 2: Create order on an RFQ that was just won in tab 1', async () => {
    await p2.getByRole('dialog').getByRole('button', { name: 'Create order' }).click()
    await p2.waitForTimeout(2500)
    const orders = await db.rows<{ id: string; customer_po_number: string | null }>(`orders?rfq_id=eq.${c.rfq.id}&select=id,customer_po_number`)
    want(info, 'S14 two tabs', orders.length === 1, `two tabs made ${orders.length} orders for one RFQ`)
    const where = p2.url()
    want(info, 'S14 two tabs', orderIdFrom(where) === orders[0]?.id, `the second tab ends on ${where}, not on the order that exists`)
    want(info, 'S14 two tabs', orders[0]?.customer_po_number === 'TAB-TWO-PO' || (await toast(p2, /already|PO/).count()) > 0, `the customer PO typed in the second tab (TAB-TWO-PO) was dropped without a word: the order keeps ${orders[0]?.customer_po_number}`)
    await shot(p2, 'S14-second-tab-after-win')
  })
  await probe(info, null, 'S14 a Mark won dialog opened by ?won=1 on an RFQ that already has an order', async () => {
    const p = await newPage(sales, info, 'S14 won=1')
    await visit(p, info, `/rfqs/${c.rfq.id}?won=1`)
    const d = p.getByRole('dialog')
    const open = (await d.count()) > 0
    want(info, 'S14 won=1', !open, 'the Mark won dialog opens by the address on an RFQ that is already won (Create order would only open the existing order)')
    await p.close()
  })

  const phone = await ctxAs(browser, info, 'sales', 'phone')
  const c2 = await seedCast({ items: 5 })
  await standardReplies(c2)
  await issueQuote(c2, { gst: { 4: 0 } })
  const pp = await newPage(phone, info, 'S14 phone')
  await visit(pp, info, `/rfqs/${c2.rfq.id}`)
  await probe(info, pp, 'S14 the Mark won dialog and the order on a 375 px phone', async () => {
    const w = pp.locator('[data-slot="mark-won"]').getByRole('button', { name: 'Mark won' })
    if (await w.first().isVisible().catch(() => false)) await w.first().click()
    else {
      await pp.getByRole('button', { name: 'More actions' }).click({ timeout: T })
      await pp.getByRole('menuitem', { name: /^Mark won/ }).click()
    }
    const d = pp.getByRole('dialog')
    await d.getByRole('group', { name: 'Suppliers by line' }).waitFor({ timeout: T })
    await layout(pp, info, 'S14 Mark won dialog phone')
    await shot(pp, 'S14-phone-mark-won')
    const box = await d.getByRole('button', { name: 'Create order' }).boundingBox()
    want(info, 'S14 phone', !!box && box.height >= 40 && box.x + box.width <= 375, `Create order on the phone is ${JSON.stringify(box)}`)
    const scrollsSideways = await pp.evaluate(() => document.scrollingElement!.scrollWidth > window.innerWidth + 1)
    want(info, 'S14 phone', !scrollsSideways, 'the page scrolls sideways under the Mark won dialog on a 375 px phone')
    await d.getByRole('button', { name: 'Create order' }).click()
    await pp.waitForURL(/\/orders\/[0-9a-f-]{36}$/, { timeout: 30_000 })
    await settle(pp)
    await layout(pp, info, 'S14 order page phone')
    await shot(pp, 'S14-phone-order')
  })
  await phone.close()
  await sales.close()
})

test('jobflow S14b: the quotation is revised and a quantity changed in another tab while Mark won is open: the order is made at figures the dialog never showed', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const c = await seedCast({ items: 3 })
  await standardReplies(c)
  await issueQuote(c, { only: [0, 1, 2] })
  const sales = await ctxAs(browser, info, 'sales', 'desktop')
  const p1 = await newPage(sales, info, 'S14b tab 1')
  await visit(p1, info, `/rfqs/${c.rfq.id}`)
  let shownNet = ''
  await probe(info, p1, 'S14b tab 1 opens Mark won', async () => {
    await openMarkWon(p1)
    const d = p1.getByRole('dialog')
    await d.getByRole('group', { name: 'Order totals' }).waitFor({ timeout: T })
    shownNet = flat(await d.getByRole('group', { name: 'Order totals' }).innerText())
  })
  // another tab: a revised quotation with new prices, then a quantity edited on the RFQ
  const r1 = await issueQuote(c, { only: [0, 1, 2], prices: { 0: 10000, 1: 200000, 2: 220000 } })
  want(info, 'S14b R1', r1.status < 300, `R1 refused ${r1.status}`)
  await db.patch(`rfq_items?id=eq.${c.items[0].id}`, { qty: 12 })
  await probe(info, p1, 'S14b tab 1 presses Create order', async () => {
    await p1.getByRole('dialog').getByRole('button', { name: 'Create order' }).click()
    await p1.waitForURL(/\/orders\/[0-9a-f-]{36}$/, { timeout: 30_000 })
    const id = /orders\/([0-9a-f-]{36})/.exec(p1.url())?.[1] as string
    const t = await orderTotal(id)
    want(info, 'S14b stale dialog', shownNet.includes(amount(t.net)) && shownNet.includes(amount(t.gross)), `the dialog showed "${shownNet}" but the order was made at net ${t.net} gross ${t.gross} (prices of the revision, quantity 12): nothing warned that the quotation had changed`)
  })
  await sales.close()
})

test('jobflow S7b: a line is split in another tab while Issue PO is open: the PO is issued at the old quantity', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const L = await liveOrder({ service5: true, leaveOut4: true })
  const sales = await ctxAs(browser, info, 'sales', 'desktop')
  const page = await newPage(sales, info, 'S7b sales')
  await visit(page, info, `/orders/${L.id}`)
  await probe(info, page, 'S7b open Issue PO on the Lahore supplier order', async () => {
    const row = legRows(page, L.c.supA.name).first()
    await row.getByRole('button', { name: `Issue PO, ${L.c.supA.name}` }).click({ timeout: T })
    await page.getByRole('dialog').getByTestId('po-total').waitFor({ timeout: T })
  })
  // another tab splits the contactor line: 4 of the 10 go to Gulf (USD)
  const split = await rpcAs<string>('sales', 'split_order_item', { p_item_id: L.items[0].id, p_qty: 4, p_supplier_id: L.c.supB.id, p_currency: 'USD', p_supplier_unit_price: 31 })
  want(info, 'S7b split', split.status < 300, `split refused ${split.status} ${JSON.stringify(split.body).slice(0, 160)}`)
  await probe(info, page, 'S7b press Issue PO in the stale dialog', async () => {
    await page.getByRole('dialog').getByRole('button', { name: 'Issue PO', exact: true }).click()
    await page.waitForTimeout(3500)
    const pos = await posOf(L.A.id)
    const now = (await itemsOf(L.id)).find(i => i.id === L.items[0].id)
    const poQty = pos[0]?.lines?.find(l => l.order_item_id === L.items[0].id)?.qty
    want(info, 'S7b stale PO', pos.length === 0 || num(poQty) === num(now?.qty), `the PO to the supplier was issued for quantity ${poQty} of the contactor; the order line now has ${now?.qty} (4 moved to another supplier): the supplier is asked for ${num(poQty) - num(now?.qty)} too many`)
  })
  await sales.close()
})

test('jobflow S10b: two people create the invoice for the same order from two screens', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const L = await liveOrder({ service5: true, leaveOut4: true, terms: 30 })
  for (const leg of [L.A, L.BU, L.BE]) await db.patch(`supplier_orders?id=eq.${leg.id}`, { placed_on: addDays(today, -6), delivered_on: addDays(today, -1), received_on: addDays(today, -1) })
  const M = totalsOf([
    { qty: 10, price: SELL[0], gst: 18 },
    { qty: 1, price: SELL[1], gst: 18 },
    { qty: 2, price: SELL[2], gst: 18 },
    { qty: 1, price: SELL[4], gst: 0 },
  ])
  const admin = await ctxAs(browser, info, 'admin', 'desktop')
  const page = await newPage(admin, info, 'S10b admin')
  await visit(page, info, `/orders/${L.id}`)
  const invoices = () => db.rows<{ number: string; net_amount: number; gst_amount: number }>(`invoices?order_id=eq.${L.id}&select=number,net_amount,gst_amount&order=created_at`)
  await probe(info, page, 'S10b the first screen opens Create invoice', async () => {
    await actions(page).getByRole('button', { name: 'Create invoice' }).click({ timeout: T })
    await page.getByRole('dialog', { name: 'Create invoice' }).getByRole('textbox', { name: 'Invoice number' }).waitFor({ timeout: T })
    await page.waitForTimeout(1500)
  })
  // the second person creates the same invoice (what the dialog writes)
  const nextNo = (await db.adminRpc<{ next_number: string }[]>('next_invoice_number', {}))[0].next_number
  await post('invoices', { order_id: L.id, company_id: L.c.customer.id, number: nextNo, invoice_date: today, net_amount: M.net, gst_amount: M.gst })
  await probe(info, page, 'S10b the first screen presses Create invoice (its number is now taken)', async () => {
    const d = page.getByRole('dialog', { name: 'Create invoice' })
    await d.getByRole('button', { name: 'Create invoice', exact: true }).click()
    await page.waitForTimeout(2500)
    obs(info, 'S10b after the first press', `dialog: ${flat(await d.innerText().catch(() => '(closed)')).slice(0, 360)}; invoices ${(await invoices()).length}`)
    const again = d.getByRole('button', { name: /Try again|Create invoice/ })
    if (await d.isVisible().catch(() => false)) {
      await again.last().click().catch(() => undefined)
      await page.waitForTimeout(2500)
    }
    const rows = await invoices()
    const net = r2(rows.reduce((n, r) => n + num(r.net_amount), 0))
    want(info, 'S10b duplicate invoice', net <= M.net + 0.5, `the order has ${rows.length} invoices carrying net ${net}; the order is only net ${M.net}: the same job was invoiced twice (${rows.map(r => r.number).join(', ')})`)
  })
  await admin.close()
})

test('jobflow S7c: two people issue the PO for the same supplier order from two screens', async ({ browser }, info) => {
  await setProfile(true)
  await setRates()
  const L = await liveOrder({ service5: true, leaveOut4: true })
  const sales = await ctxAs(browser, info, 'sales', 'desktop')
  const page = await newPage(sales, info, 'S7c sales')
  await visit(page, info, `/orders/${L.id}`)
  await probe(info, page, 'S7c the first screen opens Issue PO (R0)', async () => {
    await legRows(page, L.c.supA.name).first().getByRole('button', { name: `Issue PO, ${L.c.supA.name}` }).click({ timeout: T })
    await page.getByRole('dialog').getByTestId('po-total').waitFor({ timeout: T })
  })
  const first = await issuePoRpc(L.A.id, 'admin')
  want(info, 'S7c other screen', first.status < 300, `the other person's PO refused ${first.status}`)
  await probe(info, page, 'S7c the first screen presses Issue PO', async () => {
    await page.getByRole('dialog').getByRole('button', { name: 'Issue PO', exact: true }).click()
    await page.waitForTimeout(4000)
    const pos = await posOf(L.A.id)
    want(info, 'S7c second PO', pos.length === 1, `two people issued the PO for one supplier order: ${pos.length} POs (${pos.map(p => `${p.number} R${p.revision}`).join(', ')}); the second is a silent R1 identical to R0, and nothing told the person that a PO was just issued`)
  })
  await sales.close()
})
