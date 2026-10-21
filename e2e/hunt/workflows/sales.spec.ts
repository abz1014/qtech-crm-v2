import { expect, test, type Browser, type BrowserContext, type Locator, type Page, type TestInfo } from '@playwright/test'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { db, num } from '../../verify/support/db'
import { company, karachiDay, quote, quotedRfq, rfq, setProfile, setRates, supplier, type Co } from '../../verify/support/fixtures'
import { amount } from '../../verify/support/text'
import { fetchStoredPdf, pdfIsValid, pdfText } from '../../support/pdf'
import { readClipboardWhen, resetClipboard } from '../../support/clipboard'
import { ctxAs, layout, note, probe, settle, shot, tag, visit, watch, type Viewport } from './support'

/*
 * Bug hunt, the sales workflow (SALES, admin where it matters), at 1366x768 and at 375x812 with touch. Every step is a probe: a
 * failure is written down with a screenshot and the test carries on; anything odd that is not an exception is a note.
 *
 * Probed:
 *   intake (both sizes)  a pasted email with odd lines (decimal, zero and huge quantities, Urdu, a 400-character description,
 *                        whitespace-only lines and a blank hand-added row), what is stored vs what was shown; double-click on
 *                        "Looks right" (does the second click land on the next step's button?); double-click on "Copy message";
 *                        the copied supplier message; a PDF enquiry made here with pdf-lib (Choose PDF or photo) and a double
 *                        "Save without asking"; a screenshot of an enquiry (rendered here, pasted on desktop, picked on the
 *                        phone) read on the device; reload mid-form (warned? draft offered and restored?); browser Back
 *                        with items on the form, and Back while "Leave this new RFQ?" is open; a quantity past numeric(12,3).
 *   replies (both)       typed prices in odd formats ("1.234,50", "12,5", "PKR 1,200/-", "-5", "0") and what is stored; a
 *                        double-click on Save reply; a pasted reply with "EUR 1.234,50", "USD 1,200/-", "3-4 weeks" and a line
 *                        with no price; closing a reply with typed prices then Back while the confirm is open; the ranked
 *                        comparison order vs the PKR values.
 *   quotation (desktop)  GST 18% and exempt lines with decimal quantities: the dialog's totals vs a hand computation vs the
 *                        database vs the PDF text vs the Quotations list; a double-click on Issue; Revise (same number, R1,
 *                        R0 and its PDF kept); reload with the dialog open (typed price kept?); Back with the dialog open;
 *                        zero, negative, 22-digit and overflowing prices; the issue call failing after the item prices were
 *                        written (are rfq_items left with prices no quotation carries, and does Mark won pick them up?).
 *   quotation (phone)    issue and revise at 375, layout of the dialog and the list.
 *   two tabs             both open Issue quotation; one issues, the stale one issues after (warned? which revision?); a
 *                        quantity changed under an open dialog (screen total vs stored total).
 *   close and win        every close reason from the menu and Reopen (stored and shown), Mark won from a lost RFQ with Back
 *                        while the dialog is open and a double-click on Create order (one order, prices and quantities, is the
 *                        close reason cleared?), and the same on the phone.
 */

test.beforeAll(async () => {
  await setProfile(true)
  await setRates()
})

// ------------------------------------------------------------------------------------------------ helpers

const dialog = (p: Page) => p.getByRole('dialog')
const toast = (p: Page, t: string | RegExp) => p.getByRole('status').filter({ hasText: t })
const vis = (l: Locator) => l.filter({ visible: true }).first()
const moreButton = (p: Page) => vis(p.getByRole('button', { name: /^More( actions)?$/ }))
const T = { timeout: 15_000 }

/** beforeunload (and any other) dialogs a page raised, accepted so a reload goes ahead. */
const raised = new WeakMap<Page, string[]>()

async function openPage(ctx: BrowserContext, info: TestInfo, path: string, label: string): Promise<Page> {
  const page = await ctx.newPage()
  // Bounded actions: an action on a page whose dialog crashed must fail the probe, not hang the test until its time is up.
  page.setDefaultTimeout(15_000)
  page.setDefaultNavigationTimeout(30_000)
  const seen: string[] = []
  raised.set(page, seen)
  page.on('dialog', d => {
    seen.push(d.type())
    void d.accept().catch(() => undefined)
  })
  watch(page, info, label)
  await visit(page, info, path, label)
  return page
}

/** A paste with nothing focused, as Ctrl+V anywhere on the intake page delivers it (text and/or one file). */
async function pasteOnPage(page: Page, payload: { text?: string; file?: { name: string; type: string; b64: string } }): Promise<void> {
  await page.evaluate(({ text, file }) => {
    const dt = new DataTransfer()
    if (text) dt.setData('text/plain', text)
    if (file) {
      const bytes = Uint8Array.from(atob(file.b64), c => c.charCodeAt(0))
      dt.items.add(new File([bytes], file.name, { type: file.type }))
    }
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, payload)
}

/** New RFQ for a customer (by ?company=), answering "Start new" when a kept draft is offered. */
async function startIntake(page: Page, info: TestInfo, customer: Co, extra = ''): Promise<void> {
  await visit(page, info, `/rfqs/new?company=${customer.id}${extra}`, 'intake')
  const offer = page.getByRole('region', { name: 'Your draft' })
  if (await offer.waitFor({ timeout: 2_000 }).then(() => true).catch(() => false)) await offer.getByRole('button', { name: /^Start new/ }).click()
  await expect(page.getByRole('button', { name: `Change company, now ${customer.name}` })).toBeVisible(T)
}

async function rowsOnScreen(page: Page): Promise<[string, string][]> {
  const n = await page.getByRole('textbox', { name: /^Description of item \d+$/ }).count()
  const out: [string, string][] = []
  for (let i = 1; i <= n; i++)
    out.push([await page.getByRole('textbox', { name: `Description of item ${i}`, exact: true }).inputValue(), await page.getByRole('textbox', { name: `Quantity of item ${i}`, exact: true }).inputValue()])
  return out
}

async function stepOf(page: Page): Promise<string> {
  return (await page.locator('[data-step-line]').first().getAttribute('aria-label').catch(() => null)) ?? '?'
}

type RfqRow = { id: string; number: number; closed_on: string | null; close_reason: string | null; quoted_on: string | null }
const rfqsOf = (customerId: string) => db.rows<RfqRow>(`rfqs?company_id=eq.${customerId}&select=id,number,closed_on,close_reason,quoted_on&order=created_at`)
const itemsOf = (rfqId: string) =>
  db.rows<{ id: string; description: string; qty: number; unit: string | null; gst_rate: number; quoted_unit_price_net: number | null }>(
    `rfq_items?rfq_id=eq.${rfqId}&select=id,description,qty,unit,gst_rate,quoted_unit_price_net&order=position,created_at`,
  )
type QRow = { id: string; number: number; revision: number; issued_on: string; net_total: number; gst_total: number; pdf_path: string | null; lines: unknown[] }
const quotationsOf = (rfqId: string) => db.rows<QRow>(`quotations?rfq_id=eq.${rfqId}&select=id,number,revision,issued_on,net_total,gst_total,pdf_path,lines&order=revision`)
const linesOf = (rfqId: string, supplierId: string) =>
  db.rows<{ rfq_item_id: string; unit_price: number; currency: string; lead_time: string | null }>(
    `supplier_quote_lines?select=rfq_item_id,unit_price,currency,lead_time,supplier_inquiries!inner(supplier_id,rfq_id)&supplier_inquiries.rfq_id=eq.${rfqId}&supplier_inquiries.supplier_id=eq.${supplierId}`,
  )

/** A one-page A4 PDF with real text (Helvetica, so ASCII only), as a customer's enquiry PDF would be. */
async function enquiryPdf(lines: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const p = doc.addPage([595, 842])
  lines.forEach((t, i) => {
    if (t) p.drawText(t, { x: 56, y: 842 - 80 - i * 18, size: 11, font })
  })
  return Buffer.from(await doc.save({ useObjectStreams: false }))
}

/** A PNG "screenshot" of an enquiry: the lines rendered as plain text in a white page and photographed. */
async function enquiryPng(browser: Browser, lines: string[]): Promise<Buffer> {
  const ctx = await browser.newContext({ viewport: { width: 980, height: 400 }, deviceScaleFactor: 1 })
  const p = await ctx.newPage()
  const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string)
  await p.setContent(`<html><body style="margin:0;background:#fff;color:#111;font:22px Arial,Helvetica,sans-serif;padding:28px">${lines.map(l => `<div style="margin:8px 0">${esc(l)}</div>`).join('')}</body></html>`)
  const buf = await p.screenshot({ fullPage: true })
  await ctx.close()
  return buf
}

/**
 * The quotation arithmetic, worked out here independently of the app: line net = qty x price to the paisa (half away from zero),
 * line GST = rate% of the line net to the WHOLE rupee, exempt = 0; totals are sums of the lines.
 */
function quoteTotals(lines: { qty: number; price: number; gst: number }[]): { net: number; gst: number; gross: number } {
  const half = (a: bigint, b: bigint) => (a * 2n + b) / (2n * b)
  let net = 0n
  let gst = 0n
  for (const l of lines) {
    const n = half(BigInt(Math.round(l.qty * 1000)) * BigInt(Math.round(l.price * 100)), 1000n)
    net += n
    gst += half(n * BigInt(l.gst), 10_000n) * 100n
  }
  return { net: Number(net) / 100, gst: Number(gst) / 100, gross: Number(net + gst) / 100 }
}

const hasFigure = (text: string, n: number) => text.includes(amount(n)) || text.includes(amount(n, { always: true }))

/** The green Issue quotation button; when the page offers another green button, the address that opens the same dialog (noted). */
async function openIssue(page: Page, info: TestInfo, rfqId: string, where: string): Promise<void> {
  const button = vis(page.locator('[data-slot="issue-quotation"]').getByRole('button'))
  if (await button.waitFor({ timeout: 8_000 }).then(() => true).catch(() => false)) await button.click()
  else {
    note(info, { kind: 'observation', where, what: 'Issue quotation is not the green button on an RFQ with every item priced by a supplier' })
    await visit(page, info, `/rfqs/${rfqId}?issue=1`, where)
  }
  await expect(page.getByRole('list', { name: 'Items to quote' })).toBeVisible(T)
}

/** Revise from the header's More menu (it puts ?issue=1 in the address, as the first issue does). */
async function openReviseFromMenu(page: Page): Promise<void> {
  await moreButton(page).click()
  await page.getByRole('menuitem', { name: /^Revise quotation/ }).click()
  await expect(page.getByRole('list', { name: 'Items to quote' })).toBeVisible(T)
}

async function fillPrice(page: Page, n: number, value: string): Promise<void> {
  const box = dialog(page).getByLabel(`Unit price, net PKR, item ${n}`)
  await box.fill(value)
  await box.blur()
}

async function screenTotals(page: Page): Promise<{ net: string; gst: string; gross: string; exempt: string | null }> {
  const d = dialog(page)
  return {
    net: (await d.getByTestId('total-net').innerText()).trim(),
    gst: (await d.getByTestId('total-gst').innerText()).trim(),
    gross: (await d.getByTestId('total-gross').innerText()).trim(),
    exempt: (await d.getByTestId('total-gst-exempt').count()) ? (await d.getByTestId('total-gst-exempt').innerText()).trim() : null,
  }
}

/** Remember any "Could not issue the quotation" banner that shows, however briefly (the issued screen replaces it). */
async function watchIssueError(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __issueErr?: string }
    w.__issueErr = ''
    new MutationObserver(() => {
      const t = document.querySelector('[role=dialog]')?.textContent ?? ''
      if (!w.__issueErr && t.includes('Could not issue the quotation')) w.__issueErr = t.slice(t.indexOf('Could not issue'), t.indexOf('Could not issue') + 300)
    }).observe(document.body, { subtree: true, childList: true, characterData: true })
  })
}

const issueErrorSeen = (page: Page): Promise<string> => page.evaluate(() => (window as unknown as { __issueErr?: string }).__issueErr ?? '')

async function main(page: Page): Promise<string> {
  return (await page.locator('#main').innerText().catch(() => '')).replace(/\s+/g, ' ')
}

// ================================================================================================ 1. intake

for (const vp of ['desktop', 'phone'] as Viewport[]) {
  test(`sales intake at ${vp}: odd paste, PDF, screenshot, reload, Back, double taps, boundaries`, async ({ browser }, info) => {
    test.setTimeout(330_000)
    const ctx = await ctxAs(browser, info, 'sales', vp)
    const page = await openPage(ctx, info, '/today', `sales/${vp}`)
    const W = `intake/${vp}`

    // ---- (a) a pasted email with odd lines, asked to one supplier
    await probe(info, page, `${W} paste odd enquiry`, async () => {
      const t = tag()
      const cust = await company('Hunt Intake Customer', { city: 'Multan' })
      const sup = await supplier('Hunt Intake Supplier', 'Pakistan')
      const long = `Hunt diaphragm seal pressure transmitter ${t} ` + 'with flushing ring, capillary and SS316L wetted parts for the boiler feed line '.repeat(5)
      const email = [
        'Dear Sir, please quote the following:',
        `1) Pressure gauge 0-16 bar 100mm dial ${t} - 2.5 nos`,
        `2) پریشر گیج دباؤ ${t} برائے بوائلر - 3 nos`,
        `3) ${long.trim()} - 2 nos`,
        `4) Thermowell SS316 ${t} - 0 nos`,
        `5) Flow switch paddle type ${t} - 1000000 nos`,
        '     ',
        '6)    ',
        '\t',
        'Regards, Kamran',
      ].join('\n')
      await startIntake(page, info, cust, `&supplier=${sup.id}`)
      await pasteOnPage(page, { text: email })
      await expect(page.getByRole('textbox', { name: 'Description of item 1', exact: true })).toBeVisible(T)
      // a blank row and a whitespace-only row added by hand
      await vis(page.getByRole('button', { name: 'Add item', exact: true })).click()
      const n = await page.getByRole('textbox', { name: /^Description of item \d+$/ }).count()
      await page.getByRole('textbox', { name: `Description of item ${n}`, exact: true }).fill('    ')
      const rows = await rowsOnScreen(page)
      note(info, { kind: 'observation', where: `${W} paste odd enquiry`, what: `rows on screen after the paste (${rows.length})`, detail: rows.map(([d, q]) => [d.slice(0, 50), q]) })
      if (!rows.some(([d]) => d.includes('پریشر'))) note(info, { kind: 'observation', where: `${W} paste odd enquiry`, what: 'the Urdu line did not come through as an item' })
      if (!rows.some(([d]) => d.length > 300)) note(info, { kind: 'observation', where: `${W} paste odd enquiry`, what: 'the 400-character description was cut or lost', detail: rows.map(r => r[0].length) })
      const zero = rows.find(([d]) => d.includes('Thermowell'))
      if (zero && /^0\b/.test(zero[1])) note(info, { kind: 'observation', where: `${W} paste odd enquiry`, what: `a quantity of 0 is shown as "${zero[1]}" with no warning (it is saved as 1, see below)` })
      await layout(page, info, `${W} items`)
      await shot(page, `${W}-paste-odd-items`)

      // double-click "Looks right": the next step's button appears where it was
      await vis(page.getByRole('button', { name: /Looks right: find suppliers/ })).dblclick()
      await page.waitForTimeout(800)
      const step = await stepOf(page)
      if (step !== 'Step 2 of 4') note(info, { kind: 'observation', where: `${W} double-click Looks right`, what: `a double-click on "Looks right" landed on ${step} (the second click hit the next button)` })
      if (step === 'Step 2 of 4') {
        await expect(page.getByRole('checkbox', { name: sup.name })).toBeChecked(T)
        await layout(page, info, `${W} suppliers`)
        await shot(page, `${W}-suppliers-step`)
        await vis(page.getByRole('button', { name: /^Write the message/ })).click()
      }
      const copy = vis(page.getByRole('button', { name: 'Copy message for 1 supplier' }))
      await expect(copy).toBeVisible(T)
      await layout(page, info, `${W} message`)
      await shot(page, `${W}-message-step`)
      await resetClipboard(page)
      await copy.dblclick()
      const text = await readClipboardWhen(page, s => /RFQ-\d{4}/.test(s))
      for (const want of ['Pressure gauge 0-16 bar', 'پریشر', 'Flow switch paddle type'])
        if (!text.includes(want)) note(info, { kind: 'observation', where: `${W} copied message`, what: `the supplier message lacks "${want}"`, detail: text.slice(0, 600) })
      if (/RFQ-####|\{\{|undefined|NaN/.test(text)) note(info, { kind: 'observation', where: `${W} copied message`, what: 'placeholder or junk in the supplier message', detail: text.slice(0, 600) })
      await expect.poll(async () => (await rfqsOf(cust.id)).length, T).toBeGreaterThan(0)
      await page.waitForTimeout(1500)
      const saved = await rfqsOf(cust.id)
      if (saved.length !== 1) note(info, { kind: 'observation', where: `${W} double-click Copy message`, what: `${saved.length} RFQs saved for one form` })
      const items = await itemsOf(saved[0].id)
      const inq = await db.rows<{ supplier_id: string }>(`supplier_inquiries?rfq_id=eq.${saved[0].id}&select=supplier_id`)
      if (inq.length !== 1) note(info, { kind: 'observation', where: `${W} double-click Copy message`, what: `${inq.length} inquiries for one supplier` })
      note(info, { kind: 'observation', where: `${W} stored items`, what: `${items.length} items stored`, detail: items.map(i => [i.description.slice(0, 40), num(i.qty), i.unit]) })
      if (items.some(i => !i.description.trim())) note(info, { kind: 'observation', where: `${W} stored items`, what: 'a whitespace-only item was stored' })
      const th = items.find(i => i.description.includes('Thermowell'))
      if (th && num(th.qty) === 1) note(info, { kind: 'observation', where: `${W} stored items`, what: 'a quantity of 0 was saved as 1 silently (effectiveQty), the customer asked for 0' })
      const dec = items.find(i => i.description.includes('Pressure gauge'))
      if (dec && num(dec.qty) !== 2.5) note(info, { kind: 'observation', where: `${W} stored items`, what: `2.5 nos stored as ${dec.qty}` })
      const big = items.find(i => i.description.includes('Flow switch'))
      if (big && num(big.qty) !== 1_000_000) note(info, { kind: 'observation', where: `${W} stored items`, what: `1000000 nos stored as ${big.qty}` })
      const shown = rows.filter(([d]) => d.trim()).length
      if (items.length !== shown) note(info, { kind: 'observation', where: `${W} stored items`, what: `${shown} non-blank rows on screen, ${items.length} stored` })
      await layout(page, info, `${W} floated`)
      await shot(page, `${W}-floated`)
    })

    // ---- (b) a PDF enquiry, then a double "Save without asking"
    await probe(info, page, `${W} PDF enquiry`, async () => {
      const t = tag()
      const cust = await company('Hunt PDF Customer', { city: 'Sialkot' })
      const pdf = await enquiryPdf([
        'Purchase Enquiry',
        'Dear Sir, kindly quote your best price for:',
        `1. Coriolis mass flow meter DN25 ${t} - 2 nos`,
        `2. RTD sensor PT100 with head ${t} - 6 nos`,
        '',
        'Regards, Procurement',
      ])
      await startIntake(page, info, cust)
      await page.getByTestId('pdf-input-items').setInputFiles({ name: `enquiry-${t}.pdf`, mimeType: 'application/pdf', buffer: pdf })
      await expect(page.getByRole('textbox', { name: 'Description of item 1', exact: true })).toBeVisible({ timeout: 30_000 })
      const rows = await rowsOnScreen(page)
      const want = [`Coriolis mass flow meter DN25 ${t}`, `RTD sensor PT100 with head ${t}`]
      const ok = want.every((w, i) => rows[i]?.[0].includes(w)) && rows[0]?.[1] === '2 nos' && rows[1]?.[1] === '6 nos' && rows.length === 2
      if (!ok) note(info, { kind: 'observation', where: `${W} PDF enquiry`, what: 'the PDF did not give the two items with their quantities', detail: rows })
      await layout(page, info, `${W} pdf items`)
      await shot(page, `${W}-pdf-items`)
      await vis(page.getByRole('button', { name: 'Save without asking' })).dblclick()
      await expect(page.getByText(/is saved/).first()).toBeVisible(T)
      await page.waitForTimeout(2000)
      const saved = await rfqsOf(cust.id)
      if (saved.length !== 1) note(info, { kind: 'observation', where: `${W} double Save without asking`, what: `${saved.length} RFQs saved` })
      const files = await db.rows<{ file_name: string | null }>(`attachments?rfq_id=eq.${saved[0].id}&select=file_name`)
      if (files.length !== 1) note(info, { kind: 'observation', where: `${W} PDF enquiry`, what: `the picked PDF is attached ${files.length} times (expected once)`, detail: files })
      await shot(page, `${W}-pdf-saved`)
    })

    // ---- (c) a screenshot of an enquiry, read on the device
    await probe(info, page, `${W} screenshot enquiry`, async () => {
      const cust = await company('Hunt Screenshot Customer', { city: 'Quetta' })
      const png = await enquiryPng(browser, ['Please send quotation for:', '1) Ultrasonic level transmitter 0-10 m - 2 nos', '2) Solenoid valve 1/2 inch 24V DC - 5 nos', 'Thanks'])
      await startIntake(page, info, cust)
      if (vp === 'desktop') await pasteOnPage(page, { file: { name: 'screenshot.png', type: 'image/png', b64: png.toString('base64') } })
      else await page.getByTestId('pdf-input-items').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png })
      const t0 = Date.now()
      await expect(page.getByRole('textbox', { name: 'Description of item 1', exact: true })).toBeVisible({ timeout: 120_000 })
      const ms = Date.now() - t0
      if (ms > 30_000) note(info, { kind: 'slow', where: `${W} screenshot enquiry`, what: `reading the screenshot took ${ms} ms` })
      const rows = await rowsOnScreen(page)
      const ok = rows.length === 2 && /ultrasonic level transmitter/i.test(rows[0][0]) && rows[0][1] === '2 nos' && /solenoid valve/i.test(rows[1][0]) && rows[1][1] === '5 nos'
      if (!ok) note(info, { kind: 'observation', where: `${W} screenshot enquiry`, what: 'the screenshot did not give the two items with their quantities', detail: rows })
      await layout(page, info, `${W} screenshot items`)
      await shot(page, `${W}-screenshot-items`)
      await vis(page.getByRole('button', { name: 'Save without asking' })).click()
      await expect(page.getByText(/is saved/).first()).toBeVisible(T)
    })

    // ---- reload mid-form
    await probe(info, page, `${W} reload mid-form`, async () => {
      const cust = await company('Hunt Reload Customer')
      const t = tag()
      await startIntake(page, info, cust)
      await pasteOnPage(page, { text: [`Vortex flow meter DN80 ${t} - 2 nos`, `Magnetic level gauge ${t} 1500 mm - 1 no`].join('\n') })
      await expect(page.getByRole('textbox', { name: 'Description of item 2', exact: true })).toBeVisible(T)
      await page.getByRole('textbox', { name: 'Quantity of item 1', exact: true }).fill('7 nos')
      await page.getByRole('textbox', { name: 'Description of item 1', exact: true }).click()
      const before = await rowsOnScreen(page)
      const seen = raised.get(page) ?? []
      const n0 = seen.length
      await page.reload()
      await settle(page)
      if (seen.length === n0) note(info, { kind: 'observation', where: `${W} reload mid-form`, what: 'reloading with items on the form gave no "Leave site?" warning' })
      const offer = page.getByRole('region', { name: 'Your draft' })
      if (!(await offer.isVisible().catch(() => false))) {
        note(info, { kind: 'observation', where: `${W} reload mid-form`, what: 'after a reload no draft was offered: the pasted items are gone' })
        return
      }
      await shot(page, `${W}-draft-offer`)
      await offer.getByRole('button', { name: 'Continue your draft' }).click()
      await expect(page.getByRole('textbox', { name: 'Description of item 1', exact: true })).toBeVisible(T)
      const after = await rowsOnScreen(page)
      if (JSON.stringify(after) !== JSON.stringify(before)) note(info, { kind: 'observation', where: `${W} reload mid-form`, what: 'the restored draft differs from the form before the reload', detail: { before, after } })
      if (!(await page.getByRole('button', { name: `Change company, now ${cust.name}` }).isVisible().catch(() => false)))
        note(info, { kind: 'observation', where: `${W} reload mid-form`, what: 'the company was not restored with the draft' })
    })

    // ---- browser Back with items on the form; Back while "Leave this new RFQ?" is open
    await probe(info, page, `${W} Back from New RFQ`, async () => {
      const cust = await company('Hunt Back Customer')
      await visit(page, info, '/today', W)
      await startIntake(page, info, cust)
      await pasteOnPage(page, { text: `Differential pressure transmitter ${tag()} - 3 nos` })
      await expect(page.getByRole('textbox', { name: 'Description of item 1', exact: true })).toBeVisible(T)
      await page.goBack()
      await settle(page)
      const url = page.url()
      if (!url.includes('/rfqs/new')) {
        note(info, { kind: 'observation', where: `${W} Back from New RFQ`, what: `Back left New RFQ with items on it, no question asked (now ${url.replace(/^https?:\/\/[^/]+/, '')})` })
        await visit(page, info, '/rfqs/new', W)
        if (!(await page.getByRole('region', { name: 'Your draft' }).isVisible().catch(() => false)))
          note(info, { kind: 'observation', where: `${W} Back from New RFQ`, what: 'coming back after Back offers no draft: the items are lost' })
      }
    })
    await probe(info, page, `${W} Back while the leave dialog is open`, async () => {
      const cust = await company('Hunt Leave Customer')
      await startIntake(page, info, cust)
      await pasteOnPage(page, { text: `Temperature transmitter PT100 ${tag()} - 4 nos` })
      await expect(page.getByRole('textbox', { name: 'Description of item 1', exact: true })).toBeVisible(T)
      await vis(page.getByRole('link', { name: 'Orders', exact: true })).click()
      const leave = page.getByRole('dialog', { name: 'Leave this new RFQ?' })
      await expect(leave).toBeVisible(T)
      await layout(page, info, `${W} leave dialog`)
      await shot(page, `${W}-leave-dialog`)
      await page.goBack()
      await settle(page)
      const url = page.url().replace(/^https?:\/\/[^/]+/, '')
      const open = await leave.isVisible().catch(() => false)
      const items = await page.getByRole('textbox', { name: /^Description of item \d+$/ }).count()
      if (!url.startsWith('/rfqs/new') || open || items === 0)
        note(info, { kind: 'observation', where: `${W} Back while the leave dialog is open`, what: `after Back: url ${url}, dialog ${open ? 'still open' : 'closed'}, ${items} item rows on screen` })
    })

    // ---- a quantity past numeric(12,3)
    await probe(info, page, `${W} huge quantity`, async () => {
      const cust = await company('Hunt Huge Qty Customer')
      await startIntake(page, info, cust)
      await pasteOnPage(page, { text: `Level switch vibrating fork ${tag()} - 5 nos` })
      const q = page.getByRole('textbox', { name: 'Quantity of item 1', exact: true })
      await q.fill('99999999999 nos')
      await q.blur()
      await vis(page.getByRole('button', { name: 'Save without asking' })).click()
      const outcome = await Promise.race([
        page.getByText(/is saved/).first().waitFor({ timeout: 15_000 }).then(() => 'saved'),
        page.getByText(/Nothing was saved/).first().waitFor({ timeout: 15_000 }).then(() => 'refused'),
      ]).catch(() => 'nothing happened')
      const saved = await rfqsOf(cust.id)
      const stored = saved.length ? await itemsOf(saved[0].id) : []
      const text = await main(page)
      note(info, {
        kind: 'observation',
        where: `${W} huge quantity`,
        what: `a quantity of 99,999,999,999 (over numeric(12,3)): ${outcome}`,
        detail: { stored: stored.map(i => i.qty), message: (text.match(/[^.]*Nothing was saved[^.]*\./) ?? text.match(/Could not[^.]*\./) ?? [''])[0].slice(0, 300) },
      })
      await shot(page, `${W}-huge-qty`)
    })

    await ctx.close()
  })
}

// ================================================================================================ 2. supplier replies

for (const vp of ['desktop', 'phone'] as Viewport[]) {
  test(`supplier replies at ${vp}: odd typed and pasted formats, double Save, ranking`, async ({ browser }, info) => {
    test.setTimeout(300_000)
    const t = tag()
    const cust = await company('Hunt Replies Customer', { city: 'Gujranwala' })
    const d = [`Hunt magnetic flow meter DN50 ${t}`, `Hunt pressure switch 0-10 bar ${t}`, `Hunt instrument cable 2 core ${t}`]
    const r = await rfq({ customer: cust, items: [{ description: d[0], qty: 4 }, { description: d[1], qty: 2 }, { description: d[2], qty: 10, unit: 'm' }] })
    const de = await supplier('Hunt Rheinmess GmbH', 'Germany')
    const pk = await supplier('Hunt Karachi Instruments', 'Pakistan')
    const cn = await supplier('Hunt Ningbo Sensors', 'China')
    const de2 = await supplier('Hunt Alpenwerk GmbH', 'Germany')
    for (const s of [de, pk, cn, de2]) await quote(r.rfq.id, s, [])
    const ctx = await ctxAs(browser, info, 'sales', vp)
    // The RFQ list first, so Back from the RFQ page has a real page to go to (not about:blank).
    let page = await openPage(ctx, info, '/rfqs', `sales/${vp}`)
    await visit(page, info, `/rfqs/${r.rfq.id}`, `sales/${vp}`)
    const revive = async () => {
      if (!page.isClosed()) return
      page = await openPage(ctx, info, '/rfqs', `sales/${vp}`)
      await visit(page, info, `/rfqs/${r.rfq.id}`, `sales/${vp}`)
    }
    const W = `replies/${vp}`
    const region = (s: Co) => page.getByRole('region', { name: s.name, exact: true })
    const price = (s: Co, n: number) => region(s).getByLabel(`Price for item ${n} from ${s.name}`)
    await layout(page, info, `${W} rfq page`)
    await shot(page, `${W}-rfq-page`)

    await revive()
    await probe(info, page, `${W} typed comma decimals`, async () => {
      await price(de, 1).fill('1.234,50')
      await price(de, 1).blur()
      await price(de, 2).fill('12,5')
      await price(de, 2).blur()
      const shown = [await price(de, 1).inputValue(), await price(de, 2).inputValue()]
      await region(de).getByRole('button', { name: 'Save reply' }).click()
      await expect(toast(page, 'Reply saved').first()).toBeVisible(T)
      await expect.poll(async () => (await linesOf(r.rfq.id, de.id)).length, T).toBe(2)
      const lines = await linesOf(r.rfq.id, de.id)
      const by = (n: number) => num(lines.find(l => l.rfq_item_id === r.items[n - 1].id)?.unit_price)
      if (by(1) !== 1234.5 || by(2) !== 12.5)
        note(info, { kind: 'observation', where: `${W} typed comma decimals`, what: `typed "1.234,50" and "12,5" (EUR) were stored as ${by(1)} and ${by(2)}, shown as ${JSON.stringify(shown)}; no warning`, detail: lines })
    })

    await revive()
    await probe(info, page, `${W} typed junk, negative and zero`, async () => {
      await price(pk, 1).fill('PKR 1,200/-')
      await price(pk, 2).fill('-5')
      await price(pk, 3).fill('0')
      await price(pk, 3).blur()
      const save = region(pk).getByRole('button', { name: 'Save reply' })
      const enabled = await save.isEnabled()
      const shown = [await price(pk, 1).inputValue(), await price(pk, 2).inputValue(), await price(pk, 3).inputValue()]
      const said = (await region(pk).innerText()).replace(/\s+/g, ' ')
      note(info, {
        kind: 'observation',
        where: `${W} typed junk, negative and zero`,
        what: `"PKR 1,200/-", "-5", "0" typed: Save reply ${enabled ? 'ENABLED' : 'disabled'}; boxes show ${JSON.stringify(shown)}; ${/not a (price|number)|valid|positive|greater than/i.test(said) ? 'a message says why' : 'nothing says why'}`,
      })
      await layout(page, info, `${W} junk prices`)
      await shot(page, `${W}-junk-prices`)
      if (enabled) {
        await save.click()
        await page.waitForTimeout(1500)
        note(info, { kind: 'observation', where: `${W} typed junk`, what: 'saved with junk prices', detail: await linesOf(r.rfq.id, pk.id) })
      }
      await price(pk, 1).fill('1200')
      await price(pk, 2).fill('3500')
      await price(pk, 3).fill('95.5')
      await save.click()
      await expect.poll(async () => (await linesOf(r.rfq.id, pk.id)).length, T).toBe(3)
    })

    await revive()
    await probe(info, page, `${W} double-click Save reply`, async () => {
      const box = region(cn)
      // A Chinese supplier: CNY is pre-filled from the country, or one chip is asked for.
      const chip = box.getByRole('group', { name: `Currency for ${cn.name}` }).getByRole('button', { name: 'CNY', exact: true })
      if (await chip.isVisible().catch(() => false)) await chip.click()
      await price(cn, 1).fill('2100')
      await price(cn, 2).fill('480')
      await price(cn, 3).fill('9')
      let posts = 0
      const onReq = (q: { url: () => string; method: () => string }) => {
        if (/supplier_quote_lines|rpc\/save_reply|rpc\/.*reply/.test(q.url()) && q.method() !== 'GET') posts++
      }
      page.on('request', onReq)
      await box.getByRole('button', { name: 'Save reply' }).dblclick()
      await expect(toast(page, 'Reply saved').first()).toBeVisible(T)
      await page.waitForTimeout(1500)
      page.off('request', onReq)
      const lines = await linesOf(r.rfq.id, cn.id)
      if (lines.length !== 3) note(info, { kind: 'observation', where: `${W} double-click Save reply`, what: `${lines.length} lines stored for 3 prices` })
      if (posts > 1) note(info, { kind: 'observation', where: `${W} double-click Save reply`, what: `${posts} write requests for one double-clicked Save reply` })
      if (lines.some(l => l.currency !== 'CNY')) note(info, { kind: 'observation', where: `${W} double-click Save reply`, what: 'Chinese supplier reply not stored in CNY', detail: lines })
    })

    await revive()
    await probe(info, page, `${W} pasted odd reply`, async () => {
      const reply = [
        'Dear Sir,',
        'Thank you for your enquiry. Our offer:',
        `${d[0]} - EUR 1.234,50 each, delivery 3-4 weeks`,
        `${d[1]} - USD 1,200/- per piece, 3-4 weeks`,
        `${d[2]} - price on request`,
        'Validity 30 days. Best regards, Hans',
      ].join('\n')
      await page.evaluate(x => navigator.clipboard.writeText(x), reply)
      await region(de2).getByRole('button', { name: 'Paste reply' }).click()
      const panel = page.getByRole('region', { name: `Read from the reply of ${de2.name}` })
      const box = page.getByRole('region', { name: 'Paste their reply' })
      if (await box.isVisible().catch(() => false)) {
        note(info, { kind: 'observation', where: `${W} pasted odd reply`, what: 'Paste reply fell back to the paste box (clipboard not readable)' })
        await box.getByRole('textbox').fill(reply)
        await box.getByRole('button', { name: 'Read it' }).click()
      }
      await expect(panel).toBeVisible(T)
      const read = (await panel.innerText()).replace(/\s+/g, ' ')
      note(info, { kind: 'observation', where: `${W} pasted odd reply`, what: 'what the paste was read as', detail: read.slice(0, 700) })
      if (!/1,234\.50/.test(read)) note(info, { kind: 'observation', where: `${W} pasted odd reply`, what: '"EUR 1.234,50" was not read as 1,234.50', detail: read.slice(0, 400) })
      if (!/1,200\.00|1,200\b/.test(read)) note(info, { kind: 'observation', where: `${W} pasted odd reply`, what: '"USD 1,200/-" was not read as 1,200', detail: read.slice(0, 400) })
      await layout(page, info, `${W} paste panel`)
      await shot(page, `${W}-paste-panel`)
      const accept = panel.getByRole('button', { name: /^Accept \d+ prices?$/ })
      if (!(await accept.isVisible().catch(() => false))) {
        note(info, { kind: 'observation', where: `${W} pasted odd reply`, what: 'no Accept button for the pasted reply' })
        await panel.getByRole('button', { name: 'Cancel' }).click()
        return
      }
      await accept.click()
      await expect.poll(async () => (await linesOf(r.rfq.id, de2.id)).length, T).toBeGreaterThan(0)
      await page.waitForTimeout(1000)
      const lines = await linesOf(r.rfq.id, de2.id)
      note(info, { kind: 'observation', where: `${W} pasted odd reply`, what: 'stored lines', detail: lines })
      const l1 = lines.find(l => l.rfq_item_id === r.items[0].id)
      const l2 = lines.find(l => l.rfq_item_id === r.items[1].id)
      if (!l1 || num(l1.unit_price) !== 1234.5 || l1.currency !== 'EUR') note(info, { kind: 'observation', where: `${W} pasted odd reply`, what: `item 1 stored as ${l1 ? `${l1.currency} ${l1.unit_price}` : 'nothing'} (wanted EUR 1234.50)` })
      if (l2 && l2.currency !== 'USD') note(info, { kind: 'observation', where: `${W} pasted odd reply`, what: `"USD 1,200/-" stored as ${l2.currency} ${l2.unit_price}: the reply's one currency overrode the line's own` })
      if (lines.some(l => l.rfq_item_id === r.items[2].id)) note(info, { kind: 'observation', where: `${W} pasted odd reply`, what: '"price on request" was stored as a price' })
      if (l1 && !/3\s*-\s*4 weeks/.test(l1.lead_time ?? '')) note(info, { kind: 'observation', where: `${W} pasted odd reply`, what: `lead time "3-4 weeks" stored as ${JSON.stringify(l1.lead_time)}` })
    })

    await revive()
    await probe(info, page, `${W} close a reply with typed prices, then Back`, async () => {
      const edit = vis(page.getByRole('button', { name: `Edit reply, ${pk.name}` }))
      if (await edit.isVisible().catch(() => false)) await edit.click()
      await price(pk, 1).fill('1111')
      await region(pk).getByRole('button', { name: `Close the reply, ${pk.name}` }).click()
      const confirm = page.getByRole('dialog', { name: 'Close without saving the prices?' })
      await expect(confirm).toBeVisible(T)
      await page.goBack()
      await settle(page)
      const url = page.url().replace(/^https?:\/\/[^/]+/, '')
      const open = await confirm.isVisible().catch(() => false)
      const kept = await price(pk, 1).inputValue().catch(() => '(gone)')
      if (!url.startsWith(`/rfqs/${r.rfq.id}`) || open || kept !== '1111')
        note(info, { kind: 'observation', where: `${W} Back on "Close without saving"`, what: `after Back: url ${url}, confirm ${open ? 'still open' : 'closed'}, typed price now ${JSON.stringify(kept)}` })
      if (!url.startsWith(`/rfqs/${r.rfq.id}`)) await visit(page, info, `/rfqs/${r.rfq.id}`, W)
    })

    await revive()
    await probe(info, page, `${W} ranked comparison`, async () => {
      await page.reload()
      await settle(page)
      // Item 1 in PKR at EUR 300 / CNY 40: Karachi 1,200; Rheinmess 1.2345 EUR (or 1,234.50) x 300; Ningbo 2,100 x 40 = 84,000; Alpenwerk 1,234.50 x 300.
      const art = page.getByRole('article', { name: 'Item 1' })
      await expect(art.locator('li[data-ranked]').first()).toBeVisible(T)
      const rows = (await art.locator('li[data-ranked]').allInnerTexts()).map(s => s.replace(/\s+/g, ' ').slice(0, 120))
      note(info, { kind: 'observation', where: `${W} ranked comparison`, what: 'item 1 ranking as shown', detail: rows })
      const values = rows.map(s => Number((s.match(/([\d,]+(?:\.\d+)?)/g) ?? []).map(x => x.replace(/,/g, '')).find(x => Number(x) >= 1) ?? NaN))
      for (let i = 1; i < values.length; i++)
        if (values[i] < values[i - 1]) note(info, { kind: 'observation', where: `${W} ranked comparison`, what: `row ${i + 1} reads cheaper than row ${i}`, detail: rows })
      await layout(page, info, `${W} ranking`)
      await shot(page, `${W}-ranking`)
    })

    await ctx.close()
  })
}

// ================================================================================================ 3. quotation, desktop

test('quotation at desktop: GST mix and decimals vs DB vs PDF, double Issue, revise, back, reload, boundaries, failed issue', async ({ browser }, info) => {
  test.setTimeout(330_000)
  const t = tag()
  const cust = await company('Hunt Quote Customer', { city: 'Peshawar' })
  const r = await rfq({
    customer: cust,
    items: [
      { description: `Hunt pressure transmitter ${t}`, qty: 2.5 },
      { description: `Hunt calibration service ${t}`, qty: 3, gst: 0 },
      { description: `Hunt flow computer ${t}`, qty: 1 },
    ],
  })
  const sup = await supplier('Hunt Lahore Stockist', 'Pakistan')
  await quote(r.rfq.id, sup, r.items.map((it, i) => ({ itemId: it.id, price: [1000, 800, 90000][i] })))
  const ctx = await ctxAs(browser, info, 'sales', 'desktop')
  await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, 'share', { value: undefined, configurable: true }))
  let page = await openPage(ctx, info, '/rfqs', 'sales/desktop')
  await visit(page, info, `/rfqs/${r.rfq.id}`, 'sales/desktop')
  const revive = async () => {
    if (!page.isClosed()) return
    page = await openPage(ctx, info, '/rfqs', 'sales/desktop')
    await visit(page, info, `/rfqs/${r.rfq.id}`, 'sales/desktop')
  }
  const W = 'quote/desktop'
  // By hand: 2.5 x 1,234.56 = 3,086.40, GST 18% = 555.55 -> 556; 3 x 999.99 = 2,999.97 exempt; 1 x 100,000 = 100,000, GST 18,000.
  // Net 106,086.37; GST 18,556; gross 124,642.37.
  const exp0 = quoteTotals([
    { qty: 2.5, price: 1234.56, gst: 18 },
    { qty: 3, price: 999.99, gst: 0 },
    { qty: 1, price: 100000, gst: 18 },
  ])

  await revive()
  await probe(info, page, `${W} issue: totals on screen, double-click Issue`, async () => {
    await openIssue(page, info, r.rfq.id, W)
    await fillPrice(page, 1, '1234.56')
    await fillPrice(page, 2, '999.99')
    await fillPrice(page, 3, '100000')
    await dialog(page).getByLabel('GST rate, item 2').selectOption('0')
    const s = await screenTotals(page)
    if (s.net !== `PKR ${amount(exp0.net)}` || s.gst !== `PKR ${amount(exp0.gst)}` || s.gross !== `PKR ${amount(exp0.gross)}`)
      note(info, { kind: 'observation', where: `${W} totals`, what: 'the dialog totals differ from the hand computation', detail: { screen: s, expected: exp0 } })
    await layout(page, info, `${W} dialog`)
    await shot(page, `${W}-issue-dialog`)
    await watchIssueError(page)
    await dialog(page).getByRole('button', { name: 'Issue quotation' }).dblclick()
    await expect(dialog(page).getByTestId('pdf-ready')).toBeVisible({ timeout: 45_000 })
    await shot(page, `${W}-issued`)
    const flashed = await issueErrorSeen(page)
    if (flashed) note(info, { kind: 'observation', where: `${W} double-click Issue`, what: 'the double-click showed "Could not issue the quotation" (the second call hit quotations_pkey) before the issued screen', detail: flashed })
    const qs = await quotationsOf(r.rfq.id)
    if (qs.length !== 1) note(info, { kind: 'observation', where: `${W} double-click Issue`, what: `${qs.length} quotations after one double-clicked Issue` })
    const q = qs[0]
    if (num(q.net_total) !== exp0.net || num(q.gst_total) !== exp0.gst)
      note(info, { kind: 'observation', where: `${W} stored totals`, what: `DB net ${q.net_total} GST ${q.gst_total}, expected ${exp0.net} / ${exp0.gst}` })
    const pdf = q.pdf_path ? await fetchStoredPdf('sales', 'generated-docs', q.pdf_path) : null
    if (!pdfIsValid(pdf)) note(info, { kind: 'observation', where: `${W} PDF`, what: 'the stored PDF is missing or not valid', detail: q.pdf_path })
    const text = pdf ? pdfText(pdf) : null
    if (text) {
      for (const [what, n] of [['net', exp0.net], ['GST', exp0.gst], ['gross', exp0.gross]] as const)
        if (!hasFigure(text, n)) note(info, { kind: 'observation', where: `${W} PDF`, what: `the PDF does not print the ${what} ${amount(n)}`, detail: text.slice(0, 1500) })
      if (!text.includes('2.5')) note(info, { kind: 'observation', where: `${W} PDF`, what: 'the decimal quantity 2.5 is not printed as such' })
      if (!/exempt/i.test(text)) note(info, { kind: 'observation', where: `${W} PDF`, what: 'the PDF does not say which line is GST-exempt' })
    }
    await dialog(page).getByRole('button', { name: 'Done' }).click()
    const row = page.getByTestId('quotation-0')
    await expect(row).toBeVisible(T)
    if (!(await row.innerText()).includes(amount(exp0.gross))) note(info, { kind: 'observation', where: `${W} Quotations list`, what: `the list row does not show the gross ${amount(exp0.gross)}`, detail: await row.innerText() })
  })

  // Revise: item 1 to 1,300 -> 2.5 x 1,300 = 3,250, GST 585. Net 106,249.97; GST 18,585; gross 124,834.97.
  const exp1 = quoteTotals([
    { qty: 2.5, price: 1300, gst: 18 },
    { qty: 3, price: 999.99, gst: 0 },
    { qty: 1, price: 100000, gst: 18 },
  ])
  await revive()
  await probe(info, page, `${W} revise: R1 under the same number, R0 kept`, async () => {
    const r0 = (await quotationsOf(r.rfq.id))[0]
    await page.locator('[data-slot="quotations"]').getByRole('button', { name: 'Revise quotation' }).click()
    await expect(dialog(page).getByText('Revision 1', { exact: true })).toBeVisible(T)
    const kept = await dialog(page).getByLabel('Unit price, net PKR, item 1').inputValue()
    if (kept !== '1,234.56') note(info, { kind: 'observation', where: `${W} revise`, what: `the last price is not pre-filled for item 1 (shows ${JSON.stringify(kept)})` })
    const gst2 = await dialog(page).getByLabel('GST rate, item 2').inputValue()
    if (gst2 !== '0') note(info, { kind: 'observation', where: `${W} revise`, what: `item 2's exemption is not kept on revise (GST select is ${gst2})` })
    await fillPrice(page, 1, '1300')
    const s = await screenTotals(page)
    if (s.gross !== `PKR ${amount(exp1.gross)}`) note(info, { kind: 'observation', where: `${W} revise totals`, what: 'revise dialog totals differ from the hand computation', detail: { screen: s, expected: exp1 } })
    await dialog(page).getByRole('button', { name: 'Issue revised quotation' }).dblclick()
    await expect(dialog(page).getByTestId('pdf-ready')).toBeVisible({ timeout: 45_000 })
    await dialog(page).getByRole('button', { name: 'Done' }).click()
    const qs = await quotationsOf(r.rfq.id)
    if (qs.length !== 2) note(info, { kind: 'observation', where: `${W} revise`, what: `${qs.length} quotations after one revise (wanted 2)` })
    const [a, b] = qs
    if (b && (b.number !== a.number || b.revision !== 1)) note(info, { kind: 'observation', where: `${W} revise`, what: `revise gave number ${b.number} revision ${b.revision} (R0 was ${a.number})` })
    if (b && (num(b.net_total) !== exp1.net || num(b.gst_total) !== exp1.gst)) note(info, { kind: 'observation', where: `${W} revise`, what: `R1 stored net ${b.net_total} GST ${b.gst_total}, expected ${exp1.net} / ${exp1.gst}` })
    if (num(a.net_total) !== num(r0.net_total) || a.pdf_path !== r0.pdf_path) note(info, { kind: 'observation', where: `${W} revise`, what: 'R0 changed when R1 was issued', detail: { before: r0, after: a } })
    const old = a.pdf_path ? await fetchStoredPdf('sales', 'generated-docs', a.pdf_path) : null
    if (!pdfIsValid(old)) note(info, { kind: 'observation', where: `${W} revise`, what: 'R0 PDF is no longer readable after the revise' })
    const pdf1 = b?.pdf_path ? await fetchStoredPdf('sales', 'generated-docs', b.pdf_path) : null
    const text = pdf1 ? pdfText(pdf1) : null
    if (text && !hasFigure(text, exp1.gross)) note(info, { kind: 'observation', where: `${W} revise PDF`, what: `R1 PDF does not print the gross ${amount(exp1.gross)}` })
    if (!(await page.getByTestId('quotation-0').innerText()).includes('Replaced by revision 1')) note(info, { kind: 'observation', where: `${W} revise`, what: 'R0 row does not say it was replaced' })
    await layout(page, info, `${W} two revisions`)
    await shot(page, `${W}-two-revisions`)
  })

  await revive()
  await probe(info, page, `${W} reload with the dialog open`, async () => {
    await openReviseFromMenu(page)
    await fillPrice(page, 1, '1400')
    const seen = raised.get(page) ?? []
    const n0 = seen.length
    await page.reload()
    await settle(page)
    const open = await page.getByRole('list', { name: 'Items to quote' }).isVisible().catch(() => false)
    const value = open ? await dialog(page).getByLabel('Unit price, net PKR, item 1').inputValue() : '(dialog closed)'
    note(info, {
      kind: 'observation',
      where: `${W} reload with the dialog open`,
      what: `after reload the dialog is ${open ? 'open' : 'closed'}, item 1 shows ${JSON.stringify(value)} (typed 1,400)${seen.length === n0 ? '; no "Leave site?" warning' : ''}`,
    })
    if (open) await dialog(page).getByRole('button', { name: 'Cancel' }).click()
  })

  await revive()
  await probe(info, page, `${W} Back with the dialog open`, async () => {
    await visit(page, info, '/rfqs', W)
    await visit(page, info, `/rfqs/${r.rfq.id}`, W)
    await openReviseFromMenu(page)
    await fillPrice(page, 1, '1450')
    await page.goBack()
    await settle(page)
    const url = page.url().replace(/^https?:\/\/[^/]+/, '')
    const open = await dialog(page).isVisible().catch(() => false)
    if (!url.startsWith(`/rfqs/${r.rfq.id}`) || open)
      note(info, { kind: 'observation', where: `${W} Back with the dialog open`, what: `Back ${url.startsWith(`/rfqs/${r.rfq.id}`) ? 'kept the page' : `left the RFQ page for ${url}`}; dialog ${open ? 'still open' : 'closed'}; the typed 1,450 was discarded without a question` })
    await visit(page, info, `/rfqs/${r.rfq.id}`, W)
  })

  await revive()
  await probe(info, page, `${W} zero, negative and 22-digit prices`, async () => {
    await openReviseFromMenu(page)
    const issue = dialog(page).getByRole('button', { name: 'Issue revised quotation' })
    await fillPrice(page, 1, '-5')
    const negLine = await dialog(page).getByTestId('quote-line-1').innerText()
    const negEnabled = await issue.isEnabled()
    if (negEnabled || !/No price yet/.test(negLine)) note(info, { kind: 'observation', where: `${W} negative price`, what: `a price of -5: Issue ${negEnabled ? 'ENABLED' : 'disabled'}, line says ${JSON.stringify(negLine.replace(/\s+/g, ' ').slice(-60))}` })
    await fillPrice(page, 1, '0')
    if (await issue.isEnabled()) note(info, { kind: 'observation', where: `${W} zero price`, what: 'a unit price of 0 can be issued (a free line on a customer quotation, no warning)' })
    // No blur: when the dialog crashes on the keystroke there is no box left to blur.
    await dialog(page).getByLabel('Unit price, net PKR, item 1').fill('9999999999999999999999')
    await page.waitForTimeout(800)
    const alive = await dialog(page).getByTestId('total-gross').isVisible().catch(() => false)
    if (!alive) note(info, { kind: 'observation', where: `${W} 22-digit price`, what: 'a 22-digit price broke the dialog (computeTotals cannot read 1e+21)', detail: (await main(page)).slice(0, 300) })
    else note(info, { kind: 'observation', where: `${W} 22-digit price`, what: `a 22-digit price: gross shows ${await dialog(page).getByTestId('total-gross').innerText({ timeout: 3_000 })}` })
    await shot(page, `${W}-huge-price`)
    if (alive) await dialog(page).getByRole('button', { name: 'Cancel' }).click()
    // A fresh load of the RFQ page (without ?issue=1) puts the error screen away.
    await visit(page, info, `/rfqs/${r.rfq.id}`, W)
  })

  await revive()
  await probe(info, page, `${W} overflowing total`, async () => {
    // 999,999,999,999 fits rfq_items (numeric(14,2)); x 2.5 does not fit quotations.net_total.
    const before = await itemsOf(r.rfq.id)
    await openReviseFromMenu(page)
    await fillPrice(page, 1, '999999999999')
    await dialog(page).getByRole('button', { name: 'Issue revised quotation' }).click()
    const outcome = await Promise.race([
      dialog(page).getByTestId('pdf-ready').waitFor({ timeout: 30_000 }).then(() => 'issued'),
      dialog(page).getByText('Could not issue the quotation').waitFor({ timeout: 30_000 }).then(() => 'refused'),
    ]).catch(() => 'nothing happened')
    const message = outcome === 'refused' ? (await dialog(page).getByText('Could not issue the quotation').locator('..').innerText()).replace(/\s+/g, ' ') : ''
    const after = await itemsOf(r.rfq.id)
    const changed = num(after[0].quoted_unit_price_net) !== num(before[0].quoted_unit_price_net)
    note(info, {
      kind: 'observation',
      where: `${W} overflowing total`,
      what: `price 999,999,999,999 x 2.5: ${outcome}${changed && outcome !== 'issued' ? '; rfq_items.quoted_unit_price_net WAS changed although nothing was issued' : ''}`,
      detail: { message: message.slice(0, 300), itemPrice: after[0].quoted_unit_price_net },
    })
    await shot(page, `${W}-overflow`)
    if (await dialog(page).isVisible().catch(() => false)) await page.keyboard.press('Escape')
    await db.patch(`rfq_items?id=eq.${r.items[0].id}`, { quoted_unit_price_net: 1300 })
    await visit(page, info, `/rfqs/${r.rfq.id}`, W)
  })

  await revive()
  await probe(info, page, `${W} issue call fails after the prices were written`, async () => {
    const count0 = (await quotationsOf(r.rfq.id)).length
    await page.route(/\/rest\/v1\/rpc\/issue_quotation/, route => route.abort('failed'))
    try {
      await openReviseFromMenu(page)
      await fillPrice(page, 1, '1500')
      await dialog(page).getByRole('button', { name: 'Issue revised quotation' }).click()
      await expect(dialog(page).getByText('Could not issue the quotation')).toBeVisible(T)
      await shot(page, `${W}-issue-failed`)
    } finally {
      await page.unroute(/\/rest\/v1\/rpc\/issue_quotation/)
    }
    await page.keyboard.press('Escape')
    const count1 = (await quotationsOf(r.rfq.id)).length
    const items = await itemsOf(r.rfq.id)
    if (count1 === count0 && num(items[0].quoted_unit_price_net) === 1500) {
      note(info, { kind: 'observation', where: `${W} failed issue`, what: 'the issue failed but rfq_items.quoted_unit_price_net is now 1,500: a price no quotation carries (issueQuotation writes the items before the RPC)' })
      await visit(page, info, `/rfqs/${r.rfq.id}`, W)
      const won = vis(page.locator('[data-slot="mark-won"]').getByRole('button', { name: 'Mark won' }))
      await won.click()
      const d = page.getByRole('dialog', { name: 'Mark won' })
      await expect(d.getByRole('group', { name: 'Suppliers by line' })).toBeVisible(T)
      const lines = await d.getByRole('group', { name: 'Suppliers by line' }).innerText()
      if (/1,500/.test(lines)) note(info, { kind: 'observation', where: `${W} failed issue -> Mark won`, what: 'Mark won offers to sell item 1 at 1,500, a price the customer was never quoted (R1 says 1,300)' })
      await shot(page, `${W}-won-after-failed-issue`)
      await page.keyboard.press('Escape')
    }
    await db.patch(`rfq_items?id=eq.${r.items[0].id}`, { quoted_unit_price_net: 1300 })
  })

  await ctx.close()
})

// ================================================================================================ 4. quotation, phone

test('quotation at phone: issue and revise at 375 with layout', async ({ browser }, info) => {
  test.setTimeout(180_000)
  const t = tag()
  const cust = await company('Hunt Phone Quote Customer', { city: 'Hyderabad' })
  const r = await rfq({ customer: cust, items: [{ description: `Hunt orifice plate assembly DN150 with flanges and gaskets ${t}`, qty: 1.25, unit: 'set' }, { description: `Hunt site commissioning ${t}`, qty: 2, gst: 0 }] })
  const sup = await supplier('Hunt Phone Stockist', 'Pakistan')
  await quote(r.rfq.id, sup, r.items.map((it, i) => ({ itemId: it.id, price: [40000, 15000][i] })))
  const ctx = await ctxAs(browser, info, 'sales', 'phone')
  const page = await openPage(ctx, info, `/rfqs/${r.rfq.id}`, 'sales/phone')
  const W = 'quote/phone'
  await layout(page, info, `${W} rfq page`)
  await shot(page, `${W}-rfq-page`)
  // 1.25 x 48,999.99 = 61,249.9875 -> 61,249.99, GST 11,025; 2 x 17,500 = 35,000 exempt. Net 96,249.99; GST 11,025; gross 107,274.99.
  const exp = quoteTotals([
    { qty: 1.25, price: 48999.99, gst: 18 },
    { qty: 2, price: 17500, gst: 0 },
  ])
  await probe(info, page, `${W} issue`, async () => {
    await openIssue(page, info, r.rfq.id, W)
    await layout(page, info, `${W} dialog`)
    await shot(page, `${W}-dialog`)
    await fillPrice(page, 1, '48999.99')
    await fillPrice(page, 2, '17500')
    await dialog(page).getByLabel('GST rate, item 2').selectOption('0')
    const s = await screenTotals(page)
    if (s.net !== `PKR ${amount(exp.net)}` || s.gross !== `PKR ${amount(exp.gross)}`) note(info, { kind: 'observation', where: `${W} totals`, what: 'phone dialog totals differ from the hand computation', detail: { screen: s, expected: exp } })
    const issue = dialog(page).getByRole('button', { name: 'Issue quotation' })
    await issue.scrollIntoViewIfNeeded()
    await shot(page, `${W}-dialog-filled`, false)
    await issue.click()
    await expect(dialog(page).getByTestId('pdf-ready')).toBeVisible({ timeout: 45_000 })
    await layout(page, info, `${W} issued`)
    await shot(page, `${W}-issued`)
    await dialog(page).getByRole('button', { name: 'Done' }).click()
    const [q] = await quotationsOf(r.rfq.id)
    if (num(q.net_total) !== exp.net || num(q.gst_total) !== exp.gst) note(info, { kind: 'observation', where: `${W} stored totals`, what: `DB net ${q.net_total} GST ${q.gst_total}, expected ${exp.net} / ${exp.gst}` })
    const pdf = q.pdf_path ? await fetchStoredPdf('sales', 'generated-docs', q.pdf_path) : null
    const text = pdf ? pdfText(pdf) : null
    if (text && !hasFigure(text, exp.gross)) note(info, { kind: 'observation', where: `${W} PDF`, what: `the PDF does not print the gross ${amount(exp.gross)}`, detail: text.slice(0, 1200) })
    if (text && !text.includes('1.25')) note(info, { kind: 'observation', where: `${W} PDF`, what: 'the decimal quantity 1.25 is not printed as such' })
  })
  await probe(info, page, `${W} revise`, async () => {
    await page.locator('[data-slot="quotations"]').getByRole('button', { name: 'Revise quotation' }).click()
    await expect(dialog(page).getByText('Revision 1', { exact: true })).toBeVisible(T)
    await fillPrice(page, 2, '18000')
    await dialog(page).getByRole('button', { name: 'Issue revised quotation' }).click()
    await expect(dialog(page).getByTestId('pdf-ready')).toBeVisible({ timeout: 45_000 })
    await dialog(page).getByRole('button', { name: 'Done' }).click()
    const qs = await quotationsOf(r.rfq.id)
    if (qs.length !== 2 || qs[1].number !== qs[0].number || qs[1].revision !== 1) note(info, { kind: 'observation', where: `${W} revise`, what: 'revise did not give R1 under the same number', detail: qs.map(q => [q.number, q.revision]) })
    await page.locator('[data-slot="quotations"]').scrollIntoViewIfNeeded()
    await layout(page, info, `${W} quotations list`)
    await shot(page, `${W}-quotations-list`)
  })
  await ctx.close()
})

// ================================================================================================ 5. two tabs

test('two tabs on one RFQ: a stale Issue after another tab issued, and a quantity changed under an open dialog', async ({ browser }, info) => {
  test.setTimeout(180_000)
  const ctx = await ctxAs(browser, info, 'sales', 'desktop')
  const W = 'two-tabs'
  const sup = await supplier('Hunt Two Tabs Stockist', 'Pakistan')

  {
    const cust = await company('Hunt Two Tabs Customer')
    const r = await rfq({ customer: cust, items: [{ description: `Hunt control valve 2 inch ${tag()}`, qty: 4 }] })
    await quote(r.rfq.id, sup, [{ itemId: r.items[0].id, price: 4000 }])
    const a = await openPage(ctx, info, `/rfqs/${r.rfq.id}?issue=1`, `${W}/A`)
    const b = await openPage(ctx, info, `/rfqs/${r.rfq.id}?issue=1`, `${W}/B`)
    await probe(info, a, `${W} stale issue`, async () => {
      await expect(a.getByRole('list', { name: 'Items to quote' })).toBeVisible(T)
      await expect(b.getByRole('list', { name: 'Items to quote' })).toBeVisible(T)
      await fillPrice(a, 1, '5000')
      await fillPrice(b, 1, '6000')
      await dialog(b).getByRole('button', { name: 'Issue quotation' }).click()
      await expect(dialog(b).getByTestId('pdf-ready')).toBeVisible({ timeout: 45_000 })
      const aTitle = (await dialog(a).getByRole('heading').first().innerText()).trim()
      const aShown = await dialog(a).getByTestId('total-net').innerText()
      await dialog(a).getByRole('button', { name: /^Issue (revised )?quotation$/ }).click()
      const done = dialog(a).getByRole('heading', { name: /issued$/ })
      await expect(done).toBeVisible({ timeout: 45_000 })
      const doneTitle = await done.innerText()
      const qs = await quotationsOf(r.rfq.id)
      note(info, {
        kind: 'observation',
        where: `${W} stale issue`,
        what: `tab A still titled "${aTitle}" after tab B issued; A's Issue made ${qs.length === 2 ? `revision ${qs[1].revision}` : `${qs.length} quotations`} ("${doneTitle}") with no warning that one had just been issued`,
        detail: qs.map(q => ({ n: q.number, rev: q.revision, net: q.net_total })),
      })
      if (qs.length === 2 && num(qs[1].net_total) !== 20000) note(info, { kind: 'observation', where: `${W} stale issue`, what: `A showed ${aShown} but its quotation stored net ${qs[1].net_total}` })
      await shot(a, `${W}-stale-A-done`)
    })
    await a.close()
    await b.close()
  }

  {
    const cust = await company('Hunt Stale Qty Customer')
    const r = await rfq({ customer: cust, items: [{ description: `Hunt level transmitter radar ${tag()}`, qty: 4 }] })
    await quote(r.rfq.id, sup, [{ itemId: r.items[0].id, price: 800 }])
    const a = await openPage(ctx, info, `/rfqs/${r.rfq.id}?issue=1`, `${W}/qty`)
    await probe(info, a, `${W} quantity changed under an open dialog`, async () => {
      await expect(a.getByRole('list', { name: 'Items to quote' })).toBeVisible(T)
      await fillPrice(a, 1, '1000')
      const shown = await dialog(a).getByTestId('total-gross').innerText() // 4 x 1,000 = 4,000 + 720 = 4,720
      // Someone else corrects the quantity to 5 meanwhile.
      await db.patch(`rfq_items?id=eq.${r.items[0].id}`, { qty: 5 })
      await dialog(a).getByRole('button', { name: 'Issue quotation' }).click()
      await expect(dialog(a).getByTestId('pdf-ready')).toBeVisible({ timeout: 45_000 })
      const [q] = await quotationsOf(r.rfq.id)
      const stored = num(q.net_total) + num(q.gst_total)
      if (`PKR ${amount(stored)}` !== shown)
        note(info, { kind: 'observation', where: `${W} quantity changed under an open dialog`, what: `the dialog showed ${shown} but the issued quotation (and its PDF) says PKR ${amount(stored)}: issued from a quantity the person never saw` })
    })
    await a.close()
  }
  await ctx.close()
})

// ================================================================================================ 6. close, reopen, won

const REASONS = [
  ['competitor', 'The customer chose a competitor'],
  ['price', 'Price too high'],
  ['no_reply_to_clarification', 'No reply to our questions'],
  ['customer_cancelled', 'The customer cancelled'],
  ['could_not_source', 'We could not source it'],
  ['we_were_late', 'We were too late'],
  ['other', 'Another reason'],
] as const

async function closeWith(page: Page, label: string): Promise<void> {
  await moreButton(page).click()
  await page.getByRole('menuitem', { name: new RegExp(`^${label}`) }).click()
  await expect(toast(page, 'Closed').first()).toBeVisible(T)
}

async function rfqRow(id: string): Promise<RfqRow> {
  return db.one<RfqRow>(`rfqs?id=eq.${id}&select=id,number,closed_on,close_reason,quoted_on`)
}

async function winFromLost(page: Page, info: TestInfo, rfqId: string, W: string, vp: Viewport): Promise<void> {
  const won = vis(page.locator('[data-slot="mark-won"]').getByRole('button', { name: 'Mark won' }))
  await won.click()
  const d = page.getByRole('dialog', { name: 'Mark won' })
  await expect(d.getByRole('group', { name: 'Suppliers by line' })).toBeVisible(T)
  await layout(page, info, `${W} mark won dialog`)
  await shot(page, `${W}-mark-won-dialog`)
  // Back with the dialog open.
  await page.goBack()
  await settle(page)
  const url = page.url().replace(/^https?:\/\/[^/]+/, '')
  const open = await d.isVisible().catch(() => false)
  if (!url.startsWith(`/rfqs/${rfqId}`) || open) note(info, { kind: 'observation', where: `${W} Back with Mark won open`, what: `after Back: url ${url}, dialog ${open ? 'still open' : 'closed'}` })
  if (!url.startsWith(`/rfqs/${rfqId}`)) await visit(page, info, `/rfqs/${rfqId}`, W)
  if (!(await d.isVisible().catch(() => false))) await vis(page.locator('[data-slot="mark-won"]').getByRole('button', { name: 'Mark won' })).click()
  await expect(d.getByRole('group', { name: 'Suppliers by line' })).toBeVisible(T)
  const create = d.getByRole('button', { name: 'Create order' })
  if (vp === 'phone') await create.scrollIntoViewIfNeeded()
  await create.dblclick()
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/, T)
  await settle(page)
  await layout(page, info, `${W} order`)
  await shot(page, `${W}-order`)
}

test('close and win: every close reason and Reopen, won from lost with Back and a double Create order, desktop and phone', async ({ browser }, info) => {
  test.setTimeout(300_000)
  const today = karachiDay(0)
  for (const vp of ['desktop', 'phone'] as Viewport[]) {
    const W = `close/${vp}`
    const t = tag()
    const r = await quotedRfq({
      items: [
        { description: `Hunt gas detector ${t}`, qty: 2, price: 50000, supplierPrice: 40000 },
        { description: `Hunt installation ${t}`, qty: 1.5, price: 1000, supplierPrice: 700, gst: 0 },
      ],
    })
    const ctx = await ctxAs(browser, info, 'sales', vp)
    // The RFQ list first, so Back (with Mark won open) has a real page to go to.
    const page = await openPage(ctx, info, '/rfqs', `sales/${vp}`)
    await visit(page, info, `/rfqs/${r.rfq.id}`, `sales/${vp}`)
    await layout(page, info, `${W} open rfq`)
    await shot(page, `${W}-open-rfq`)
    const reasons = vp === 'desktop' ? REASONS : REASONS.filter(([k]) => k === 'could_not_source' || k === 'other')
    for (const [key, label] of reasons) {
      await probe(info, page, `${W} close: ${key}`, async () => {
        await closeWith(page, label)
        await expect.poll(async () => (await rfqRow(r.rfq.id)).close_reason, T).toBe(key)
        const row = await rfqRow(r.rfq.id)
        if (row.closed_on !== today) note(info, { kind: 'observation', where: `${W} close: ${key}`, what: `closed_on is ${row.closed_on}, expected ${today}` })
        await expect(page.getByText(new RegExp(`Closed .*: ${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.`)).first()).toBeVisible(T)
        if (key === 'other' || vp === 'phone') {
          await layout(page, info, `${W} closed`)
          await shot(page, `${W}-closed-${key}`)
        }
        await vis(page.getByRole('button', { name: 'Reopen', exact: true })).click()
        await expect.poll(async () => (await rfqRow(r.rfq.id)).closed_on, T).toBeNull()
        const after = await rfqRow(r.rfq.id)
        if (after.close_reason !== null) note(info, { kind: 'observation', where: `${W} reopen after ${key}`, what: `reopened but close_reason is still ${after.close_reason}` })
        await page.waitForTimeout(300)
      })
    }
    await probe(info, page, `${W} won from lost`, async () => {
      await closeWith(page, 'Price too high')
      await expect.poll(async () => (await rfqRow(r.rfq.id)).close_reason, T).toBe('price')
      await winFromLost(page, info, r.rfq.id, W, vp)
      await page.waitForTimeout(1500)
      const orders = await db.rows<{ id: string }>(`orders?rfq_id=eq.${r.rfq.id}&select=id`)
      if (orders.length !== 1) note(info, { kind: 'observation', where: `${W} double Create order`, what: `${orders.length} orders for one RFQ` })
      const lines = await db.rows<{ qty: number; unit_price_net: number; gst_rate: number }>(`order_items?order_id=eq.${orders[0].id}&select=qty,unit_price_net,gst_rate&order=position,created_at`)
      const got = lines.map(l => [num(l.qty), num(l.unit_price_net), num(l.gst_rate)])
      if (JSON.stringify(got) !== JSON.stringify([[2, 50000, 18], [1.5, 1000, 0]])) note(info, { kind: 'observation', where: `${W} won from lost`, what: 'order lines differ from the quoted lines', detail: got })
      const row = await rfqRow(r.rfq.id)
      if (row.closed_on !== null || row.close_reason !== null)
        note(info, { kind: 'observation', where: `${W} won from lost`, what: `the RFQ is won with an order but still carries closed_on ${row.closed_on} / close_reason ${row.close_reason} (lost-reason reports would count it)` })
      // The RFQ page after winning: does it still say lost anywhere?
      await visit(page, info, `/rfqs/${r.rfq.id}`, W)
      const text = await main(page)
      if (/Closed .*Price too high/.test(text)) note(info, { kind: 'observation', where: `${W} won from lost`, what: 'the RFQ page still says it was closed for price after winning' })
      await shot(page, `${W}-rfq-after-win`)
    })
    await ctx.close()
  }
})

// ================================================================================================ pinned bugs (HW-n)
/*
 * Each confirmed bug as its own minimal test. The setup runs normally (a broken setup fails red); test.fail() is declared right
 * before the one expect() that states the correct behaviour, so the test turns red ("expected to fail") once the bug is fixed.
 */

async function hwPage(browser: Browser, info: TestInfo, path: string, label: string, vp: Viewport = 'desktop'): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await ctxAs(browser, info, 'sales', vp)
  const page = await openPage(ctx, info, path, label)
  return { ctx, page }
}

/** An RFQ whose items all have a PKR supplier price, so Issue quotation includes every item. */
async function pricedRfq(items: { description: string; qty: number; gst?: number }[], prices: number[]) {
  const r = await rfq({ items })
  const sup = await supplier('Hunt HW Stockist', 'Pakistan')
  await quote(r.rfq.id, sup, r.items.map((it, i) => ({ itemId: it.id, price: prices[i] })))
  return r
}

test('HW-1: typed comma-decimal supplier prices are stored wrong ("1.234,50" -> 1.2345, "12,5" -> 125), no warning', async ({ browser }, info) => {
  const t = tag()
  const r = await rfq({ items: [{ description: `Hunt HW1 flow meter ${t}`, qty: 1 }, { description: `Hunt HW1 pressure gauge ${t}`, qty: 1 }] })
  const de = await supplier('Hunt HW1 Messtechnik GmbH', 'Germany')
  await quote(r.rfq.id, de, [])
  const { ctx, page } = await hwPage(browser, info, `/rfqs/${r.rfq.id}`, 'HW-1')
  const box = page.getByRole('region', { name: de.name, exact: true })
  await box.getByLabel(`Price for item 1 from ${de.name}`).fill('1.234,50')
  await box.getByLabel(`Price for item 2 from ${de.name}`).fill('12,5')
  await box.getByRole('button', { name: 'Save reply' }).click()
  await expect.poll(async () => (await linesOf(r.rfq.id, de.id)).length, T).toBe(2)
  const lines = await linesOf(r.rfq.id, de.id)
  const stored = r.items.map(it => num(lines.find(l => l.rfq_item_id === it.id)?.unit_price))
  expect(stored).toEqual([1234.5, 12.5])
  await ctx.close()
})

test('HW-2: a 22-digit price crashes the Issue quotation dialog', async ({ browser }, info) => {
  const r = await pricedRfq([{ description: `Hunt HW2 valve ${tag()}`, qty: 1 }], [1000])
  const { ctx, page } = await hwPage(browser, info, `/rfqs/${r.rfq.id}?issue=1`, 'HW-2')
  await expect(page.getByRole('list', { name: 'Items to quote' })).toBeVisible(T)
  await dialog(page).getByLabel('Unit price, net PKR, item 1').fill('9999999999999999999999')
  await page.waitForTimeout(800)
  test.fail(true, 'HW-2: computeTotals throws "Not a decimal amount: 1e+22" while rendering; the dialog is replaced by the error screen')
  await expect(page.getByRole('list', { name: 'Items to quote' })).toBeVisible({ timeout: 5_000 })
  await ctx.close()
})

test('HW-3: a quantity changed while the Issue quotation dialog is open is issued at a total the dialog never showed', async ({ browser }, info) => {
  const r = await pricedRfq([{ description: `Hunt HW3 radar level transmitter ${tag()}`, qty: 4 }], [800])
  const { ctx, page } = await hwPage(browser, info, `/rfqs/${r.rfq.id}?issue=1`, 'HW-3')
  await expect(page.getByRole('list', { name: 'Items to quote' })).toBeVisible(T)
  await fillPrice(page, 1, '1000')
  const shown = await dialog(page).getByTestId('total-gross').innerText() // 4 x 1,000 + 18% = PKR 4,720
  expect(shown).toBe('PKR 4,720')
  await db.patch(`rfq_items?id=eq.${r.items[0].id}`, { qty: 5 }) // someone else corrects the quantity
  await dialog(page).getByRole('button', { name: 'Issue quotation' }).click()
  await expect(dialog(page).getByTestId('pdf-ready')).toBeVisible({ timeout: 45_000 })
  const [q] = await quotationsOf(r.rfq.id)
  test.fail(true, 'HW-3: the dialog totals use the quantities it loaded, issue_quotation snapshots the stored ones (5 x 1,000 + GST = 5,900), no warning')
  expect(`PKR ${amount(num(q.net_total) + num(q.gst_total))}`).toBe(shown)
  await ctx.close()
})

test('HW-4: a stale tab issues a revision with no warning that a quotation was just issued from another tab', async ({ browser }, info) => {
  const r = await pricedRfq([{ description: `Hunt HW4 control valve ${tag()}`, qty: 4 }], [4000])
  const { ctx, page: a } = await hwPage(browser, info, `/rfqs/${r.rfq.id}?issue=1`, 'HW-4/A')
  const b = await openPage(ctx, info, `/rfqs/${r.rfq.id}?issue=1`, 'HW-4/B')
  await expect(a.getByRole('list', { name: 'Items to quote' })).toBeVisible(T)
  await expect(b.getByRole('list', { name: 'Items to quote' })).toBeVisible(T)
  await fillPrice(a, 1, '5000')
  await fillPrice(b, 1, '6000')
  await dialog(b).getByRole('button', { name: 'Issue quotation' }).click()
  await expect(dialog(b).getByTestId('pdf-ready')).toBeVisible({ timeout: 45_000 })
  await dialog(a).getByRole('button', { name: /^Issue (revised )?quotation$/ }).click()
  // Either the issued screen, or (once fixed) a warning that one was just issued.
  await Promise.race([
    dialog(a).getByRole('heading', { name: /issued$/ }).waitFor({ timeout: 45_000 }),
    dialog(a).getByText(/already|just issued|another tab|was issued/i).first().waitFor({ timeout: 45_000 }),
  ]).catch(() => undefined)
  const qs = await quotationsOf(r.rfq.id)
  test.fail(true, 'HW-4: tab A still says "Issue quotation" and silently makes revision 1 over the quotation tab B just issued')
  expect(qs).toHaveLength(1)
  await ctx.close()
})

test('HW-5: a pasted reply line "price on request" is stored as a price (the "2" of "2 core" in the item name)', async ({ browser }, info) => {
  const t = tag()
  const d = [`Hunt HW5 magnetic flow meter DN50 ${t}`, `Hunt HW5 instrument cable 2 core ${t}`]
  const r = await rfq({ items: [{ description: d[0], qty: 4 }, { description: d[1], qty: 10, unit: 'm' }] })
  const de = await supplier('Hunt HW5 Alpenwerk GmbH', 'Germany')
  await quote(r.rfq.id, de, [])
  const { ctx, page } = await hwPage(browser, info, `/rfqs/${r.rfq.id}`, 'HW-5')
  const reply = ['Dear Sir,', 'Our offer:', `${d[0]} - EUR 1.234,50 each, delivery 3-4 weeks`, `${d[1]} - price on request`, 'Best regards, Hans'].join('\n')
  await page.evaluate(x => navigator.clipboard.writeText(x), reply)
  await page.getByRole('region', { name: de.name, exact: true }).getByRole('button', { name: 'Paste reply' }).click()
  const panel = page.getByRole('region', { name: `Read from the reply of ${de.name}` })
  await expect(panel).toBeVisible(T)
  await panel.getByRole('button', { name: /^Accept \d+ prices?$/ }).click()
  await expect.poll(async () => (await linesOf(r.rfq.id, de.id)).length, T).toBeGreaterThan(0)
  await page.waitForTimeout(1000)
  const lines = await linesOf(r.rfq.id, de.id)
  expect(lines.find(l => l.rfq_item_id === r.items[1].id)).toBeUndefined()
  await ctx.close()
})

// HW-6 (double-click on Looks right skips the suppliers step) was seen in run 1 but did not reproduce in run 2: not pinned.

test('HW-7: an enquiry quantity of 0 is read as 1 and saved as 1, with no warning', async ({ browser }, info) => {
  const cust = await company('Hunt HW7 Customer')
  const { ctx, page } = await hwPage(browser, info, '/today', 'HW-7')
  await startIntake(page, info, cust)
  await pasteOnPage(page, { text: [`Pressure gauge 0-16 bar ${tag()} - 2 nos`, `Thermowell SS316 ${tag()} - 0 nos`].join('\n') })
  const qty = page.getByRole('textbox', { name: 'Quantity of item 2', exact: true })
  await expect(page.getByRole('textbox', { name: 'Description of item 2', exact: true })).toHaveValue(/Thermowell SS316/, T)
  await expect(qty).not.toHaveValue('1 no', { timeout: 3_000 })
  await ctx.close()
})

test('HW-8: a unit price of 0 can be issued on a quotation with no warning', async ({ browser }, info) => {
  const r = await pricedRfq([{ description: `Hunt HW8 gas detector ${tag()}`, qty: 2 }], [40000])
  const { ctx, page } = await hwPage(browser, info, `/rfqs/${r.rfq.id}?issue=1`, 'HW-8')
  await expect(page.getByRole('list', { name: 'Items to quote' })).toBeVisible(T)
  await fillPrice(page, 1, '0')
  await expect(dialog(page).getByTestId('total-net')).toHaveText('PKR 0', T)
  test.fail(true, 'HW-8: min={0} and quoted_unit_price_net >= 0, so a free line can go out on a customer quotation')
  await expect(dialog(page).getByRole('button', { name: 'Issue quotation' })).toBeDisabled({ timeout: 3_000 })
  await ctx.close()
})

test('HW-9: Back with the Issue quotation dialog open leaves the RFQ page and discards the typed prices without asking', async ({ browser }, info) => {
  const r = await pricedRfq([{ description: `Hunt HW9 flow computer ${tag()}`, qty: 1 }], [90000])
  const { ctx, page } = await hwPage(browser, info, '/rfqs', 'HW-9')
  await visit(page, info, `/rfqs/${r.rfq.id}`, 'HW-9')
  await openIssue(page, info, r.rfq.id, 'HW-9')
  await fillPrice(page, 1, '125000')
  await page.goBack()
  await settle(page)
  test.fail(true, 'HW-9: ?issue=1 is set with replace: true, so Back leaves the RFQ page (to /rfqs) and the typed price is lost; a reload loses it too')
  await expect(page).toHaveURL(new RegExp(`/rfqs/${r.rfq.id}`), { timeout: 3_000 })
  await ctx.close()
})

test('HW-10: an over-large intake quantity is refused with only "Nothing was saved." and no reason', async ({ browser }, info) => {
  const cust = await company('Hunt HW10 Customer')
  const { ctx, page } = await hwPage(browser, info, '/today', 'HW-10')
  await startIntake(page, info, cust)
  await pasteOnPage(page, { text: `Level switch vibrating fork ${tag()} - 5 nos` })
  const q = page.getByRole('textbox', { name: 'Quantity of item 1', exact: true })
  await q.fill('99999999999 nos')
  await q.blur()
  await vis(page.getByRole('button', { name: 'Save without asking' })).click()
  const said = page.getByText(/Nothing was saved/).first()
  await expect(said).toBeVisible(T)
  const banner = said.locator('xpath=ancestor::div[contains(@class,"rounded")][1]')
  await expect(banner).toContainText(/quantit/i, { timeout: 3_000 })
  await ctx.close()
})

test('HW-43: a refused Issue quotation still changes the item prices (Mark won then offers a price never quoted)', async ({ browser }, info) => {
  const r = await pricedRfq([{ description: `Hunt HW43 pressure transmitter ${tag()}`, qty: 2.5 }], [1000])
  const { ctx, page } = await hwPage(browser, info, `/rfqs/${r.rfq.id}?issue=1`, 'HW-43')
  await expect(page.getByRole('list', { name: 'Items to quote' })).toBeVisible(T)
  await fillPrice(page, 1, '1300')
  await dialog(page).getByRole('button', { name: 'Issue quotation' }).click()
  await expect(dialog(page).getByTestId('pdf-ready')).toBeVisible({ timeout: 45_000 })
  await dialog(page).getByRole('button', { name: 'Done' }).click()
  expect(num((await itemsOf(r.rfq.id))[0].quoted_unit_price_net)).toBe(1300)
  // Revise at 999,999,999,999: it fits rfq_items (numeric(14,2)) but 2.5 x it overflows quotations.net_total, so the issue is refused.
  await openReviseFromMenu(page)
  await fillPrice(page, 1, '999999999999')
  await dialog(page).getByRole('button', { name: 'Issue revised quotation' }).click()
  await expect(dialog(page).getByText('Could not issue the quotation')).toBeVisible({ timeout: 30_000 })
  expect(await quotationsOf(r.rfq.id)).toHaveLength(1)
  const price = num((await itemsOf(r.rfq.id))[0].quoted_unit_price_net)
  test.fail(true, 'HW-43: issueQuotation updates rfq_items before the issue_quotation RPC, so a refused issue leaves a price no quotation carries (and Mark won uses it)')
  expect(price).toBe(1300)
  await ctx.close()
})
