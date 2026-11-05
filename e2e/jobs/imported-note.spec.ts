import { expect, test } from '@playwright/test'
import { createCompany, openAs, uniqueName } from '../support/stack'
import { JOB_URL } from '../support/job'
import { db } from '../verify/support/db'

/*
 * Imported text is private (migration 0135). The old system's free text came with the import: an order's notes, and a supplier
 * breakdown inside the first item's description ("... x6 - <supplier> @ Rs 2,505/unit"). An engineer sees no price and no supplier
 * name, so the database moves the notes to public.imported_notes (admin and sales only) and cleans the item text.
 *   - an engineer's job page draws neither the note nor the supplier nor the price, and none of the answers the page received holds them
 *   - an admin sees the cleaned item text, finds the "Imported note" panel closed, opens it and reads the original
 * Rows are written the way the import writes them (the service role, legacy_source set). Fictional customer, supplier and items.
 */
const ENGINEER = 'a0000000-0000-4000-8000-000000000003'
const ADMIN = 'a0000000-0000-4000-8000-000000000001'
const tag = () => Math.random().toString(36).slice(2, 8).toUpperCase()

async function seed() {
  const t = tag()
  const supplier = `Zephyr${t} Components`
  const co = await createCompany(uniqueName('Imported Customer'))
  const breakdown = `Supplier breakdown: • ITEM#30: IC TLC0838C 20PIN SMD ×6 — ${supplier} @ Rs 2,505/unit • ITEM#31: Relay 12V DPDT ×2 — ${supplier} @ Rs 410/unit`
  const note = `PO received.\n${breakdown}`
  const order = await db.add<{ id: string; number: number }>('orders', {
    company_id: co.id, owner_id: ADMIN, ordered_on: '2026-03-02', payment_terms_days: 30, notes: note, legacy_source: { sheet: 'orders', row: t },
  })
  await db.insert('order_items', { order_id: order.id, position: 0, description: breakdown, qty: 1, unit: 'ea', unit_price_net: 1000, gst_rate: 18, legacy_source: { sheet: 'items', row: t } })
  await db.insert('order_engineers', { order_id: order.id, user_id: ENGINEER })
  return { order, supplier, note, breakdown }
}

test('the database keeps the original in imported_notes and the order and its lines clean', async () => {
  const s = await seed()
  const o = await db.one<{ notes: string | null }>(`orders?id=eq.${s.order.id}&select=notes`)
  expect(o.notes).toBeNull()
  const line = await db.one<{ description: string }>(`order_items?order_id=eq.${s.order.id}&select=description`)
  expect(line.description).toBe('IC TLC0838C 20PIN SMD ×6 +1 more')
  const kept = await db.rows<{ table_name: string; note: string }>(`imported_notes?parent_id=eq.${s.order.id}&select=table_name,note&order=table_name`)
  expect(kept.map(k => k.table_name)).toEqual(['order_items', 'orders'])
  expect(kept.find(k => k.table_name === 'orders')?.note).toBe(s.note)
})

test('an engineer sees no note, no supplier and no price, in the page or in anything it received', async ({ page }) => {
  const s = await seed()
  const bodies: string[] = []
  page.on('response', async res => {
    if (!res.url().includes('/rest/v1/')) return
    try {
      bodies.push(await res.text())
    } catch {
      /* a redirect or an aborted request has no body */
    }
  })
  await page.setViewportSize({ width: 375, height: 812 })
  await openAs(page, 'engineer', `/orders/${s.order.id}`)
  await expect(page).toHaveURL(JOB_URL)
  await expect(page.getByText('IC TLC0838C 20PIN SMD ×6 +1 more').first()).toBeVisible()
  await expect(page.getByRole('button', { name: /Imported note/ })).toHaveCount(0)
  await page.waitForLoadState('networkidle')
  const html = await page.content()
  for (const bad of [s.supplier, 'Rs 2,505', '/unit', 'Supplier breakdown', 'ITEM#30']) expect(html, `the page holds "${bad}"`).not.toContain(bad)
  const all = bodies.join('\n')
  expect(all.length, 'the page made API calls').toBeGreaterThan(0)
  for (const bad of [s.supplier, 'Rs 2,505', '/unit', 'Supplier breakdown', 'ITEM#30']) expect(all, `an answer held "${bad}"`).not.toContain(bad)
})

test('an admin finds the Imported note closed, opens it and reads the original', async ({ page }) => {
  const s = await seed()
  await openAs(page, 'admin', `/orders/${s.order.id}`)
  await expect(page).toHaveURL(JOB_URL)
  const button = page.getByRole('button', { name: /Imported note/ })
  await expect(button).toBeVisible()
  await expect(button).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByText(s.supplier).first()).toHaveCount(0)
  await button.click()
  await expect(button).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByText(/PO received\./)).toBeVisible()
  await expect(page.getByText(new RegExp(`${s.supplier} @ Rs 2,505/unit`)).first()).toBeVisible()
})
