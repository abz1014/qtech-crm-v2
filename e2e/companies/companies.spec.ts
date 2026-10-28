import { expect, test, type Page } from '@playwright/test'
import { createCompany, createRfq, karachiDay, must, openAs, review, rest, rfqRef, uniqueName } from '../support/stack'

/*
 * R02 end to end, against the local CI stack. Each test makes its own companies with unique names, so the
 * tests do not depend on each other or on the seed beyond its fixture users.
 */

/**
 * Open the command palette with its shortcut. The shortcut listener is attached when the shell mounts, so a key
 * pressed straight after `goto` can be lost: wait for the shell (heading and an enabled search button) first.
 */
async function openPalette(page: Page) {
  await expect(page.getByRole('heading', { name: 'To do', level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Search or jump to' }).first()).toBeEnabled()
  await page.keyboard.press('Control+k')
  await expect(page.getByRole('dialog', { name: 'Search or jump to' })).toBeVisible()
}

test.describe('inline create (FE-2: name only, three actions)', () => {
  test('a company is created from its name alone, in one dialog', async ({ page }) => {
    const name = uniqueName('Indus Textile')
    await openAs(page, 'sales', '/companies')
    await expect(page.getByRole('heading', { name: 'Companies', level: 1 })).toBeVisible()

    let actions = 0
    await page.getByRole('button', { name: 'New company' }).first().click() // 1 (a fresh database also shows the empty state's button)
    actions++
    const dialog = page.getByRole('dialog', { name: 'New company' })
    await expect(dialog.getByText('Only the name is required.')).toBeVisible()
    await dialog.getByRole('textbox', { name: /Company name/ }).fill(name) // 2
    actions++
    await review(page, 'create-dialog-1440')
    await dialog.getByRole('button', { name: 'Add company' }).click() // 3
    actions++

    await expect(page).toHaveURL(/\/companies\/[0-9a-f-]{36}$/)
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible()
    expect(actions).toBeLessThanOrEqual(3)

    const rows = await must(rest<{ name: string; country: string | null; notes: string | null; created_by: string }[]>('admin', `companies?name=eq.${encodeURIComponent(name)}`))
    expect(rows).toHaveLength(1)
    expect(rows[0].notes).toBeNull() // nothing but the name was required, nothing else was invented
  })

  test('an empty name is the only thing that blocks the save', async ({ page }) => {
    await openAs(page, 'sales', '/companies')
    await page.getByRole('button', { name: 'New company' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'New company' })
    await dialog.getByRole('button', { name: 'Add company' }).click()
    await expect(dialog.getByText('Enter the company name.').first()).toBeVisible()
    await expect(dialog).toBeVisible()
  })

  test('a name that exists in any case says so plainly and offers Open it', async ({ page }) => {
    const existing = await createCompany(uniqueName('Karachi Glassworks'))
    await openAs(page, 'engineer', '/companies')
    await page.getByRole('button', { name: 'New company' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'New company' })
    await dialog.getByRole('textbox', { name: /Company name/ }).fill(`  ${existing.name.toUpperCase()} `)
    await dialog.getByRole('button', { name: 'Add company' }).click()

    await expect(dialog.getByText('A company with this name already exists.')).toBeVisible()
    await review(page, 'create-dialog-duplicate-1440')
    await dialog.getByRole('link', { name: 'Open it' }).click()
    await expect(page).toHaveURL(new RegExp(`/companies/${existing.id}$`))
    await expect(page.getByRole('heading', { name: existing.name, level: 1 })).toBeVisible()

    const all = await must(rest<unknown[]>('admin', `companies?name=ilike.${encodeURIComponent(existing.name)}`))
    expect(all).toHaveLength(1)
  })

  test('the command palette finds a company by name and opens it', async ({ page }) => {
    const company = await createCompany(uniqueName('Palette Probe'))
    await openAs(page, 'sales', '/todo')
    await openPalette(page)
    await page.getByRole('combobox').fill(company.name.slice(0, 18))
    const hit = page.getByRole('option', { name: company.name, exact: true })
    await expect(hit).toBeVisible()
    await hit.click()
    await expect(page).toHaveURL(new RegExp(`/companies/${company.id}$`))
  })

  test('the palette offers to add a name that is not on file', async ({ page }) => {
    await openAs(page, 'sales', '/todo')
    await openPalette(page)
    await page.getByRole('combobox').fill('Zzyzx Brand New Works')
    await page.getByRole('option', { name: /Add “Zzyzx Brand New Works” as a new company/ }).click()
    await expect(page).toHaveURL(/\/companies/)
    const dialog = page.getByRole('dialog', { name: 'New company' })
    await expect(dialog.getByRole('textbox', { name: /Company name/ })).toHaveValue('Zzyzx Brand New Works')
  })
})

test.describe('companies list search (audit F1)', () => {
  test('finds a company by a contact name, or by a phone number written with 0 or with +92', async ({ page }) => {
    const company = await createCompany(uniqueName('Search Contact Co'), { country: 'Pakistan', city: 'Hyderabad' })
    const tag = Date.now().toString(36)
    const contact = `Rukhsana${tag} Iqbal`
    let local = ''
    do local = String(1_000_000 + Math.floor(Math.random() * 8_999_999))
    while (`333${local}`.includes('399')) // the saved key is "333" + local: "0399 <local>" below must match nothing of ours
    await must(rest('admin', 'contacts', { method: 'POST', body: { company_id: company.id, name: contact, phone: `+92 333 ${local}` } }))

    await openAs(page, 'sales', '/companies')
    await expect(page.getByRole('heading', { name: 'Companies', level: 1 })).toBeVisible()
    const search = page.getByRole('textbox', { name: 'Search companies or contacts' })
    await expect(search).toHaveAttribute('placeholder', 'Search companies')

    await search.fill(`rukhsana${tag}`)
    const row = page.getByRole('row', { name: new RegExp(company.name) })
    await expect(row).toBeVisible()
    await expect(row).toContainText(`Contact: ${contact}`)
    await expect(row).toContainText('Hyderabad') // the city, not the country on every row
    const companyRows = page.getByRole('row').filter({ has: page.getByRole('link') })
    await expect(companyRows).toHaveCount(1)

    await search.fill(`0333 ${local}`) // saved as +92 333 ..., typed the local way
    await expect(page.getByRole('row', { name: new RegExp(company.name) })).toBeVisible()
    await expect(companyRows).toHaveCount(1)
    await review(page, 'companies-search-phone-1440')

    await search.fill(`0399 ${local}`)
    await expect(page.getByText(`Nothing matches "0399 ${local}"`)).toBeVisible()
    await expect(page.getByRole('button', { name: /Add “0399/ })).toHaveCount(0) // a number is not offered as a company name
  })
})

test.describe('company page', () => {
  test('a customer shows its sites with their RFQs, contacts and details', async ({ page }) => {
    const company = await createCompany(uniqueName('Page Customer'), { country: 'Pakistan', city: 'Karachi' })
    const site = (await must(rest<{ id: string }[]>('admin', 'company_sites', { method: 'POST', body: { company_id: company.id, name: 'Main plant', address: 'Plot 14, Landhi' } })))[0]
    await must(rest('admin', 'contacts', { method: 'POST', body: { company_id: company.id, site_id: site.id, name: 'Naveed Akhtar', job_title: 'Finance' } }))
    const rfq = await createRfq(company.id, { site_id: site.id, customer_ref: 'ENQ-2211' })

    await openAs(page, 'sales', `/companies/${company.id}`)
    await expect(page.getByRole('heading', { name: company.name, level: 1 })).toBeVisible()
    // An RFQ and no order yet: the derived role, said once, as a Tag on its own row under the name (never inside the h1).
    await expect(page.getByRole('heading', { name: company.name, level: 1 })).not.toContainText('Prospect')
    await expect(page.locator('header').getByText('Prospect', { exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Main plant' }).getByText(rfqRef(rfq.number))).toBeVisible()
    await expect(page.getByText('Karachi, Pakistan')).toBeVisible() // the place under the name: city, country
    await expect(page.getByText('Naveed Akhtar')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Contacts' }).getByText('Finance')).toBeVisible() // the job title under the name
    // Roles and Brands carried are one Details panel now (UX audit 9b); the role chip is said once, in the header.
    const details = page.getByRole('region', { name: 'Details', exact: true })
    await expect(details.getByText('Customer since')).toBeVisible()
    await expect(details.getByText('Also a supplier')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Roles' })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Brands carried' })).toHaveCount(0) // a customer carries no brands
    await expect(page.getByRole('heading', { name: 'History' })).toHaveCount(0) // no placeholder panel: the mockup has none
    await expect(page.getByRole('heading', { name: 'Money with them' })).toHaveCount(0)
    await review(page, 'company-customer-1440')
  })

  test('site history reads What, one state word per order (Cancelled, Payment overdue, else the goods word), the RFQ state words and the Repeat order slot', async ({ page }) => {
    const company = await createCompany(uniqueName('History Customer'), { country: 'Pakistan' })
    const site = (await must(rest<{ id: string }[]>('admin', 'company_sites', { method: 'POST', body: { company_id: company.id, name: 'Main plant', address: 'Plot 14, Landhi' } })))[0]
    const supplier = await createCompany(uniqueName('History Supplier'))
    // An open RFQ with a quotation due date, a closed one with a reason, and a delivered order.
    const open = await createRfq(company.id, { site_id: site.id, due_on: karachiDay(9) })
    await must(rest('admin', 'rfq_items', { method: 'POST', body: { rfq_id: open.id, description: 'Furnace zone thermocouples and transmitters' } }))
    const closed = await createRfq(company.id, { site_id: site.id, closed_on: karachiDay(-1), close_reason: 'no_reply_to_clarification' })
    await must(rest('admin', 'rfq_items', { method: 'POST', body: [{ rfq_id: closed.id, description: 'Compressed air flow meters' }, { rfq_id: closed.id, description: 'Flow meter cable' }] }))
    const order = (await must(rest<{ id: string; number: number }[]>('admin', 'orders', { method: 'POST', body: { company_id: company.id, site_id: site.id } })))[0]
    const leg = (await must(rest<{ id: string }[]>('admin', 'supplier_orders', { method: 'POST', body: { order_id: order.id, supplier_id: supplier.id, currency: 'PKR', placed_on: karachiDay(-5), expected_on: karachiDay(-2), received_on: karachiDay(-2), delivered_on: karachiDay(-1) } })))[0]
    await must(rest('admin', 'order_items', { method: 'POST', body: { order_id: order.id, description: 'Annealing lehr instrumentation', unit_price_net: 100, supplier_order_id: leg.id } }))

    await openAs(page, 'sales', `/companies/${company.id}`)
    const siteRegion = page.getByRole('region', { name: 'Main plant' })
    await expect(siteRegion.getByText('What', { exact: true })).toBeVisible() // the list's column words
    await expect(siteRegion.getByText('Furnace zone thermocouples and transmitters')).toBeVisible()
    await expect(siteRegion.getByText(/^Quotation due \d{1,2} \w{3}$/)).toBeVisible() // sentence case, like every state (round 3)
    await expect(siteRegion.getByText('Compressed air flow meters')).toBeVisible()
    await expect(siteRegion.getByText('+ 1 more')).toBeVisible()
    await expect(siteRegion.getByText('No reply from customer')).toBeVisible()
    const orderRow = siteRegion.getByRole('listitem').filter({ hasText: 'Annealing lehr instrumentation' })
    await expect(orderRow.getByText('Delivered')).toBeVisible()
    // one state per row: the goods word; invoicing is on the order page, not repeated here
    await expect(orderRow.getByText('To invoice')).toHaveCount(0)
    // Repeat order is live (O02): it opens the New order dialog with this order already chosen (its journey is in e2e/orders/repeat.spec.ts).
    const repeat = orderRow.getByRole('button', { name: /Repeat order/ })
    await expect(repeat).toBeEnabled()
    // never clipped: the whole button is inside the site's panel (it was cut to "Re" at 1366)
    const [btn, panel] = await Promise.all([repeat.boundingBox(), siteRegion.boundingBox()])
    expect(btn!.x + btn!.width).toBeLessThanOrEqual(panel!.x + panel!.width)
    await expect(repeat).toContainText('Repeat order')
    await expect(siteRegion.getByRole('columnheader', { name: 'Their reference' })).toHaveCount(0)
    await review(page, 'parity-d-company-customer-1440')
  })

  test('O06: two sites of one company (Karachi and Lahore) keep their RFQs and orders apart on the one company page', async ({ page }) => {
    const company = await createCompany(uniqueName('Two Site Customer'), { country: 'Pakistan' })
    const [khi, lhr] = await Promise.all(
      ['KHI plant', 'LHR plant'].map(async name => (await must(rest<{ id: string }[]>('admin', 'company_sites', { method: 'POST', body: { company_id: company.id, name } })))[0]),
    )
    const khiRfq = await createRfq(company.id, { site_id: khi.id })
    const lhrRfq = await createRfq(company.id, { site_id: lhr.id })
    await must(rest('admin', 'rfq_items', { method: 'POST', body: [{ rfq_id: khiRfq.id, description: 'Karachi furnace sensors' }, { rfq_id: lhrRfq.id, description: 'Lahore boiler gauges' }] }))
    const orders = await Promise.all(
      [khi, lhr].map(async s => (await must(rest<{ id: string }[]>('admin', 'orders', { method: 'POST', body: { company_id: company.id, site_id: s.id } })))[0]),
    )
    await must(rest('admin', 'order_items', { method: 'POST', body: [{ order_id: orders[0].id, description: 'Karachi calibration kit', unit_price_net: 100 }, { order_id: orders[1].id, description: 'Lahore pressure switches', unit_price_net: 100 }] }))

    await openAs(page, 'sales', `/companies/${company.id}`)
    await expect(page.getByRole('heading', { name: company.name, level: 1 })).toBeVisible()
    const k = page.getByRole('region', { name: 'KHI plant' })
    const l = page.getByRole('region', { name: 'LHR plant' })
    await expect(k.getByText('Karachi furnace sensors')).toBeVisible()
    await expect(k.getByText('Karachi calibration kit')).toBeVisible()
    await expect(l.getByText('Lahore boiler gauges')).toBeVisible()
    await expect(l.getByText('Lahore pressure switches')).toBeVisible()
    await expect(k.getByText('Lahore boiler gauges')).toHaveCount(0)
    await expect(k.getByText('Lahore pressure switches')).toHaveCount(0)
    await expect(l.getByText('Karachi furnace sensors')).toHaveCount(0)
    await expect(l.getByText('Karachi calibration kit')).toHaveCount(0)
  })

  test('a supplier says its counts once under the name, with one Enquiries list and no score', async ({ page }) => {
    const supplier = await createCompany(uniqueName('Alpenmark Test'), { country: 'Austria' })
    const customer = await createCompany(uniqueName('Enquiring Customer'))
    const rfq = await createRfq(customer.id)
    await must(rest('admin', 'supplier_inquiries', { method: 'POST', body: { rfq_id: rfq.id, supplier_id: supplier.id, sent_on: karachiDay(-10) } }))

    await openAs(page, 'engineer', `/companies/${supplier.id}`)
    await expect(page.getByRole('heading', { name: supplier.name, level: 1 })).toBeVisible()
    const line = page.getByTestId('supplier-record-line')
    await expect(line).toHaveText('Asked once · no replies') // the counts, once, under the name ("What we know" is gone, round 3)
    const enquiries = page.getByRole('region', { name: 'Enquiries' })
    await expect(enquiries.getByRole('listitem').filter({ hasText: rfqRef(rfq.number) })).toContainText('No reply')
    expect(await line.innerText()).not.toMatch(/score|rating|rank|%/i)
    for (const gone of ['What we know', 'Recent quotes', 'Recent enquiries']) await expect(page.getByRole('heading', { name: gone, exact: true })).toHaveCount(0)

    // The useful history comes first: Enquiries, then Deliveries; sites and details fold under it.
    const top = async (name: string) => (await page.getByRole('heading', { name, level: 2, exact: true }).boundingBox())?.y ?? -1
    const order = [await top('Enquiries'), await top('Deliveries')]
    expect(order.every(y => y >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    await expect(page.getByText('More about this supplier')).toBeVisible()

    // The rules behind the numbers are behind the (i), not printed on the page.
    await expect(page.getByText('With so few enquiries')).toHaveCount(0)
    await expect(page.getByText(/Where this comes from/)).toHaveCount(0)
    await line.getByRole('button', { name: 'About these numbers' }).click()
    await expect(page.getByRole('dialog', { name: 'About these numbers' })).toContainText('With so few enquiries these are facts, not a pattern.')
    await review(page, 'company-supplier-1440')
    await page.keyboard.press('Escape')

    // A supplier-only page's New RFQ (was "Float an RFQ here") is its next step: it opens intake with this supplier already
    // chosen to ask for prices (?supplier=), never with the supplier as the customer.
    await page.getByRole('region', { name: 'Next step' }).getByRole('button', { name: 'New RFQ' }).click()
    await expect(page).toHaveURL(url => url.pathname === '/rfqs/new' && url.searchParams.get('supplier') === supplier.id)
  })

  test('brands are carried by picking one or typing a new one', async ({ page }) => {
    const supplier = await createCompany(uniqueName('Brand Carrier'))
    const brand = uniqueName('Belimo')
    await openAs(page, 'sales', `/companies/${supplier.id}`)
    // Brands carried lives inside the one Details panel of the side column (it was its own panel).
    const panel = page.getByRole('region', { name: 'Details', exact: true }).getByRole('region', { name: 'Brands carried' })
    await panel.getByRole('button', { name: 'Add' }).click()
    await panel.getByRole('combobox', { name: 'Brand or product family' }).fill(brand)
    await page.getByRole('option', { name: new RegExp(`Add “${brand}” as a new brand`) }).click()
    await expect(panel.getByText(brand)).toBeVisible()
    const linked = await must(rest<unknown[]>('admin', `company_brands?company_id=eq.${supplier.id}`))
    expect(linked).toHaveLength(1)
  })

  test('a site and a contact are added in one dialog each, name only', async ({ page }) => {
    const company = await createCompany(uniqueName('Dialog Customer'))
    await openAs(page, 'engineer', `/companies/${company.id}`)
    await page.getByRole('button', { name: 'Add site' }).click()
    await page.getByRole('dialog', { name: 'Add site' }).getByRole('textbox', { name: /Site name/ }).fill('Karachi')
    await page.getByRole('dialog', { name: 'Add site' }).getByRole('button', { name: 'Add site' }).click()
    await expect(page.getByRole('region', { name: 'Karachi' })).toBeVisible()

    await page.getByRole('region', { name: 'Contacts' }).getByRole('button', { name: 'Add' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add contact' })
    await dialog.getByRole('textbox', { name: /^Name/ }).fill('Salman Khan')
    await expect(dialog.getByText('Only site on file: Karachi')).toBeVisible() // pre-filled, with its source
    await dialog.getByRole('button', { name: 'Add contact' }).click()
    await expect(page.getByText('Salman Khan')).toBeVisible()
  })
})

test.describe('admin merge', () => {
  test('merging a duplicate moves its RFQs, contacts and sites to the company you keep', async ({ page }) => {
    const keep = await createCompany(uniqueName('Keep Glassworks'))
    const drop = await createCompany(uniqueName('Keep Glass Works'))
    const rfq = await createRfq(drop.id, { customer_ref: 'DUP-1' })
    await must(rest('admin', 'contacts', { method: 'POST', body: { company_id: drop.id, name: 'Moved Contact' } }))
    await must(rest('admin', 'company_sites', { method: 'POST', body: { company_id: drop.id, name: 'Moved Site' } }))

    await openAs(page, 'admin', `/companies/${drop.id}`)
    await expect(page.getByRole('heading', { name: drop.name, level: 1 })).toBeVisible()
    await page.getByRole('button', { name: /^More( actions)?$/ }).click()
    await page.getByRole('menuitem', { name: 'Merge into another company' }).click()
    const dialog = page.getByRole('dialog', { name: 'Merge duplicate company' })
    await dialog.getByRole('combobox', { name: 'Merge into' }).fill(keep.name)
    await page.getByRole('option', { name: new RegExp(keep.name) }).click()
    await expect(dialog.getByText(/1 RFQ, 0 orders, 1 contact, 1 site move to/)).toBeVisible()
    await review(page, 'merge-dialog-1440')
    await dialog.getByRole('button', { name: `Merge into ${keep.name}` }).click()

    await expect(page).toHaveURL(new RegExp(`/companies/${keep.id}$`))
    await expect(page.getByRole('heading', { name: keep.name, level: 1 })).toBeVisible()
    await expect(page.getByText(rfqRef(rfq.number))).toBeVisible()
    await expect(page.getByText('Moved Contact')).toBeVisible()
    await review(page, 'after-merge-1440')

    // The database agrees: the RFQ now belongs to the kept company and the duplicate is gone.
    const moved = await must(rest<{ company_id: string }[]>('admin', `rfqs?id=eq.${rfq.id}&select=company_id`))
    expect(moved[0].company_id).toBe(keep.id)
    expect(await must(rest<unknown[]>('admin', `companies?id=eq.${drop.id}`))).toHaveLength(0)
    expect(await must(rest<unknown[]>('admin', `contacts?company_id=eq.${keep.id}&name=eq.Moved%20Contact`))).toHaveLength(1)
    expect(await must(rest<unknown[]>('admin', `company_sites?company_id=eq.${keep.id}&name=eq.Moved%20Site`))).toHaveLength(1)

    // The page for the removed company says where to look instead of crashing.
    await page.goto(`/companies/${drop.id}`)
    await expect(page.getByText("This company isn't here")).toBeVisible()
  })

  test('a clash the database cannot settle is refused in plain words and nothing moves', async ({ page }) => {
    const keep = await createCompany(uniqueName('Clash Keep'))
    const drop = await createCompany(uniqueName('Clash Drop'))
    await createRfq(keep.id, { customer_ref: 'SAME-REF' })
    const dropRfq = await createRfq(drop.id, { customer_ref: 'SAME-REF' })

    await openAs(page, 'admin', `/companies/${drop.id}`)
    await page.getByRole('button', { name: /^More( actions)?$/ }).click()
    await page.getByRole('menuitem', { name: 'Merge into another company' }).click()
    const dialog = page.getByRole('dialog', { name: 'Merge duplicate company' })
    await dialog.getByRole('combobox', { name: 'Merge into' }).fill(keep.name)
    await page.getByRole('option', { name: new RegExp(keep.name) }).click()
    await dialog.getByRole('button', { name: `Merge into ${keep.name}` }).click()

    await expect(dialog.getByText(/same customer reference/i)).toBeVisible()
    await expect(dialog.getByText('Nothing was changed.')).toBeVisible()
    const still = await must(rest<{ company_id: string }[]>('admin', `rfqs?id=eq.${dropRfq.id}&select=company_id`))
    expect(still[0].company_id).toBe(drop.id)
  })
})

test.describe('access by role (DATA_MODEL section 10)', () => {
  test('sales and engineers get no merge action and never request money; admin does', async ({ browser }) => {
    const company = await createCompany(uniqueName('Role Probe'))
    const money: Record<string, number> = {}
    for (const role of ['sales', 'engineer', 'admin'] as const) {
      const context = await browser.newContext()
      const page = await context.newPage()
      let seen = 0
      page.on('request', r => {
        if (r.url().includes('/rest/v1/v_order_money')) seen++
      })
      await openAs(page, role, `/companies/${company.id}`)
      await expect(page.getByRole('heading', { name: company.name, level: 1 })).toBeVisible()
      await page.waitForLoadState('networkidle')
      // Everyone has the "..." menu the design draws; only an admin finds Merge in it.
      await page.getByRole('button', { name: /^More( actions)?$/ }).click()
      await expect(page.getByRole('menuitem', { name: 'Copy link to this company' })).toBeVisible()
      expect(await page.getByRole('menuitem', { name: 'Merge into another company' }).count(), `${role} merge menu`).toBe(role === 'admin' ? 1 : 0)
      money[role] = seen
      await context.close()
    }
    expect(money.sales).toBe(0)
    expect(money.engineer).toBe(0)
    expect(money.admin).toBeGreaterThan(0)
  })

  test('the database refuses what the screen hides', async () => {
    const a = await createCompany(uniqueName('RLS One'))
    const b = await createCompany(uniqueName('RLS Two'))
    for (const role of ['sales', 'engineer'] as const) {
      const merge = await rest<{ message: string }>(role, 'rpc/merge_companies', { method: 'POST', body: { p_keep: a.id, p_drop: b.id } })
      expect(merge.status, `${role} merge`).toBeGreaterThanOrEqual(400)
      const money = await rest<unknown[]>(role, `v_order_money?company_id=eq.${a.id}`)
      expect(money.body ?? []).toHaveLength(0)
      const del = await rest<unknown[]>(role, `companies?id=eq.${b.id}`, { method: 'DELETE' })
      expect(del.body ?? []).toHaveLength(0)
    }
    expect(await must(rest<unknown[]>('admin', `companies?id=eq.${b.id}`))).toHaveLength(1)
  })

  test('engineers and sales can create and edit companies (section 10: SIU)', async () => {
    for (const role of ['sales', 'engineer'] as const) {
      const made = await rest<{ id: string }[]>(role, 'companies', { method: 'POST', body: { name: uniqueName(`Made by ${role}`) } })
      expect(made.status).toBe(201)
      const edited = await rest<{ country: string }[]>(role, `companies?id=eq.${made.body[0].id}`, { method: 'PATCH', body: { country: 'Pakistan' } })
      expect(edited.status).toBe(200)
      expect(edited.body[0].country).toBe('Pakistan')
    }
  })
})

test.describe('review screenshots (only with REVIEW_DIR)', () => {
  test.skip(!process.env.REVIEW_DIR, 'screenshots are for the review folder')

  for (const [label, width, height] of [
    ['1440', 1440, 900],
    ['375', 375, 812],
    ['768', 768, 1024],
  ] as const) {
    test(`list and company pages at ${label}`, async ({ browser }) => {
      const customer = await createCompany(uniqueName('Shot Customer'), { country: 'Pakistan' })
      const site = (await must(rest<{ id: string }[]>('admin', 'company_sites', { method: 'POST', body: { company_id: customer.id, name: 'Main plant', address: 'Plot 14' } })))[0]
      await createRfq(customer.id, { site_id: site.id })
      const supplier = await createCompany(uniqueName('Shot Supplier'), { country: 'Austria' })
      const rfq = await createRfq(customer.id)
      await must(rest('admin', 'supplier_inquiries', { method: 'POST', body: { rfq_id: rfq.id, supplier_id: supplier.id, sent_on: karachiDay(-10) } }))
      const context = await browser.newContext({ viewport: { width, height } })
      const page = await context.newPage()
      await openAs(page, 'sales', '/companies')
      await expect(page.getByRole('heading', { name: 'Companies', level: 1 })).toBeVisible()
      await review(page, `companies-list-${label}`)
      await page.goto(`/companies/${customer.id}`)
      await expect(page.getByRole('heading', { name: customer.name, level: 1 })).toBeVisible()
      await review(page, `company-customer-${label}`)
      await page.goto(`/companies/${supplier.id}`)
      await expect(page.getByRole('heading', { name: 'Enquiries', exact: true })).toBeVisible()
      await review(page, `company-supplier-${label}`)
      await context.close()
    })
  }
})
