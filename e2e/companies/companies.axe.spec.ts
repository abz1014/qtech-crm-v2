import { expect, test, type Page } from '@playwright/test'
import { createCompany, createRfq, karachiDay, must, openAs, rest, uniqueName } from '../support/stack'
import { axeViolations } from '../support/axe'

/*
 * axe-core on the real Companies screens, set up like e2e/gallery.axe.spec.ts: WCAG 2.2 AA plus axe's
 * best-practice rules, colour contrast on (a real browser, which jsdom cannot give), zero violations.
 * Run at 1440 and 375 wide. `region` is off for the two dialogs only: Radix portals them outside <main>.
 */

const violations = (page: Page, landmarks: boolean) => axeViolations(page, { landmarks })

async function settle(page: Page) {
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready)
}

const WIDTHS = [
  { label: '1440', width: 1440, height: 900 },
  { label: '375', width: 375, height: 812 },
] as const

for (const { label, width, height } of WIDTHS) {
  test.describe(`axe at ${label}`, () => {
    test.use({ viewport: { width, height } })

    test('company list', async ({ page }) => {
      await createCompany(uniqueName('Axe Listed'), { country: 'Pakistan', city: 'Multan' })
      await openAs(page, 'sales', '/companies')
      await expect(page.getByRole('heading', { name: 'Companies', level: 1 })).toBeVisible()
      await expect(page.getByRole('row').nth(1)).toBeVisible()
      await settle(page)
      expect(await violations(page, true)).toEqual([])
      // No sideways scroll on a phone: below 640 px each company is one card (name, place, role).
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
    })

    test('customer detail, with a site, a contact and an RFQ', async ({ page }) => {
      const company = await createCompany(uniqueName('Axe Customer'), { country: 'Pakistan', notes: 'Pays on the 10th.' })
      const site = (await must(rest<{ id: string }[]>('admin', 'company_sites', { method: 'POST', body: { company_id: company.id, name: 'Main plant', address: 'Plot 14, Landhi' } })))[0]
      await must(rest('admin', 'contacts', { method: 'POST', body: { company_id: company.id, site_id: site.id, name: 'Naveed Akhtar', phone: '0300 1234567', email: 'naveed@example.test', notes: 'Finance' } }))
      await createRfq(company.id, { site_id: site.id, customer_ref: 'ENQ-2211' })
      await openAs(page, 'sales', `/companies/${company.id}`)
      await expect(page.getByRole('heading', { name: company.name, level: 1 })).toBeVisible()
      await expect(page.getByText('Naveed Akhtar')).toBeVisible()
      await expect(page.getByRole('region', { name: 'Main plant' }).getByRole('row').nth(1)).toBeVisible()
      await settle(page)
      expect(await violations(page, true)).toEqual([])
    })

    test('customer detail with a remove question and a refusal open', async ({ page }) => {
      const company = await createCompany(uniqueName('Axe Remove'))
      const site = (await must(rest<{ id: string }[]>('admin', 'company_sites', { method: 'POST', body: { company_id: company.id, name: 'Main plant' } })))[0]
      await createRfq(company.id, { site_id: site.id })
      await must(rest('admin', 'contacts', { method: 'POST', body: { company_id: company.id, name: 'Naveed Akhtar' } }))
      await openAs(page, 'sales', `/companies/${company.id}`)
      await page.getByRole('button', { name: 'Remove Naveed Akhtar' }).click()
      await expect(page.getByRole('group', { name: 'Remove Naveed Akhtar?' })).toBeVisible()
      await page.getByRole('region', { name: 'Main plant' }).getByRole('button', { name: 'Remove Main plant' }).click()
      await page.getByRole('group', { name: 'Remove Main plant?' }).getByRole('button', { name: 'Remove', exact: true }).click()
      await expect(page.getByRole('alert').filter({ hasText: "can't be removed" })).toBeVisible()
      await settle(page)
      expect(await violations(page, true)).toEqual([])
    })

    test('supplier detail', async ({ page }) => {
      const supplier = await createCompany(uniqueName('Axe Supplier'), { country: 'Austria' })
      const customer = await createCompany(uniqueName('Axe Enquirer'))
      const rfq = await createRfq(customer.id)
      await must(rest('admin', 'supplier_inquiries', { method: 'POST', body: { rfq_id: rfq.id, supplier_id: supplier.id, sent_on: karachiDay(-10) } }))
      await openAs(page, 'engineer', `/companies/${supplier.id}`)
      await expect(page.getByRole('heading', { name: 'What we know' })).toBeVisible()
      await expect(page.getByRole('row', { name: /RFQ-/ })).toBeVisible()
      await expect(page.getByRole('region', { name: 'Details', exact: true })).toBeVisible()
      await settle(page)
      expect(await violations(page, true)).toEqual([])
      // The rules behind the numbers open from the (i) beside "What we know" (a popover, portalled outside <main>).
      await page.getByRole('region', { name: 'What we know' }).getByRole('button', { name: 'About these numbers' }).click()
      await expect(page.getByRole('dialog', { name: 'About these numbers' })).toBeVisible()
      expect(await violations(page, false)).toEqual([])
    })

    test('create dialog', async ({ page }) => {
      await openAs(page, 'sales', '/companies')
      await page.getByRole('button', { name: 'New company' }).first().click()
      const dialog = page.getByRole('dialog', { name: 'New company' })
      await expect(dialog.getByText('Only the name is required.')).toBeVisible()
      await settle(page)
      expect(await violations(page, false)).toEqual([])
    })

    test('merge dialog', async ({ page }) => {
      const keep = await createCompany(uniqueName('Axe Keep'))
      const drop = await createCompany(uniqueName('Axe Drop'))
      await createRfq(drop.id)
      await openAs(page, 'admin', `/companies/${drop.id}`)
      await expect(page.getByRole('heading', { name: drop.name, level: 1 })).toBeVisible()
      await page.getByRole('button', { name: /^More( actions)?$/ }).click()
      await page.getByRole('menuitem', { name: 'Merge into another company' }).click()
      const dialog = page.getByRole('dialog', { name: 'Merge duplicate company' })
      await dialog.getByRole('combobox', { name: 'Merge into' }).fill(keep.name)
      await page.getByRole('option', { name: new RegExp(keep.name) }).click()
      await expect(dialog.getByText(/move to/)).toBeVisible()
      await settle(page)
      expect(await violations(page, false)).toEqual([])
    })
  })
}
