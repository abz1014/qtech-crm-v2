import { mkdirSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { createCompany, createRfq, karachiDay, must, openAs, rest, uniqueName } from '../support/stack'
import { openStage } from '../support/job'

/*
 * Review screenshots for the Quotation step clean-up (owner, 18 Nov 2026: "too cluttered"). An RFQ with 12 items and one supplier asked,
 * nothing back yet: the step should read as the supplier on one line, the follow-up message shut, and the items folded behind
 * "Show items" with one "No prices yet" line. Then one price in, so the items show with their waiting lines.
 * Written to test-results/review-shots/quotation/ (the shard uploads test-results). Desktop 1440 wide.
 */
const DIR = 'test-results/review-shots/quotation'

test.setTimeout(300_000)

async function stepShot(page: Page, name: string): Promise<void> {
  mkdirSync(DIR, { recursive: true })
  const body = page.getByRole('region', { name: 'Quotation stage' })
  await page.waitForTimeout(400)
  await body.screenshot({ path: `${DIR}/${name}.png` })
}

test('Quotation step: waiting on one supplier, then one price in', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', viewport: { width: 1440, height: 900 }, locale: 'en-GB', timezoneId: 'Asia/Karachi', serviceWorkers: 'block' })
  const page = await ctx.newPage()
  const customer = await createCompany(uniqueName('Declutter Customer'))
  const rfq = await createRfq(customer.id, { due_on: karachiDay(6) })
  const items: { id: string }[] = []
  const names = [
    'HMI Touch Panel Siemens 6AV2124-0QC02-0AX0 SIMATIC HMI TP1500 Comfort, 15" widescreen TFT touch display, 24V DC',
    'PLC CPU Module Siemens 6ES7315-2EH14-0AB0 SIMATIC S7-300 CPU 315-2 PN/DP, 384 KB work memory',
    'PLC Analog Output Module Siemens 6ES7232-0HB22-0XA0 SIMATIC S7-200 EM 232, 2 AO',
    'Soft Starter ABB PSR85-600-70 45 kW (at 400V AC), 85A rated operational current',
    'Manual Motor Starter ABB MS495-40, thermal overload setting range 28-40A',
    'Phase Monitoring Relay ABB CM-PVS.41S 3-phase over/undervoltage, 300-500V AC',
    'Digital Temperature Controller Honeywell DC1040CR-701000-E 1/4 DIN PID',
    'Compact PLC Base Unit Mitsubishi Electric FX3U-64M MELSEC-F, 64 I/O points',
    'AC Servo Amplifier Mitsubishi Electric MR-J2S-200A, 2.0 kW, 3-phase 200-230V AC',
    'Incremental Rotary Encoder Omron E6H-CWZ6C 500P/R, NPN open-collector output',
    'HMI Touch Panel Weintek MT8071iE 7" TFT LCD, 800x480, Ethernet and RS232/485',
    'PLC Analog Input Module B&R Automation X20AI4622, 4 inputs, 16-bit resolution',
  ]
  for (const [i, description] of names.entries()) {
    items.push((await must(rest<{ id: string }[]>('admin', 'rfq_items', { method: 'POST', body: { rfq_id: rfq.id, position: i, description, qty: 1 } })))[0])
  }
  const supplier = await createCompany(uniqueName('Viassion Automation Trading'))
  const [inq] = await must(rest<{ id: string }[]>('admin', 'supplier_inquiries', { method: 'POST', body: { rfq_id: rfq.id, supplier_id: supplier.id, sent_on: karachiDay(-1) } }))

  await openAs(page, 'admin', `/rfqs/${rfq.id}`)
  await openStage(page, 'Quotation')
  await expect(page.locator('[data-all-waiting]')).toContainText('All 12 items are waiting on the suppliers asked')
  await expect(page.getByRole('article', { name: 'Item 1' })).toHaveCount(0)
  await expect(page.locator('[data-chase-card]')).toHaveCount(0)
  await stepShot(page, '1-waiting-desktop')

  await page.getByRole('button', { name: 'Show items' }).click()
  await expect(page.getByRole('article', { name: 'Item 12' })).toBeVisible()
  await expect(page.locator('[data-waiting]')).toHaveCount(0)
  await stepShot(page, '2-waiting-items-shown-desktop')

  await page.getByRole('button', { name: /^Show message, / }).click()
  await expect(page.locator('[data-chase-card]')).toHaveCount(1)
  await stepShot(page, '3-follow-up-open-desktop')

  // One price in: the items show, each still waiting says on whom.
  await must(rest('admin', 'supplier_quote_lines', { method: 'POST', body: { inquiry_id: inq.id, rfq_item_id: items[0].id, unit_price: 1600, currency: 'USD', lead_time: '4 weeks', in_stock: false, weight: 2 }, prefer: 'return=minimal' }))
  await page.reload()
  await openStage(page, 'Quotation')
  await expect(page.locator('[data-all-waiting]')).toHaveCount(0)
  await stepShot(page, '4-one-price-desktop')
  await ctx.close()
})
