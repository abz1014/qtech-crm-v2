import { expect, test, type Page } from '@playwright/test'
import { createCompany, createRfq, karachiDay, must, openAs, review, rest, rfqRef, uniqueName } from '../support/stack'
import { axeViolations } from '../support/axe'

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
  test('lists a job per customer request, with the six columns and one green button; Job O-n for an order with no enquiry', async ({ page }) => {
    const f = await seed()
    await openAs(page, 'admin', `/jobs?q=${encodeURIComponent(f.company.name)}`)
    await expect(page.getByRole('heading', { name: 'Jobs', level: 1 })).toBeVisible()
    await expect(page.getByRole('row', { name: new RegExp(`Job ${f.rfq.number}\\b`) }).first()).toBeVisible()
    await expect(page.getByRole('row', { name: new RegExp(`Job O-${f.direct.number}\\b`) }).first()).toBeVisible()
    // the enquiry and its order are ONE job, not two
    await expect(page.getByRole('row', { name: new RegExp(`Job O-${f.order.number}\\b`) })).toHaveCount(0)
    const headers = (await page.getByRole('columnheader').allTextContents()).map(h => h.trim()).filter(Boolean)
    expect(headers).toEqual(['Job', 'Customer', 'Items', 'Where it stands', 'Next step', 'Owner'])
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

test.describe('Job page (P5-C, P5-D1)', () => {
  test('the page for an enquiry: header, seven-stop ruler, one green button, and the enquiry work on the Quotation stage', async ({ page }) => {
    const f = await seed()
    // an enquiry with no order of its own: its Quotation stage holds the supplier work
    const rfq = await createRfq(f.company.id, { customer_ref: `${f.ref}-B`, due_on: karachiDay(7) })
    await must(rest('admin', 'rfq_items', { method: 'POST', body: { rfq_id: rfq.id, position: 0, description: 'Level switch', qty: 1 }, prefer: 'return=minimal' }))
    await openAs(page, 'admin', `/jobs/${rfq.number}`)
    await expect(page.getByRole('heading', { level: 1 })).toContainText(`Job ${rfq.number}`)
    await expect(page.getByRole('list', { name: 'Stages of this job' }).getByRole('listitem')).toHaveCount(7)
    await expect(page.locator('button.bg-primary')).toHaveCount(1)
    await page.getByRole('button', { name: 'Ask suppliers' }).click()
    await expect(page.locator('[data-stages]').getByRole('button', { name: /^Quotation/ })).toHaveAttribute('aria-expanded', 'true')
    await review(page, 'job-page-1440')
    expect(await axeViolations(page)).toEqual([])
  })

  test('an engineer opens the job with no Money panel and no price', async ({ page }) => {
    const f = await seed()
    await openAs(page, 'engineer', `/jobs/${f.rfq.number}`)
    await expect(page.getByRole('heading', { level: 1 })).toContainText(`Job ${f.rfq.number}`)
    await expect(page.getByRole('region', { name: 'Money for this job' })).toHaveCount(0)
    expect(await page.locator('#main').innerText()).not.toMatch(/PKR|Rs\.?\s?\d/)
    await review(page, 'job-page-engineer-1440')
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
