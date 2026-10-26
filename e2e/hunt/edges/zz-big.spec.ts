import { test } from '@playwright/test'
import { IDS } from '../../verify-roles/fixtures'
import { service } from '../../verify-roles/lib'
import { contextAs, layout, note, recordLayout, settle, shot, vp, Watcher } from './lib'

/*
 * Exploration: the big state. Runs LAST in the suite (file name): 1,200 companies, 1,100 RFQs and 1,050 orders with a line each,
 * inserted in bulk with the local stack's service role (fictional names), then the list screens as admin and engineer at 1366
 * and 375: time to settle, errors, layout, what the list says about its size, and the page at the bottom.
 */
async function bulk<T>(table: string, rows: unknown[]): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < rows.length; i += 400) {
    const res = await service(`/rest/v1/${table}`, { method: 'POST', body: rows.slice(i, i + 400), prefer: 'return=representation' })
    const text = await res.text()
    if (res.status >= 300) throw new Error(`bulk ${table}: ${res.status} ${text.slice(0, 300)}`)
    out.push(...(JSON.parse(text) as T[]))
  }
  return out
}

test('1,000+ rows: lists, board, search', async ({ browser }, info) => {
  test.setTimeout(900_000)
  const tag = `HB${Date.now().toString(36).slice(-4)}`
  const cos = await bulk<{ id: string }>('companies', Array.from({ length: 1200 }, (_, i) => ({ name: `${tag} Bulk Company ${String(i).padStart(4, '0')} Pvt Ltd`, country: i % 3 ? 'Pakistan' : 'Germany' })))
  const rfqs = await bulk<{ id: string }>('rfqs', Array.from({ length: 1100 }, (_, i) => ({ company_id: cos[i % cos.length].id, owner_id: i % 2 ? IDS.sales : IDS.admin, customer_ref: `${tag}-R${i}` })))
  await bulk('rfq_items', rfqs.map((r, i) => ({ rfq_id: r.id, position: 0, description: `${tag} bulk item ${i} pressure gauge`, qty: (i % 7) + 1 })))
  const orders = await bulk<{ id: string }>('orders', Array.from({ length: 1050 }, (_, i) => ({ company_id: cos[i % cos.length].id, owner_id: i % 2 ? IDS.sales : IDS.admin, customer_po_number: `${tag}-PO${i}` })))
  await bulk('order_items', orders.map((o, i) => ({ order_id: o.id, position: 0, description: `${tag} bulk order line ${i}`, qty: 1, unit_price_net: 1000 + i * 37.25, gst_rate: 18 })))
  note({ kind: 'big', detail: `seeded 1200 companies, 1100 RFQs, 1050 orders (${tag})` })

  for (const run of [
    { role: 'admin', v: 'w1366' },
    { role: 'admin', v: 'w375' },
    { role: 'engineer', v: 'w1366' },
  ] as const) {
    const context = await contextAs(browser, info, run.role, vp(run.v))
    const page = await context.newPage()
    const w = new Watcher(page, { role: run.role, vp: `${run.v}-big` })
    const paths = ['/companies', '/rfqs', '/rfqs?owner=all', '/orders', '/orders?owner=all', '/todo', ...(run.role === 'admin' ? ['/money/receivables', '/money/gst-register', '/money/margins'] : [])]
    for (const path of paths) {
      w.at(`${path} big`)
      const t0 = Date.now()
      await page.goto(path)
      await page.locator('#main').waitFor({ timeout: 30_000 }).catch(() => undefined)
      await settle(page)
      const ms = Date.now() - t0
      const rows = await page.locator('#main [role="row"], #main tr, #main li, #main article').count()
      const sizeText = ((await page.locator('#main').innerText().catch(() => '')).match(/[^\n]*\b\d[\d,]*\s+(companies|RFQs|orders|rows|results|shown|of \d)[^\n]*/i) ?? [''])[0]
      note({ kind: 'big', role: run.role, vp: run.v, path, detail: `${ms} ms to settle; ${rows} row-like elements; size text "${sizeText.slice(0, 120)}"` })
      if (ms > 8000) w.add('slow', `${ms} ms to settle with 1,000+ rows`)
      recordLayout(w, await layout(page), `${path} big`)
      await shot(page, `big_${run.v}_${run.role}_${path}`)
      const t1 = Date.now()
      await page.keyboard.press('End')
      await page.mouse.wheel(0, 200000)
      await page.waitForTimeout(800)
      note({ kind: 'big', role: run.role, vp: run.v, path, detail: `scroll to the bottom took ${Date.now() - t1} ms` })
      await shot(page, `big_${run.v}_${run.role}_${path}_bottom`)
    }
    // Search across the bulk rows: a company name and an order PO.
    w.at('palette big')
    await page.goto('/todo')
    await settle(page)
    await page.keyboard.press('Control+k')
    const box = page.getByRole('combobox').first()
    await box.fill(`${tag} Bulk Company 07`).catch(() => undefined)
    await page.waitForTimeout(2500)
    const opts = await page.getByRole('option').count()
    note({ kind: 'big', role: run.role, vp: run.v, path: 'palette', detail: `"${tag} Bulk Company 07" -> ${opts} options` })
    await shot(page, `big_${run.v}_${run.role}_palette`)
    await context.close()
  }
})
