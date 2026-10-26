import { expect, test, type Page } from '@playwright/test'
import { createCompany, karachiDay, must, openAs, review, rest, rfqRef, uniqueName } from '../support/stack'
import { axeViolations } from '../support/axe'
import { readClipboardWhen, resetClipboard } from '../support/clipboard'
import { SCENES } from '../docread/scenes'

/*
 * R05 end to end, against the local CI stack: the intake = float screen, as the fixture users, through the real
 * login form. Each test makes its own companies, brands and suppliers with unique names, so tests do not depend on
 * each other or on the seed beyond its fixture users.
 *
 * FE-2 targets asserted here (BUILD_PLAN FE-2):
 *   New RFQ, desktop   at most 3 actions + 1 paste   (pick the company = 2: type, choose; then "Looks right")
 *   Ask suppliers      at most 2 taps                (Write the message, Copy message for N suppliers)
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
  test('company, paste, suppliers, message, copy and ask, then Undo', async ({ page }) => {
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
    await expect(page.getByRole('textbox', { name: 'Quantity of item 1' })).toHaveValue('2 nos')
    await expect(page.getByRole('textbox', { name: 'Description of item 1' })).toHaveValue(`${s.brand1} ${s.model} electromagnetic flow meter DN50`)
    await expect(page.getByRole('combobox', { name: 'Brand of item 1' }).locator('option:checked')).toHaveText(s.brand1) // picked from the text
    await expect(page.getByRole('textbox', { name: 'Quantity of item 2' })).toHaveValue('4 nos')
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
    // Named by its brand, with the supplier that carries it offered as a one-tap tick (owner audit N4). Not ticked for them.
    await expect(page.getByText(/^Item 2 \(.+\): tick .+\?$/)).toBeVisible()
    await expect(page.getByRole('button', { name: /^Tick / })).toBeVisible()
    expect(await page.locator('main').innerText()).not.toMatch(/score|rating|rank \d|%/i)
    await review(page, 'intake-float-04-suppliers-1440')

    // Float: Write the enquiry, Copy & mark floated.
    let floatTaps = 0
    await page.getByRole('button', { name: 'Write the message' }).click()
    floatTaps++ // 1
    actions++
    await expect(page.getByRole('heading', { name: /WhatsApp message to 1 supplier/ })).toBeVisible()
    await expect(page.getByLabel('Message text')).toContainText(/Spec:\s+left blank/)
    // A blank Spec is drawn as a highlighted blank, not as plain text.
    await expect(page.locator('[data-spec-blank]')).toHaveCount(2)
    await review(page, 'intake-float-05-enquiry-1440')
    await resetClipboard(page)
    await page.getByRole('button', { name: 'Copy message for 1 supplier' }).click()
    floatTaps++ // 2
    actions++
    await expect(page.getByText(/is waiting for prices/)).toBeVisible()
    expect(floatTaps).toBeLessThanOrEqual(2)

    const [rfq] = await rfqsOf(s.customer.id)
    expect(rfq).toBeTruthy()
    const text = await readClipboardWhen(page, `our ref *${rfqRef(rfq.number)}*`)
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

    // Item 2 has no supplier ticked, and a shortlisted supplier carries it: the panel offers to float it to them.
    await expect(page.getByText('Item 2 has no supplier yet.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Ask them for item 2' })).toBeVisible()

    // Undo within the toast: the RFQ stays, the inquiry goes back to shortlisted.
    await expect(page.getByRole('status').filter({ hasText: 'Asked 1 supplier' })).toBeVisible()
    await review(page, 'intake-float-06-floated-with-undo-1440')
    await page.getByRole('button', { name: /Undo/ }).click()
    actions++
    await expect(page.getByText('Undone', { exact: true }).first()).toBeVisible()
    inquiries = await inquiriesOf(rfq.id)
    expect(inquiries).toEqual([{ supplier_id: s.supplied.id, sent_on: null }])
    expect(await rfqsOf(s.customer.id)).toHaveLength(1)
    await review(page, 'intake-float-07-after-undo-1440')
    expect(actions + pastes).toBeLessThanOrEqual(15)

    // Copying again floats the saved RFQ (no second RFQ).
    await page.getByRole('button', { name: 'Copy message for 1 supplier' }).click()
    await expect(page.getByText(/is waiting for prices/)).toBeVisible()
    inquiries = await inquiriesOf(rfq.id)
    expect(inquiries[0].sent_on).toBe(karachiDay())
    expect(await rfqsOf(s.customer.id)).toHaveLength(1)
  })

  test('a double tap on Copy message makes one RFQ', async ({ page }) => {
    const s = await seed()
    const ref = `DT-${Date.now().toString(36)}`
    await openAs(page, 'sales', '/rfqs/new')
    await pickCompany(page, s.customer.name)
    await paste(page, s.email)
    await page.getByRole('textbox', { name: 'Customer reference' }).fill(ref)
    await page.getByRole('button', { name: 'Looks right: find suppliers' }).click()
    await page.getByRole('button', { name: 'Write the message' }).click()
    await page.getByRole('button', { name: 'Copy message for 1 supplier' }).dblclick()
    await expect(page.getByText(/is waiting for prices/)).toBeVisible()
    const rows = await must(rest<{ id: string }[]>('admin', `rfqs?company_id=eq.${s.customer.id}&customer_ref=eq.${ref}&select=id`))
    expect(rows).toHaveLength(1)
    expect(await inquiriesOf(rows[0].id)).toHaveLength(1)
  })
})

test.describe('the draft on this device (UX audit S1: one tap on a tab must not throw the paste away)', () => {
  test('leaving with items asks first; the draft comes back with Continue your draft, and saving it clears it', async ({ page }) => {
    const s = await seed()
    const ref = `DR-${Date.now().toString(36)}`
    await openAs(page, 'sales', '/rfqs/new')
    await pickCompany(page, s.customer.name)
    // The customer's reference sits with the company: it is how the RFQ is found later.
    await page.getByRole('region', { name: 'Customer' }).getByRole('textbox', { name: 'Customer reference' }).fill(ref)
    await paste(page, s.email)
    await expect(page.getByText('2 items found').first()).toBeVisible()

    // A tab in the top bar: the screen asks first, and Stay keeps everything.
    const rfqsTab = page.getByRole('navigation', { name: 'Main' }).first().getByRole('link', { name: /^Jobs/ })
    await rfqsTab.click()
    const ask = page.getByRole('dialog', { name: 'Leave this new RFQ?' })
    await expect(ask).toContainText(`${s.customer.name}, 2 items`)
    await review(page, 'intake-leave-warning-1440')
    await ask.getByRole('button', { name: 'Stay here' }).click()
    await expect(page.getByRole('textbox', { name: 'Description of item 1' })).toBeVisible()
    await rfqsTab.click()
    await page.getByRole('dialog', { name: 'Leave this new RFQ?' }).getByRole('button', { name: 'Leave, keep the draft' }).click()
    await expect(page).toHaveURL(/\/rfqs$/)
    expect(await rfqsOf(s.customer.id)).toHaveLength(0) // nothing was saved to the database

    // Back on New RFQ: the draft is offered, and Continue brings it all back.
    await page.getByRole('button', { name: 'New RFQ' }).click()
    await expect(page.getByText(/You have a draft from .* today/)).toBeVisible()
    await expect(page.getByText(`${s.customer.name}, 2 items. It is kept on this device until you save it or start new; Start new forgets it.`)).toBeVisible()
    await review(page, 'intake-draft-offer-1440')
    await page.getByRole('button', { name: 'Continue your draft' }).click()
    await expect(page.getByRole('textbox', { name: 'Description of item 1' })).toHaveValue(`${s.brand1} ${s.model} electromagnetic flow meter DN50`)
    await expect(page.getByRole('textbox', { name: 'Customer reference' })).toHaveValue(ref)

    // Saving it clears the draft: the next New RFQ starts blank, and leaving no longer asks.
    await page.getByRole('button', { name: "Save for later (don't ask suppliers yet)" }).click()
    await expect(page.getByText(/is saved/)).toBeVisible()
    expect(await rfqsOf(s.customer.id)).toHaveLength(1)
    await rfqsTab.click()
    await expect(page).toHaveURL(/\/rfqs$/)
    await page.getByRole('button', { name: 'New RFQ' }).click()
    await expect(page.getByRole('heading', { name: 'New RFQ', level: 1 })).toBeVisible()
    await expect(page.getByText(/You have a draft/)).toHaveCount(0)
  })

  test('a company page\'s New RFQ offers the kept draft first: nothing is written over it, and Start new takes that company', async ({ page }) => {
    const s = await seed()
    const other = await createCompany(uniqueName('Second Mill Test'))
    await openAs(page, 'sales', '/rfqs/new')
    await pickCompany(page, s.customer.name)
    await paste(page, s.email)
    await expect(page.getByText('2 items found').first()).toBeVisible()
    await page.getByRole('navigation', { name: 'Main' }).first().getByRole('link', { name: /^Jobs/ }).click()
    await page.getByRole('dialog', { name: 'Leave this new RFQ?' }).getByRole('button', { name: 'Leave, keep the draft' }).click()
    await expect(page).toHaveURL(/\/jobs/)

    await page.goto(`/companies/${other.id}`)
    await page.locator('#main').getByRole('button', { name: 'New RFQ', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/rfqs/new\\?company=${other.id}`))
    // The draft comes first, and the other company waits for the answer.
    await expect(page.getByText(`${s.customer.name}, 2 items. It is kept on this device`, { exact: false })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Customer' })).toHaveCount(0)
    const kept = await page.evaluate(() => Object.entries(localStorage).find(([k]) => k.startsWith('qtech.rfqs.intakeDraft.'))?.[1] ?? '')
    expect(kept).toContain(s.customer.name)

    await page.getByRole('button', { name: `Start new for ${other.name}` }).click()
    await expect(page.getByRole('button', { name: `Change company, now ${other.name}` })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Description of item 1' })).toHaveCount(0)
    const after = await page.evaluate(() => Object.entries(localStorage).find(([k]) => k.startsWith('qtech.rfqs.intakeDraft.'))?.[1] ?? '')
    expect(after).not.toContain(s.customer.name)
  })

  test('on a phone the steps show as one line, and nothing scrolls sideways at 320', async ({ page }) => {
    const s = await seed()
    await page.setViewportSize({ width: 320, height: 640 })
    await openAs(page, 'sales', '/rfqs/new')
    const steps = page.getByRole('list', { name: 'Step 1 of 4' })
    await expect(steps).toBeVisible()
    await expect(steps).toContainText('Items')
    await expect(steps).toContainText('Done')
    await pickCompany(page, s.customer.name)
    await paste(page, s.email)
    await expect(page.getByText('2 items found').first()).toBeVisible()
    await page.getByRole('button', { name: 'Looks right: find suppliers' }).click()
    await expect(page.getByRole('list', { name: 'Step 2 of 4' })).toBeVisible()
    await review(page, 'intake-steps-320')
    // The step bar is one slim row (owner audit N1): the green button, and Back / Save for later in the ⋯ menu.
    const bar = page.getByRole('region', { name: 'Next step' })
    expect((await bar.boundingBox())?.height ?? 999).toBeLessThanOrEqual(72)
    await bar.getByRole('button', { name: 'More options' }).click()
    await expect(page.getByRole('menuitem', { name: "Save for later (don't ask suppliers yet)" })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Back to items' })).toBeVisible()
    await page.keyboard.press('Escape')
    // Nothing reaches past the right edge; a miss names the widest offenders, so the fix is one look away.
    const m = await page.evaluate(() => {
      const main = document.querySelector('#main') as HTMLElement
      const edge = main.getBoundingClientRect().right
      const wide = Array.from(main.querySelectorAll<HTMLElement>('*'))
        .filter(e => e.getBoundingClientRect().right > edge + 1 && e.getClientRects().length > 0)
        .map(e => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 90)} [${Math.round(e.getBoundingClientRect().width)}px] "${(e.textContent ?? '').trim().slice(0, 40)}"`)
      return { scroll: main.scrollWidth, client: main.clientWidth, wide: wide.slice(0, 6) }
    })
    expect(m.scroll, `too wide at 320: ${m.wide.join(' | ')}`).toBeLessThanOrEqual(m.client + 1)
  })
})

test.describe('what is required and what is pre-filled (FE-2)', () => {
  test('a company and one typed item are enough; qty is 1, GST 18, today and the owner fill themselves', async ({ page }) => {
    const customer = await createCompany(uniqueName('Bare Minimum'))
    await openAs(page, 'engineer', '/rfqs/new')
    // Not ready: the reason is beside the button, and a press puts the focus on what is missing (owner test 2026-10-20).
    await expect(page.getByText('Choose the company first, then paste or add an item.')).toBeVisible()
    await page.getByRole('button', { name: 'Looks right: find suppliers' }).click()
    await expect(page.locator('#intake-company')).toBeFocused()
    await pickCompany(page, customer.name)
    await page.getByRole('button', { name: 'Add an item by hand' }).click()
    await page.getByRole('textbox', { name: 'Description of item 1' }).fill('Spare gasket set')
    await page.getByRole('button', { name: "Save for later (don't ask suppliers yet)" }).click()
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
    await page.getByRole('button', { name: "Save for later (don't ask suppliers yet)" }).click()
    await expect(page.getByText(/is saved/)).toBeVisible()
    const [rfq] = await rfqsOf(s.customer.id)
    expect(rfq.site_id).not.toBeNull()
    expect(rfq.contact_id).not.toBeNull()
  })

  test('customer reference, quotation due date and top priority are optional extras and are saved when given', async ({ page }) => {
    const s = await seed()
    const ref = `ENQ-${Date.now().toString(36)}`
    await openAs(page, 'sales', '/rfqs/new')
    await pickCompany(page, s.customer.name)
    await paste(page, s.email)
    await page.getByRole('textbox', { name: 'Customer reference' }).fill(ref)
    await page.getByRole('textbox', { name: /Quotation due/ }).fill('3 dec 2030')
    await page.getByRole('checkbox', { name: /Top priority/ }).check()
    await page.getByRole('button', { name: "Save for later (don't ask suppliers yet)" }).click()
    await expect(page.getByText(/is saved/)).toBeVisible()
    const [rfq] = await rfqsOf(s.customer.id)
    expect(rfq).toMatchObject({ customer_ref: ref, due_on: '2030-12-03', is_priority: true })
  })
})

test.describe('a polite WhatsApp paste is not lost (audit E1)', () => {
  test('"Please quote 2 nos ..." gives an item; the courtesy line under it is skipped', async ({ page }) => {
    const customer = await createCompany(uniqueName('Polite Paste'))
    await openAs(page, 'sales', '/rfqs/new')
    await pickCompany(page, customer.name)
    await paste(page, 'Sir please quote 2 nos pressure transmitter 0-10 bar\nKindly share best price')
    await expect(page.getByText('1 item found in 2 lines').first()).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Description of item 1' })).toHaveValue('pressure transmitter 0-10 bar')
    await expect(page.getByRole('textbox', { name: 'Quantity of item 1' })).toHaveValue('2 nos')
    await page.getByRole('button', { name: "Save for later (don't ask suppliers yet)" }).click()
    await expect(page.getByText(/is saved/)).toBeVisible()
    const [rfq] = await rfqsOf(customer.id)
    const items = await itemsOf(rfq.id)
    expect(items.map(i => [i.description, i.qty, i.unit])).toEqual([['pressure transmitter 0-10 bar', 2, 'nos']])
  })
})

test.describe('save only, and no supplier ticked', () => {
  test('a company with no suppliers on file saves without asking: no inquiry, nothing sent', async ({ page }) => {
    const customer = await createCompany(uniqueName('Nobody Knows'))
    await openAs(page, 'sales', '/rfqs/new')
    await pickCompany(page, customer.name)
    await paste(page, '1. Hand-made one-off bracket - 3 nos')
    await page.getByRole('button', { name: 'Looks right: find suppliers' }).click()
    await expect(page.getByText('0 suppliers ticked')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Write the message' })).toHaveCount(0)
    await page.getByRole('button', { name: "Save for later (don't ask suppliers yet)" }).click()
    await expect(page.getByText(/is saved/)).toBeVisible()
    expect(await violations(page)).toEqual([])
    const [rfq] = await rfqsOf(customer.id)
    expect(await inquiriesOf(rfq.id)).toEqual([])
    await expect(page.getByRole('link', { name: `Open ${rfqRef(rfq.number)}` })).toBeVisible()
  })

  test('saved without asking keeps the ticked supplier shortlisted, then floats from the saved RFQ', async ({ page }) => {
    const s = await seed()
    await openAs(page, 'sales', '/rfqs/new')
    await pickCompany(page, s.customer.name)
    await paste(page, s.email)
    await page.getByRole('button', { name: 'Looks right: find suppliers' }).click()
    await expect(page.getByRole('checkbox', { name: s.supplied.name })).toBeChecked()
    await tick(page, s.carries.name)
    await expect(page.getByRole('checkbox', { name: s.carries.name })).toBeChecked()
    await page.getByRole('button', { name: "Save for later (don't ask suppliers yet)" }).click()
    await expect(page.getByText(/is saved/)).toBeVisible()
    const [rfq] = await rfqsOf(s.customer.id)
    const shortlisted = await inquiriesOf(rfq.id)
    expect(shortlisted.map(i => i.sent_on)).toEqual([null, null])
    expect(shortlisted.map(i => i.supplier_id).sort()).toEqual([s.supplied.id, s.carries.id].sort())

    await page.getByRole('button', { name: 'Write the message' }).click()
    await expect(page.getByLabel('Message text')).toContainText(rfqRef(rfq.number))
    await page.getByRole('button', { name: 'Copy message for 2 suppliers' }).click()
    await expect(page.getByText(/is waiting for prices/)).toBeVisible()
    const floated = await inquiriesOf(rfq.id)
    expect(floated.map(i => i.sent_on)).toEqual([karachiDay(), karachiDay()])
    expect(await rfqsOf(s.customer.id)).toHaveLength(1)
  })

  test('saved without asking, then Ask suppliers on the RFQ page: the shortlist comes first and ticked, and asking stamps it sent', async ({ page }) => {
    const s = await seed()
    await openAs(page, 'sales', '/rfqs/new')
    await pickCompany(page, s.customer.name)
    await paste(page, s.email)
    await page.getByRole('button', { name: 'Looks right: find suppliers' }).click()
    await expect(page.getByRole('checkbox', { name: s.supplied.name })).toBeChecked()
    await page.getByRole('button', { name: "Save for later (don't ask suppliers yet)" }).click()
    await expect(page.getByText(/is saved/)).toBeVisible()
    const [rfq] = await rfqsOf(s.customer.id)
    expect((await inquiriesOf(rfq.id)).map(i => i.sent_on)).toEqual([null])

    await page.getByRole('link', { name: `Open ${rfqRef(rfq.number)}` }).click()
    await page.locator('[data-slot="ask-suppliers"]:visible').click()
    const dialog = page.getByRole('dialog', { name: 'Ask suppliers' })
    const first = dialog.getByRole('checkbox').first()
    await expect(first).toHaveAccessibleName(s.supplied.name)
    await expect(first).toBeChecked()
    await expect(dialog.getByText('On the shortlist from New RFQ. Not asked yet.')).toBeVisible()
    await dialog.getByRole('button', { name: /^Copy message for \d+ suppliers?$/ }).click()
    await expect(dialog).toBeHidden()
    await expect
      .poll(async () => (await inquiriesOf(rfq.id)).filter(i => i.supplier_id === s.supplied.id).map(i => i.sent_on))
      .toEqual([karachiDay()])
  })

  test('a customer reference the customer already has is refused in plain words and nothing is created', async ({ page }) => {
    const s = await seed()
    const ref = `SAME-${Date.now().toString(36)}`
    const existing = (await must(rest<{ id: string; number: number }[]>('admin', 'rfqs', { method: 'POST', body: { company_id: s.customer.id, customer_ref: ref } })))[0]
    await openAs(page, 'sales', '/rfqs/new')
    await pickCompany(page, s.customer.name)
    await paste(page, s.email)
    await page.getByRole('textbox', { name: 'Customer reference' }).fill(ref)
    await page.getByRole('button', { name: "Save for later (don't ask suppliers yet)" }).click()
    await expect(page.getByText('This customer already has an RFQ with that reference.')).toBeVisible()
    await expect(page.getByRole('link', { name: `Open ${rfqRef(existing.number)}` })).toBeVisible()
    expect(await rfqsOf(s.customer.id)).toHaveLength(1)
  })
})

test.describe('company picker', () => {
  test('a company that is not on file is added inline, with its city and first contact, without leaving the page', async ({ page }) => {
    const name = uniqueName('Brand New Works')
    await openAs(page, 'sales', '/rfqs/new')
    let actions = 0
    await page.getByRole('combobox', { name: 'Company' }).fill(name)
    actions++
    const add = page.getByRole('option', { name: new RegExp(`Add “${name}” as a new company`) })
    await expect(add).toContainText('Saved as a prospect until the first order')
    await add.click()
    actions++
    const form = page.getByRole('region', { name: 'New company' })
    await expect(form.getByRole('textbox', { name: 'Company name' })).toHaveValue(name)
    await expect(page.getByText('City and contact can wait. Add them from the company page later.')).toBeVisible()
    expect(page.url()).toMatch(/\/rfqs\/new/)
    await form.getByRole('textbox', { name: 'City' }).fill('Mianwali')
    await form.getByRole('textbox', { name: 'Contact' }).fill('Kamran Zafar')
    await form.getByRole('button', { name: 'Create and use' }).click()
    actions++
    await expect(page.getByText(name).first()).toBeVisible()
    await expect(page.getByText('New prospect')).toBeVisible()
    await expect(page.getByText('Mianwali · Kamran Zafar')).toBeVisible()
    expect(actions).toBeLessThanOrEqual(3)
    expect(page.url()).toMatch(/\/rfqs\/new/)
    const rows = await must(rest<{ id: string; city: string | null }[]>('admin', `companies?name=eq.${encodeURIComponent(name)}&select=id,city`))
    expect(rows).toHaveLength(1)
    expect(rows[0].city).toBe('Mianwali')
    const contacts = await must(rest<{ name: string }[]>('admin', `contacts?company_id=eq.${rows[0].id}&select=name`))
    expect(contacts.map(c => c.name)).toEqual(['Kamran Zafar'])
  })

  test('a similar existing name is listed with its RFQ count and a similar-name flag before a new company is made', async ({ page }) => {
    const tag = Math.random().toString(36).slice(2, 8)
    const near = await createCompany(`Mianwali${tag} Plastics Ltd`)
    await must(rest('admin', 'rfqs', { method: 'POST', body: { company_id: near.id } }))
    const typed = `Mianwali${tag} Polymers`
    await openAs(page, 'sales', '/rfqs/new')
    await page.getByRole('combobox', { name: 'Company' }).fill(typed)
    const similar = page.getByRole('option', { name: new RegExp(near.name) })
    await expect(similar).toContainText('1 RFQ')
    await expect(similar).toContainText('similar name')
    await expect(page.getByRole('option', { name: new RegExp(`Add “${typed}” as a new company`) })).toBeVisible()
  })

  test('the items zone is open before a company is chosen (the paste or PDF often names the company)', async ({ page }) => {
    const s = await seed()
    await openAs(page, 'sales', '/rfqs/new')
    const zone = page.locator('section[aria-labelledby="h-items"]')
    await expect(zone).toHaveCSS('opacity', '1')
    await expect(zone.getByRole('button', { name: 'Choose PDF or photo' })).toBeEnabled()
    await pickCompany(page, s.customer.name)
    await expect(zone).toHaveCSS('opacity', '1')
  })
})

test.describe('float one item to the supplier who is not ticked', () => {
  test('"Ask them for item 2" asks that supplier, marks it sent and copies a text for that item only', async ({ page }) => {
    const s = await seed()
    await openAs(page, 'sales', '/rfqs/new')
    await pickCompany(page, s.customer.name)
    await paste(page, s.email)
    await page.getByRole('button', { name: 'Looks right: find suppliers' }).click()
    await page.getByRole('button', { name: 'Write the message' }).click()
    await resetClipboard(page)
    await page.getByRole('button', { name: 'Copy message for 1 supplier' }).click()
    await expect(page.getByText(/is waiting for prices/)).toBeVisible()
    await page.getByRole('button', { name: 'Ask them for item 2' }).click()
    await expect(page.getByText(/Item 2: asked /).first()).toBeVisible()
    const [rfq] = await rfqsOf(s.customer.id)
    const inquiries = await inquiriesOf(rfq.id)
    expect(inquiries.map(i => i.supplier_id).sort()).toEqual([s.supplied.id, s.other.id].sort())
    expect(inquiries.every(i => i.sent_on === karachiDay())).toBe(true)
    const text = await readClipboardWhen(page, s.brand2)
    expect(text).toContain(s.brand2)
    expect(text).not.toContain(s.model)
  })
})

for (const width of [1440, 375]) {
  test(`axe (WCAG 2.2 AA) at ${width}: every step has zero violations, and the review screenshots are taken`, async ({ page }) => {
    const s = await seed({ site: true })
    await page.setViewportSize({ width, height: width > 800 ? 900 : 812 })
    await openAs(page, 'sales', '/rfqs/new')
    expect(await violations(page)).toEqual([])
    await review(page, `intake-float-01-empty-${width}`)

    // Frame 2: a name that is not on file, a similar one listed first, the inline create form open.
    const tag = Math.random().toString(36).slice(2, 8)
    const near = await createCompany(`Mianwali${tag} Plastics Ltd`, { city: 'Mianwali' })
    await must(rest('admin', 'rfqs', { method: 'POST', body: [{ company_id: near.id }, { company_id: near.id }] }))
    const typed = `Mianwali${tag} Polymers`
    await page.getByRole('combobox', { name: 'Company' }).fill(typed)
    await page.getByRole('option', { name: new RegExp(`Add “${typed}” as a new company`) }).click()
    await expect(page.getByRole('region', { name: 'New company' })).toBeVisible()
    expect(await violations(page)).toEqual([])
    await review(page, `intake-float-02-company-typed-${width}`)

    await pickCompany(page, s.customer.name)
    await paste(page, s.email)
    await expect(page.getByText('2 items found').first()).toBeVisible()
    expect(await violations(page)).toEqual([])
    await page.getByRole('textbox', { name: 'Description of item 1' }).scrollIntoViewIfNeeded()
    await review(page, `intake-float-03-items-pasted-${width}`)

    await page.getByRole('button', { name: 'Looks right: find suppliers' }).click()
    await expect(page.getByRole('checkbox', { name: s.supplied.name })).toBeChecked()
    expect(await violations(page)).toEqual([])
    await review(page, `intake-float-04-suppliers-${width}`)

    await page.getByRole('button', { name: 'Write the message' }).click()
    await expect(page.getByRole('heading', { name: /WhatsApp message to 1 supplier/ })).toBeVisible()
    expect(await violations(page)).toEqual([])
    await review(page, `intake-float-05-enquiry-${width}`)

    await page.getByRole('button', { name: 'Copy message for 1 supplier' }).click()
    await expect(page.getByText(/is waiting for prices/)).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'Asked 1 supplier' })).toBeVisible()
    expect(await violations(page)).toEqual([])
    await review(page, `intake-float-06-floated-with-undo-${width}`)
  })
}

// Owner, 2026-10-20, on an Android phone: New RFQ must take a screenshot of the customer's email. The picture is read on the
// phone (src/lib/docread/imageText.ts) and its items land in the rows, as a paste's would. The screenshot is a fictional
// Outlook RFQ (e2e/docread/scenes.ts), rendered here.
test.describe('a screenshot on a phone (375)', () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true })

  test('Choose PDF or photo reads a screenshot into the items; the paste zone offers Paste, never Ctrl V', async ({ page, browser }) => {
    test.setTimeout(180_000)
    const scene = SCENES.find(s => s.name === 'outlook-rfq-shaded')!
    const shot = await browser.newContext({ viewport: scene.viewport, deviceScaleFactor: scene.deviceScaleFactor })
    const sp = await shot.newPage()
    await sp.setContent(scene.html)
    const buffer = await sp.screenshot({ fullPage: true })
    await shot.close()

    await openAs(page, 'sales', '/rfqs/new')
    const zone = page.locator('section[aria-labelledby="h-items"]')
    await expect(zone.getByRole('button', { name: 'Paste', exact: true })).toBeVisible()
    await expect(zone).not.toContainText('Ctrl')
    await expect(zone).toContainText('Paste the whole email, a PDF or a screenshot — we pick out the items; you check them before saving.')

    await page.getByTestId('pdf-input-items').setInputFiles({ name: 'Screenshot_20261013.png', mimeType: 'image/png', buffer })
    await expect(page.getByText('8 items found').first()).toBeVisible({ timeout: 120_000 })
    await expect(page.getByRole('textbox', { name: 'Description of item 1' })).toHaveValue('CAPACITOR 100UF 450 V-01')
    await expect(page.getByRole('textbox', { name: 'Quantity of item 1' })).toHaveValue(/^10\b/)
    await expect(page.getByRole('textbox', { name: 'Description of item 8' })).toHaveValue('FUSE GLASS 5X20 2A-01')
    await expect(page.getByRole('textbox', { name: 'Quantity of item 8' })).toHaveValue(/^200\b/)
    await expect(page.getByRole('textbox', { name: 'Customer reference' })).toHaveValue('131026')
    await review(page, 'intake-photo-375')
  })
})
