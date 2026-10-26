import { expect, test } from '@playwright/test'
import { createCompany, karachiDay, must, openAs, rest, uniqueName } from '../support/stack'
import { showAllTodo } from '../support/todo'
import { db } from '../verify/support/db'

/*
 * Owner decision 2026-10-22 (1b), redesign phase 0: the order tasks of an order imported from the old CRM (still to invoice,
 * delivered not invoiced, goods late, place PO, to source, plan commissioning) leave Today's groups and counts and wait in a grey
 * "Imported, to review" fold until the one-off Review imported (phase 2). A v2 order with the same facts is still listed and
 * counted. Fictional data. The import marker is written as the service role (the import's own role), as the import does.
 */
const SALES = 'a0000000-0000-4000-8000-000000000002'

async function lateGoods(imported: boolean) {
  const customer = uniqueName(imported ? 'Imported Customer' : 'Live Customer')
  const co = await createCompany(customer)
  const supplier = uniqueName(imported ? 'Imported Supplier' : 'Live Supplier')
  const sup = await createCompany(supplier)
  const order = (await must(rest<{ id: string; number: number }[]>('admin', 'orders', { method: 'POST', body: { company_id: co.id, owner_id: SALES, ordered_on: karachiDay(-20) } })))[0]
  const leg = (await must(rest<{ id: string }[]>('admin', 'supplier_orders', { method: 'POST', body: { order_id: order.id, supplier_id: sup.id, placed_on: karachiDay(-15), expected_on: karachiDay(-6) } })))[0]
  await must(rest('admin', 'order_items', { method: 'POST', body: { order_id: order.id, description: 'Pressure transmitter', qty: 1, unit_price_net: 1000, supplier_order_id: leg.id }, prefer: 'return=minimal' }))
  if (imported) await db.patch(`orders?id=eq.${order.id}`, { legacy_source: { imported: true, table: 'orders' } })
  return { customer, supplier, order }
}

test('an imported order\'s late goods wait in "Imported, to review", grey and not counted; a v2 order\'s are still due', async ({ page }) => {
  const old = await lateGoods(true)
  const live = await lateGoods(false)
  await openAs(page, 'sales', '/todo')
  await showAllTodo(page)
  await expect(page.getByRole('heading', { level: 1, name: 'To do' })).toBeVisible()

  const due = page.locator('section[data-block="late"], section[data-block="today"]')
  await expect(due.locator('li[data-rule="goods_late"]').filter({ hasText: live.supplier })).toBeVisible()
  await expect(page.locator('li[data-rule]').filter({ hasText: old.supplier }).filter({ visible: true })).toHaveCount(0)

  const fold = page.getByRole('region', { name: 'Imported, to review' })
  await expect(fold.getByRole('button', { name: /^Imported, to review · \d+/ })).toHaveAttribute('aria-expanded', 'false')
  await fold.getByRole('button', { name: /^Imported, to review/ }).click()
  const row = fold.locator('li[data-rule="goods_late"][data-imported]').filter({ hasText: old.supplier })
  await expect(row).toBeVisible()
  await expect(row.getByText(/^since \d{1,2} [A-Z][a-z]{2} \d{4}$/)).toHaveClass(/text-fg-muted/)
})
