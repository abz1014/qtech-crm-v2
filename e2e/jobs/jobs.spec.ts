import { expect, test, type Page } from '@playwright/test'
import { createCompany, createRfq, karachiDay, must, openAs, review, rest, rfqRef, uniqueName } from '../support/stack'
import { axeViolations } from '../support/axe'
import { db } from '../verify/support/db'

/*
 * Jobs (redesign phase 5), against the local CI stack: the list at /jobs, and the ONE search the Jobs box shares with the command
 * palette. A job is a read-only view over rfqs and orders (migration 0099): "Job 139" is an RFQ, "Job O-45" an order with no RFQ.
 * Every test makes its own records with unique names.
 */
async function openPalette(page: Page) {
  await page.locator('#main').waitFor()
  await expect(async () => {
    if (!(await page.getByRole('dialog', { name: 'Search or jump to' }).isVisible())) await page.keyboard.press('Control+k')
    await expect(page.getByRole('dialog', { name: 'Search or jump to' })).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 10_000 })
}

interface Fixture {
  company: { id: string; name: string }
  rfq: { id: string; number: number }
  order: { id: string; number: number }
  /** An order with no RFQ: its job is "O-n". */
  direct: { id: string; number: number }
  ref: string
  po: string
}

async function seed(): Promise<Fixture> {
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  const company = await createCompany(uniqueName(`Jobs${tag} Textiles`))
  const ref = `JOB-${tag}-11`
  const rfq = await createRfq(company.id, { customer_ref: ref, due_on: karachiDay(7) })
  await must(rest('admin', 'rfq_items', { method: 'POST', body: { rfq_id: rfq.id, position: 0, description: `Ultrasonic flowmeter ${tag}`, qty: 2 }, prefer: 'return=minimal' }))
  const po = `CPO-${tag}-5`
  const [order] = await must(rest<{ id: string; number: number }[]>('admin', 'orders', { method: 'POST', body: { company_id: company.id, rfq_id: rfq.id, customer_po_number: po, payment_terms_days: 30, ordered_on: karachiDay(-3) } }))
  await must(rest('admin', 'order_items', { method: 'POST', body: { order_id: order.id, position: 0, description: `Ultrasonic flowmeter ${tag}`, qty: 2, unit_price_net: 100000, gst_rate: 18 }, prefer: 'return=minimal' }))
  const [direct] = await must(rest<{ id: string; number: number }[]>('admin', 'orders', { method: 'POST', body: { company_id: company.id, payment_terms_days: 30, ordered_on: karachiDay(-1) } }))
  await must(rest('admin', 'order_items', { method: 'POST', body: { order_id: direct.id, position: 0, description: `Direct cable ${tag}`, qty: 1, unit_price_net: 5000, gst_rate: 18 }, prefer: 'return=minimal' }))
  return { company, rfq, order, direct, ref, po }
}

test.describe('Jobs list (P5-B)', () => {
  test('lists a job per customer request, with the seven columns and one green button; Job O-n for an order with no enquiry', async ({ page }) => {
    const f = await seed()
    await openAs(page, 'admin', `/jobs?q=${encodeURIComponent(f.company.name)}`)
    await expect(page.getByRole('heading', { name: 'Jobs', level: 1 })).toBeVisible()
    await expect(page.getByRole('row', { name: new RegExp(`Job ${f.rfq.number}\\b`) }).first()).toBeVisible()
    await expect(page.getByRole('row', { name: new RegExp(`Job O-${f.direct.number}\\b`) }).first()).toBeVisible()
    // the enquiry and its order are ONE job, not two
    await expect(page.getByRole('row', { name: new RegExp(`Job O-${f.order.number}\\b`) })).toHaveCount(0)
    const headers = (await page.getByRole('columnheader').allTextContents()).map(h => h.trim()).filter(Boolean)
    expect(headers).toEqual(['Job', 'Customer', 'Customer PO', 'Items', 'Where it stands', 'Next step', 'Owner'])
    await expect(page.locator('button.bg-primary')).toHaveCount(1)
    await review(page, 'jobs-list-1440')
    expect(await axeViolations(page)).toEqual([])
  })

  test('the Jobs box and Ctrl K find the same job by job number, RFQ, order, customer PO and customer reference', async ({ page }) => {
    const f = await seed()
    await openAs(page, 'admin', '/jobs')
    const box = page.getByLabel('Search jobs')
    for (const q of [`Job ${f.rfq.number}`, rfqRef(f.rfq.number), f.po, f.ref]) {
      await box.fill(q)
      await expect(page.getByRole('row', { name: new RegExp(`Job ${f.rfq.number}\\b`) }).first(), `the list finds the job by "${q}"`).toBeVisible()
    }
    await box.fill(`Job O-${f.direct.number}`)
    await expect(page.getByRole('row', { name: new RegExp(`Job O-${f.direct.number}\\b`) }).first()).toBeVisible()

    await openPalette(page)
    const input = page.getByRole('combobox')
    for (const q of [`Job ${f.rfq.number}`, rfqRef(f.rfq.number), f.po, f.ref]) {
      await input.fill(q)
      await expect(page.getByRole('option', { name: new RegExp(`Job ${f.rfq.number} · ${f.company.name}`) }), `the palette finds the job by "${q}"`).toBeVisible()
    }
    await input.fill(`Job ${f.rfq.number}`)
    await page.getByRole('option', { name: new RegExp(`Job ${f.rfq.number} · `) }).click()
    await expect(page).toHaveURL(new RegExp(`/jobs/${f.rfq.number}$`))
  })

  test('History shows only closed work, and a search ignores the chips', async ({ page }) => {
    const f = await seed()
    // closing the enquiry without an order would make it lost, but this RFQ has an order: its job stays open
    await openAs(page, 'admin', '/jobs?chip=history')
    await expect(page.getByRole('row', { name: new RegExp(`Job ${f.rfq.number}\\b`) })).toHaveCount(0)
    await page.goto(`/jobs?chip=history&q=${f.rfq.number}`)
    await expect(page.getByRole('row', { name: new RegExp(`Job ${f.rfq.number}\\b`) }).first()).toBeVisible()
  })

  test('an engineer sees the list with no amount and no way to start an enquiry', async ({ page }) => {
    const f = await seed()
    await openAs(page, 'engineer', `/jobs?q=${f.rfq.number}`)
    await expect(page.getByRole('row', { name: new RegExp(`Job ${f.rfq.number}\\b`) }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'New enquiry' })).toHaveCount(0)
    expect(await page.locator('#main').innerText()).not.toMatch(/PKR|Rs\.?\s?\d/)
  })

  test('phone: cards, no sideways scroll at 375 and 320', async ({ page }) => {
    const f = await seed()
    await openAs(page, 'admin', '/today')
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: 800 })
      await page.goto(`/jobs?q=${encodeURIComponent(f.company.name)}`)
      await expect(page.getByText(`Job ${f.rfq.number}`).first()).toBeVisible()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow, `no sideways scroll at ${width}`).toBeLessThanOrEqual(0)
      if (width === 375) await review(page, 'jobs-list-375')
    }
  })
})

test.describe('Jobs list card (2026-11)', () => {
  test('a 375 px card is five short rows: one status line, the PO for the office only, an Imported tag instead of a prefix', async ({ page, browser }) => {
    const f = await seed()
    await db.patch(`orders?id=eq.${f.direct.id}`, { legacy_source: { imported: true, table: 'orders' } })
    await page.setViewportSize({ width: 375, height: 800 })
    await openAs(page, 'admin', `/jobs?q=${encodeURIComponent(f.company.name)}`)
    const live = page.locator('tr[data-card]').filter({ hasText: `Job ${f.rfq.number}` })
    await expect(live).toHaveCount(1)
    await expect(live).toContainText(`PO ${f.po}`)
    await expect(live.locator('[data-stage-line]')).toContainText(/Stage \d of 7 · /)
    await expect(live.locator('[data-stage-mini]')).toHaveCount(0)
    await expect(live).not.toContainText('Imported')
    const old = page.locator('tr[data-card]').filter({ hasText: `Job O-${f.direct.number}` })
    await expect(old).toHaveCount(1)
    await expect(old.getByText('Imported', { exact: true })).toBeVisible()
    await expect(old).not.toContainText('Imported ·')
    // the items line is one line, whatever the text
    const itemsHeight = await live.locator('.line-clamp-1').first().evaluate(el => el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight))
    expect(itemsHeight).toBeLessThanOrEqual(1.05)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, 'no sideways scroll at 375').toBeLessThanOrEqual(0)
    await review(page, 'jobs-card-375')
    // an engineer never sees the PO
    const eng = await (await browser.newContext({ viewport: { width: 375, height: 800 } })).newPage()
    await openAs(eng, 'engineer', '/jobs?chip=open')
    await expect(eng.locator('tr[data-card]').first()).toBeVisible()
    expect(await eng.locator('#main').innerText()).not.toMatch(/\bPO [A-Z0-9]/)
  })
})

test.describe('Jobs list: stage filters and Customer PO (2026-11-03)', () => {
  /** A direct order for services only (nothing to source or deliver): its job waits at Invoice. */
  async function seedService(f: Fixture, tag: string) {
    const po = `CPO-${tag}-SVC`
    const [svc] = await must(rest<{ id: string; number: number }[]>('admin', 'orders', { method: 'POST', body: { company_id: f.company.id, customer_po_number: po, payment_terms_days: 30, ordered_on: karachiDay(-1) } }))
    await must(rest('admin', 'order_items', { method: 'POST', body: { order_id: svc.id, position: 0, description: `Commissioning ${tag}`, qty: 1, unit: 'job', unit_price_net: 9000, gst_rate: 18, is_service: true }, prefer: 'return=minimal' }))
    return { svc, po }
  }
  const row = (page: Page, key: string) => page.getByRole('row', { name: new RegExp(`Job ${key}\\b`) })
  const headersOf = async (page: Page) => (await page.getByRole('columnheader').allTextContents()).map(h => h.trim()).filter(Boolean)

  test('the Customer PO column is there for admin and sales (7 headers) and not for an engineer (6)', async ({ browser }) => {
    const f = await seed()
    // one signed-in browser per person: openAs signs in from the login page, which a signed-in page leaves at once
    for (const role of ['admin', 'sales'] as const) {
      const page = await (await browser.newContext()).newPage()
      await openAs(page, role, `/jobs?chip=open&q=${encodeURIComponent(f.company.name)}`)
      expect(await headersOf(page)).toEqual(['Job', 'Customer', 'Customer PO', 'Items', 'Where it stands', 'Next step', 'Owner'])
      await expect(row(page, String(f.rfq.number)).first()).toContainText(f.po)
      await expect(row(page, `O-${f.direct.number}`).first()).toContainText('—')
      await page.context().close()
    }
    const page = await (await browser.newContext()).newPage()
    await openAs(page, 'engineer', `/jobs?chip=open&q=${encodeURIComponent(f.company.name)}`)
    expect(await headersOf(page)).toEqual(['Job', 'Customer', 'Items', 'Where it stands', 'Next step', 'Owner'])
    await expect(row(page, String(f.rfq.number)).first()).toBeVisible()
    expect(await page.locator('#main').innerText()).not.toContain(f.po)
  })

  test('Waiting for supplier holds a direct goods order with no supplier leg; To invoice holds a service-only order; they combine with the chips', async ({ page }) => {
    const f = await seed()
    const { svc } = await seedService(f, f.ref)
    await openAs(page, 'admin', '/jobs?chip=open&stage=supplier')
    await expect(page.getByRole('radio', { name: 'Waiting for supplier' })).toBeChecked()
    await expect(row(page, `O-${f.direct.number}`).first()).toBeVisible()
    await expect(row(page, `O-${svc.number}`)).toHaveCount(0)
    await expect(page.getByText(/Showing \d+ open jobs? · Waiting for supplier/)).toBeVisible()

    await page.getByRole('radio', { name: 'To invoice' }).click()
    await expect(page).toHaveURL(/stage=invoice/)
    await expect(row(page, `O-${svc.number}`).first()).toBeVisible()
    await expect(row(page, `O-${f.direct.number}`)).toHaveCount(0)
    await expect(page.getByText(/Showing \d+ open jobs? · To invoice/)).toBeVisible()

    await page.getByRole('radio', { name: 'Orders' }).click()
    await expect(row(page, `O-${svc.number}`).first()).toBeVisible()
    await expect(row(page, `O-${f.direct.number}`).first()).toBeVisible()

    // History offers only All and Orders, and an Open-only stage is dropped on the way
    await page.getByRole('radio', { name: 'To invoice' }).click()
    await page.getByRole('radio', { name: 'History' }).click()
    await expect(page.getByRole('radio', { name: 'To invoice' })).toHaveCount(0)
    await expect(page.getByRole('radio', { name: 'Orders' })).toBeVisible()
    await expect(page).not.toHaveURL(/stage=invoice/)

    // All takes the parameter off the address
    await page.goto('/jobs?chip=open&stage=deliver')
    await page.getByRole('radio', { name: 'All', exact: true }).click()
    await expect(page).not.toHaveURL(/stage=/)
  })

  test('the stage survives Back from a Job page', async ({ page }) => {
    const f = await seed()
    await openAs(page, 'admin', '/jobs?chip=open&stage=supplier')
    await row(page, `O-${f.direct.number}`).first().click()
    await expect(page).toHaveURL(new RegExp(`/jobs/O-${f.direct.number}$`))
    await page.goBack()
    await expect(page).toHaveURL(/stage=supplier/)
    await expect(page.getByRole('radio', { name: 'Waiting for supplier' })).toBeChecked()
    await expect(row(page, `O-${f.direct.number}`).first()).toBeVisible()
  })

  test('an engineer is offered four stages, never sees a PO or the invoice words, and ?stage=invoice shows All', async ({ page }) => {
    const f = await seed()
    await openAs(page, 'engineer', '/jobs?chip=open&stage=invoice')
    await expect(page.getByTestId('stage-filter').getByRole('radio')).toHaveText(['All', 'Orders', 'Waiting for supplier', 'To deliver'])
    await expect(page.getByRole('radio', { name: 'All', exact: true })).toBeChecked()
    await expect(row(page, `O-${f.direct.number}`).first()).toBeVisible()
    const text = await page.locator('#main').innerText()
    expect(text).not.toMatch(/To invoice|To be paid|Customer PO/)
    expect(text).not.toContain(f.po)
  })

  test('the old /orders address opens the Jobs list on the Orders stage', async ({ page }) => {
    await openAs(page, 'admin', '/orders')
    await expect(page).toHaveURL(/\/jobs\?stage=orders$/)
    await expect(page.getByRole('radio', { name: 'Orders' })).toBeChecked()
    await page.goto('/orders?show=closed')
    await expect(page).toHaveURL(/\/jobs\?chip=history&stage=orders$/)
  })

  test('a phone shows the PO line on the card and a select for the stage; axe is clean at 1440 and 375', async ({ page }) => {
    const f = await seed()
    await openAs(page, 'admin', '/jobs?chip=open&stage=orders')
    await expect(row(page, String(f.rfq.number)).first()).toBeVisible()
    await review(page, 'jobs-stage-orders-1440')
    expect(await axeViolations(page)).toEqual([])
    await page.setViewportSize({ width: 375, height: 800 })
    await page.goto(`/jobs?chip=open&stage=orders&q=${encodeURIComponent(f.company.name)}`)
    await expect(page.getByText(`PO ${f.po}`).first()).toBeVisible()
    await page.goto('/jobs?chip=open&stage=orders')
    await expect(page.getByRole('combobox', { name: 'Show jobs at stage' })).toBeVisible()
    await page.getByRole('combobox', { name: 'Show jobs at stage' }).selectOption('invoice')
    await expect(page).toHaveURL(/stage=invoice/)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, 'no sideways scroll at 375').toBeLessThanOrEqual(0)
    await review(page, 'jobs-stage-invoice-375')
    expect(await axeViolations(page)).toEqual([])
  })
})

test.describe('Job page (P5-C, P5-D1)', () => {
  test('the page for an enquiry: header, seven-stop ruler, one green button, and the enquiry work on the Quotation stage', async ({ page }) => {
    const f = await seed()
    // an enquiry with no order of its own: its Quotation stage holds the supplier work
    const rfq = await createRfq(f.company.id, { customer_ref: `${f.ref}-B`, due_on: karachiDay(7) })
    await must(rest('admin', 'rfq_items', { method: 'POST', body: { rfq_id: rfq.id, position: 0, description: 'Level switch', qty: 1 }, prefer: 'return=minimal' }))
    // this test is about the closed state: the helper that opens the current step for other specs stands down
    await page.addInitScript(() => {
      ;(window as unknown as { __keepStepsClosed?: boolean }).__keepStepsClosed = true
    })
    await openAs(page, 'admin', `/jobs/${rfq.number}`)
    await expect(page.getByRole('heading', { level: 1 })).toContainText(`Job ${rfq.number}`)
    // the stage and the next step are one block, and the seven steps are one list of rows, every one closed
    await expect(page.locator('[data-stage-block]')).toHaveCount(1)
    await expect(page.locator('[data-stages] > [data-fold-row]')).toHaveCount(7)
    for (const b of await page.locator('[data-stages]').getByRole('button').all()) await expect(b).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('button.bg-primary')).toHaveCount(1)
    await page.getByRole('button', { name: 'Ask suppliers' }).click()
    await expect(page.locator('[data-stages]').getByRole('button', { name: /^Quotation/ })).toHaveAttribute('aria-expanded', 'true')
    await review(page, 'job-page-1440')
    expect(await axeViolations(page)).toEqual([])
  })

  test('the order steps are on the page (P5-D2): the green button opens the Supplier order stage, which holds the supplier work; Invoice offers nothing before delivery', async ({ page }) => {
    const f = await seed()
    await openAs(page, 'admin', `/jobs/${f.rfq.number}`)
    await expect(page.locator('button.bg-primary')).toHaveCount(1)
    await page.getByRole('button', { name: 'Choose suppliers' }).click()
    const stage = page.getByRole('region', { name: 'Supplier order stage' })
    await expect(stage).toBeVisible()
    await expect(stage.getByText('1 line has no supplier')).toBeVisible()
    await expect(stage.getByRole('button', { name: 'Add supplier' }).first()).toBeVisible()
    // the order lines (Order stage) and the invoice (nothing to create before the goods are delivered) are on this page, not the order page
    await page.locator('[data-stages]').getByRole('button', { name: /^Order/ }).click()
    // the customer PO is shown once, in the key facts line under the stage block; the Order step does not repeat it
    await expect(page.getByLabel('Key facts').getByText(f.po)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create invoice' })).toHaveCount(0)
    await expect(page.locator('button.bg-primary')).toHaveCount(1)
  })

  for (const role of ['sales', 'engineer'] as const) {
    test(`the real default for ${role}: every step is closed, the current one only marked`, async ({ page }) => {
      const f = await seed()
      // the test-side helper that opens the current step for other specs stands down here
      await page.addInitScript(() => {
        ;(window as unknown as { __keepStepsClosed?: boolean }).__keepStepsClosed = true
      })
      await openAs(page, role, `/jobs/${f.rfq.number}`)
      await expect(page.locator('[data-stages] > [data-fold-row]')).toHaveCount(7)
      for (const b of await page.locator('[data-stages]').getByRole('button').all()) await expect(b).toHaveAttribute('aria-expanded', 'false')
      await expect(page.locator('[data-stages]').getByRole('button', { name: / Now/ })).toHaveCount(1)
    })
  }

  test('an engineer opens the job with no Money panel and no price', async ({ page }) => {
    const f = await seed()
    await openAs(page, 'engineer', `/jobs/${f.rfq.number}`)
    await expect(page.getByRole('heading', { level: 1 })).toContainText(`Job ${f.rfq.number}`)
    await expect(page.getByRole('region', { name: 'Money for this job' })).toHaveCount(0)
    expect(await page.locator('#main').innerText()).not.toMatch(/PKR|Rs\.?\s?\d/)
    // never payment status, a price or the customer PO
    const text = await page.locator('#main').innerText()
    expect(text).not.toMatch(/\bpaid\b|collect|Customer PO|price/i)
    expect(text).not.toContain(f.po)
    expect(await page.locator('#main').innerHTML()).not.toContain(f.po)
    await expect(page.locator('[data-stages]').getByRole('button', { name: /^Payment/ })).toContainText('With the office')
    await review(page, 'job-page-engineer-1440')
  })

  test('phone: the engineer Add to this job row is one closed row, its button 44 px or more, no price, no sideways scroll at 375 and 320', async ({ page }) => {
    const f = await seed()
    await openAs(page, 'engineer', '/today')
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: 800 })
      await page.goto(`/jobs/${f.rfq.number}`)
      // this job has nothing to deliver or install, so there is no On site card and no green button: the one row holds Add photo or note, once
      const row = page.getByRole('button', { name: /^Add to this job/ })
      await expect(row).toHaveAttribute('aria-expanded', 'false')
      await expect(page.getByRole('button', { name: 'Add photo or note' })).toHaveCount(0)
      await row.click()
      const add = page.getByRole('button', { name: 'Add photo or note' })
      await expect(add).toHaveCount(1)
      await expect(page.locator('#main button.bg-primary'), `no green button at ${width}`).toHaveCount(0)
      for (const b of [row, add]) {
        const box = await b.boundingBox()
        expect(box?.height ?? 0, `${await b.innerText()} is tall enough at ${width}`).toBeGreaterThanOrEqual(44)
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
      }
      expect(await page.locator('#main').innerText()).not.toMatch(/PKR|Rs.?s?d/)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow, `no sideways scroll at ${width}`).toBeLessThanOrEqual(0)
      if (width === 375) await review(page, 'job-page-engineer-375')
    }
  })

  test('phone: the ruler is one line, no sideways scroll at 375 and 320', async ({ page }) => {
    const f = await seed()
    await openAs(page, 'admin', '/today')
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: 800 })
      await page.goto(`/jobs/${f.rfq.number}`)
      await expect(page.locator('[data-stage-phone]')).toContainText(/Stage \d of 7/)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow, `no sideways scroll at ${width}`).toBeLessThanOrEqual(0)
    }
  })
})

test.describe('Money (PKR) row', () => {
  test('an enquiry-stage job (no order) leaves Loading and says there is no money yet', async ({ page }) => {
    const f = await seed()
    // seed's RFQ has an order: make a fresh enquiry with none
    const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
    const rfq = await createRfq(f.company.id, { customer_ref: `ENQ-${tag}`, due_on: karachiDay(5) })
    await openAs(page, 'admin', `/jobs/${rfq.number}`)
    const row = page.getByRole('button', { name: /^Money \(PKR\)/ })
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    await row.click()
    const card = page.getByRole('region', { name: 'Money for this job' })
    await expect(card).toBeVisible()
    await expect(card).toContainText('No money yet')
    await expect(card).not.toContainText('Loading')
    await expect(card.getByRole('status')).toHaveCount(0)
  })

  test('a job with an order shows the sale in the Money card, not Loading', async ({ page }) => {
    const f = await seed()
    await openAs(page, 'admin', `/jobs/${f.rfq.number}`)
    // closed, the row already says what is still to collect
    await expect(page.getByRole('button', { name: /^Money \(PKR\)/ })).toContainText('Still to collect')
    await page.getByRole('button', { name: /^Money \(PKR\)/ }).click()
    const ordered = page.getByRole('region', { name: 'Money for this job' })
    await expect(ordered).toContainText('Sale (with GST)')
    await expect(ordered).not.toContainText('Loading')
  })
})
