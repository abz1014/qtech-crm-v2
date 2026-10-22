import { expect, test } from '@playwright/test'
import { invoice, order } from '../../verify/support/fixtures'
import { ctxAs, settle, shot, tag } from './support'

/*
 * Confirmed bugs from the crawl (crawl.spec.ts), pinned as test.fail so a fix flips them. The setup runs normally (a broken setup is a red
 * failure); test.fail is declared just before the one expect that states the correct behaviour.
 */

test('HW-42: on a phone, Invoices & GST puts the search box and the filter tabs past the right edge of the screen', async ({ browser }, info) => {
  const o = await order({ lines: [{ description: `Hunt phone register ${tag()}`, qty: 1, price: 10000 }] })
  await invoice(o.order.id, 10000, 1800)
  const ctx = await ctxAs(browser, info, 'admin', 'phone')
  const page = await ctx.newPage()
  await page.goto('/money/gst-register')
  await settle(page)
  const search = page.getByPlaceholder('Search invoices')
  await expect(search).toBeVisible()
  const box = await search.boundingBox()
  expect(box).not.toBeNull()
  await shot(page, 'HW-42-phone-gst-register', false)
  const width = page.viewportSize()?.width ?? 375
  expect(Math.round(box!.x + box!.width), 'right edge of the Search invoices box').toBeLessThanOrEqual(width)
  await ctx.close()
})
