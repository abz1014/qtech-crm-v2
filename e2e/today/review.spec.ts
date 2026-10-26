import { expect, test } from '@playwright/test'
import { createCompany, createRfq, karachiDay, must, openAs, rest, rfqRef, uniqueName } from '../support/stack'

/*
 * The weekly owner review (redesign phase 3, P3-C1) against the real stack: admin only, an old enquiry with no supplier asked is on
 * it, "Still live" takes it off and Undo puts it back, "Close as lost" closes the RFQ and Undo reopens it. Fictional data.
 */
const SALES = 'a0000000-0000-4000-8000-000000000002'

test('the review lists a stuck enquiry; Still live and Close as lost both have an Undo; sales cannot open it', async ({ page, browser }) => {
  test.setTimeout(120_000)
  const live = await createRfq((await createCompany(uniqueName('Review Live'))).id, { owner_id: SALES, received_on: karachiDay(-15) })
  const lost = await createRfq((await createCompany(uniqueName('Review Lost'))).id, { owner_id: SALES, received_on: karachiDay(-16) })

  await openAs(page, 'admin', '/todo/review')
  await expect(page.getByRole('heading', { name: 'Weekly review', level: 1 })).toBeVisible()
  const enquiries = page.getByRole('region', { name: /^Enquiries with no supplier asked/ })
  const liveRow = enquiries.locator('li').filter({ hasText: rfqRef(live.number) })
  const lostRow = enquiries.locator('li').filter({ hasText: rfqRef(lost.number) })
  await expect(liveRow).toBeVisible()
  await expect(lostRow).toBeVisible()

  // Still live: the row leaves; Undo brings it back
  await liveRow.getByRole('button', { name: /^Still live/ }).click()
  await expect(liveRow).toHaveCount(0)
  await page.getByRole('status').filter({ hasText: 'Still live' }).getByRole('button', { name: /Undo/ }).click()
  await expect(liveRow).toBeVisible()

  // Close as lost: the RFQ closes; Undo reopens it
  await lostRow.getByRole('button', { name: /^Close as lost/ }).click()
  await expect(lostRow).toHaveCount(0)
  await expect.poll(async () => (await must(rest<Array<{ closed_on: string | null }>>('admin', `rfqs?id=eq.${lost.id}&select=closed_on`)))[0]?.closed_on).not.toBeNull()
  await page.getByRole('status').filter({ hasText: 'closed as lost' }).getByRole('button', { name: /Undo/ }).click()
  await expect.poll(async () => (await must(rest<Array<{ closed_on: string | null }>>('admin', `rfqs?id=eq.${lost.id}&select=closed_on`)))[0]?.closed_on).toBeNull()

  // admin only
  const ctx = await browser.newContext()
  const p2 = await ctx.newPage()
  await openAs(p2, 'sales', '/todo/review')
  await expect(p2.locator('main')).toContainText(/access/i)
  await expect(p2.locator('[data-review]')).toHaveCount(0)
  await ctx.close()
})
