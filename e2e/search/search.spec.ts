import { expect, test, type Page } from '@playwright/test'
import { API_URL, createCompany, createRfq, login, must, openAs, review, rest, rfqRef, uniqueName } from '../support/stack'
import { axeViolations } from '../support/axe'

/*
 * R12 end to end, against the local CI stack: the command palette searches companies, contacts (name, phone, e-mail), RFQ
 * numbers and customer references through ONE database call (search_all, migration 0034), grouped, with the matched text
 * in bold, one request per burst of keystrokes, stale requests cancelled, and nothing money-related for an engineer.
 * Every test makes its own records with unique names.
 */

async function openPalette(page: Page) {
  // The phone layout has no search button; the shortcut works at every width once the shell has mounted.
  await page.locator('#main').waitFor()
  await expect(async () => {
    if (!(await page.getByRole('dialog', { name: 'Search or jump to' }).isVisible())) await page.keyboard.press('Control+k')
    await expect(page.getByRole('dialog', { name: 'Search or jump to' })).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 10_000 })
}

const unique = () => Math.random().toString(36).slice(2, 8)

interface Fixture {
  tag: string
  company: { id: string; name: string }
  contact: { id: string; name: string; email: string; phone: string }
  rfq: { id: string; number: number; ref: string }
}

/** A company with a contact (name, phone, e-mail) and an RFQ carrying the customer's reference. */
async function seed(): Promise<Fixture> {
  const tag = unique()
  const company = await createCompany(uniqueName(`Srch${tag} Textiles`))
  const contact = { name: `Qadir${tag} Hussain`, email: `qadir.${tag}@srch.example`, phone: '+92 321 555 7788' }
  const [row] = await must(rest<{ id: string }[]>('admin', 'contacts', { method: 'POST', body: { company_id: company.id, ...contact } }))
  const ref = `ENQ-${tag.toUpperCase()}-77`
  const rfq = await createRfq(company.id, { customer_ref: ref })
  return { tag, company, contact: { id: row.id, ...contact }, rfq: { ...rfq, ref } }
}

const rpcHeaders = (token: string) => ({ apikey: process.env.ANON_KEY ?? '', authorization: `Bearer ${token}`, 'content-type': 'application/json' })

test.describe('palette search (R12)', () => {
  test('finds a contact by name, groups the results, bolds the match and opens the contact company', async ({ page }) => {
    const f = await seed()
    await openAs(page, 'sales', '/today')
    await openPalette(page)
    await page.getByRole('combobox').fill(`qadir${f.tag}`)
    const hit = page.getByRole('option', { name: new RegExp(`Qadir${f.tag} Hussain`) })
    await expect(hit).toBeVisible()
    await expect(page.getByRole('dialog').getByText('Contacts', { exact: true })).toBeVisible()
    // the matched part is bold
    await expect(hit.locator('b').first()).toHaveText(new RegExp(`qadir${f.tag}`, 'i'))
    await review(page, 'search-contact-1440')
    await hit.click()
    await expect(page).toHaveURL(new RegExp(`/companies/${f.company.id}$`))
  })

  test('finds a contact by e-mail and by phone digits', async ({ page }) => {
    const f = await seed()
    await openAs(page, 'sales', '/today')
    await openPalette(page)
    const input = page.getByRole('combobox')
    await input.fill(`qadir.${f.tag}@srch`)
    await expect(page.getByRole('option', { name: new RegExp(`Qadir${f.tag} Hussain`) })).toBeVisible()
    await input.fill('321 555 7788')
    await expect(page.getByRole('option', { name: new RegExp(`Qadir${f.tag} Hussain`) }).first()).toBeVisible()
  })

  test('finds an RFQ by number and by customer reference, RFQs first for a number', async ({ page }) => {
    const f = await seed()
    await openAs(page, 'sales', '/today')
    await openPalette(page)
    const input = page.getByRole('combobox')
    await input.fill(rfqRef(f.rfq.number))
    const byNumber = page.getByRole('option', { name: new RegExp(`${rfqRef(f.rfq.number)} ${f.company.name}`) })
    await expect(byNumber).toBeVisible()
    await expect(page.getByRole('option').first()).toContainText(rfqRef(f.rfq.number))
    await input.fill(f.rfq.ref.slice(0, 9))
    const byRef = page.getByRole('option', { name: new RegExp(`Ref ${f.rfq.ref}`) })
    await expect(byRef).toBeVisible()
    await byRef.click()
    await expect(page).toHaveURL(new RegExp(`/rfqs/${f.rfq.id}$`))
  })

  test('recents stay on the idle view', async ({ page }) => {
    const f = await seed()
    await openAs(page, 'sales', '/today')
    await openPalette(page)
    await page.getByRole('combobox').fill(f.company.name)
    await page.getByRole('option', { name: new RegExp(f.company.name) }).first().click()
    await expect(page).toHaveURL(new RegExp(`/companies/${f.company.id}$`))
    await page.goto('/today')
    await openPalette(page)
    await expect(page.getByRole('dialog').getByText('Recent', { exact: true })).toBeVisible()
    await expect(page.getByRole('option', { name: new RegExp(f.company.name) })).toBeVisible()
  })

  test('a burst of keystrokes makes one request, and a replaced request never overwrites the answer', async ({ page }) => {
    const f = await seed()
    const calls: string[] = []
    page.on('request', r => {
      if (r.url().includes('/rpc/search_all')) calls.push(JSON.parse(r.postData() ?? '{}').q)
    })
    await openAs(page, 'sales', '/today')
    await openPalette(page)
    await page.getByRole('combobox').pressSequentially(`qadir${f.tag}`, { delay: 15 })
    await expect(page.getByRole('option', { name: new RegExp(`Qadir${f.tag} Hussain`) })).toBeVisible()
    expect(calls).toEqual([`qadir${f.tag}`])

    // A slow first search must not replace the answer to the second.
    await page.route(/\/rpc\/search_all/, async route => {
      if (route.request().postData()?.includes('"q":"slowone"')) await new Promise(r => setTimeout(r, 1500))
      await route.continue().catch(() => undefined)
    })
    await page.getByRole('combobox').fill('slowone')
    await expect.poll(() => calls.includes('slowone')).toBe(true)
    await page.getByRole('combobox').fill(f.company.name)
    await expect(page.getByRole('option', { name: new RegExp(f.company.name) }).first()).toBeVisible()
    await page.waitForTimeout(1800)
    await expect(page.getByRole('option', { name: new RegExp(f.company.name) }).first()).toBeVisible()
    await expect(page.getByRole('option', { name: /slowone/ })).toHaveCount(0)
  })

  test('an engineer finds companies, contacts and RFQs but nothing money-related', async ({ page }) => {
    const f = await seed()
    const tag = unique()
    const order = (await must(rest<{ id: string }[]>('admin', 'orders', { method: 'POST', body: { company_id: f.company.id, customer_po_number: `POSEC${tag}` } })))[0]
    const invoiceNumber = `INVSEC${tag}`
    await must(rest('admin', 'invoices', { method: 'POST', body: { order_id: order.id, company_id: f.company.id, number: invoiceNumber, net_amount: 123456, gst_amount: 22222 }, prefer: 'return=minimal' }))

    await openAs(page, 'engineer', '/today')
    await openPalette(page)
    const input = page.getByRole('combobox')
    await input.fill(`srch${f.tag}`)
    await expect(page.getByRole('option', { name: new RegExp(f.company.name) }).first()).toBeVisible()
    for (const q of [invoiceNumber, `POSEC${tag}`, '123456']) {
      await input.fill(q)
      // no hit of any kind: the only row left is the offer to add the typed text as a company
      await expect(page.getByRole('option', { name: new RegExp(`Add “${q}”`) })).toBeVisible()
      await expect(page.getByRole('option')).toHaveCount(1)
    }

    // the same through the API as the engineer: no row, and no money column in any row
    const session = await login('engineer')
    const invoiceRequests: string[] = []
    for (const q of [invoiceNumber, invoiceNumber.slice(0, 7), `POSEC${tag}`, '123456']) {
      const res = await fetch(`${API_URL}/rest/v1/rpc/search_all`, { method: 'POST', headers: rpcHeaders(session.access_token), body: JSON.stringify({ q, lim: 8 }) })
      expect(await res.json()).toEqual([])
      invoiceRequests.push(q)
    }
    expect(invoiceRequests).toHaveLength(4)
    const res = await fetch(`${API_URL}/rest/v1/rpc/search_all`, { method: 'POST', headers: rpcHeaders(session.access_token), body: JSON.stringify({ q: f.company.name, lim: 8 }) })
    const rows = (await res.json()) as Array<Record<string, unknown>>
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) expect(Object.keys(r).sort()).toEqual(['company_id', 'id', 'kind', 'label', 'meta', 'order_id', 'role', 'score'])
  })

  for (const [name, size] of [['1440', { width: 1440, height: 900 }], ['375', { width: 375, height: 812 }]] as const) {
    test(`axe: the palette with grouped results has no violations at ${name}`, async ({ page }) => {
      const f = await seed()
      await page.setViewportSize(size)
      await openAs(page, 'sales', '/today')
      await openPalette(page)
      await page.getByRole('combobox').fill(`srch${f.tag}`)
      await expect(page.getByRole('option', { name: new RegExp(f.company.name) }).first()).toBeVisible()
      await expect(page.getByRole('dialog').getByText('RFQs', { exact: true })).toBeVisible()
      await review(page, `search-results-${name}`)
      expect(await axeViolations(page, { landmarks: false })).toEqual([])
    })
  }
})

test.describe('palette search v2 (P02): orders, items, POs, invoices', () => {
  interface V2 {
    tag: string
    company: { id: string; name: string }
    order: { id: string; number: number }
    po: string
    item: string
    invoice: string
    supplierPo: number
  }

  async function seedV2(): Promise<V2> {
    const tag = unique()
    const company = await createCompany(uniqueName(`Orderco${tag}`))
    const supplier = await createCompany(uniqueName(`Supplyco${tag}`), { country: 'Germany' })
    const po = `CPO${tag.toUpperCase()}77`
    const order = (await must(rest<{ id: string; number: number }[]>('admin', 'orders', { method: 'POST', body: { company_id: company.id, customer_po_number: po } })))[0]
    const item = `Pressure transmitter ${tag}x9`
    await must(rest('admin', 'order_items', { method: 'POST', body: { order_id: order.id, description: item, unit_price_net: 4321 }, prefer: 'return=minimal' }))
    const invoice = `INV${tag.toUpperCase()}5`
    await must(rest('admin', 'invoices', { method: 'POST', body: { order_id: order.id, company_id: company.id, number: invoice, net_amount: 50000, gst_amount: 9000 }, prefer: 'return=minimal' }))
    const leg = (await must(rest<{ id: string }[]>('admin', 'supplier_orders', { method: 'POST', body: { order_id: order.id, supplier_id: supplier.id, currency: 'EUR' } })))[0]
    const supplierPo = 200000 + Math.floor(Math.random() * 700000)
    await must(rest('admin', 'purchase_orders', { method: 'POST', body: { supplier_order_id: leg.id, number: supplierPo, revision: 0, currency: 'EUR', total: 0, lines: [{ qty: 1, unit_price: 1 }] }, prefer: 'return=minimal' }))
    return { tag, company, order, po, item, invoice, supplierPo }
  }

  test('sales find an order by customer PO, an item by description, a supplier PO and an invoice by number, each opening the right place', async ({ page }) => {
    const f = await seedV2()
    await openAs(page, 'sales', '/today')
    await openPalette(page)
    const input = page.getByRole('combobox')

    await input.fill(f.po.slice(0, 8))
    const order = page.getByRole('option', { name: new RegExp(`ORD-${String(f.order.number).padStart(4, '0')} ${f.company.name}`) })
    await expect(order).toBeVisible()
    await expect(order).toContainText(`Customer PO ${f.po}`)

    await input.fill(`transmitter ${f.tag}x9`)
    const item = page.getByRole('option', { name: new RegExp(f.item) })
    await expect(item).toBeVisible()
    await expect(page.getByRole('dialog').getByText('Order items', { exact: true })).toBeVisible()
    await expect(item).not.toContainText('4321')

    await input.fill(`PO-${f.supplierPo}`)
    const po = page.getByRole('option', { name: new RegExp('PO-[0-9]{2}-' + f.supplierPo) })
    await expect(po).toBeVisible()
    await po.click()
    await expect(page).toHaveURL(new RegExp(`/orders/${f.order.id}$`))

    await openPalette(page)
    await page.getByRole('combobox').fill(f.invoice.slice(0, 8))
    const inv = page.getByRole('option', { name: new RegExp(f.invoice) })
    await expect(inv).toBeVisible()
    await expect(inv).not.toContainText('50000')
    await inv.click()
    await expect(page).toHaveURL(/\/money\/gst-register\?invoice=/)
    await expect(page.getByRole('dialog', { name: new RegExp(`Invoice ${f.invoice}`) })).toBeVisible()
  })

  test('an engineer: the order and the item and the supplier PO are found, the invoice and the customer PO are not, at the API too', async ({ page }) => {
    const f = await seedV2()
    await openAs(page, 'engineer', '/today')
    await openPalette(page)
    const input = page.getByRole('combobox')
    await input.fill(`ORD-${String(f.order.number).padStart(4, '0')}`)
    const order = page.getByRole('option', { name: new RegExp(`ORD-${String(f.order.number).padStart(4, '0')} ${f.company.name}`) })
    await expect(order).toBeVisible()
    await expect(order).not.toContainText(f.po)
    await input.fill(`transmitter ${f.tag}x9`)
    await expect(page.getByRole('option', { name: new RegExp(f.item) })).toBeVisible()
    for (const q of [f.invoice, f.invoice.slice(0, 8), f.po]) {
      await input.fill(q)
      await expect(page.getByRole('option', { name: new RegExp(`Add “${q}”`) })).toBeVisible()
      await expect(page.getByRole('option')).toHaveCount(1)
    }

    // network assertion: the response to an invoice-number search contains no invoice row for an engineer, and does for sales
    const call = async (role: 'engineer' | 'sales', q: string) => {
      const session = await login(role)
      const res = await fetch(`${API_URL}/rest/v1/rpc/search_all`, { method: 'POST', headers: rpcHeaders(session.access_token), body: JSON.stringify({ q, lim: 25 }) })
      return (await res.json()) as Array<{ kind: string; label: string; meta: string | null }>
    }
    expect(await call('engineer', f.invoice)).toEqual([])
    expect((await call('engineer', f.company.name)).filter(r => r.kind === 'invoice')).toEqual([])
    expect((await call('engineer', f.po)).some(r => `${r.label} ${r.meta ?? ''}`.includes(f.po))).toBe(false)
    expect((await call('sales', f.invoice)).filter(r => r.kind === 'invoice').map(r => r.label)).toEqual([f.invoice])
    expect((await call('engineer', `PO-${f.supplierPo}`)).some(r => r.kind === 'po')).toBe(true)
  })
})
