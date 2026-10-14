import { expect, test } from '@playwright/test'
import { createCompany, createRfq, must, openAs, review, rest, rfqRef, uniqueName } from '../support/stack'

/*
 * Edit and remove for sites, contacts and brands carried (R02 follow-up), against the local CI stack.
 * Anything that an RFQ, order or quotation points at is never deleted: the database would only unfile it
 * (ON DELETE SET NULL), so the screen counts first and refuses in plain words.
 */
async function customerWithSite(prefix: string) {
  const company = await createCompany(uniqueName(prefix))
  const site = (await must(rest<{ id: string }[]>('admin', 'company_sites', { method: 'POST', body: { company_id: company.id, name: 'Main plant', address: 'Plot 14, Landhi' } })))[0]
  const contact = (
    await must(
      rest<{ id: string }[]>('admin', 'contacts', {
        method: 'POST',
        body: { company_id: company.id, site_id: site.id, name: 'Naveed Akhtar', phone: '0300 1234567', notes: 'Finance' },
      }),
    )
  )[0]
  return { company, site, contact }
}

test.describe('edit', () => {
  test('a contact is edited in the same dialog as adding, and only the name is required', async ({ page }) => {
    const { company, contact } = await customerWithSite('Edit Contact Co')
    await openAs(page, 'engineer', `/companies/${company.id}`)
    const panel = page.getByRole('region', { name: 'Contacts' })
    await panel.getByRole('button', { name: 'Edit Naveed Akhtar' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit contact' })
    await expect(dialog.getByRole('textbox', { name: /^Name/ })).toHaveValue('Naveed Akhtar')
    await expect(dialog.getByRole('textbox', { name: /Phone/ })).toHaveValue('0300 1234567')
    await dialog.getByRole('textbox', { name: /^Name/ }).fill('')
    await dialog.getByRole('button', { name: 'Save changes' }).click()
    await expect(dialog.getByText('Enter the contact name.').first()).toBeVisible()
    await dialog.getByRole('textbox', { name: /^Name/ }).fill('Naveed A. Akhtar')
    await dialog.getByRole('textbox', { name: /Phone/ }).fill('')
    await dialog.getByRole('button', { name: 'Save changes' }).click()
    await expect(dialog).toBeHidden()
    await expect(panel.getByText('Naveed A. Akhtar')).toBeVisible()
    const rows = await must(rest<{ name: string; phone: string | null; notes: string | null }[]>('admin', `contacts?id=eq.${contact.id}&select=name,phone,notes`))
    expect(rows).toEqual([{ name: 'Naveed A. Akhtar', phone: null, notes: 'Finance' }])
  })

  test('a site is edited and its RFQs stay filed under it', async ({ page }) => {
    const { company, site } = await customerWithSite('Edit Site Co')
    const rfq = await createRfq(company.id, { site_id: site.id })
    await openAs(page, 'sales', `/companies/${company.id}`)
    await page.getByRole('region', { name: 'Main plant' }).getByRole('button', { name: 'Edit Main plant' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit site' })
    await expect(dialog.getByRole('textbox', { name: /Site name/ })).toHaveValue('Main plant')
    await dialog.getByRole('textbox', { name: /Site name/ }).fill('Landhi plant')
    await dialog.getByRole('button', { name: 'Save changes' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('region', { name: 'Landhi plant' }).getByText(rfqRef(rfq.number))).toBeVisible()
    const rows = await must(rest<{ name: string; address: string | null }[]>('admin', `company_sites?id=eq.${site.id}&select=name,address`))
    expect(rows).toEqual([{ name: 'Landhi plant', address: 'Plot 14, Landhi' }])
    const filed = await must(rest<{ site_id: string }[]>('admin', `rfqs?id=eq.${rfq.id}&select=site_id`))
    expect(filed[0].site_id).toBe(site.id)
  })
})

test.describe('remove', () => {
  test('a contact: Cancel keeps them, Remove deletes them', async ({ page }) => {
    const { company, contact } = await customerWithSite('Remove Contact Co')
    await openAs(page, 'engineer', `/companies/${company.id}`)
    const panel = page.getByRole('region', { name: 'Contacts' })
    await panel.getByRole('button', { name: 'Remove Naveed Akhtar' }).click()
    const ask = panel.getByRole('group', { name: 'Remove Naveed Akhtar?' })
    await expect(ask).toBeVisible()
    await ask.getByRole('button', { name: 'Cancel' }).click()
    await expect(ask).toHaveCount(0)
    expect(await must(rest<unknown[]>('admin', `contacts?id=eq.${contact.id}`))).toHaveLength(1)

    await panel.getByRole('button', { name: 'Remove Naveed Akhtar' }).click()
    await panel.getByRole('group', { name: 'Remove Naveed Akhtar?' }).getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(panel.getByText('Naveed Akhtar')).toHaveCount(0)
    expect(await must(rest<unknown[]>('admin', `contacts?id=eq.${contact.id}`))).toHaveLength(0)
  })

  test('a contact named on an RFQ is not removed, and the page says why', async ({ page }) => {
    const { company, contact } = await customerWithSite('Used Contact Co')
    const rfq = await createRfq(company.id, { contact_id: contact.id })
    await openAs(page, 'sales', `/companies/${company.id}`)
    const panel = page.getByRole('region', { name: 'Contacts' })
    await panel.getByRole('button', { name: 'Remove Naveed Akhtar' }).click()
    await panel.getByRole('group', { name: 'Remove Naveed Akhtar?' }).getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(panel.getByRole('alert')).toContainText("This contact is used on 1 RFQ; it can't be removed.")
    await panel.getByRole('button', { name: 'Close' }).click()
    await expect(panel.getByText('Naveed Akhtar')).toBeVisible()
    expect(await must(rest<unknown[]>('admin', `contacts?id=eq.${contact.id}`))).toHaveLength(1)
    const still = await must(rest<{ contact_id: string }[]>('admin', `rfqs?id=eq.${rfq.id}&select=contact_id`))
    expect(still[0].contact_id).toBe(contact.id)
  })

  test('a site with RFQs is not removed: plain message, nothing unfiled', async ({ page }) => {
    const { company, site } = await customerWithSite('Used Site Co')
    const first = await createRfq(company.id, { site_id: site.id })
    await createRfq(company.id, { site_id: site.id })
    await createRfq(company.id, { site_id: site.id })
    await openAs(page, 'engineer', `/companies/${company.id}`)
    const region = page.getByRole('region', { name: 'Main plant' })
    await region.getByRole('button', { name: 'Remove Main plant' }).click()
    await region.getByRole('group', { name: 'Remove Main plant?' }).getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(region.getByRole('alert')).toContainText("This site is used on 3 RFQs; it can't be removed.")
    await review(page, 'remove-site-refused-1440')
    await region.getByRole('button', { name: 'Close' }).click()
    expect(await must(rest<unknown[]>('admin', `company_sites?id=eq.${site.id}`))).toHaveLength(1)
    const filed = await must(rest<{ site_id: string }[]>('admin', `rfqs?id=eq.${first.id}&select=site_id`))
    expect(filed[0].site_id).toBe(site.id)
  })

  test('a site nothing uses is removed, and its contacts stay with no site', async ({ page }) => {
    const { company, site, contact } = await customerWithSite('Empty Site Co')
    await openAs(page, 'sales', `/companies/${company.id}`)
    const region = page.getByRole('region', { name: 'Main plant' })
    await region.getByRole('button', { name: 'Remove Main plant' }).click()
    await region.getByRole('group', { name: 'Remove Main plant?' }).getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Main plant' })).toHaveCount(0)
    expect(await must(rest<unknown[]>('admin', `company_sites?id=eq.${site.id}`))).toHaveLength(0)
    const kept = await must(rest<{ site_id: string | null }[]>('admin', `contacts?id=eq.${contact.id}&select=site_id`))
    expect(kept).toEqual([{ site_id: null }])
  })

  test('a brand is dropped from a supplier; the brand itself stays', async ({ page }) => {
    const supplier = await createCompany(uniqueName('Brand Dropper'))
    const brandName = uniqueName('Siemens')
    const brand = (await must(rest<{ id: string }[]>('admin', 'brands', { method: 'POST', body: { name: brandName } })))[0]
    await must(rest('admin', 'company_brands', { method: 'POST', body: { company_id: supplier.id, brand_id: brand.id } }))
    await openAs(page, 'engineer', `/companies/${supplier.id}`)
    const panel = page.getByRole('region', { name: 'Brands carried' })
    await panel.getByRole('button', { name: `Remove ${brandName}` }).click()
    await panel.getByRole('group', { name: `Remove ${brandName}?` }).getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(panel.getByText(brandName)).toHaveCount(0)
    expect(await must(rest<unknown[]>('admin', `company_brands?company_id=eq.${supplier.id}`))).toHaveLength(0)
    expect(await must(rest<unknown[]>('admin', `brands?id=eq.${brand.id}`))).toHaveLength(1)
  })
})
