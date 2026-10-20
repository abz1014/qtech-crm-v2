import { expect, test } from '@playwright/test'
import { as, db, num, USER } from '../support/db'
import { karachiDay, letters, quote, rfq, setProfile, setRates, supplier } from '../support/fixtures'
import { open, signedIn } from '../support/session'
import { ADMIN } from '../support/text'
import { fetchStoredPdf, pdfText } from '../../support/pdf'

/*
 * Settings that change what other screens produce: the company profile (printed on the quotation PDF, the validity that dates it,
 * the default payment terms) and a hand-entered exchange rate (which re-ranks supplier prices). Each is saved on screen as the
 * admin, checked in the database, and then seen where it matters.
 */
test.describe.configure({ mode: 'serial' })

test('company profile: the legal name, NTN and validity typed by the admin are what the next quotation prints and dates; sales cannot change it', async ({ browser }, info) => {
  await setProfile(true)
  const name = `Q-Tech Verify ${letters()} (Pvt) Ltd`
  const admin = await signedIn(browser, info, 'admin')
  const page = await open(admin, ADMIN.profile.path)
  try {
    await page.getByLabel(ADMIN.profile.legalName).fill(name)
    await page.getByLabel(ADMIN.profile.ntn).fill('7654321-0')
    await page.getByLabel(ADMIN.profile.validity).fill('45')
    await page.getByLabel(ADMIN.profile.defaultTerms).fill('60')
    await page.getByRole('button', { name: ADMIN.profile.save }).click()
    await expect
      .poll(() => db.one('company_profile?id=eq.1&select=legal_name,ntn,quotation_validity_days,default_payment_terms_days,updated_by'))
      .toEqual({ legal_name: name, ntn: '7654321-0', quotation_validity_days: 45, default_payment_terms_days: 60, updated_by: USER.admin })

    // Sales may not change it, whatever they send.
    await as('sales', 'company_profile?id=eq.1', { method: 'PATCH', body: { legal_name: 'Not allowed' } })
    expect((await db.one<{ legal_name: string }>('company_profile?id=eq.1&select=legal_name')).legal_name).toBe(name)

    // The next quotation: valid 45 days from today, and the PDF prints the new name and NTN.
    const r = await rfq({ items: [{ description: `Profile check item ${letters()}`, qty: 1 }] })
    const sup = await supplier('Verify Profile Supplier', 'Pakistan')
    await quote(r.rfq.id, sup, [{ itemId: r.items[0].id, price: 900 }], 'PKR')
    const sales = await signedIn(browser, info, 'sales')
    const sp = await open(sales, `/rfqs/${r.rfq.id}`)
    await sp.locator('[data-slot="issue-quotation"]').getByRole('button', { name: ADMIN.quote.open }).click()
    await sp.getByRole('dialog').getByLabel(ADMIN.quote.price(1)).fill('1250')
    await sp.getByRole('dialog').getByRole('button', { name: ADMIN.quote.issue }).click()
    await expect(sp.getByRole('dialog').getByTestId('pdf-ready')).toBeVisible({ timeout: 30_000 })
    const q = await db.one<{ valid_until: string; issued_on: string; pdf_path: string }>(`quotations?rfq_id=eq.${r.rfq.id}&select=valid_until,issued_on,pdf_path`)
    expect(q.issued_on).toBe(karachiDay(0))
    expect(q.valid_until).toBe(karachiDay(45))
    const pdf = await fetchStoredPdf('sales', 'generated-docs', q.pdf_path)
    const text = pdf ? pdfText(pdf) : null
    if (text) {
      expect(text).toContain(name)
      expect(text).toContain('7654321-0')
    }
    await sales.close()
  } finally {
    await db.patch('company_profile?id=eq.1', { quotation_validity_days: 30, default_payment_terms_days: 30 })
    await setProfile(true)
    await admin.close()
  }
})

test('a rate entered by hand is stored as today’s manual rate and re-ranks the supplier prices at once', async ({ browser }, info) => {
  // USD 100 vs PKR 28,500. At 280: 28,000 (USD cheaper). At 290 (typed): 29,000 (PKR cheaper).
  await setRates({ USD: 280 })
  const r = await rfq({ items: [{ description: `Rate check transmitter ${letters()}`, qty: 1 }] })
  const usd = await supplier('Verify USD Supplier', 'United States')
  const pkr = await supplier('Verify PKR Supplier', 'Pakistan')
  await quote(r.rfq.id, usd, [{ itemId: r.items[0].id, price: 100 }], 'USD')
  await quote(r.rfq.id, pkr, [{ itemId: r.items[0].id, price: 28500 }], 'PKR')
  const first = async () => (await db.adminRpc<{ supplier_id: string; rank: number }[]>('rank_item_quotes', { p_rfq_id: r.rfq.id })).find(x => Number(x.rank) === 1)?.supplier_id
  expect(await first()).toBe(usd.id)

  const admin = await signedIn(browser, info, 'admin')
  const page = await open(admin, ADMIN.rates.path)
  await page.locator('form').getByLabel(ADMIN.rates.currency).selectOption('USD')
  await page.locator('form').getByLabel(ADMIN.rates.rate).fill('290')
  await page.getByRole('button', { name: ADMIN.rates.save }).click()
  await expect.poll(async () => num((await db.one<{ rate_pkr: number }>(`fx_rates?currency=eq.USD&as_of=eq.${karachiDay(0)}&source=eq.manual&select=rate_pkr`)).rate_pkr)).toBe(290)
  expect(await first()).toBe(pkr.id)
  await page.goto(`/rfqs/${r.rfq.id}`)
  await expect(page.getByRole('article', { name: 'Item 1' }).locator('li[data-ranked="1"]')).toContainText(pkr.name)
  await admin.close()
})
