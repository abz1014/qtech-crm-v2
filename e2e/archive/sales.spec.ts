import { expect, test, type Page } from '@playwright/test'
import { openAs } from '../support/stack'
import { archiveOff, archiveOn, jobRowName, SALES_ID, seedArchive } from '../support/archive'
import { homeBadge, openJobsFor, todayRowsFor } from './shared'

/*
 * Archive old data (0141), as sales. Sales sees the same hiding in lists, Today and the top-bar number, has no Archive entry in Settings
 * and is told so on /settings/archive, and is told in plain words when a customer ref it types belongs to an RFQ in the Archive.
 */
test.describe.configure({ mode: 'serial' })
test.beforeEach(async () => archiveOff())
test.afterEach(async () => archiveOff())

async function paste(page: Page, text: string): Promise<void> {
  await page.evaluate(t => {
    const dt = new DataTransfer()
    dt.setData('text/plain', t)
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, text)
}

async function pickCompany(page: Page, name: string): Promise<void> {
  await page.getByRole('combobox', { name: 'Company' }).fill(name)
  await page.getByRole('option', { name: new RegExp(name) }).click()
  await expect(page.getByText(name).first()).toBeVisible()
}

const ENQUIRY = ['Dear Sir, please quote the following for our plant:', '1) Zetaflow QZ4821 electromagnetic flow meter DN50 - 2 nos', '2) Pressure gauge 0-10 bar - 4 nos', 'Regards, Kamran Zafar'].join(String.fromCharCode(10))

test('with archiving on, the old jobs leave the Jobs list and Today and the number on Home drops; the tax register still lists the old invoice', async ({ page }) => {
  test.setTimeout(180_000)
  const f = await seedArchive(SALES_ID)
  await openAs(page, 'sales', '/todo')
  await openJobsFor(page, f.company.name)
  await expect(page.getByRole('row', { name: jobRowName.rfq(f.oldRfq.number) }).first()).toBeVisible()
  await expect(await todayRowsFor(page, f.oldRfq.number)).toHaveCount(1)
  let badgeOff = 0
  await expect(async () => {
    await page.goto('/todo')
    await page.locator('[data-needs-you-count]').waitFor()
    badgeOff = await homeBadge(page)
    expect(badgeOff).toBeGreaterThanOrEqual(2)
  }).toPass({ timeout: 30_000 })

  await archiveOn()
  await openJobsFor(page, f.company.name)
  await expect(page.getByRole('row', { name: jobRowName.rfq(f.newRfq.number) }).first()).toBeVisible()
  await expect(page.getByRole('row', { name: jobRowName.order(f.newOrder.number) }).first()).toBeVisible()
  await expect(page.getByRole('row', { name: jobRowName.rfq(f.oldRfq.number) })).toHaveCount(0)
  await expect(page.getByRole('row', { name: jobRowName.order(f.oldOrder.number) })).toHaveCount(0)
  await expect(await todayRowsFor(page, f.newRfq.number)).toHaveCount(1)
  await expect(await todayRowsFor(page, f.oldRfq.number)).toHaveCount(0)
  await expect(async () => {
    await page.goto('/todo')
    await page.locator('[data-needs-you-count]').waitFor()
    expect(await homeBadge(page)).toBeLessThan(badgeOff)
  }).toPass({ timeout: 30_000 })

  await page.goto('/money/gst-register')
  await expect(page.getByText(f.newOrder.invoiceNumber)).toBeVisible()
  await expect(page.getByText(f.oldOrder.invoiceNumber)).toBeVisible()
})

test('sales has no Archive entry in Settings, and /settings/archive shows the no-access page', async ({ page }) => {
  await openAs(page, 'sales', '/settings')
  const nav = page.getByRole('navigation', { name: 'Settings' })
  await expect(nav.getByRole('link', { name: 'Company profile' })).toBeVisible()
  await expect(nav.getByRole('link', { name: /Archive/ })).toHaveCount(0)
  await page.goto('/settings/archive')
  await expect(page.getByRole('heading', { name: 'Archive is for admins' }).first()).toBeAttached()
  await expect(page.getByText('Your role is Sales.')).toBeVisible()
  await expect(page.getByTestId('archive-page')).toHaveCount(0)
})

test('a customer ref that belongs to an archived RFQ is refused with the Archive message, and nothing is created', async ({ page }) => {
  const f = await seedArchive(SALES_ID)
  await archiveOn()
  await openAs(page, 'sales', '/rfqs/new')
  await pickCompany(page, f.company.name)
  await paste(page, ENQUIRY)
  await page.getByRole('textbox', { name: 'Customer reference' }).fill(f.oldRfq.ref)
  await page.getByRole('button', { name: /^Create job \d+$/ }).click()
  await expect(page.getByText(`Ref ${f.oldRfq.ref} already exists on RFQ-${f.oldRfq.number} (in Archive). Unarchive it or use another ref.`)).toBeVisible()
  await expect(page).toHaveURL(/\/rfqs\/new$/)
})

test('with archiving off the same clash gets the usual message', async ({ page }) => {
  const f = await seedArchive(SALES_ID)
  await openAs(page, 'sales', '/rfqs/new')
  await pickCompany(page, f.company.name)
  await paste(page, ENQUIRY)
  await page.getByRole('textbox', { name: 'Customer reference' }).fill(f.oldRfq.ref)
  await page.getByRole('button', { name: /^Create job \d+$/ }).click()
  await expect(page.getByText('This customer already has an RFQ with that reference.')).toBeVisible()
  await expect(page.getByText(/\(in Archive\)/)).toHaveCount(0)
})
