import { expect, test, type Page } from '@playwright/test'
import { openStage } from '../../support/job'
import { db, num, USER } from '../support/db'
import { company, karachiDay, letters, post, quote, rfq, setRates, supplier } from '../support/fixtures'
import { open, openMarkWon, signedIn } from '../support/session'
import { SALES } from '../support/text'
import { readClipboardWhen, resetClipboard } from '../../support/clipboard'

/*
 * The sales side from the customer's message to the ranked supplier prices:
 *   - the enquiry as it really arrives (a WhatsApp chat copied with its time and name prefixes, an Excel block with a header, an
 *     unmarked email with a signature, the same message pasted twice) must give exactly the items in it, with their quantities;
 *   - the enquiry text sent to a supplier carries no RFQ number or reply-by date, and lists every item with its quantity (the owner's format);
 *   - prices typed in three currencies are stored with the rate of the day and ranked by their PKR value, worked out by hand.
 */

/** A paste with nothing focused, as Ctrl+V on the intake page delivers it. */
async function paste(page: Page, text: string): Promise<void> {
  await page.evaluate(t => {
    const dt = new DataTransfer()
    dt.setData('text/plain', t)
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, text)
}

async function startIntake(page: Page, customer: string): Promise<void> {
  await page.goto(SALES.intake.path)
  await expect(page.getByRole('heading', { name: SALES.intake.heading, level: 1 })).toBeVisible()
  await page.getByRole('combobox', { name: SALES.intake.company }).fill(customer)
  await page.getByRole('option', { name: new RegExp(customer) }).click()
}

/** The item rows on screen, as [description, quantity] pairs. */
async function rowsOnScreen(page: Page): Promise<[string, string][]> {
  const n = await page.getByRole('textbox', { name: SALES.intake.anyDescription }).count()
  const out: [string, string][] = []
  for (let i = 1; i <= n; i++) {
    out.push([await page.getByRole('textbox', { name: SALES.intake.description(i) }).inputValue(), await page.getByRole('textbox', { name: SALES.intake.quantity(i) }).inputValue()])
  }
  return out
}

/** Save without floating, then the RFQ items as stored. */
async function saveAndRead(page: Page, customerId: string) {
  await page.getByRole('button', { name: SALES.intake.saveOnly }).click()
  await expect(page.getByText(SALES.intake.saved).first()).toBeVisible()
  const r = await db.one<{ id: string; owner_id: string; received_on: string }>(`rfqs?company_id=eq.${customerId}&select=id,owner_id,received_on`)
  expect(r).toMatchObject({ owner_id: USER.sales, received_on: karachiDay(0) })
  const items = await db.rows<{ description: string; qty: number; unit: string | null; gst_rate: number }>(`rfq_items?rfq_id=eq.${r.id}&select=description,qty,unit,gst_rate&order=position`)
  return items.map(i => [i.description, num(i.qty), i.unit, num(i.gst_rate)])
}

test.describe('the enquiry as it arrives', () => {
  test('an Excel block with a header row, a number column and a unit column gives one item per row with its quantity and unit', async ({ browser }, info) => {
    const customer = await company('Verify Excel Customer')
    const sales = await signedIn(browser, info, 'sales')
    const page = await open(sales, '/todo')
    await startIntake(page, customer.name)
    await paste(page, ['S.No\tDescription\tQty\tUnit', '1\tSolenoid valve 1/2 inch 24V DC\t6\tnos', '2\tInstrument cable 2 core 1.5 mm\t150\tm'].join('\n'))
    await expect(page.getByText(SALES.intake.found(2, 2)).first()).toBeVisible()
    expect(await rowsOnScreen(page)).toEqual([
      ['Solenoid valve 1/2 inch 24V DC', '6 nos'],
      ['Instrument cable 2 core 1.5 mm', '150 m'],
    ])
    expect(await saveAndRead(page, customer.id)).toEqual([
      ['Solenoid valve 1/2 inch 24V DC', 6, 'nos', 18],
      ['Instrument cable 2 core 1.5 mm', 150, 'm', 18],
    ])
    await sales.close()
  })

  test('a WhatsApp chat copied with its "[time, date] Name:" prefixes gives the two items, without the prefixes or the greetings', async ({ browser }, info) => {
    const customer = await company('Verify WhatsApp Customer')
    const sales = await signedIn(browser, info, 'sales')
    const page = await open(sales, '/todo')
    await startIntake(page, customer.name)
    // What WhatsApp Web puts on the clipboard when several messages are copied together.
    await paste(
      page,
      [
        '[10:41, 19/10/2026] Kamran Zafar: Assalam o Alaikum',
        '[10:42, 19/10/2026] Kamran Zafar: Please quote 2 nos ultrasonic level transmitter 0-10 m',
        '[10:42, 19/10/2026] Kamran Zafar: 4 pcs pressure gauge 0-16 bar',
        '[10:43, 19/10/2026] Kamran Zafar: Regards',
      ].join('\n'),
    )
    await expect(page.getByRole('textbox', { name: SALES.intake.description(1) })).toBeVisible()
    // Fixed (BUG-SALES-1): New RFQ reads pastes with parseEnquiry, which takes off WhatsApp Web's "[time, date] Name:" prefixes.
    expect(await rowsOnScreen(page)).toEqual([
      ['ultrasonic level transmitter 0-10 m', '2 nos'],
      ['pressure gauge 0-16 bar', '4 nos'],
    ])
    await sales.close()
  })

  test('an unmarked email with a signature block gives only the items, not the name, the job title or the phone number', async ({ browser }, info) => {
    const customer = await company('Verify Signature Customer')
    const sales = await signedIn(browser, info, 'sales')
    const page = await open(sales, '/todo')
    await startIntake(page, customer.name)
    await paste(
      page,
      ['Dear Sir,', 'Please quote the following:', 'Vortex flow meter DN100 - 2 nos', 'Magnetic level gauge 1500 mm - 1 no', 'Regards,', 'Muhammad Asif', 'Senior Procurement Engineer', '0300-1234567'].join('\n'),
    )
    await expect(page.getByRole('textbox', { name: SALES.intake.description(1) })).toBeVisible()
    // Fixed (BUG-SALES-2): nothing after the sign-off is an item (parseEnquiry).
    expect(await rowsOnScreen(page)).toEqual([
      ['Vortex flow meter DN100', '2 nos'],
      ['Magnetic level gauge 1500 mm', '1 no'],
    ])
    await sales.close()
  })

  test('the same message pasted twice does not double the items', async ({ browser }, info) => {
    const customer = await company('Verify Twice Customer')
    const sales = await signedIn(browser, info, 'sales')
    const page = await open(sales, '/todo')
    await startIntake(page, customer.name)
    const msg = ['1) Temperature transmitter PT100 head mount - 3 nos', '2) Thermowell SS316 250 mm - 3 nos'].join('\n')
    await paste(page, msg)
    await expect(page.getByRole('textbox', { name: SALES.intake.description(2) })).toBeVisible()
    await paste(page, msg) // the same Ctrl+V again, as happens when the first one seemed not to land
    await expect(page.getByRole('status').filter({ hasText: SALES.intake.alreadyThere(2) }).first()).toBeVisible()
    // BUG-SALES-3 (fixed): repeated lines are skipped (src/features/rfqs/lib/skipRepeats.ts).
    expect(await rowsOnScreen(page)).toEqual([
      ['Temperature transmitter PT100 head mount', '3 nos'],
      ['Thermowell SS316 250 mm', '3 nos'],
    ])
    await sales.close()
  })
})

test('asking a supplier: the copied enquiry carries no RFQ number, every item with its quantity and no reply-by line; the asking is recorded and Undo takes it back', async ({ browser }, info) => {
  const tag = letters()
  const brand = await post<{ id: string; name: string }>('brands', { name: `Verifyflow${tag}`, kind: 'brand' })
  const due = karachiDay(10)
  const r = await rfq({
    items: [
      { description: `Verifyflow${tag} electromagnetic flow meter DN80`, qty: 3, unit: 'nos' },
      { description: `Remote display for flow meter ${tag}`, qty: 1, unit: 'nos' },
    ],
    extra: { due_on: due },
  })
  await db.patch(`rfq_items?id=eq.${r.items[0].id}`, { brand_id: brand.id })
  const carrier = await company('Verify Brand Carrier', { country: 'Pakistan' })
  await post('company_brands', { company_id: carrier.id, brand_id: brand.id })

  const sales = await signedIn(browser, info, 'sales')
  const page = await open(sales, `/rfqs/${r.rfq.id}`)
  await openStage(page, 'Quotation') // nobody is asked yet, so the job is still at the Enquiry stage
  const card = page.locator(`[data-slot="${SALES.ask.toAskSlot}"]`)
  await card.locator('label', { hasText: carrier.name }).click()
  await resetClipboard(page)
  await card.getByRole('button', { name: SALES.ask.copyFor(1) }).click()
  await expect(page.getByRole('status').filter({ hasText: SALES.ask.copied })).toBeVisible()
  const ref = `RFQ-${String(r.rfq.number).padStart(4, '0')}`
  const text = await readClipboardWhen(page, 'Hi hope you are doing well,') // the owner's format: no RFQ number in the message
  expect(text).not.toContain(ref)
  expect(text).toContain(SALES.ask.itemLine(`Verifyflow${tag} electromagnetic flow meter DN80`, '3 nos'))
  expect(text).toContain(SALES.ask.itemLine(`Remote display for flow meter ${tag}`, '1 no'))
  expect(text).not.toContain('Kindly reply by') // the owner's format has no reply-by date line
  expect(text).not.toContain(r.customer.name)
  const inq = await db.one<{ id: string; sent_on: string | null; created_by: string }>(`supplier_inquiries?rfq_id=eq.${r.rfq.id}&supplier_id=eq.${carrier.id}&select=id,sent_on,created_by`)
  expect(inq).toMatchObject({ sent_on: karachiDay(0), created_by: USER.sales })
  await page.getByRole('status').filter({ hasText: SALES.ask.copied }).getByRole('button', { name: /^Undo/ }).click()
  await expect.poll(() => db.count(`supplier_inquiries?rfq_id=eq.${r.rfq.id}&supplier_id=eq.${carrier.id}&select=id`)).toBe(0)
  await sales.close()
})

test('prices in three currencies are stored with the rate of the day and ranked by their PKR value; Mark won pre-picks the cheapest', async ({ browser }, info) => {
  // Today: EUR 300.50, USD 280.25.
  //   Germany  EUR 85.10  x 300.50 = 25,572.55 PKR each  -> rank 1
  //   Lahore   PKR 27,450.00                              -> rank 2 (7.3% dearer: outside the 2% band)
  //   Houston  USD 101.20 x 280.25 = 28,361.30 PKR each  -> rank 3
  await setRates({ EUR: 300.5, USD: 280.25 })
  const r = await rfq({ items: [{ description: `Hart pressure transmitter 0-40 bar ${letters()}`, qty: 2, unit: 'nos' }] })
  await db.patch(`rfq_items?id=eq.${r.items[0].id}`, { quoted_unit_price_net: 36500 })
  await db.adminRpc('issue_quotation', { p_quotation_id: crypto.randomUUID(), p_rfq_id: r.rfq.id })
  const germany = await supplier('Verify Keller Messtechnik', 'Germany')
  const lahore = await supplier('Verify Lahore Instruments', 'Pakistan')
  const houston = await supplier('Verify Houston Controls', 'United States')
  const gi = await quote(r.rfq.id, germany, [], 'EUR', 4)
  await quote(r.rfq.id, lahore, [], 'PKR', 4)
  const hi = await quote(r.rfq.id, houston, [], 'USD', 4)

  const sales = await signedIn(browser, info, 'sales')
  const page = await open(sales, `/rfqs/${r.rfq.id}`)
  for (const [sup, price] of [
    [germany, '85.10'],
    [lahore, '27450'],
    [houston, '101.20'],
  ] as const) {
    // Each supplier is listed once, in Suppliers asked: "Enter reply" opens its price form in a dialog (grade-B R2/R4).
    await openStage(page, 'Quotation')
    await page.getByRole('button', { name: `Enter reply, ${sup.name}`, exact: true }).click()
    const region = page.getByRole('dialog', { name: sup.name, exact: true })
    await region.getByLabel(SALES.reply.price(1, sup.name)).fill(price)
    await region.getByRole('button', { name: SALES.reply.save }).click()
    await expect(page.getByRole('status').filter({ hasText: SALES.reply.saved }).first()).toBeVisible()
  }
  const line = (inquiryId: string) => db.one<{ unit_price: number; currency: string; fx_rate_pkr: number | null; fx_rate_on: string | null }>(`supplier_quote_lines?inquiry_id=eq.${inquiryId}&select=unit_price,currency,fx_rate_pkr,fx_rate_on`)
  for (const [inq, expected] of [
    [gi.id, [85.1, 'EUR', 300.5]],
    [hi.id, [101.2, 'USD', 280.25]],
  ] as const) {
    const l = await line(inq)
    expect([num(l.unit_price), l.currency, l.fx_rate_pkr === null ? null : num(l.fx_rate_pkr)]).toEqual(expected)
  }

  const art = page.getByRole('article', { name: 'Item 1' })
  await expect(art.locator('li[data-ranked]')).toHaveCount(3)
  const ranked = await art.locator('li[data-ranked]').allInnerTexts()
  expect(ranked[0]).toContain(germany.name)
  expect(ranked[1]).toContain(lahore.name)
  expect(ranked[2]).toContain(houston.name)
  const rank = await db.adminRpc<{ supplier_id: string; rank: number; pkr_unit_price: number }[]>('rank_item_quotes', { p_rfq_id: r.rfq.id })
  const byId = Object.fromEntries(rank.map(x => [x.supplier_id, [Number(x.rank), num(x.pkr_unit_price)]]))
  expect(byId[germany.id]).toEqual([1, 25572.55])
  expect(byId[lahore.id]).toEqual([2, 27450])
  expect(byId[houston.id]).toEqual([3, 28361.3])

  await openMarkWon(page)
  const d = page.getByRole('dialog')
  await expect(d.getByRole('heading', { name: SALES.won.heading })).toBeVisible()
  await expect(d.getByRole('button', { name: SALES.won.supplierFor(1) })).toContainText(germany.name)
  await page.keyboard.press('Escape')
  await sales.close()
})
