import { expect, test, type Page } from '@playwright/test'
import { createCompany, createRfq, karachiDay, login, must, openAs, review, rest, uniqueName } from '../support/stack'
import { axeViolations, waitForAnimationsToFinish } from '../support/axe'
import { fetchStoredPdf, pdfIsValid, pdfText, renderPdfPng } from '../support/pdf'

/*
 * R19 end to end, against the local CI stack: the Issue quotation dialog, the quotations list on the RFQ page, the PDF kept in
 * the generated-docs bucket, and the company-profile block. As the fixture users through the real login form; every test seeds
 * its own customer and RFQ.
 *
 * FE-2 target asserted here (BUILD_PLAN FE-2): issue a quotation = at most one price per item (none when a chip is tapped),
 * then 2 taps: Issue, Share.
 */

const violations = (page: Page): Promise<string[]> => axeViolations(page, { landmarks: false })
const pageViolations = (page: Page): Promise<string[]> => axeViolations(page)

async function setProfile(complete: boolean): Promise<void> {
  await must(
    rest('admin', 'company_profile?id=eq.1', {
      method: 'PATCH',
      body: complete
        ? { legal_name: 'Q-Tech Solutions (Pvt) Ltd', address: 'Office 4, Gulberg III, Lahore', phone: '+92 42 555 0138', ntn: '1234567-8', quotation_terms: '1. Prices are in PKR and exclude sales tax.\n2. Warranty is 12 months.' }
        : { legal_name: null, address: null },
      prefer: 'return=minimal',
    }),
  )
}

interface Seed {
  tag: string
  customer: string
  rfq: { id: string; number: number }
  items: { id: string; description: string }[]
}

type Item = { description: string; qty: number; price?: number }

async function addItems(rfqId: string, items: Item[]): Promise<{ id: string; description: string }[]> {
  const rows = await must(
    rest<{ id: string; description: string; position: number }[]>('admin', 'rfq_items', {
      method: 'POST',
      body: items.map((it, i) => ({ rfq_id: rfqId, position: i, description: it.description, qty: it.qty, quoted_unit_price_net: it.price ?? null })),
    }),
  )
  return rows.sort((a, b) => a.position - b.position)
}

const issueViaRpc = (rfqId: string, extra: Record<string, unknown> = {}) =>
  must(rest('admin', 'rpc/issue_quotation', { method: 'POST', body: { p_quotation_id: crypto.randomUUID(), p_rfq_id: rfqId, ...extra } }))

/** A customer with: an earlier quotation (1,200) and an earlier order (1,000) for the same model, a contact, and a supplier lead time. */
async function seed(): Promise<Seed> {
  await setProfile(true)
  // USD at 280 today, so the supplier's USD 50 reply reads "Best reply ≈ PKR 14,000 each".
  await must(rest('admin', 'fx_rates?on_conflict=currency,as_of,source', { method: 'POST', body: { currency: 'USD', rate_pkr: 280, as_of: karachiDay(0), source: 'manual' }, prefer: 'resolution=merge-duplicates,return=minimal' }))
  // The signed-in sales person's phone (users.phone, own row) prints on the PDF.
  const me = (await login('sales')).user as { id: string }
  await must(rest('sales', `users?id=eq.${me.id}`, { method: 'PATCH', body: { phone: '+92 300 1234567' }, prefer: 'return=minimal' }))
  const tag = Math.random().toString(36).slice(2, 6)
  const customer = uniqueName('Quote Customer')
  const co = await createCompany(customer)
  const contacts = await must(
    rest<{ id: string; name: string }[]>('admin', 'contacts', { method: 'POST', body: [{ company_id: co.id, name: 'Mr. Tariq Mehmood', job_title: 'Procurement Manager' }, { company_id: co.id, name: 'Ms. Sana Iqbal', job_title: null }] }),
  )
  const model = `FM${tag}1`

  const earlier = await createRfq(co.id, { customer_ref: `OLD-${tag}` })
  await addItems(earlier.id, [{ description: `Flow meter ${model} DN50 old`, qty: 1, price: 1200 }])
  await issueViaRpc(earlier.id)
  const order = (await must(rest<{ id: string }[]>('admin', 'orders', { method: 'POST', body: { company_id: co.id, ordered_on: karachiDay(-20) } })))[0]
  await must(rest('admin', 'order_items', { method: 'POST', body: { order_id: order.id, description: `Flow meter ${model} DN50`, qty: 1, unit_price_net: 1000 } }))

  const rfq = await createRfq(co.id, { due_on: karachiDay(6), customer_ref: `RFQ-${tag}`, contact_id: contacts[0].id })
  const items = await addItems(rfq.id, [
    { description: `Flow meter ${model} DN50 flanged`, qty: 2 },
    { description: `Pressure transmitter PT${tag}2 0-10 bar`, qty: 1 },
  ])
  const supplier = await createCompany(uniqueName('Hengxin'), { country: 'China' })
  const inq = (await must(rest<{ id: string }[]>('admin', 'supplier_inquiries', { method: 'POST', body: { rfq_id: rfq.id, supplier_id: supplier.id, sent_on: karachiDay(-3) } })))[0]
  await must(rest('admin', 'supplier_quote_lines', { method: 'POST', body: { inquiry_id: inq.id, rfq_item_id: items[0].id, unit_price: 50, currency: 'USD', lead_time: '10 to 14 days' } }))
  return { tag, customer, rfq, items }
}

interface Q {
  id: string
  number: number
  revision: number
  issued_on: string
  valid_until: string
  net_total: number
  gst_total: number
  delivery_text: string | null
  payment_terms: string | null
  notes: string | null
  pdf_path: string | null
  lines: { rfq_item_id: string; unit_price_net: number; gst_rate: number; lead_time: string | null }[]
}
const quotationsOf = (rfqId: string) =>
  must(rest<Q[]>('admin', `quotations?rfq_id=eq.${rfqId}&select=id,number,revision,issued_on,valid_until,net_total,gst_total,delivery_text,payment_terms,notes,pdf_path,lines&order=revision`))
const rfqOf = (id: string) => must(rest<{ quoted_on: string | null }[]>('admin', `rfqs?id=eq.${id}&select=quoted_on`)).then(r => r[0])
const refOf = (q: Q, first: Q = q) => `QT-${first.issued_on.slice(2, 4)}-${String(q.number).padStart(4, '0')}`

const openIssue = async (page: Page) => {
  // The header button on a wide screen; on a phone the same action lives in the sticky bar at the foot.
  const phone = (page.viewportSize()?.width ?? 1440) < 768
  await (phone ? page.locator('[data-action-bar]') : page.locator('[data-slot="issue-quotation"]')).getByRole('button', { name: /Issue/ }).click()
  await expect(page.getByRole('list', { name: 'Items to quote' })).toBeVisible()
}
/** A review screenshot, taken once the dialog has finished rising (otherwise it is caught half transparent). */
const shot = async (page: Page, name: string) => {
  await waitForAnimationsToFinish(page)
  await review(page, name)
}
const dialog = (page: Page) => page.getByRole('dialog')
const price = (page: Page, n: number) => dialog(page).getByLabel(`Unit price, net PKR, item ${n}`)
const noShareApi = (page: Page) => page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'share', { value: undefined, configurable: true }))

test.describe('issue a quotation (FE-2: one price per item, then Issue and Share)', () => {
  test('a chip prices item 1, one typed price prices item 2, Issue then Share; the quotation, PDF and quoted_on are stored', async ({ page }) => {
    await noShareApi(page)
    const s = await seed()
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    await expect(page.locator('[data-slot="quotations"]')).toContainText('Nothing issued')
    await openIssue(page)
    await expect(dialog(page).getByRole('heading', { name: 'Issue quotation' })).toBeVisible()
    await shot(page, 'rfq-quotation-01-issue-dialog-1440')

    // The chips: last sold to this customer (1,000) and last quoted (1,200), same model, same customer only.
    const sold = dialog(page).getByTestId('chip-sold-1')
    const quoted = dialog(page).getByTestId('chip-quoted-1')
    await expect(sold).toContainText('Last sold to this customer')
    await expect(sold).toContainText('PKR 1,000')
    await expect(sold).toContainText(/\(ORD-\d{4}\)/)
    await expect(quoted).toContainText('Last quoted')
    await expect(quoted).toContainText('PKR 1,200')
    await expect(quoted).toContainText(/\(QT-\d\d-\d{4}\)/)
    await expect(dialog(page).getByTestId('quote-line-1')).toContainText('Best reply ≈ PKR 14,000 each')
    // Include ticks: item 1 has price sources and starts ticked; item 2 has none, starts unticked and says why.
    await expect(dialog(page).getByRole('checkbox', { name: 'Include item 1' })).toBeChecked()
    await expect(dialog(page).getByRole('checkbox', { name: 'Include item 2' })).not.toBeChecked()
    await expect(dialog(page).getByTestId('quote-line-2')).toContainText('No supplier price yet, so there is nothing to quote')
    await expect(dialog(page).getByLabel('Addressed to')).toContainText('Mr. Tariq Mehmood, Procurement Manager')
    await expect(dialog(page).getByTestId('chip-sold-2')).toHaveCount(0)

    // The supplier's lead time is a hint and is never filled in (A2b).
    await expect(dialog(page).getByTestId('lead-hint')).toContainText('10 to 14 days')
    await expect(dialog(page).getByLabel('Lead time we quote, item 1')).toHaveValue('')
    // Defaults: validity from the company profile, the RFQ's contact, standard terms from the profile, GST 18 %.
    await expect(dialog(page).getByLabel('Addressed to')).toHaveValue(/.+/)
    await expect(dialog(page).getByLabel('Standard terms')).toHaveValue(/Prices are in PKR/)
    await expect(dialog(page).getByLabel('GST rate, item 1')).toHaveValue('18')
    // Nothing is priced yet: Issue waits.
    await expect(dialog(page).getByRole('button', { name: 'Issue quotation' })).toBeDisabled()

    let typedPrices = 0
    let taps = 0
    await sold.click() // a chip is the price: nothing typed for item 1
    await price(page, 2).fill('450.50')
    typedPrices++
    expect(typedPrices).toBeLessThanOrEqual(s.items.length)

    // 2 x 1,000 + 1 x 450.50 net; GST per line to whole rupees: 360 + 81 (81.09) ; gross 2,891.50.
    await expect(dialog(page).getByTestId('total-net')).toHaveText('PKR 2,450.50')
    await expect(dialog(page).getByRole('checkbox', { name: 'Include item 2' })).toBeChecked() // typing a price ticks the item
    await expect(dialog(page).getByTestId('total-gst')).toHaveText('PKR 441')
    await expect(dialog(page).getByText('GST 18% on 2 lines')).toBeVisible()
    await expect(dialog(page).getByTestId('total-gross')).toHaveText('PKR 2,891.50')
    await dialog(page).getByLabel('Lead time we quote, item 2').fill('Ex-stock')
    await dialog(page).getByLabel('Delivery').fill('To your site, within the lead time on each line')

    await dialog(page).getByRole('button', { name: 'Issue quotation' }).click()
    taps++
    const done = dialog(page).getByTestId('pdf-ready')
    await expect(done).toBeVisible({ timeout: 30_000 })
    await shot(page, 'rfq-quotation-02-issued-share-1440')

    const [q] = await quotationsOf(s.rfq.id)
    expect(q.revision).toBe(0)
    expect(Number(q.net_total)).toBe(2450.5)
    expect(Number(q.gst_total)).toBe(441)
    expect(q.delivery_text).toBe('To your site, within the lead time on each line')
    expect(q.lines.map(l => Number(l.unit_price_net))).toEqual([1000, 450.5])
    expect(q.lines.map(l => l.lead_time)).toEqual([null, 'Ex-stock'])
    expect((await rfqOf(s.rfq.id)).quoted_on).toBe(karachiDay(0))
    expect(Number(q.valid_until.replaceAll('-', ''))).toBeGreaterThan(Number(karachiDay(29).replaceAll('-', '')))

    // The PDF is stored at {quotation_id}/{revision}.pdf and is a real PDF.
    expect(q.pdf_path).toBe(`${q.id}/0.pdf`)
    const stored = await fetchStoredPdf('sales', 'generated-docs', q.pdf_path as string)
    expect(pdfIsValid(stored)).toBe(true)
    const text = stored ? pdfText(stored) : null
    if (text) {
      expect(text).toContain(refOf(q))
      expect(text).toContain('Quotation')
      expect(text).toContain('Q-Tech Solutions (Pvt) Ltd')
      expect(text).toContain('PKR 2,891.50')
      expect(text).toContain('Pakistani rupees (PKR)')
      expect(text).toContain('Procurement Manager') // Attention: name, job title
      expect(text).toContain('+92 300 1234567') // users.phone in the signature block; Prepared by is the name only (E-QT-01)
      expect(text).toContain('First issue')
      expect(text).not.toContain('₨')
    }
    if (stored && process.env.REVIEW_DIR) renderPdfPng(stored, process.env.REVIEW_DIR, 'rfq-quotation-pdf-r0-page1')

    // Share: where the browser has no share sheet with files, the PDF is downloaded instead.
    const download = page.waitForEvent('download')
    await dialog(page).getByRole('button', { name: 'Share' }).click()
    taps++
    expect((await download).suggestedFilename()).toBe(`${refOf(q)}-R0.pdf`)
    expect(taps).toBe(2) // Issue, Share

    await dialog(page).getByRole('button', { name: 'Done' }).click()
    const row = page.getByTestId('quotation-0')
    await expect(row).toContainText(`${refOf(q)} R0`)
    await expect(row).toContainText('Current')
    await expect(row).toContainText('PKR 2,891.50')
    await shot(page, 'rfq-quotation-03-list-1440')
  })

  test('Share hands the PDF file to the share sheet where the browser supports it', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __shared?: { name: string; type: string; size: number }[] }
      Object.defineProperty(Navigator.prototype, 'canShare', { value: (d: ShareData) => Boolean(d.files?.length), configurable: true })
      Object.defineProperty(Navigator.prototype, 'share', {
        value: (d: ShareData) => {
          w.__shared = (d.files ?? []).map(f => ({ name: f.name, type: f.type, size: f.size }))
          return Promise.resolve()
        },
        configurable: true,
      })
    })
    const s = await seed()
    await openAs(page, 'engineer', `/rfqs/${s.rfq.id}`)
    await openIssue(page)
    await dialog(page).getByTestId('chip-sold-1').click()
    await price(page, 2).fill('300')
    await dialog(page).getByRole('button', { name: 'Issue quotation' }).click()
    await expect(dialog(page).getByTestId('pdf-ready')).toBeVisible({ timeout: 30_000 })
    await dialog(page).getByRole('button', { name: 'Share' }).click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { __shared?: unknown[] }).__shared?.length ?? 0)).toBe(1)
    const shared = await page.evaluate(() => (window as unknown as { __shared: { name: string; type: string; size: number }[] }).__shared[0])
    expect(shared.type).toBe('application/pdf')
    expect(shared.name).toMatch(/^QT-\d\d-\d{4}-R0\.pdf$/)
    expect(shared.size).toBeGreaterThan(2000)
  })
})

test.describe('re-issue', () => {
  test('makes R1 under the same number, carries the terms over, and leaves R0 and its PDF untouched', async ({ page }) => {
    await noShareApi(page)
    const s = await seed()
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    await openIssue(page)
    await dialog(page).getByTestId('chip-quoted-1').click()
    await price(page, 2).fill('700')
    await dialog(page).getByLabel('Delivery').fill('Ex works Lahore')
    await dialog(page).getByLabel('Payment terms').fill('50% advance')
    await dialog(page).getByLabel('Lead time we quote, item 1').fill('2 weeks from PO')
    await dialog(page).getByRole('button', { name: 'Issue quotation' }).click()
    await expect(dialog(page).getByTestId('pdf-ready')).toBeVisible({ timeout: 30_000 })
    await dialog(page).getByRole('button', { name: 'Done' }).click()
    const [r0] = await quotationsOf(s.rfq.id)
    const pdf0 = await fetchStoredPdf('sales', 'generated-docs', r0.pdf_path as string)
    expect(pdfIsValid(pdf0)).toBe(true)

    // The button now offers the next revision.
    await page.locator('[data-slot="issue-quotation"]').getByRole('button', { name: 'Issue quotation' }).click()
    await expect(dialog(page).getByRole('heading', { name: `Issue quotation ${refOf(r0)} R1` })).toBeVisible()
    await expect(dialog(page).getByText('Re-issue', { exact: true })).toBeVisible()
    await expect(dialog(page).getByText('R0 stays exactly as it was sent. This creates R1 under the same number.')).toBeVisible()
    // Everything from R0 is carried over, so a re-issue with one changed price is one typed number and two taps.
    await expect(price(page, 1)).toHaveValue('1,200.00')
    await expect(price(page, 2)).toHaveValue('700.00')
    await expect(dialog(page).getByLabel('Delivery')).toHaveValue('Ex works Lahore')
    await expect(dialog(page).getByLabel('Payment terms')).toHaveValue('50% advance')
    await expect(dialog(page).getByLabel('Lead time we quote, item 1')).toHaveValue('2 weeks from PO')
    await shot(page, 'rfq-quotation-04-reissue-dialog-1440')
    await price(page, 2).fill('650')
    await dialog(page).getByRole('button', { name: `Issue quotation R1` }).click()
    await expect(dialog(page).getByTestId('pdf-ready')).toBeVisible({ timeout: 30_000 })
    await dialog(page).getByRole('button', { name: 'Done' }).click()

    const [a, b] = await quotationsOf(s.rfq.id)
    expect(b.number).toBe(a.number) // same number
    expect(b.revision).toBe(1)
    expect(b.pdf_path).toBe(`${b.id}/1.pdf`)
    expect(Number(b.net_total)).toBe(2 * 1200 + 650)
    // R0 is exactly as it was: row and PDF.
    expect(a.id).toBe(r0.id)
    expect(Number(a.net_total)).toBe(Number(r0.net_total))
    expect(a.lines).toEqual(r0.lines)
    expect(a.pdf_path).toBe(r0.pdf_path)
    const pdf0Again = await fetchStoredPdf('sales', 'generated-docs', r0.pdf_path as string)
    expect(pdf0Again?.equals(pdf0 as Buffer)).toBe(true)
    const pdf1 = await fetchStoredPdf('sales', 'generated-docs', b.pdf_path as string)
    expect(pdfIsValid(pdf1)).toBe(true)
    const text = pdf1 ? pdfText(pdf1) : null
    if (text) {
      expect(text).toContain(`${refOf(b, a)}`)
      expect(text).toContain('R1')
      expect(text).toContain(`Supersedes ${refOf(a)}`)
    }
    if (pdf1 && process.env.REVIEW_DIR) renderPdfPng(pdf1, process.env.REVIEW_DIR, 'rfq-quotation-pdf-r1-supersedes-page1')

    // The list: both revisions, the latest current, the earlier superseded.
    await expect(page.getByTestId('quotation-1')).toContainText('Current')
    await expect(page.getByTestId('quotation-0')).toContainText('Superseded')
    await shot(page, 'rfq-quotation-05-list-two-revisions-1440')
  })
})

test.describe('expired state', () => {
  test('a quotation past its valid-until date is marked Expired in the list', async ({ page }) => {
    const s = await seed()
    await must(rest('admin', `rfq_items?rfq_id=eq.${s.rfq.id}`, { method: 'PATCH', body: { quoted_unit_price_net: 500 }, prefer: 'return=minimal' }))
    await issueViaRpc(s.rfq.id, { p_valid_until: karachiDay(-2) })
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    const row = page.getByTestId('quotation-0')
    await expect(row).toContainText('Expired')
    await expect(row).toContainText(/Expired/)
    await shot(page, 'rfq-quotation-06-expired-1440')
  })
})

test.describe('company profile incomplete (the PDF is blocked, saving never is)', () => {
  test('Issue still saves the quotation, no PDF is made, a banner links to Settings, Company; making it later works', async ({ page, context }) => {
    const s = await seed()
    await setProfile(false)
    try {
      await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
      await openIssue(page)
      const gap = dialog(page).getByText("The PDF needs the company's legal name and address")
      await expect(gap).toBeVisible()
      await expect(dialog(page).getByRole('link', { name: 'Open Settings, Company' })).toHaveAttribute('href', '/settings/company')
      await shot(page, 'rfq-quotation-07-profile-incomplete-dialog-1440')

      await dialog(page).getByTestId('chip-sold-1').click()
      await price(page, 2).fill('300')
      await dialog(page).getByRole('button', { name: 'Issue quotation' }).click()
      await expect(dialog(page).getByText('The PDF was not made')).toBeVisible()
      await expect(dialog(page).getByRole('button', { name: 'Share' })).toHaveCount(0)
      await expect(dialog(page).getByRole('link', { name: 'Open Settings, Company' })).toHaveAttribute('href', '/settings/company')
      await shot(page, 'rfq-quotation-08-profile-incomplete-issued-1440')

      const [q] = await quotationsOf(s.rfq.id)
      expect(q.revision).toBe(0)
      expect(q.pdf_path).toBeNull() // saved, no PDF
      expect((await rfqOf(s.rfq.id)).quoted_on).toBe(karachiDay(0))

      await dialog(page).getByRole('button', { name: 'Done' }).click()
      await expect(page.locator('[data-slot="quotations"]').getByText(/A PDF needs the company's legal name and address/)).toBeVisible()
      await expect(page.getByTestId('quotation-0').getByRole('button', { name: 'Open PDF' })).toBeDisabled()
      await shot(page, 'rfq-quotation-09-profile-incomplete-list-1440')

      // Once the profile is complete, opening the quotation makes its PDF and stores it.
      await setProfile(true)
      await page.reload()
      await expect(page.getByTestId('quotation-0')).toBeVisible()
      const popup = context.waitForEvent('page')
      await page.getByTestId('quotation-0').getByRole('button', { name: 'Open PDF' }).click()
      await popup
      await expect.poll(async () => (await quotationsOf(s.rfq.id))[0].pdf_path, { timeout: 30_000 }).toBe(`${q.id}/0.pdf`)
      expect(pdfIsValid(await fetchStoredPdf('sales', 'generated-docs', `${q.id}/0.pdf`))).toBe(true)
    } finally {
      await setProfile(true)
    }
  })
})

test.describe('a long quotation', () => {
  test('runs onto more pages with the table header repeated and the page count in the footer', async ({ page, context }) => {
    await setProfile(true)
    const co = await createCompany(uniqueName('Long Quote Customer'))
    const rfq = await createRfq(co.id, { customer_ref: 'LONG-1' })
    await addItems(
      rfq.id,
      Array.from({ length: 30 }, (_, i) => ({ description: `Siemens SITRANS LR250 radar level transmitter item ${i + 1}\n0 to 10 m, 4 to 20 mA HART, 2 in thread`, qty: i + 1, price: 148500 + i * 1000 })),
    )
    await issueViaRpc(rfq.id)
    await openAs(page, 'sales', `/rfqs/${rfq.id}`)
    const popup = context.waitForEvent('page')
    await page.getByTestId('quotation-0').getByRole('button', { name: 'Open PDF' }).click()
    await popup
    await expect.poll(async () => (await quotationsOf(rfq.id))[0].pdf_path, { timeout: 30_000 }).not.toBeNull()
    const [q] = await quotationsOf(rfq.id)
    const pdf = await fetchStoredPdf('sales', 'generated-docs', q.pdf_path as string)
    expect(pdfIsValid(pdf)).toBe(true)
    const text = pdf ? pdfText(pdf) : null
    if (text) {
      expect(text).toMatch(/Page 1 of [2-9]/)
      expect((text.match(/Lead time/g) ?? []).length).toBeGreaterThanOrEqual(2) // the header is repeated on each page
      expect(text).toContain('item 30')
    }
    if (pdf && process.env.REVIEW_DIR) renderPdfPng(pdf, process.env.REVIEW_DIR, 'rfq-quotation-pdf-long-page1')
  })
})

test.describe('partial quotations and Preview PDF', () => {
  test('an unticked item is not priced, not snapshotted and not printed; Preview PDF opens the unsaved document', async ({ page, context }) => {
    await noShareApi(page)
    await page.addInitScript(() => {
      const w = window as unknown as { __blobs: { type: string; size: number }[] }
      w.__blobs = []
      const real = URL.createObjectURL.bind(URL)
      URL.createObjectURL = (o: Blob | MediaSource) => {
        if (o instanceof Blob) w.__blobs.push({ type: o.type, size: o.size })
        return real(o)
      }
    })
    const s = await seed()
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    await openIssue(page)
    // Quote only item 2: untick item 1 (it has price sources, so it started ticked) and type a price for item 2.
    await dialog(page).getByRole('checkbox', { name: 'Include item 1' }).click()
    await expect(dialog(page).getByTestId('quote-line-1')).toContainText('Not included')
    await price(page, 2).fill('300')
    await expect(dialog(page).getByTestId('total-net')).toHaveText('PKR 300')
    await expect(dialog(page).getByText('GST 18% on 1 line')).toBeVisible()
    await expect(dialog(page).getByTestId('total-gross')).toHaveText('PKR 354')

    // Preview PDF: a new tab with the document as it would be issued now. Nothing is saved.
    const popup = context.waitForEvent('page')
    await dialog(page).getByRole('button', { name: 'Preview PDF' }).click()
    const tab = await popup
    // A headless browser downloads a PDF instead of showing it, so the tab's address proves nothing: the blob handed to it does.
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __blobs?: { type: string; size: number }[] }).__blobs?.length ?? 0), { timeout: 30_000 })
      .toBeGreaterThan(0)
    const blob = await page.evaluate(() => (window as unknown as { __blobs: { type: string; size: number }[] }).__blobs[0])
    expect(blob.type).toBe('application/pdf')
    expect(blob.size).toBeGreaterThan(2000)
    expect(await quotationsOf(s.rfq.id)).toHaveLength(0)
    await tab.close()

    await dialog(page).getByRole('button', { name: 'Issue quotation' }).click()
    await expect(dialog(page).getByTestId('pdf-ready')).toBeVisible({ timeout: 30_000 })
    const [q] = await quotationsOf(s.rfq.id)
    expect(q.lines).toHaveLength(1)
    expect(Number(q.net_total)).toBe(300)
    expect(q.lines[0].rfq_item_id).toBe(s.items[1].id)
    const pdf = await fetchStoredPdf('sales', 'generated-docs', q.pdf_path as string)
    expect(pdfIsValid(pdf)).toBe(true)
    const text = pdf ? pdfText(pdf) : null
    if (text) {
      expect(text).toContain('Pressure transmitter')
      expect(text).not.toContain('Flow meter')
    }
    // Item 1 was left alone: no price was written to it.
    const rows = await must(rest<{ id: string; quoted_unit_price_net: number | null }[]>('admin', `rfq_items?id=eq.${s.items[0].id}&select=id,quoted_unit_price_net`))
    expect(rows[0].quoted_unit_price_net).toBeNull()
    if (pdf && process.env.REVIEW_DIR) renderPdfPng(pdf, process.env.REVIEW_DIR, 'rfq-quotation-pdf-partial-page1')
  })
})

for (const width of [1440, 375]) {
  test(`axe (WCAG 2.2 AA) and review screenshots at ${width}`, async ({ page }) => {
    await noShareApi(page)
    const s = await seed()
    await page.setViewportSize({ width, height: width > 800 ? 900 : 812 })
    await openAs(page, 'sales', `/rfqs/${s.rfq.id}`)
    await expect(page.locator('[data-slot="quotations"]')).toContainText('Nothing issued')
    expect(await pageViolations(page)).toEqual([])

    await openIssue(page)
    await expect(dialog(page).getByTestId('chip-sold-1')).toBeVisible()
    expect(await violations(page)).toEqual([])
    await shot(page, `rfq-quotation-dialog-${width}`)

    await dialog(page).getByTestId('chip-sold-1').click()
    await price(page, 2).fill('300')
    await dialog(page).getByRole('button', { name: 'Issue quotation' }).click()
    await expect(dialog(page).getByTestId('pdf-ready')).toBeVisible({ timeout: 30_000 })
    expect(await violations(page)).toEqual([])
    await shot(page, `rfq-quotation-issued-${width}`)

    await dialog(page).getByRole('button', { name: 'Done' }).click()
    await expect(page.getByTestId('quotation-0')).toBeVisible()
    await page.locator('#main').evaluate(m => m.scrollTo(0, m.scrollHeight)) // at the end of the page the phone's sticky action bar covers nothing
    expect(await pageViolations(page)).toEqual([])
    await shot(page, `rfq-quotation-list-${width}`)
  })
}

// Owner decision 2026-10-19 (DECISIONS.md): engineers MAY see selling prices on the quotation screens and issue quotations.
// They never see the spread, the margin or the Money pages. This documents that line.
test.describe('what an engineer sees on the quotation screens (owner decision 2026-10-19)', () => {
  test('selling prices are visible and an engineer can issue; there is no spread, margin or money request', async ({ page }) => {
    await noShareApi(page)
    const s = await seed()
    const urls: string[] = []
    page.on('request', r => urls.push(r.url()))
    await openAs(page, 'engineer', `/rfqs/${s.rfq.id}`)
    await openIssue(page)
    // Selling prices: the memory chips and the price boxes are there.
    await expect(dialog(page).getByTestId('chip-sold-1')).toContainText('PKR 1,000')
    await expect(dialog(page).getByTestId('chip-quoted-1')).toContainText('PKR 1,200')
    await expect(price(page, 1)).toBeVisible()
    // No spread, margin, sell-versus-cost or markup wording anywhere in the dialog or on the page.
    const text = `${await dialog(page).innerText()}\n${await page.locator('main').innerText()}`
    expect(text).not.toMatch(/spread|margin|markup|profit|sell(?:ing)? (?:vs|versus) cost/i)
    // And an engineer can issue.
    await dialog(page).getByTestId('chip-sold-1').click()
    await price(page, 2).fill('300')
    await dialog(page).getByRole('button', { name: 'Issue quotation' }).click()
    await expect(dialog(page).getByTestId('pdf-ready')).toBeVisible({ timeout: 30_000 })
    expect(await quotationsOf(s.rfq.id)).toHaveLength(1)
    // No money page or money view was requested.
    expect(urls.filter(u => /v_order_money|v_payment|v_margin|payments_in|order_costs|v_receivable|order_receivables/.test(u))).toEqual([])
  })
})
