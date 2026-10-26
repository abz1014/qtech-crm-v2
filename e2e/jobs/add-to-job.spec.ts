import { expect, test, type Page } from '@playwright/test'
import { createCompany, createRfq, karachiDay, must, openAs, rest, uniqueName } from '../support/stack'

/*
 * Add to this job (P4-B, redesign phase 4): a supplier's WhatsApp price pasted on the job page is read, matched to the supplier it
 * came from, and "Accept 2 prices" saves it to that supplier's lines. Fictional customer, suppliers and prices.
 */
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function seed() {
  const customer = await createCompany(uniqueName('Kohsar Cement'), { city: 'Abbottabad' })
  const rfq = await createRfq(customer.id, { due_on: karachiDay(6), customer_ref: `A${Math.floor(Math.random() * 90000 + 10000)}` })
  const item = (position: number, description: string, qty: number) =>
    must(rest<{ id: string }[]>('admin', 'rfq_items', { method: 'POST', body: { rfq_id: rfq.id, position, description, qty, unit: 'nos' } }))
  const [first] = await item(0, 'Ultrasonic flowmeter RST 1158S', 2)
  const [second] = await item(1, 'Clamp-on transducer pair DN50', 2)
  const rhein = await createCompany(`Rhein Automation ${Date.now().toString(36)}`, { country: 'Germany' })
  const shanghai = await createCompany(`Shanghai Flowtech ${Date.now().toString(36)}`, { country: 'China' })
  const ask = async (supplierId: string) =>
    (await must(rest<{ id: string }[]>('admin', 'supplier_inquiries', { method: 'POST', body: { rfq_id: rfq.id, supplier_id: supplierId, sent_on: karachiDay(-2) } })))[0]
  const rheinInquiry = await ask(rhein.id)
  const shanghaiInquiry = await ask(shanghai.id)
  return { customer, rfq, first, second, rhein, rheinInquiry, shanghaiInquiry }
}

/** A paste as the browser makes it from the clipboard, on a page with nothing focused. */
async function paste(page: Page, text: string) {
  await page.evaluate(t => {
    const dt = new DataTransfer()
    dt.setData('text/plain', t)
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, text)
}

test('a pasted WhatsApp price is read, matched to the supplier, and Accept saves it to that supplier line', async ({ page }) => {
  const s = await seed()
  const message = [
    `${s.rhein.name.split(' ').slice(0, 2).join(' ')}: dear Ayesha, our offer`,
    '1) Ultrasonic flowmeter RST 1158S EUR 3610 - 8 weeks',
    '2) Clamp-on transducer pair DN50 EUR 980 - 8 weeks',
  ].join('\n')

  await openAs(page, 'sales', `/jobs/${s.rfq.number}`)
  await expect(page.getByRole('region', { name: 'Add to this job' })).toBeVisible()
  await paste(page, message)

  await expect(page.getByTestId('guess-line')).toHaveText(`Supplier price from ${s.rhein.name}`)
  const accept = page.getByRole('button', { name: /^Accept \d+ prices?$/ })
  await expect(accept).toHaveText('Accept 2 prices')
  await accept.click()
  await expect(page.getByRole('status').filter({ hasText: 'Reply saved' })).toBeVisible()

  const lines = await must(rest<{ inquiry_id: string; rfq_item_id: string; unit_price: number; currency: string }[]>('admin', `supplier_quote_lines?inquiry_id=eq.${s.rheinInquiry.id}&select=inquiry_id,rfq_item_id,unit_price,currency&order=unit_price.desc`))
  expect(lines.map(l => [l.rfq_item_id, Number(l.unit_price), l.currency])).toEqual([
    [s.first.id, 3610, 'EUR'],
    [s.second.id, 980, 'EUR'],
  ])
  const other = await must(rest<unknown[]>('admin', `supplier_quote_lines?inquiry_id=eq.${s.shanghaiInquiry.id}&select=id`))
  expect(other).toEqual([])
})

test('a note and a photo are added together with Add note and files', async ({ page }) => {
  const s = await seed()
  await openAs(page, 'sales', `/jobs/${s.rfq.number}`)
  await expect(page.getByRole('region', { name: 'Add to this job' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Paste here' }).fill('Customer wants the PDF datasheet too.')
  await page.getByTestId('add-photo-input').setInputFiles({ name: 'site.png', mimeType: 'image/png', buffer: Buffer.from(PNG_B64, 'base64') })
  await page.getByRole('button', { name: 'Note', exact: true }).click()
  await page.getByRole('button', { name: 'Add note and files' }).click()
  await expect(page.getByRole('status').filter({ hasText: `Added to Job ${s.rfq.number}` })).toBeVisible()
  const notes = await must(rest<{ notes: string | null }[]>('admin', `rfqs?id=eq.${s.rfq.id}&select=notes`))
  expect(notes[0].notes).toContain('Customer wants the PDF datasheet too.')
  const files = await must(rest<{ file_name: string }[]>('admin', `attachments?rfq_id=eq.${s.rfq.id}&select=file_name`))
  expect(files.map(f => f.file_name)).toEqual(['site.png'])
})
