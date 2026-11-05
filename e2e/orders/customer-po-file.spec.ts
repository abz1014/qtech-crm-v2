import { expect, test } from '@playwright/test'
import { createCompany, karachiDay, must, openAs, rest, uniqueName } from '../support/stack'
import { JOB_URL, openStage } from '../support/job'

/*
 * The customer's PO document on an order (0134). Sales attaches a PDF and a photo on the Order stage, sees "PO file: name" and downloads
 * it; both rows are is_customer_po with has_prices true (a photographed PO shows prices too). An engineer on the same job never gets the
 * file: not in the page, not in any response, not as a row. Synthetic data only. (The supplier-PO spec is po.spec.ts.)
 */
const ENGINEER = 'a0000000-0000-4000-8000-000000000003'
const unique = () => Math.random().toString(36).slice(2, 8).toUpperCase()
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')
// a 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

const SALES = 'a0000000-0000-4000-8000-000000000002'

async function seed() {
  const customer = await createCompany(uniqueName('Po File Customer'))
  const [order] = await must(
    rest<{ id: string }[]>('admin', 'orders', { method: 'POST', body: { company_id: customer.id, owner_id: SALES, customer_po_number: `PF-${unique()}`, payment_terms_days: 30, ordered_on: karachiDay(-2) } }),
  )
  await must(rest('admin', 'order_items', { method: 'POST', body: { order_id: order.id, position: 0, description: 'Flow meter DN50', qty: 1, unit_price_net: 100000, gst_rate: 18 }, prefer: 'return=minimal' }))
  await must(rest('admin', 'order_engineers', { method: 'POST', body: { order_id: order.id, user_id: ENGINEER }, prefer: 'return=minimal' }))
  return { id: order.id }
}

test.describe('Customer PO file', () => {
  test('sales attaches a PDF and a photo, sees them and downloads one; an engineer never gets them', async ({ page, browser }) => {
    const o = await seed()
    const pdfName = `customer-po-${unique()}.pdf`
    const pngBase = `customer-po-photo-${unique()}`
    const pngName = `${pngBase}.png`

    await openAs(page, 'sales', `/orders/${o.id}`)
    await expect(page).toHaveURL(JOB_URL)
    const stage = await openStage(page, 'Order')
    await expect(stage.getByRole('button', { name: 'Attach PO file' })).toBeVisible()

    await stage.getByTestId('po-file-input').setInputFiles([
      { name: pdfName, mimeType: 'application/pdf', buffer: PDF },
      { name: pngName, mimeType: 'image/png', buffer: PNG },
    ])
    const list = stage.getByRole('list', { name: 'Customer PO files' })
    await expect(list.getByText(pdfName)).toBeVisible({ timeout: 30_000 })
    // a picture may be re-encoded as .jpg in the browser, so match its base name
    await expect(list.getByText(pngBase)).toBeVisible()
    await expect(list.getByText('PO file:')).toHaveCount(2)

    // download through the signed link
    const link = list.getByRole('link', { name: pdfName })
    const href = await link.getAttribute('href')
    expect(href).toBeTruthy()
    const res = await page.request.get(href as string)
    expect(res.status()).toBe(200)
    expect((await res.body()).subarray(0, 5).toString()).toBe('%PDF-')

    // stored as the customer's PO, with prices, whatever the type
    const rows = await must(rest<{ file_name: string; is_customer_po: boolean; has_prices: boolean; order_id: string }[]>('admin', `attachments?order_id=eq.${o.id}&select=file_name,is_customer_po,has_prices,order_id`))
    expect(rows).toHaveLength(2)
    for (const r of rows) expect(r).toMatchObject({ is_customer_po: true, has_prices: true, order_id: o.id })

    // the Notes and files panel tags them
    await expect(page.getByRole('region', { name: 'Notes and files' }).getByText('Customer PO', { exact: true }).first()).toBeVisible()

    // an engineer: not in the rows, not in any response, not on the screen
    const eng = await browser.newPage()
    const bodies: string[] = []
    eng.on('response', async r => {
      if (!r.url().includes('/rest/v1/') && !r.url().includes('/storage/v1/')) return
      try {
        bodies.push(await r.text())
      } catch {
        // a redirect or a stream has no body
      }
    })
    await openAs(eng, 'engineer', `/orders/${o.id}`)
    await expect(eng).toHaveURL(JOB_URL)
    await expect(eng.locator('[data-stages]')).toBeVisible()
    await eng.waitForLoadState('networkidle')
    const html = await eng.content()
    for (const name of [pdfName, pngBase]) {
      expect(html).not.toContain(name)
      expect(bodies.join('\n')).not.toContain(name)
    }
    await expect(eng.getByRole('button', { name: 'Attach PO file' })).toHaveCount(0)
    await expect(eng.getByRole('button', { name: 'Add file' })).toHaveCount(0)
    const seen = await must(rest<unknown[]>('engineer', `attachments?order_id=eq.${o.id}&select=id`))
    expect(seen).toHaveLength(0)
    await eng.close()
  })
})
