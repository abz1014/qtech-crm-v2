import { expect, test, type Page } from '@playwright/test'
import { letterPdf } from '../../src/test/pdfFixtures'
import { createCompany, must, openAs, rest, uniqueName } from '../support/stack'

/*
 * New enquiry (P4-A, redesign phase 4): a customer's PDF becomes a job in 4 clicks or fewer. The PDF is made here (fictional).
 *   0. drop the PDF anywhere on To do (a drop, not a click)
 *   1. Use <Company>           the company is suggested from the sender's email
 *   2. Create job N            the one green button; the job is saved, nobody is asked yet
 * and the Job page opens. Two clicks after the drop, inside the limit of four.
 */
async function dropFile(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  const data = file.buffer.toString('base64')
  await page.evaluate(
    ({ name, mimeType, data }) => {
      const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0))
      const dt = new DataTransfer()
      dt.items.add(new File([bytes], name, { type: mimeType }))
      for (const type of ['dragenter', 'dragover', 'drop']) document.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }))
    },
    { name: file.name, mimeType: file.mimeType, data },
  )
}

test('a PDF dropped on To do becomes a job in two clicks: Use the company, Create job', async ({ page }) => {
  const domain = `e2e${Date.now().toString(36)}.example.pk`
  const customer = await createCompany(uniqueName('Kohsar Cement'), { city: 'Abbottabad' })
  await must(rest('admin', 'contacts', { method: 'POST', body: { company_id: customer.id, name: 'Buyer', email: `stores@${domain}` } }))
  const ref = `KC-${Math.floor(Math.random() * 90000 + 10000)}`
  const pdf = await letterPdf([
    'Dear Sir,',
    'Please quote your best price for the following:',
    '',
    '1. Level switch LSX-200 24V - 2 Nos',
    '2. Dosing pump DP-90 230V - 1 Nos',
    '',
    `RFQ No: ${ref}`,
    'Quotations must reach us before 30-DEC-30',
    '',
    'Regards,',
    'Purchase Department',
    `purchase@${domain}`,
  ])

  await openAs(page, 'sales', '/todo')
  await page.locator('#main').waitFor()
  await dropFile(page, { name: 'enquiry.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf) })

  // The document on one side, what was read on the other.
  await expect(page).toHaveURL(/\/enquiries\/new$/)
  await expect(page.getByTestId('source-file')).toContainText('enquiry.pdf')
  await expect(page.getByRole('textbox', { name: 'Description of item 1' })).toHaveValue(/^Level switch LSX-200 24V/)
  await expect(page.getByRole('textbox', { name: 'Quantity of item 1' })).toHaveValue('2 nos')
  await expect(page.getByLabel('Customer reference')).toHaveValue(ref)
  // What was read is marked for a second look.
  await expect(page.getByText(/From the PDF, check this/).first()).toBeVisible()

  await page.getByRole('button', { name: `Use ${customer.name}` }).click() // click 1
  await page.getByRole('button', { name: /^Create job \d+$/ }).click() // click 2

  await expect(page).toHaveURL(/\/jobs\/\d+$/)
  await expect(page.getByText(customer.name).first()).toBeVisible()
})
