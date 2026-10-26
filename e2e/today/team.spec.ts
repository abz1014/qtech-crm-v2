import { expect, test } from '@playwright/test'
import { createCompany, createRfq, karachiDay, openAs, rfqRef, uniqueName } from '../support/stack'

/*
 * To do, Team view (redesign phase 3, P3-B), against the real stack: the admin sees the salesperson's late work under the
 * salesperson's own name, read only; work older than 30 days is greyed there, "since <date>"; the sales role has no Team switch.
 * Fictional data.
 */
const SALES = 'a0000000-0000-4000-8000-000000000002'

test('Team shows each person\'s late count and their old work greyed; sales has no Team switch', async ({ page, browser }) => {
  await createRfq((await createCompany(uniqueName('Team Late'))).id, { owner_id: SALES, received_on: karachiDay(-4) })
  const old = await createRfq((await createCompany(uniqueName('Team Old'))).id, { owner_id: SALES, received_on: karachiDay(-300) })

  await openAs(page, 'admin', '/todo')
  await page.getByRole('radio', { name: 'Team' }).click()
  await expect(page).toHaveURL(/view=team/)
  const person = page.locator(`[data-person="${SALES}"]`)
  await expect(person).toBeVisible()
  // the panel shows each person's first five rows, so one seeded row can be past them: the late count is what is checked
  await expect(person.locator('li[data-rule]').first()).toBeVisible()
  await expect(person.locator('[data-late]')).toContainText(/\d+ late/)
  const grey = person.locator('li[data-stale]').filter({ hasText: rfqRef(old.number) })
  await expect(grey).toBeVisible()
  await expect(grey.getByText(/^since \d{1,2} [A-Z][a-z]{2} \d{4}$/)).toBeVisible()
  // read only: no buttons on a person's rows
  await expect(person.locator('li button')).toHaveCount(0)

  const ctx = await browser.newContext()
  const p2 = await ctx.newPage()
  await openAs(p2, 'sales', '/todo')
  await expect(p2.locator('[data-needs-you-count]')).toBeVisible()
  await expect(p2.getByRole('radio', { name: 'Team' })).toHaveCount(0)
  await ctx.close()
})
