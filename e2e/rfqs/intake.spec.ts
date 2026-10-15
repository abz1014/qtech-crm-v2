import { expect, test, type Page } from '@playwright/test'
import { createCompany, createRfq, karachiDay, must, openAs, review, rest, rfqRef, uniqueName } from '../support/stack'
import { axeViolations } from '../support/axe'

/*
 * R05 end to end, against the local CI stack: the intake = float screen, as the fixture users, through the real
 * login form. Each test makes its own companies, brands and suppliers with unique names, so tests do not depend on
 * each other or on the seed beyond its fixture users.
 *
 * FE-2 targets asserted here (BUILD_PLAN FE-2):
 *   New RFQ, desktop   at most 3 actions + 1 paste   (pick the company = 2: type, choose; then "Looks right")
 *   Float              at most 2 taps                (Write the enquiry, Copy & mark floated)
 *   R05 canonical      at most 15 interactions in all, Undo included
 */

const SALES_ID = 'a0000000-0000-4000-8000-000000000002'

async function paste(page: Page, text: string): Promise<void> {
  // The page listens for a paste anywhere; this is what Ctrl+V with nothing focused delivers.
  await page.evaluate(t => {
    const dt = new DataTransfer()
    dt.setData('text/plain', t)
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, text)
}

const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText())

const violations = (page: Page): Promise<string[]> => axeViolations(page)

interface Seed {
  customer: { id: string; name: string }
  brand1: string
  brand2: string
  supplied: { id: string; name: string } // supplied item 1 before: the only pre-tick
  carries: { id: string; name: string } // carries brand 1, no history: suggested, not ticked
  other: { id: string; name: string } // carries brand 2, no history
  model: string
  email: string
}

async function seed(opts: { site?: boolean } = {}): Promise<Seed> {
  const tag = Math.random().toString(36).slice(2, 6)
  const brand1 = `Zetaflow${tag}`
  const brand2 = `Qmeter${tag}`
  const model = `QZ${Math.floor(1000 + Math.random() * 9000)}`
  const b1 = (await must(rest<{ id: string }[]>('admin', 'brands', { method: 'POST', body: { name: brand1, kind: 'brand' } })))[0]
  const b2 = (await must(rest<{ id: string }[]>('admin', 'brands', { method: 'POST', body: { name: brand2, kind: 'brand' } })))[0]

  const customer = await createCompany(uniqueName('Mianwali Test'))
  if (opts.site) {
    const site = (await must(rest<{ id: string }[]>('admin', 'company_sites', { method: 'POST', body: { company_id: customer.id, name: 'Mianwali plant' } })))[0]
    await must(rest('admin', 'contacts', { method: 'POST', body: { company_id: customer.id, site_id: site.id, name: 'Kamran Zafar' } }))
  }

  const supplied = await createCompany(uniqueName('Orient Test'))
  const carries = await createCompany(uniqueName('Carrier Test'))
  const other = await createCompany(uniqueName('Gateway Test'))
  await must(rest('admin', 'company_brands', { method: 'POST', body: [{ company_id: supplied.id, brand_id: b1.id }, { company_id: carries.id, brand_id: b1.id }, { company_id: other.id, brand_id: b2.id }] }))

  // The history that earns the tick: an earlier order of the same model from this brand, bought through `supplied`.
  const past = await createCompany(uniqueName('Earlier Customer'))
  const order = (await must(rest<{ id: string }[]>('admin', 'orders', { method: 'POST', body: { company_id: past.id } })))[0]
  const leg = (await must(rest<{ id: string }[]>('admin', 'supplier_orders', { method: 'POST', body: { order_id: order.id, supplier_id: supplied.id } })))[0]
  await must(
    rest('admin', 'order_items', {
      method: 'POST',
      body: { order_id: order.id, description: `${brand1} ${model} electromagnetic flow meter`, brand_id: b1.id, unit_price_net: 100, supplier_order_id: leg.id },
    }),
  )

  const email = [
    'Dear Sir, please quote the following for our plant:',
    `1) ${brand1} ${model} electromagnetic flow meter DN50 - 2 nos`,
    `2) ${brand2} gateway module 24V x 4`,
    'Regards, Kamran Zafar',
  ].join('\n')
  return { customer, brand1, brand2, supplied, carries, other, model, email }
}

interface RfqRow {
  id: string
  number: number
  received_on: string
  owner_id: string
  is_priority: boolean
  site_id: string | null
  contact_id: string | null
  customer_ref: string | null
  due_on: string | null
}
const rfqsOf = (companyId: string) =>
  must(rest<RfqRow[]>('admin', `rfqs?company_id=eq.${companyId}&select=id,number,received_on,owner_id,is_priority,site_id,contact_id,customer_ref,due_on`))
const inquiriesOf = (rfqId: string) =>
  must(rest<{ supplier_id: string; sent_on: string | null }[]>('admin', `supplier_inquiries?rfq_id=eq.${rfqId}&select=supplier_id,sent_on`))
const itemsOf = (rfqId: string) =>
  must(rest<{ description: string; qty: number; unit: string | null; gst_rate: number; brand_id: string | null; position: number }[]>('admin', `rfq_items?rfq_id=eq.${rfqId}&order=position&select=description,qty,unit,gst_rate,brand_id,position`))

/** The whole supplier row is the tap target: its name is the label that covers the row. */
async function tick(page: Page, name: string): Promise<void> {
  await page.locator('label').filter({ hasText: name }).click()
}

async function pickCompany(page: Page, name: string): Promise<void> {
  await page.getByRole('combobox', { name: 'Company' }).fill(name)
  await page.getByRole('option', { name: new RegExp(name) }).click()
  await expect(page.getByText(name).first()).toBeVisible()
}

test.describe('canonical scenario (FE-2 counts)', () => {
  test('company, paste, suppliers, enquiry, copy and float, then Undo', async ({ page }) => {
    const s = await seed()
    await openAs(page, 'sales', '/rfqs/new')
    await expect(page.getByRole('heading', { name: 'New RFQ', level: 1 })).toBeVisible()
    await review(page, 'intake-float-01-empty-1440')

    let actions = 0
    let pastes = 0
    // New RFQ: pick the company (type, choose), paste, "Looks right".
    await page.getByRole('combobox', { name: 'Company' }).fill(s.customer.name)
    actions++ // 1
    await review(page, 'intake-float-02-company-typed-1440')
    await page.getByRole('option', { name: new RegExp(s.customer.name) }).click()
    actions++ // 2
    await paste(page, s.email)
    pastes++
    await expect(page.getByText('2 items found').first()).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Quantity of item 1' })).toHaveValue('2')
    await expect(page.getByRole('textbox', { name: 'Description of item 1' })).toHaveValue(`${s.brand1} ${s.model} electromagnetic flow meter DN50`)
    await expect(page.getByRole('combobox', { name: 'Brand of item 1' }).locator('option:checked')).toHaveText(s.brand1) // picked from the text
    await expect(page.getByRole('textbox', { name: 'Quantity of item 2' })).toHaveValue('4')
    await review(page, 'intake-float-03-items-pasted-1440')
    await page.getByRole('button', { name: 'Looks right: find suppliers' }).click()
    actions++ // 3
    const newRfqActions = actions
    expect(newRfqActions).toBeLessThanOrEqual(3)
    expect(pastes).toBe(1)

    // Suppliers: reasons first. Only the one that supplied it before is ticked; the item nobody is asked about is flagged.
    await expect(page.getByRole('heading', { name: 'Supplied this item before', level: 3 })).toBeVisible()
    await expect(page.getByRole('checkbox', { name: s.supplied.name })).toBeChecked()
    await expect(page.getByRole('checkbox', { name: s.carries.name })).not.toBeChecked()
    await expect(page.getByRole('checkbox', { name: s.other.name })).not.toBeChecked()
    await expect(page.getByText(/Supplied this item before: /)).toBeVisible()
    await expect(page.getByText(/Item 2, .* has no supplier ticked\./)).toBeVisible()
    expect(await page.locator('main').innerText()).not.toMatch(/score|rating|rank \d|%/i)
    await review(page, 'intake-float-04-suppliers-1440')

    // Float: Write the enquiry, Copy & mark floated.
    let floatTaps = 0
    await page.getByRole('button', { name: 'Write the enquiry' }).click()
    floatTaps++ // 1
    actions++
    await expect(page.getByRole('heading', { name: /Enquiry to 1 supplier/ })).toBeVisible()
    await expect(page.getByLabel('Enquiry text')).toHaveValue(/Spec: left blank/)
    await review(page, 'intake-float-05-enquiry-1440')
    await page.getByRole('button', { name: 'Copy & mark floated to 1' }).click()
    floatTaps++ // 2
    actions++
    await expect(page.getByText(/is out for prices/)).toBeVisible()
    expect(floatTaps).toBeLessThanOrEqual(2)

    const [rfq] = await rfqsOf(s.customer.id)
    expect(rfq).toBeTruthy()
    const text = await clipboard(page)
    expect(text).toContain(`our ref *${rfqRef(rfq.number)}*`) // the number the database gave it, not the placeholder
    expect(text).not.toContain('####')
    expect(text).toMatch(/Spec: left blank/)
    expect(text).toContain(`${s.brand1} ${s.model} electromagnetic flow meter DN50, 2 nos`)

    // Entry burden: nothing was typed for these.
    expect(rfq.received_on).toBe(karachiDay())
    expect(rfq.owner_id).toBe(SALES_ID)
    expect(rfq.is_priority).toBe(false)
    expect(rfq.customer_ref).toBeNull()
    expect(rfq.due_on).toBeNull()
    const items = await itemsOf(rfq.id)
    expect(items.map(i => [i.qty, i.unit, i.gst_rate])).toEqual([
      [2, 'nos', 18],
      [4, null, 18],
    ])
    expect(items[0].brand_id).not.toBeNull()
    let inquiries = await inquiriesOf(rfq.id)
    expect(inquiries).toEqual([{ supplier_id: s.supplied.id, sent_on: karachiDay() }])

    // Undo within the toast: the RFQ stays, the inquiry goes back to shortlisted.
    await expect(page.getByRole('status').filter({ hasText: 'Floated to 1' })).toBeVisible()
    await review(page, 'intake-float-06-floated-with-undo-1440')
    await page.getByRole('button', { name: /Undo/ }).click()
    actions++
    await expect(page.getByText('Float undone').first()).toBeVisible()
    inquiries = await inquiriesOf(rfq.id)
    expect(inquiries).toEqual([{ supplier_id: s.supplied.id, sent_on: null }])
    expect(await rfqsOf(s.customer.id)).toHaveLength(1)
    await review(page, 'intake-float-07-after-undo-1440')
    expect(actions + pastes).toBeLessThanOrEqual(15)

    // Copying again floats the saved RFQ (no second RFQ).
    await page.getByRole('button', { name: 'Copy & mark floated to 1' }).click()
    await expect(page.getByText(/is out for prices/)).toBeVisible()
    inquiries = await inquiriesOf(rfq.id)
    expect(inquiries[0].sent_on).toBe(karachiDay())
    expect(await rfqsOf(s.customer.id)).toHaveLength(1)
  })

  test('a double tap on Copy & mark floated makes one RFQ', async ({ page }) => {
    const s = await seed()
    const ref = `DT-${Date.now().toString(36)}`
    await openAs(page, 'sales', '/rfqs/new')
    await pickCompany(page, s.customer.name)
    await paste(page, s.email)
    await page.getByRole('textbox', { name: 'Customer reference' }).fill(ref)
    await page.getByRole('button', { name: 'Looks right: find suppliers' }).click()
    await page.getByRole('button', { name: 'Write the enquiry' }).click()
    await page.getByRole('button', { name: 'Copy & mark floated to 1' }).dblclick()
    await expect(page.getByText(/is out for prices/)).toBeVisible()
    const rows = await must(rest<{ id: string }[]>('admin', `rfqs?company_id=eq.${s.customer.id}&customer_ref=eq.${ref}&select=id`))
    expect(rows).toHaveLength(1)
    expect(await inquiriesOf(rows[0].id)).toHaveLength(1)
  })
})

test.describe('what is required and what is pre-filled (FE-2)', () => {
  test('a company and one typed item are enough; qty is 1, GST 18, today and the owner fill themselves', async ({ page }) => {
    const customer = await createCompany(uniqueName('Bare Minimum'))
    await openAs(page, 'engineer', '/rfqs/new')
    await expect(page.getByRole('button', { name: 'Looks right: find suppliers' })).toBeDisabled()
    await expect(page.getByText('Choose the company and paste or add at least one item.')).toBeVisible()
    await pickCompany(page, customer.name)
    await page.getByRole('button', { name: 'Add an item by hand' }).click()
    await page.getByRole('textbox', { name: 'Description of item 1' }).fill('Spare gasket set')
    await page.getByRole('button', { name: 'Save without floating' }).click()
    await expect(page.getByText(/is saved/)).toBeVisible()

    const [rfq] = await rfqsOf(customer.id)
    expect(rfq.received_on).toBe(karachiDay())
    expect(rfq.owner_id).toBe('a0000000-0000-4000-8000-000000000003') // the engineer who entered it
    const items = await itemsOf(rfq.id)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ description: 'Spare gasket set', qty: 1, unit: null, gst_rate: 18, brand_id: null })
    expect(await inquiriesOf(rfq.id)).toEqual([])
  })

  test('site and contact fill themselves when the company has exactly one, and say where they came from', async ({ page }) => {
    const s = await seed({ site: true })
    await openAs(page, 'sales', `/rfqs/new?company=${s.customer.id}`)
    await expect(page.getByText(s.customer.name).first()).toBeVisible()
    await expect(page.getByLabel('Site')).toHaveValue(/.+/)
    await expect(page.getByText('Only site on file')).toBeVisible()
    await expect(page.getByText('Only contact on file')).toBeVisible()
    await paste(page, s.email)
    await page.getByRole('button', { name: 'Save without floating' }).click()
    await expect(page.getByText(/is saved/)).toBeVisible()
    const [rfq] = await rfqsOf(s.customer.id)
    expect(rfq.site_id).not.toBeNull()
    expect(rfq.contact_id).not.toBeNull()
  })

  test('customer reference, bid due date and top priority are optional extras and are saved when given', async ({ page }) => {
    const s = await seed()
    const ref = `ENQ-${Date.now().toString(36)}`
    await openAs(page, 'sales', '/rfqs/new')
    await pickCompany(page, s.customer.name)
    await paste(page, s.email)
    await page.getByRole('textbox', { name: 'Customer reference' }).fill(ref)
    await page.getByRole('textbox', { name: /Bid due/ }).fill('3 dec 2030')
    await page.getByRole('checkbox', { name: /Top priority/ }).check()
    await page.getByRole('button', { name: 'Save without floating' }).click()
    await expect(page.getByText(/is saved/)).toBeVisible()
    const [rfq] = await rfqsOf(s.customer.id)
    expect(rfq).toMatchObject({ customer_ref: ref, due_on: '2030-12-03', is_priority: true })
  })
})

test.describe('save only, and no supplier ticked', () => {
  test('a company with no suppliers on file saves without floating: no inquiry, nothing sent', async ({ page }) => {
    const customer = await createCompany(uniqueName('Nobody Knows'))
    await openAs(page, 'sales', '/rfqs/new')
    await pickCompany(page, customer.name)
    await paste(page, '1. Hand-made one-off bracket - 3 nos')
    await page.getByRole('button', { name: 'Looks right: find suppliers' }).click()
    await expect(page.getByText('0 suppliers ticked')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Write the enquiry' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Save without floating' }).click()
    await expect(page.getByText(/is saved/)).toBeVisible()
    expect(await violations(page)).toEqual([])
    const [rfq] = await rfqsOf(customer.id)
    expect(await inquiriesOf(rfq.id)).toEqual([])
    await expect(page.getByRole('link', { name: `Open ${rfqRef(rfq.number)}` })).toBeVisible()
  })

  test('saved without floating keeps the ticked supplier shortlisted, then floats from the saved RFQ', async ({ page }) => {
    const s = await seed()
    await openAs(page, 'sales', '/rfqs/new')
    await pickCompany(page, s.customer.name)
    await paste(page, s.email)
    await page.getByRole('button', { name: 'Looks right: find suppliers' }).click()
    await expect(page.getByRole('checkbox', { name: s.supplied.name })).toBeChecked()
    await tick(page, s.carries.name)
    await expect(page.getByRole('checkbox', { name: s.carries.name })).toBeChecked()
    await page.getByRole('button', { name: 'Save without floating' }).click()
    await expect(page.getByText(/is saved/)).toBeVisible()
    const [rfq] = await rfqsOf(s.customer.id)
    const shortlisted = await inquiriesOf(rfq.id)
    expect(shortlisted.map(i => i.sent_on)).toEqual([null, null])
    expect(shortlisted.map(i => i.supplier_id).sort()).toEqual([s.supplied.id, s.carries.id].sort())

    await page.getByRole('button', { name: 'Write the enquiry' }).click()
    await expect(page.getByLabel('Enquiry text')).toHaveValue(new RegExp(rfqRef(rfq.number)))
    await page.getByRole('button', { name: 'Copy & mark floated to 2' }).click()
    await expect(page.getByText(/is out for prices/)).toBeVisible()
    const floated = await inquiriesOf(rfq.id)
    expect(floated.map(i => i.sent_on)).toEqual([karachiDay(), karachiDay()])
    expect(await rfqsOf(s.customer.id)).toHaveLength(1)
  })

  test('a customer reference the customer already has is refused in plain words and nothing is created', async ({ page }) => {
    const s = await seed()
    const ref = `SAME-${Date.now().toString(36)}`
    const existing = (await must(rest<{ id: string; number: number }[]>('admin', 'rfqs', { method: 'POST', body: { company_id: s.customer.id, customer_ref: ref } })))[0]
    await openAs(page, 'sales', '/rfqs/new')
    await pickCompany(page, s.customer.name)
    await paste(page, s.email)
    await page.getByRole('textbox', { name: 'Customer reference' }).fill(ref)
    await page.getByRole('button', { name: 'Save without floating' }).click()
    await expect(page.getByText('This customer already has an RFQ with that reference.')).toBeVisible()
    await expect(page.getByRole('link', { name: `Open ${rfqRef(existing.number)}` })).toBeVisible()
    expect(await rfqsOf(s.customer.id)).toHaveLength(1)
  })
})

test.describe('company picker', () => {
  test('a company that is not on file is added inline (name, optional contact) without leaving the page', async ({ page }) => {
    const name = uniqueName('Brand New Works')
    await openAs(page, 'sales', '/rfqs/new')
    let actions = 0
    await page.getByRole('combobox', { name: 'Company' }).fill(name)
    actions++
    await expect(page.getByText('Saved as a prospect until the first order')).toBeVisible()
    await page.getByRole('option', { name: new RegExp(`Add “${name}” as a new company`) }).click()
    actions++
    const inline = page.getByRole('region', { name: 'New company' })
    await expect(inline.getByRole('textbox', { name: /Company name/ })).toHaveValue(name)
    await expect(inline.getByText('City and contact can wait. Add them from the company page later.')).toBeVisible()
    await inline.getByRole('textbox', { name: /City/ }).fill('Mianwali')
    await inline.getByRole('textbox', { name: /Contact/ }).fill('Kamran Zafar')
    await inline.getByRole('button', { name: 'Create and use' }).click()
    actions++
    await expect(page.getByText(name).first()).toBeVisible()
    await expect(page.getByText('Prospect')).toBeVisible()
    expect(actions).toBeLessThanOrEqual(3) // the optional contact is typed, not a required action
    expect(page.url()).toMatch(/\/rfqs\/new/)
    const rows = await must(rest<{ id: string }[]>('admin', `companies?name=eq.${encodeURIComponent(name)}`))
    expect(rows).toHaveLength(1)
    expect(await must(rest<{ city: string | null }[]>('admin', `companies?id=eq.${rows[0].id}&select=city`))).toEqual([{ city: 'Mianwali' }])
    const contacts = await must(rest<{ name: string }[]>('admin', `contacts?company_id=eq.${rows[0].id}`))
    expect(contacts.map(c => c.name)).toEqual(['Kamran Zafar'])
  })

  test('a near name is listed as a similar name, with its RFQ count, before a new company is added', async ({ page }) => {
    const tag = Math.random().toString(36).slice(2, 8)
    const near = await createCompany(`Mianwali${tag} Plastics Ltd`)
    await createRfq(near.id)
    await openAs(page, 'sales', '/rfqs/new')
    await page.getByRole('combobox', { name: 'Company' }).fill(`Mianwali${tag} Polymers`)
    const option = page.getByRole('option', { name: new RegExp(`Mianwali${tag} Plastics Ltd`) })
    await expect(option).toBeVisible()
    await expect(option).toContainText('similar name')
    await expect(option).toContainText('1 RFQ')
    await expect(page.getByRole('option', { name: /as a new company/ })).toBeVisible()
  })
})

for (const width of [1440, 375]) {
  test(`axe (WCAG 2.2 AA) at ${width}: every step has zero violations, and the review screenshots are taken`, async ({ page }) => {
    const s = await seed({ site: true })
    await page.setViewportSize({ width, height: width > 800 ? 900 : 812 })
    await openAs(page, 'sales', '/rfqs/new')
    expect(await violations(page)).toEqual([])
    await review(page, `intake-float-01-empty-${width}`)

    await pickCompany(page, s.customer.name)
    await paste(page, s.email)
    await expect(page.getByText('2 items found').first()).toBeVisible()
    expect(await violations(page)).toEqual([])
    await review(page, `intake-float-03-items-pasted-${width}`)

    await page.getByRole('button', { name: 'Looks right: find suppliers' }).click()
    await expect(page.getByRole('checkbox', { name: s.supplied.name })).toBeChecked()
    expect(await violations(page)).toEqual([])
    await review(page, `intake-float-04-suppliers-${width}`)

    await page.getByRole('button', { name: 'Write the enquiry' }).click()
    await expect(page.getByRole('heading', { name: /Enquiry to 1 supplier/ })).toBeVisible()
    expect(await violations(page)).toEqual([])
    await review(page, `intake-float-05-enquiry-${width}`)

    await page.getByRole('button', { name: 'Copy & mark floated to 1' }).click()
    await expect(page.getByText(/is out for prices/)).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'Floated to 1' })).toBeVisible()
    expect(await violations(page)).toEqual([])
    await review(page, `intake-float-06-floated-with-undo-${width}`)
  })
}
