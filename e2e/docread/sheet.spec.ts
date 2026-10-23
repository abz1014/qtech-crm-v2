import { expect, test } from '@playwright/test'
import { utils, write } from 'xlsx'

/*
 * The spreadsheet reader (src/lib/docread/sheetText.ts, SheetJS in its own lazy chunk) in real Chromium on /dev/docread, under
 * the production Content-Security-Policy when E2E_CSP=1 (CI sets it): a fictional .xlsx and a .csv made here are read on the
 * device, and parseEnquiry finds the items under the header row with their quantities and units.
 *     E2E_CSP=1 npx playwright test --project=docread e2e/docread/sheet.spec.ts
 */

interface Parsed {
  items: Array<{ description: string; qty: number; unit: string | null }>
  customerRef: string | null
}

test('an .xlsx and a .csv enquiry are read on the device under the CSP', async ({ page }) => {
  const violations: string[] = []
  page.on('console', m => {
    if (/Content.Security.Policy/i.test(m.text())) violations.push(m.text())
  })
  await page.goto('/dev/docread')
  await expect(page.getByRole('heading', { name: 'Read a picture' })).toBeVisible()

  const wb = utils.book_new()
  utils.book_append_sheet(
    wb,
    utils.aoa_to_sheet([
      ['Sablan Paper Mills Ltd'],
      ['RFQ No:', 'SPM-RFQ-2026-0412'],
      [],
      ['S.No', 'Item Code', 'Description', 'UOM', 'Qty', 'Required Date'],
      [1, 'ELC-00412', 'Contactor 32A coil 230VAC 1NO+1NC', 'EA', 4, '15.12.2026'],
      [2, 'INS-00988', 'Instrument cable 2 pair x 1.5 mm2 screened', 'MTR', 12.5, '15.12.2026'],
      [3, 'GEN-00017', 'Lithium grease NLGI 2', 'KG', 0.5, '20.12.2026'],
    ]),
    'RFQ',
  )
  const xlsx = Buffer.from(write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer)
  await page.getByLabel('Spreadsheet').setInputFiles({ name: 'rfq.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xlsx })
  const result = page.getByTestId('ocr-result')
  await expect(result).toHaveAttribute('data-ok', 'true', { timeout: 30_000 })
  const parsed = JSON.parse((await page.getByTestId('ocr-items').textContent()) ?? 'null') as Parsed
  expect(parsed.items.map(i => [i.qty, i.unit])).toEqual([
    [4, 'EA'],
    [12.5, 'MTR'],
    // (KG is the intake's own kg; EA and MTR are kept as the customer wrote them.)
    [0.5, 'kg'],
  ])
  expect(parsed.customerRef).toBe('SPM-RFQ-2026-0412')

  const csv = 'Description,Qty,Unit\nFuse 10A glass,4,عدد\n"Cable tie 300 mm, black","1,000",Nos\n'
  await page.getByLabel('Spreadsheet').setInputFiles({ name: 'rfq.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') })
  await expect(page.getByTestId('ocr-text')).toContainText('Fuse 10A glass', { timeout: 30_000 })
  const fromCsv = JSON.parse((await page.getByTestId('ocr-items').textContent()) ?? 'null') as Parsed
  expect(fromCsv.items).toEqual([
    { description: 'Fuse 10A glass', qty: 4, unit: 'nos' },
    { description: 'Cable tie 300 mm, black', qty: 1000, unit: 'nos' },
  ])
  expect(violations).toEqual([])
})
