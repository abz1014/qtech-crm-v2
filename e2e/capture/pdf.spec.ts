import { expect, test } from '@playwright/test'
import { letterPdf } from '../../src/test/pdfFixtures'
import { createCompany, must, openAs, rest, uniqueName } from '../support/stack'

/*
 * A customer's PDF enquiry, the first-RFQ path the owner tested (2026-10-20): Paste or photo, drop the PDF, Start a new RFQ,
 * Continue to New RFQ (no company needed there), and New RFQ opens with the items read from the PDF, the reference and due date
 * filled in "From the PDF", and the company suggested from the sender's email as one tap. The PDF is made here (fictional).
 *
 * Taps, PDF from WhatsApp to an RFQ with items: Share, Q-Tech CRM, Start a new RFQ, Continue to New RFQ, Use <Company> (5).
 * Before this change the PDF was only attached: the company had to be typed and chosen in the sheet and every item typed by hand.
 */
test('a PDF enquiry dropped in Paste or photo opens New RFQ with its items, reference, due date and company', async ({ page }) => {
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
  await page.getByRole('button', { name: /^(Capture|Paste or photo)/ }).first().click()
  const sheet = page.getByRole('dialog')
  await sheet.locator('input[aria-label="Choose files"]:visible').setInputFiles({ name: 'enquiry.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf) })
  await expect(sheet.getByText('enquiry.pdf').first()).toBeVisible()
  // Only the chosen option shows; Something else opens the rest (R2-11).
  await sheet.getByRole('button', { name: 'Something else' }).click()
  await sheet.getByRole('radio', { name: /Start a new RFQ/ }).click()
  // No company chosen: the button is not grey, and nothing stops the way.
  await sheet.getByRole('button', { name: 'Continue to New RFQ' }).click()

  await expect(page).toHaveURL(/\/rfqs\/new$/)
  await expect(page.getByRole('textbox', { name: 'Description of item 1' })).toHaveValue(/^Level switch LSX-200 24V/)
  await expect(page.getByRole('textbox', { name: 'Quantity of item 1' })).toHaveValue('2 nos')
  await expect(page.getByRole('textbox', { name: 'Description of item 2' })).toHaveValue(/^Dosing pump DP-90/)
  await expect(page.getByLabel('Customer reference')).toHaveValue(ref)
  await expect(page.getByText('From the PDF').first()).toBeVisible()

  // Without a company the next step says why, beside the button, and puts the focus on the company.
  await page.getByRole('button', { name: /Looks right: find suppliers/ }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Choose the company first.' })).toBeVisible()
  await expect(page.locator('#intake-company')).toBeFocused()

  await page.getByRole('button', { name: `Use ${customer.name}` }).click()
  await expect(page.getByRole('button', { name: `Change company, now ${customer.name}` })).toBeVisible()
  await expect(page.getByText(/Creates a new RFQ for/)).toBeVisible()
})
