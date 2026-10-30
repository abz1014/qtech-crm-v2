import { JOB_URL, markWonButton, orderCreated } from '../../support/job'
import { expect, test, type Page } from '@playwright/test'
import { db, num } from '../support/db'
import { karachiDay, letters, order, quote, ref, rfq, setProfile, supplier } from '../support/fixtures'
import { open, signedIn } from '../support/session'
import { QUOTES, pkr } from '../support/text'
import { fetchStoredPdf, pdfIsValid, pdfText } from '../../support/pdf'

/*
 * From the quotation to the order, with figures worked by hand: an exempt line, a decimal quantity and prices with paisa; the order
 * made by Mark won must carry exactly what was quoted. Then every way an RFQ can be lost, a lost RFQ that is won after all, and a
 * repeat order that copies GST rates and decimal quantities exactly.
 *
 * The quotation:
 *   item 1  2.5 x 12,345.67 = 30,864.175 -> 30,864.18 net (half away from zero); GST 18% = 5,555.5524 -> 5,556
 *   item 2  1   x  7,500.40 =  7,500.40 net; exempt; GST 0
 *   item 3  3   x    999.99 =  2,999.97 net; GST 18% = 539.9946 -> 540
 *   total   net 41,364.55; GST 6,096; gross 47,460.55
 */
const dialog = (page: Page) => page.getByRole('dialog')

test('issue a quotation with an exempt line and a decimal quantity, then Mark won: the order carries exactly what was quoted', async ({ browser }, info) => {
  await setProfile(true)
  const r = await rfq({
    items: [
      { description: `Radar level transmitter ${letters()}`, qty: 2.5, unit: 'nos' },
      { description: `Calibration of the loop ${letters()}`, qty: 1, unit: 'job', gst: 18 },
      { description: `Junction box, IP66 ${letters()}`, qty: 3, unit: 'nos' },
    ],
  })
  const sup = await supplier('Verify Quote Supplier', 'Pakistan')
  await quote(r.rfq.id, sup, r.items.map((it, i) => ({ itemId: it.id, price: [9000, 5000, 700][i] })), 'PKR')
  const sales = await signedIn(browser, info, 'sales')
  await sales.addInitScript(() => Object.defineProperty(Navigator.prototype, 'share', { value: undefined, configurable: true }))
  const page = await open(sales, `/rfqs/${r.rfq.id}`)

  await test.step('the dialog totals', async () => {
    await page.getByRole('button', { name: QUOTES.issue.open, exact: true }).click()
    await expect(page.getByRole('list', { name: QUOTES.issue.itemsList })).toBeVisible()
    await dialog(page).getByLabel(QUOTES.issue.price(1)).fill('12345.67')
    await dialog(page).getByLabel(QUOTES.issue.price(2)).fill('7500.40')
    await dialog(page).getByLabel(QUOTES.issue.gstRate(2)).selectOption('0')
    await dialog(page).getByLabel(QUOTES.issue.price(3)).fill('999.99')
    await expect(dialog(page).getByTestId('total-net')).toHaveText(pkr(41364.55))
    await expect(dialog(page).getByTestId('total-gst')).toHaveText(pkr(6096))
    await expect(dialog(page).getByTestId('total-gross')).toHaveText(pkr(47460.55))
    await dialog(page).getByRole('button', { name: QUOTES.issue.issue }).click()
    await expect(dialog(page).getByTestId('pdf-ready')).toBeVisible({ timeout: 30_000 })
  })

  const q = await db.one<{ id: string; number: number; revision: number; issued_on: string; valid_until: string; net_total: number; gst_total: number; pdf_path: string | null; lines: { rfq_item_id: string; unit_price_net: number; gst_rate: number }[] }>(
    `quotations?rfq_id=eq.${r.rfq.id}&select=id,number,revision,issued_on,valid_until,net_total,gst_total,pdf_path,lines`,
  )
  await test.step('the quotation, its lines and its PDF', async () => {
    expect([q.revision, num(q.net_total), num(q.gst_total)]).toEqual([0, 41364.55, 6096])
    expect(q.lines.map(l => [num(l.unit_price_net), num(l.gst_rate)])).toEqual([
      [12345.67, 18],
      [7500.4, 0],
      [999.99, 18],
    ])
    const profile = await db.one<{ quotation_validity_days: number }>('company_profile?id=eq.1&select=quotation_validity_days')
    const [y, m, d] = q.issued_on.split('-').map(Number)
    expect(q.valid_until).toBe(new Date(Date.UTC(y, m - 1, d + profile.quotation_validity_days)).toISOString().slice(0, 10))
    const items = await db.rows<{ quoted_unit_price_net: number; gst_rate: number }>(`rfq_items?rfq_id=eq.${r.rfq.id}&select=quoted_unit_price_net,gst_rate&order=position`)
    expect(items.map(i => [num(i.quoted_unit_price_net), num(i.gst_rate)])).toEqual([
      [12345.67, 18],
      [7500.4, 0],
      [999.99, 18],
    ])
    expect((await db.one<{ quoted_on: string | null }>(`rfqs?id=eq.${r.rfq.id}&select=quoted_on`)).quoted_on).toBe(karachiDay(0))
    const stored = await fetchStoredPdf('sales', 'generated-docs', q.pdf_path as string)
    expect(pdfIsValid(stored)).toBe(true)
    const text = stored ? pdfText(stored) : null
    if (text) {
      expect(text).toContain(ref.quotation(q.number, q.issued_on))
      expect(text).toContain(pkr(47460.55))
      expect(text).toContain(pkr(6096))
    }
    await dialog(page).getByRole('button', { name: QUOTES.issue.done }).click()
  })

  await test.step('Mark won: the order lines are the quoted lines, and the order totals are the quotation totals', async () => {
    await (await markWonButton(page)).click()
    await expect(dialog(page).getByRole('heading', { name: QUOTES.won.heading })).toBeVisible()
    await dialog(page).getByRole('button', { name: QUOTES.won.createOrder }).click()
    await orderCreated(page)
    const o = await db.one<{ id: string }>(`orders?rfq_id=eq.${r.rfq.id}&select=id`)
    const lines = await db.rows<{ qty: number; unit_price_net: number; gst_rate: number }>(`order_items?order_id=eq.${o.id}&select=qty,unit_price_net,gst_rate&order=position`)
    expect(lines.map(l => [num(l.qty), num(l.unit_price_net), num(l.gst_rate)])).toEqual([
      [2.5, 12345.67, 18],
      [1, 7500.4, 0],
      [3, 999.99, 18],
    ])
    const [t] = await db.view<{ net: number; gst: number; gross: number }>(`v_order_items_total?order_id=eq.${o.id}&select=net,gst,gross`)
    expect([num(t.net), num(t.gst), num(t.gross)]).toEqual([41364.55, 6096, 47460.55])
    const st = await db.view<{ outcome: string; outcome_clash: boolean }>(`v_rfq_state?rfq_id=eq.${r.rfq.id}&select=outcome,outcome_clash`)
    expect(st[0]).toMatchObject({ outcome: 'won', outcome_clash: false })
  })
  await sales.close()
})

test('a repeat order copies quantities, prices, GST rates and the service flag exactly, so its totals equal the original', async ({ browser }, info) => {
  // Source: 1.5 x 22,222.22 = 33,333.33 net, GST 18% = 5,999.9994 -> 6,000; 1 x 9,876.54 exempt service; net 43,209.87, GST 6,000.
  const tag = letters()
  const src = await order({
    lines: [
      { description: `Repeat flow computer ${tag}`, qty: 1.5, price: 22222.22 },
      { description: `Repeat site service ${tag}`, qty: 1, price: 9876.54, gst: 0, service: true },
    ],
    owner: 'sales',
    orderedOn: karachiDay(-30),
  })
  const totals = async (id: string) => {
    const [t] = await db.view<{ net: number; gst: number; gross: number }>(`v_order_items_total?order_id=eq.${id}&select=net,gst,gross`)
    return [num(t.net), num(t.gst), num(t.gross)]
  }
  expect(await totals(src.order.id)).toEqual([43209.87, 6000, 49209.87])
  const sales = await signedIn(browser, info, 'sales')
  const page = await open(sales, QUOTES.repeat.ordersPath)
  const d = dialog(page)
  await expect(d.getByRole('heading', { name: QUOTES.repeat.heading })).toBeVisible()
  await d.getByLabel(QUOTES.repeat.find).fill(src.customer.name)
  await d.getByRole('button', { name: new RegExp(`${src.customer.name}.*${ref.order(src.order.number)}`) }).click()
  await d.getByLabel(QUOTES.repeat.customerPo).fill(`REP-${tag.toUpperCase()}`)
  await d.getByRole('button', { name: QUOTES.repeat.create }).click()
  await expect(page).toHaveURL(JOB_URL)
  const copy = await db.one<{ id: string }>(`orders?customer_po_number=eq.REP-${tag.toUpperCase()}&select=id`)
  const lines = await db.rows<{ qty: number; unit_price_net: number; gst_rate: number; is_service: boolean }>(`order_items?order_id=eq.${copy.id}&select=qty,unit_price_net,gst_rate,is_service&order=position`)
  expect(lines.map(l => [num(l.qty), num(l.unit_price_net), num(l.gst_rate), l.is_service])).toEqual([
    [1.5, 22222.22, 18, false],
    [1, 9876.54, 0, true],
  ])
  expect(await totals(copy.id)).toEqual([43209.87, 6000, 49209.87])
  await sales.close()
})

