import { expect, test, type Page } from '@playwright/test'
import { createCompany, must, openAs, rest, uniqueName } from '../support/stack'

/*
 * Forest lane B1 (new RFQ intake, mockups 21-new-enquiry and 44-capture): pictures of the intake page and of /capture at 1440, 768,
 * 375 and 320, written to REVIEW_DIR (CI uploads it; nothing is written locally). Each width is checked for sideways scroll, so a
 * long company name or item never runs off a phone. Synthetic data only.
 */
async function paste(page: Page, text: string): Promise<void> {
  await page.evaluate(t => {
    const dt = new DataTransfer()
    dt.setData('text/plain', t)
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, text)
}

/** No sideways scroll, then the whole page (the window grown to the content: #main scrolls inside a one-viewport shell). */
async function shoot(page: Page, name: string, w: number, h: number): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect.soft(overflow, `${name}: no sideways scroll at ${w}`).toBeLessThanOrEqual(0)
  const main = await page.evaluate(() => {
    const m = document.querySelector('#main') as HTMLElement
    return { scroll: m.scrollWidth, client: m.clientWidth }
  })
  expect.soft(main.scroll, `${name}: #main does not scroll sideways at ${w}`).toBeLessThanOrEqual(main.client + 1)
  const dir = process.env.REVIEW_DIR
  if (!dir) return
  const tall = await page.evaluate(() =>
    Math.max(
      ...Array.from(document.querySelectorAll('#main, #main *'))
        .filter(e => /auto|scroll/.test(getComputedStyle(e).overflowY))
        .map(e => e.scrollHeight + e.getBoundingClientRect().top),
      window.innerHeight,
    ),
  )
  if (tall > h) {
    await page.setViewportSize({ width: w, height: Math.min(Math.ceil(tall) + 120, 6000) })
    await page.waitForTimeout(300)
  }
  await page.screenshot({ path: `${dir}/forest-b1-${name}-${w}.png`, fullPage: true })
  await page.setViewportSize({ width: w, height: h })
}

const WIDTHS = [
  [1440, 900],
  [768, 1024],
  [375, 812],
  [320, 640],
] as const

test('Forest intake: empty, filled (long names), and /capture, at 1440, 768, 375 and 320', async ({ page, browser }) => {
  test.setTimeout(240_000)
  const tag = Math.random().toString(36).slice(2, 6).toUpperCase()
  const customer = await createCompany(uniqueName(`Pak-Meridian Integrated Process Automation and Industrial Engineering Services ${tag} (Private) Limited`), { city: 'Sheikhupura' })
  await must(rest('admin', 'contacts', { method: 'POST', body: { company_id: customer.id, name: 'Ayesha Malik' } }))
  const email = [
    'Dear Sir, please quote the following for our plant:',
    '1) Endress+Hauser Proline Promag 400 electromagnetic flowmeter with Ex-approved remote transmitter housing, 5P4C25-AAAA1AA4ABAAA - 2 nos',
    '2) Siemens SITRANS TH320 temperature transmitter 7NG3211-0AN00 x 10',
    `Our reference ENQ-${tag}`,
    'Regards, Ayesha',
  ].join('\n')

  await openAs(page, 'sales', '/enquiries/new')
  for (const [w, h] of WIDTHS) {
    await page.setViewportSize({ width: w, height: h })
    await page.goto('/enquiries/new')
    await expect(page.getByTestId('enquiry-dropzone')).toBeVisible()
    await page.waitForTimeout(300)
    await shoot(page, 'new-rfq-empty', w, h)
    // Leave nothing behind for the next width: an empty form keeps no draft.
  }

  // Filled: the company chosen, the email pasted. One draft for all widths (the reload offers it; Continue brings it back).
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/enquiries/new')
  await page.getByRole('combobox', { name: 'Company' }).fill(customer.name.slice(0, 24))
  await page.getByRole('option', { name: new RegExp(tag) }).click()
  await paste(page, email)
  await expect(page.getByText('2 items found').first()).toBeVisible()
  for (const [w, h] of WIDTHS) {
    await page.setViewportSize({ width: w, height: h })
    await page.waitForTimeout(400)
    await shoot(page, 'new-rfq-filled', w, h)
  }
  // Ask suppliers now: the green button becomes the next step.
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('checkbox', { name: /Ask suppliers now/ }).check()
  await expect(page.getByRole('button', { name: 'Looks right: find suppliers' })).toBeVisible()
  await page.waitForTimeout(200)
  await shoot(page, 'new-rfq-ask-now', 1440, 900)

  // /capture as an engineer, in a fresh window (the filled form above would ask before leaving): Photo or note, which job.
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1440, height: 900 } })
  page = await ctx.newPage()
  await openAs(page, 'engineer', '/capture')
  for (const [w, h] of WIDTHS) {
    await page.setViewportSize({ width: w, height: h })
    await page.goto('/capture')
    await expect(page.getByTestId('photo-or-note')).toBeVisible()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(300)
    await shoot(page, 'capture-photo-or-note', w, h)
  }
  // A share that is gone.
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/capture?share=missing')
  await expect(page.getByTestId('share-gone')).toBeVisible()
  await shoot(page, 'capture-gone', 375, 812)
  await ctx.close()
})
