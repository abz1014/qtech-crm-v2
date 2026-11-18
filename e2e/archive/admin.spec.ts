import { expect, test } from '@playwright/test'
import { openAs } from '../support/stack'
import { archiveOff, archiveOn, CUTOFF, jobRowName, NEW_DAY, OLD_DAY, seedArchive, ADMIN_ID } from '../support/archive'
import { homeBadge, monthOf, openJobsFor, settledText, todayRowsFor } from './shared'

/*
 * Archive old data (0141), as the admin. The setting ships OFF; when ON, records dated before the cutoff (and imported ones) leave the lists,
 * Today, the top-bar number and search, for every role, while totals and the tax register still count them. Admin has Settings > Archive:
 * the switch, the preview, the browse list and Unarchive. Synthetic data; every test switches archiving back off.
 */
test.describe.configure({ mode: 'serial' })
test.beforeEach(async () => archiveOff())
test.afterEach(async () => archiveOff())

test('with archiving on, the old job leaves the Jobs list and Today and the top-bar number drops; the new ones stay; off brings them back', async ({ page }) => {
  test.setTimeout(180_000)
  const f = await seedArchive(ADMIN_ID)
  await openAs(page, 'admin', '/todo')

  // OFF: everything is listed, the old RFQ is due on Today
  await openJobsFor(page, f.company.name)
  for (const n of [jobRowName.rfq(f.oldRfq.number), jobRowName.rfq(f.newRfq.number), jobRowName.order(f.oldOrder.number), jobRowName.order(f.newOrder.number)]) {
    await expect(page.getByRole('row', { name: n }).first()).toBeVisible()
  }
  await expect(await todayRowsFor(page, f.oldRfq.number)).toHaveCount(1)
  await expect(await todayRowsFor(page, f.newRfq.number)).toHaveCount(1)
  let badgeOff = 0
  await expect(async () => {
    await page.goto('/todo')
    await page.locator('[data-needs-you-count]').waitFor()
    badgeOff = await homeBadge(page)
    expect(badgeOff).toBeGreaterThanOrEqual(2)
  }).toPass({ timeout: 30_000 })

  // ON: the old ones are gone from both lists, the new ones are not
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

  // OFF again: all back
  await archiveOff()
  await openJobsFor(page, f.company.name)
  await expect(page.getByRole('row', { name: jobRowName.rfq(f.oldRfq.number) }).first()).toBeVisible()
  await expect(page.getByRole('row', { name: jobRowName.order(f.oldOrder.number) }).first()).toBeVisible()
})

test('payments: an old payment leaves the Payments list and a new one stays, while the month total counts both; the GST register stays whole', async ({ page }) => {
  const f = await seedArchive()
  await openAs(page, 'admin', '/money/payments')
  const paymentsOf = async (day: string) => {
    await page.goto(`/money/payments?month=${monthOf(day)}`)
    await expect(page.getByRole('heading', { name: 'Payments', level: 1 })).toBeAttached()
    await expect(page.getByTestId('payments-count')).toBeVisible()
    return page.getByRole('row').filter({ hasText: f.company.name })
  }
  const totalOf = async () => settledText(() => page.getByTestId('payments-count').innerText())

  // OFF: both are listed; remember the totals of the two months
  await expect(await paymentsOf(OLD_DAY())).toHaveCount(monthOf(OLD_DAY()) === monthOf(NEW_DAY()) ? 2 : 1)
  const oldMonthOff = await totalOf()
  await expect(await paymentsOf(NEW_DAY())).toHaveCount(monthOf(OLD_DAY()) === monthOf(NEW_DAY()) ? 2 : 1)
  const newMonthOff = await totalOf()

  await archiveOn()
  // ON: the old payment is not a row; the new one is; the figures are the same
  const rowsOld = await paymentsOf(OLD_DAY())
  await expect(rowsOld.filter({ hasText: f.oldPaid.amount.toLocaleString('en-US') })).toHaveCount(0)
  await expect(page.getByTestId('payments-count')).toHaveText(oldMonthOff)
  const rowsNew = await paymentsOf(NEW_DAY())
  await expect(rowsNew.filter({ hasText: f.newPaid.amount.toLocaleString('en-US') })).toHaveCount(1)
  await expect(page.getByTestId('payments-count')).toHaveText(newMonthOff)

  // The GST register is the tax record: it lists every invoice, old ones too (only its own filters narrow it)
  await page.goto('/money/gst-register')
  await expect(page.getByText(f.newOrder.invoiceNumber)).toBeVisible()
  await expect(page.getByText(f.oldOrder.invoiceNumber)).toBeVisible()
})

test('the To collect figures are the same with archiving on and off', async ({ page }) => {
  const f = await seedArchive()
  await openAs(page, 'admin', '/money/receivables')
  const tile = page.getByLabel('Balance by status, includes GST').first()
  await expect(page.getByRole('row').filter({ hasText: f.company.name }).first()).toBeVisible()
  const off = await settledText(async () => (await tile.textContent()) ?? '')
  await archiveOn()
  await page.goto('/money/receivables')
  await expect(page.getByRole('row').filter({ hasText: f.newOrder.invoiceNumber })).not.toHaveCount(0)
  // the old job's row is hidden from the list, yet the figures above did not move
  await expect(page.getByRole('row').filter({ hasText: f.oldOrder.invoiceNumber })).toHaveCount(0)
  await expect(tile).toHaveText(off)
})

test('Settings > Archive: the switch, the preview and the browse list; Unarchive brings the job back to the Jobs list', async ({ page }) => {
  test.setTimeout(120_000)
  const f = await seedArchive()
  await openAs(page, 'admin', '/settings')
  await expect(page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Archive' })).toBeVisible()
  await page.goto('/settings/archive')
  const status = page.getByTestId('archive-status')
  await expect(page.getByRole('heading', { name: 'Archive', level: 1 })).toBeVisible()
  await expect(page.getByTestId('archive-state')).toHaveText('Off')

  // the preview works while it is off: it says what the date would hide
  const preview = page.getByTestId('archive-preview')
  await status.getByLabel('Archive records dated before').fill(CUTOFF())
  await expect(preview.getByRole('row', { name: /^Orders/ })).toBeVisible()
  await expect(preview.getByRole('row', { name: /^Invoices/ })).toBeVisible()

  // switch on, through the confirm
  await status.getByRole('button', { name: 'Switch on' }).click()
  const dialog = page.getByRole('dialog', { name: 'Switch archiving on?' })
  await expect(dialog).toContainText('kept but hidden from lists and search')
  await dialog.getByRole('button', { name: 'Switch on' }).click()
  await expect(page.getByTestId('archive-state')).toHaveText('On')

  // the job is hidden from the Jobs list
  await openJobsFor(page, f.company.name)
  await expect(page.getByRole('row', { name: jobRowName.order(f.newOrder.number) }).first()).toBeVisible()
  await expect(page.getByRole('row', { name: jobRowName.order(f.oldOrder.number) })).toHaveCount(0)

  // browse: the old order is listed, Unarchive puts it back
  await page.goto('/settings/archive')
  const browse = page.getByTestId('archive-browse')
  await browse.getByLabel('Kind').selectOption('order')
  await browse.getByLabel('Search').fill(f.company.name)
  const row = browse.getByTestId(`archive-row-${f.oldOrder.id}`)
  await expect(row).toBeVisible()
  await expect(browse.getByTestId(`archive-row-${f.newOrder.id}`)).toHaveCount(0)
  await row.getByRole('button', { name: 'Unarchive' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Unarchived' })).toBeVisible()
  await expect(row.getByText('Shown')).toBeVisible()
  await expect(row.getByRole('button', { name: 'Put back in Archive' })).toBeVisible()

  await openJobsFor(page, f.company.name)
  await expect(page.getByRole('row', { name: jobRowName.order(f.oldOrder.number) }).first()).toBeVisible()
})

test('an archived job still opens by its address, with the "In Archive" banner; Unarchive on the banner brings it back', async ({ page }) => {
  const f = await seedArchive()
  await archiveOn()
  await openAs(page, 'admin', `/jobs/O-${f.oldOrder.number}`)
  const banner = page.getByText(/This is in the Archive \(dated before .+\)\. It still counts in all totals\./)
  await expect(banner).toBeVisible()
  // the new job has no banner
  await page.goto(`/jobs/O-${f.newOrder.number}`)
  await page.locator('[data-stages]').waitFor()
  await expect(page.getByText(/This is in the Archive/)).toHaveCount(0)

  await page.goto(`/jobs/O-${f.oldOrder.number}`)
  await expect(banner).toBeVisible()
  await page.getByRole('button', { name: 'Unarchive', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Unarchive this record?' })
  await dialog.getByRole('button', { name: 'Unarchive', exact: true }).click()
  await expect(banner).toHaveCount(0)
  await openJobsFor(page, f.company.name)
  await expect(page.getByRole('row', { name: jobRowName.order(f.oldOrder.number) }).first()).toBeVisible()
})

test('an archived invoice opens with the banner and an Unarchive button for the admin', async ({ page }) => {
  const f = await seedArchive()
  await archiveOn()
  await openAs(page, 'admin', `/money/gst-register?invoice=${f.oldOrder.invoiceId}`)
  const dialog = page.getByRole('dialog').last()
  await expect(dialog.getByText(/This is in the Archive \(dated before .+\)/)).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Unarchive', exact: true })).toBeVisible()
  await page.goto(`/money/gst-register?invoice=${f.newOrder.invoiceId}`)
  await expect(page.getByRole('dialog').last().getByText(f.newOrder.invoiceNumber).first()).toBeVisible()
  await expect(page.getByText(/This is in the Archive/)).toHaveCount(0)
})
