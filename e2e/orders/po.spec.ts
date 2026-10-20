import { test, type Page } from '@playwright/test'
import { karachiDay, must, openAs, rest } from '../support/stack'
import { axeViolations } from '../support/axe'
import { fetchStoredPdf, pdfIsValid, pdfText, renderPdfPng } from '../support/pdf'
import { expect, get, legLoc, seedPo, setProfile, shot, tapper } from './fixtures'

/*
 * O07 end to end, against the local CI stack: "Issue PO" on a supplier order, the dialog with each line's price and where it came from, the PO
 * stored with its PDF, the PO chip and View PO on the leg, and a re-issue as the next revision. As the fixture users through the real
 * login form; every test seeds its own customer, supplier and orders.
 *
 * FE-2 target asserted here: issue a PO with every line priced = 2 taps (Issue PO on the leg, Issue PO in the dialog), nothing typed.
 */

const dialogViolations = (page: Page) => axeViolations(page, { landmarks: false })
const dialog = (page: Page) => page.getByRole('dialog')
const price = (page: Page, n: number) => dialog(page).getByLabel(`Unit price, line ${n}`)

interface PoRow {
  id: string
  number: number
  revision: number
  currency: string
  total: number
  incoterm: string | null
  delivery_terms: string | null
  payment_terms: string | null
  ship_to: string | null
  pdf_path: string | null
  lines: Array<{ order_item_id: string; unit_price: number; price_source: string; qty: number }>
}
const posOf = (leg: string) => get<PoRow>(`purchase_orders?supplier_order_id=eq.${leg}&select=id,number,revision,currency,total,incoterm,delivery_terms,payment_terms,ship_to,pdf_path,lines&order=revision`)

test.describe('O07: Issue PO', () => {
  test('every line carries its price source; the terms come from the last PO; one typed price, then Issue; the PO, its PDF, the written-back prices and the placed stamp are stored', async ({ page }) => {
    const s = await seedPo()
    await openAs(page, 'sales', `/orders/${s.order.id}`)
    await expect(legLoc(page, 'A').getByTestId('leg-A-po')).toHaveText('No PO yet')
    await legLoc(page, 'A').getByRole('button', { name: `Issue PO, ${s.supplier.name}` }).click()

    const d = dialog(page)
    await expect(d.getByRole('heading', { name: 'Issue purchase order' })).toBeVisible()
    await expect(d).toContainText(`${s.supplier.name} · for ORD-`)
    // the currency is the leg's and cannot be changed here
    await expect(d.getByLabel('Currency')).toHaveValue('USD')
    await expect(d.getByLabel('Currency')).toHaveJSProperty('readOnly', true)
    await expect(d).toContainText('Set on this supplier order, not here.')
    // incoterm and terms from the supplier's last PO, each with where it came from; ship-to from the profile
    await expect(d.getByLabel('Incoterm')).toHaveValue('DAP')
    await expect(d.getByLabel('Delivery terms')).toHaveValue('Air freight, 3 weeks')
    await expect(d.getByLabel('Payment terms')).toHaveValue('Advance on order, balance before dispatch')
    await expect(d.getByLabel('Ship to')).toHaveValue(/Gulberg III/)
    await expect(d).toContainText(`from ${s.lastPoRef}`)
    await expect(d).toContainText('Q-Tech office, default')

    // the four sources, in the order the lines are on the order
    await expect(d.getByTestId('po-source-1')).toContainText('order')
    await expect(d.getByTestId('po-source-1')).toContainText('Agreed on the order')
    await expect(price(page, 1)).toHaveValue('612.00')
    await expect(d.getByTestId('po-source-2')).toContainText('last PO')
    await expect(d.getByTestId('po-source-2')).toContainText(s.lastPoRef)
    await expect(price(page, 2)).toHaveValue('742.00')
    await expect(d.getByTestId('po-source-3')).toContainText('quote')
    await expect(d.getByTestId('po-source-3')).toContainText('Their quote, RFQ-')
    await expect(price(page, 3)).toHaveValue('214.00')
    await expect(d.getByTestId('po-source-4')).toContainText('typed')
    await expect(d.getByTestId('po-source-4')).toContainText('Type a price')
    // a line nothing knows a price for holds the button until it has one
    await expect(d.getByRole('button', { name: 'Issue PO' })).toBeDisabled()
    await expect(d.getByTestId('po-missing')).toContainText('One line needs a price')
    await shot(page, 'o07-issue-po-dialog-1440')

    await price(page, 4).fill('18.50')
    await expect(d.getByTestId('po-source-4')).toContainText('Typed by you, check it')
    // 3 x 612 + 2 x 742 + 2 x 214 + 8 x 18.50 = 1,836 + 1,484 + 428 + 148
    await expect(d.getByTestId('po-total')).toContainText('USD 3,896.00')
    // an edited price becomes typed, and the totals move
    await price(page, 1).fill('600')
    await expect(d.getByTestId('po-source-1')).toContainText('typed')
    await price(page, 1).fill('612')
    await expect(d.getByTestId('po-source-1')).toContainText('order')

    await d.getByRole('button', { name: 'Issue PO' }).click()
    await expect(dialog(page)).toHaveCount(0, { timeout: 30_000 })
    await expect(page.getByText(/^Issued PO-\d\d-\d{4} · R0/)).toBeVisible()

    const [po] = await posOf(s.leg)
    expect(po.revision).toBe(0)
    expect(po.currency).toBe('USD')
    expect(Number(po.total)).toBe(3896)
    expect(po.incoterm).toBe('DAP')
    expect(po.delivery_terms).toBe('Air freight, 3 weeks')
    expect(po.payment_terms).toBe('Advance on order, balance before dispatch')
    expect(po.ship_to).toMatch(/Gulberg III/)
    expect(po.lines.map(l => l.price_source)).toEqual(['order', 'last_po', 'quote', 'typed'])
    expect(po.lines.map(l => Number(l.unit_price))).toEqual([612, 742, 214, 18.5])
    // the issued prices are written back to the order lines, the leg is placed today
    const items = await get<{ position: number; supplier_unit_price: number | null }>(`order_items?order_id=eq.${s.order.id}&select=position,supplier_unit_price&order=position`)
    expect(items.slice(0, 4).map(i => Number(i.supplier_unit_price))).toEqual([612, 742, 214, 18.5])
    // (the expected date is suggested from the quoted lead time, 2 wks, once the PO is placed)
    await expect.poll(async () => (await get<{ placed_on: string | null; expected_on: string | null }>(`supplier_orders?id=eq.${s.leg}&select=placed_on,expected_on`))[0]).toMatchObject({ placed_on: karachiDay(0), expected_on: karachiDay(14) })

    // the PDF is stored at {po_id}/{revision}.pdf and is a real PO
    expect(po.pdf_path).toBe(`${po.id}/0.pdf`)
    const stored = await fetchStoredPdf('sales', 'generated-docs', po.pdf_path as string)
    expect(pdfIsValid(stored)).toBe(true)
    const text = stored ? pdfText(stored) : null
    if (text) {
      expect(text).toContain('Purchase order')
      expect(text).toContain(`PO-${karachiDay(0).slice(2, 4)}-${String(po.number).padStart(4, '0')}`)
      expect(text).toContain(s.supplier.name)
      expect(text).toContain('Q-Tech Solutions (Pvt) Ltd')
      expect(text).toContain('USD 3,896.00')
      expect(text).toContain('Three thousand eight hundred ninety-six US dollars only.')
      expect(text).toContain('DAP')
      expect(text).toContain('Attention: Mr. Rashid Al Mansoori')
    }
    if (stored && process.env.REVIEW_DIR) renderPdfPng(stored, process.env.REVIEW_DIR, 'o07-po-pdf-r0-page1')

    // the supplier order shows the PO chip; View PO and the next revision are in its menu
    await expect(legLoc(page, 'A').getByTestId('leg-A-po')).toHaveText(/^PO-\d\d-\d{4} · R0$/)
    await legLoc(page, 'A').getByRole('button', { name: `More for ${s.supplier.name}` }).click()
    await expect(page.getByRole('menuitem', { name: 'View PO' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Revise PO (R1)' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(legLoc(page, 'A').getByTestId('leg-A-state')).toContainText('On order')
    await shot(page, 'o07-leg-with-po-1440')
  })

  test('issue a PO with every line priced: 2 taps, nothing typed', async ({ page }) => {
    const s = await seedPo({ allPriced: true })
    const t = tapper()
    await openAs(page, 'sales', `/orders/${s.order.id}`)
    await t.tap(legLoc(page, 'A').getByRole('button', { name: `Issue PO, ${s.supplier.name}` }))
    await expect(dialog(page).getByTestId('po-source-1')).toBeVisible()
    await expect(dialog(page).getByTestId('po-missing')).toHaveCount(0)
    await t.doubleTap(dialog(page).getByRole('button', { name: 'Issue PO' }))
    await expect(dialog(page)).toHaveCount(0, { timeout: 30_000 })
    expect(t.count).toBe(2)
    // a double tap still issues exactly one PO
    expect(await posOf(s.leg)).toHaveLength(1)
  })

  test('re-issue makes the next revision under the same number; the PDF of each revision is kept', async ({ page }) => {
    const s = await seedPo({ allPriced: true })
    await openAs(page, 'admin', `/orders/${s.order.id}`)
    await legLoc(page, 'A').getByRole('button', { name: `Issue PO, ${s.supplier.name}` }).click()
    await dialog(page).getByRole('button', { name: 'Issue PO' }).click()
    await expect(dialog(page)).toHaveCount(0, { timeout: 30_000 })
    await legLoc(page, 'A').getByRole('button', { name: `More for ${s.supplier.name}` }).click()
    const button = page.getByRole('menuitem', { name: 'Revise PO (R1)' })
    await expect(button).toBeVisible()
    await button.click()
    await expect(dialog(page).locator('.num').filter({ hasText: /^PO-\d\d-\d{4} · R1$/ })).toBeVisible()
    // the price written back by the first issue is now the order's own
    await expect(dialog(page).getByTestId('po-source-1')).toContainText('order')
    await price(page, 1).fill('650')
    await dialog(page).getByRole('button', { name: 'Issue PO' }).click()
    await expect(dialog(page)).toHaveCount(0, { timeout: 30_000 })
    const pos = await posOf(s.leg)
    expect(pos.map(p => p.revision)).toEqual([0, 1])
    expect(pos[1].number).toBe(pos[0].number)
    expect(pos[1].lines[0].unit_price).toBe(650)
    expect(pos[0].lines[0].unit_price).toBe(612)
    expect(pos[1].pdf_path).toBe(`${pos[1].id}/1.pdf`)
    expect(pdfIsValid(await fetchStoredPdf('admin', 'generated-docs', pos[1].pdf_path as string))).toBe(true)
    await expect(legLoc(page, 'A').getByTestId('leg-A-po')).toHaveText(/R1$/)
  })

  test('a leg with no currency asks for one before it can be priced; with the profile incomplete the PO is still issued and says why there is no PDF', async ({ page }) => {
    const s = await seedPo({ allPriced: true })
    await must(rest('admin', `supplier_orders?id=eq.${s.leg}`, { method: 'PATCH', body: { currency: null }, prefer: 'return=minimal' }))
    await setProfile(false)
    await openAs(page, 'sales', `/orders/${s.order.id}`)
    await legLoc(page, 'A').getByRole('button', { name: `Issue PO, ${s.supplier.name}` }).click()
    const d = dialog(page)
    await expect(d.getByRole('button', { name: 'Issue PO' })).toBeDisabled()
    await d.getByLabel('Currency').selectOption('USD')
    await expect.poll(async () => (await get<{ currency: string | null }>(`supplier_orders?id=eq.${s.leg}&select=currency`))[0].currency).toBe('USD')
    await expect(d.getByLabel('Currency')).toHaveValue('USD')
    await expect(d).toContainText('company\'s legal name and address')
    await shot(page, 'o07-issue-po-profile-gap-1440')
    await d.getByRole('button', { name: 'Issue PO' }).click()
    await expect(dialog(page)).toHaveCount(0, { timeout: 30_000 })
    await expect(page.getByText(/Add the legal name and address in Settings, Company to make its PDF/)).toBeVisible()
    const [po] = await posOf(s.leg)
    expect(po.pdf_path).toBeNull()
    await setProfile(true)
  })

  test('Preview PDF opens a PDF without issuing anything', async ({ page, context }) => {
    const s = await seedPo({ allPriced: true })
    await openAs(page, 'sales', `/orders/${s.order.id}`)
    await legLoc(page, 'A').getByRole('button', { name: `Issue PO, ${s.supplier.name}` }).click()
    // headless Chromium has no PDF viewer: pointing the new tab at the PDF makes it a download, which is the proof that a PDF was made
    let downloaded = 0
    context.on('page', p => p.on('download', () => downloaded++))
    await dialog(page).getByRole('button', { name: 'Preview PDF' }).click()
    await expect.poll(() => downloaded, { timeout: 30_000 }).toBeGreaterThan(0)
    expect(await posOf(s.leg)).toHaveLength(0)
  })

  test('Pay <supplier> on a supplier order opens the M03 dialog with this order and supplier order, the supplier as payee', async ({ page }) => {
    const s = await seedPo({ allPriced: true })
    await openAs(page, 'admin', `/orders/${s.order.id}`)
    await legLoc(page, 'A').getByRole('button', { name: `More for ${s.supplier.name}` }).click()
    await page.getByRole('menuitem', { name: `Pay ${s.supplier.name}` }).click()
    const d = dialog(page)
    await expect(d.getByRole('heading', { name: /expense/i })).toBeVisible()
    await expect(d).toContainText(s.supplier.name)
    await expect(d.getByRole('combobox', { name: 'Category' })).toHaveValue('Supplier payment')
  })

  test('an engineer never sees Issue PO, View PO or a price, but does see the PO chip', async ({ page }) => {
    const s = await seedPo({ allPriced: true })
    await must(rest('admin', 'rpc/issue_purchase_order', { method: 'POST', body: { p_po_id: crypto.randomUUID(), p_supplier_order_id: s.leg } }))
    await openAs(page, 'engineer', `/orders/${s.order.id}`)
    await expect(legLoc(page, 'A').getByTestId('leg-A-po')).toHaveText(/^PO-\d\d-\d{4} · R0$/)
    await expect(page.getByRole('button', { name: /Issue PO|View PO|Revise PO/ })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: /View PO|Revise PO/ })).toHaveCount(0)
  })

  for (const width of [1440, 375]) {
    test(`axe (WCAG 2.2 AA) and review screenshots at ${width}: the Issue PO dialog`, async ({ page }) => {
      const s = await seedPo()
      await page.setViewportSize({ width, height: width > 800 ? 900 : 812 })
      await openAs(page, 'sales', `/orders/${s.order.id}`)
      await legLoc(page, 'A').getByRole('button', { name: `Issue PO, ${s.supplier.name}` }).click()
      await expect(dialog(page).getByTestId('po-source-4')).toBeVisible()
      expect(await dialogViolations(page)).toEqual([])
      await shot(page, `o07-issue-po-dialog-axe-${width}`)
    })
  }
})
