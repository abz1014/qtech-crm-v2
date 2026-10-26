import { expect, test } from '@playwright/test'
import { createCompany, createRfq, openAs, uniqueName } from '../support/stack'

/*
 * 0092 "whose is it", on the screen (VERIFY, END-CHECKLIST 16 and 82): sales may change only what they entered or own. For somebody
 * else's enquiry the dialog does not let a save fail: every field is disabled and it says "Entered by X: only they or an admin can
 * change this". The admin may change anything. Fictional data; the RFQ is made by the admin and owned by the admin.
 */
const ADMIN = 'a0000000-0000-4000-8000-000000000001'

test('sales editing the admin\'s RFQ sees disabled fields and who entered it; the admin may edit', async ({ page, browser }) => {
  const co = await createCompany(uniqueName('Guard Customer'))
  const rfq = await createRfq(co.id, { owner_id: ADMIN, customer_ref: 'GUARD-1' })

  await openAs(page, 'sales', `/rfqs/${rfq.id}`)
  await page.getByRole('button', { name: /^More/ }).first().click()
  await page.getByRole('menuitem', { name: 'Edit RFQ details' }).click()
  const d = page.getByRole('dialog', { name: 'Edit RFQ details' })
  await expect(d).toBeVisible()
  await expect(d.locator('[data-slot="not-yours"]')).toContainText(/^Entered by .+: only they or an admin can change this$/)
  await expect(d.getByRole('button', { name: 'Change customer' })).toBeDisabled()
  await expect(d.getByRole('textbox').first()).toBeDisabled()
  await expect(d.getByRole('button', { name: /^Save/ })).toBeDisabled()

  const ctx = await browser.newContext()
  const admin = await ctx.newPage()
  await openAs(admin, 'admin', `/rfqs/${rfq.id}`)
  await admin.getByRole('button', { name: /^More/ }).first().click()
  await admin.getByRole('menuitem', { name: 'Edit RFQ details' }).click()
  const a = admin.getByRole('dialog', { name: 'Edit RFQ details' })
  await expect(a).toBeVisible()
  await expect(a.locator('[data-slot="not-yours"]')).toHaveCount(0)
  await expect(a.getByRole('button', { name: 'Change customer' })).toBeEnabled()
  await ctx.close()
})
