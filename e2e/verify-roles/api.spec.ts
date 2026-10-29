import { expect, test } from '@playwright/test'
import { API_URL } from '../support/stack'
import { api, karachiToday, moneyIn, readSchema, service, SERVICE_KEY, tokenFor, type Persona } from './lib'
import { IDS, seedWorld, type World } from './fixtures'

/*
 * The data API itself (PostgREST and Storage on the local CI stack), as each persona with a real signed-in token: what the
 * browser's developer tools would let a person read or write. The table, view and function lists come from
 * src/types/database.ts, so a new object is swept without editing this file. The pgTAP files 0901 to 0904 prove the same
 * rules inside the database; this proves them through the API, including embedded selects and counts.
 */
let world: World
const schema = readSchema()
const today = karachiToday()

test.setTimeout(300_000)

test.beforeAll(async () => {
  test.skip(!SERVICE_KEY, 'needs SERVICE_ROLE_KEY from the local stack (supabase status -o env)')
  world = await seedWorld('VA')
})

const NO_ACCESS: Persona[] = ['anon', 'deactivated', 'norole', 'ghost']
/** Pure helpers that read no table: s10 is silent on people without a role (S14 item 3); anon is refused. */
const PURE = new Set(['model_tokens', 'item_text_norm', 'lead_time_upper_days', 'supplier_median_delivery_days', 'item_match_tier', 'brand_tokens',
  'tokens_without', 'brand_words', 'strip_words', 'similar_enough', 'today_pkt'])
/** Functions that write: never called as a staff role here (pgTAP proves who may); a no-access persona must be refused. */
const WRITES = new Set(['apply_fx_payload', 'close_month', 'close_months_through', 'convert_rfq_to_order', 'create_repeat_order', 'fetch_fx_rates',
  'float_rfq', 'import_purge_audit', 'import_reset_numbers', 'ingest_fx_response', 'issue_purchase_order', 'issue_quotation', 'merge_brands',
  'merge_companies', 'reopen_month', 'resolve_value_basis', 'revoke_user_sessions', 'schedule_fx_cron', 'set_fx_rate', 'set_rfq_floated',
  'split_order_item', 'stamp_clarification_ask', 'stamp_fbr_psid', 'stamp_goods_chase', 'stamp_payment_reminder', 'stamp_supplier_chase',
  'stamp_tax_deposited', 'stamp_tcs_sent', 'void_payment', 'correct_payment', 'restore_payment'])

/** Arguments for any function, from the argument names (fixture ids where the name says which record). */
function argsFor(fn: string, names: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const n of names) {
    if (n === 'p_rfq_id') out[n] = world.rfq.id
    else if (n === 'p_order_id') out[n] = world.order.id
    else if (n === 'p_supplier_order_id') out[n] = world.leg
    else if (n === 'p_company_id' || n === 'p_keep') out[n] = world.company.id
    else if (n === 'p_drop') out[n] = world.supplier.id
    else if (n === 'p_supplier_ids') out[n] = [world.supplier.id]
    else if (n === 'p_invoice_ids') out[n] = [world.invoice.id]
    else if (n.endsWith('_ids')) out[n] = [crypto.randomUUID()]
    else if (n.endsWith('_id')) out[n] = crypto.randomUUID()
    else if (/date|month|as_of|_on$|^p_at$/.test(n)) out[n] = today
    else if (/qty|lim|limit|rate|days|threshold|min/.test(n)) out[n] = 1
    else if (n === 'p_items' || n === 'p_lines' || n === 'p_payload') out[n] = []
    else if (/^p_(is_|mark_|needs_)/.test(n)) out[n] = false
    else if (n === 'p_description' || n === 'q' || n === 't' || n === 'p_text') out[n] = world.tag
    else if (n === 'p_currency') out[n] = 'USD'
    else if (n === 'p_basis') out[n] = 'net'
    else out[n] = 'probe'
  }
  return out
}

function empty(body: unknown): boolean {
  if (body === null || body === false || body === 0 || body === '') return true
  // An object of empty maps or lists (lookup_labels answers {legs: {}, orders: {}, companies: {}} to someone who sees nothing).
  if (typeof body === 'object' && !Array.isArray(body) && Object.values(body as object).every(v => v === null || (typeof v === 'object' && Object.keys(v as object).length === 0))) return true
  // A row that only echoes the ids it was asked about (supplier_item_memory answers one row per supplier id, all else empty).
  if (Array.isArray(body))
    return body.length === 0 || body.every(r => r === null || (typeof r === 'object' && Object.entries(r as object).every(([k, v]) => k.endsWith('_id') || v === null || v === false || v === 0)))
  return false
}

test('no-access personas (anon, deactivated, no users row, deleted account) read no row of any table or view', async () => {
  const objects = [...schema.tables, ...schema.views]
  expect(objects.length, 'the schema lists tables and views').toBeGreaterThan(50)
  for (const p of NO_ACCESS) {
    const got: string[] = []
    for (const o of objects) {
      const r = await api(p, `/rest/v1/${o}?select=*&limit=3`, { prefer: 'count=exact' })
      const refused = r.status === 401 || r.status === 403
      const none = r.status === 200 && Array.isArray(r.body) && r.body.length === 0 && /\/0$|\*$/.test(r.headers.get('content-range') ?? '*/0')
      if (!refused && !none) got.push(`${o}: ${r.status} ${r.text.slice(0, 120)}`)
    }
    expect.soft(got, `${p} reads rows (or a count) it must not`).toEqual([])
  }
})

test('no-access personas call no function with a result, and write nothing', async () => {
  for (const p of NO_ACCESS) {
    const got: string[] = []
    for (const f of schema.functions) {
      const r = await api(p, `/rest/v1/rpc/${f.name}`, { method: 'POST', body: argsFor(f.name, f.args) })
      if (r.status >= 400) continue
      if (empty(r.body)) continue
      if (PURE.has(f.name) && p !== 'anon') continue
      got.push(`${f.name}: ${r.status} ${r.text.slice(0, 120)}`)
    }
    expect.soft(got, `${p} gets a result from functions`).toEqual([])
    for (const [t, body] of [
      ['companies', { name: `${world.tag} intruder` }],
      ['payments_in', { order_id: world.order.id, amount: 1 }],
      ['users', { id: IDS.engineer, name: 'x', role: 'admin' }],
    ] as const) {
      const r = await api(p, `/rest/v1/${t}`, { method: 'POST', body })
      expect.soft(r.status, `${p} inserts into ${t}`).toBeGreaterThanOrEqual(400)
    }
    const patch = await api(p, `/rest/v1/orders?id=eq.${world.order.id}`, { method: 'PATCH', body: { notes: 'intruder' }, prefer: 'return=representation' })
    expect.soft(patch.status >= 400 || (Array.isArray(patch.body) && patch.body.length === 0), `${p} updates an order: ${patch.status} ${patch.text.slice(0, 80)}`).toBe(true)
  }
})

test('a person with no users row cannot give themselves one, and nobody changes a role or a deactivation through the API', async () => {
  for (const p of ['norole', 'sales', 'engineer', 'admin'] as const) {
    const me = await api(p, '/auth/v1/user')
    const id = (me.body as { id?: string } | null)?.id ?? ''
    const ins = await api(p, '/rest/v1/users', { method: 'POST', body: { id, name: 'Me', role: 'admin' } })
    expect.soft(ins.status, `${p}: insert a users row for themselves`).toBeGreaterThanOrEqual(400)
    const up = await api(p, `/rest/v1/users?id=eq.${id}`, { method: 'PATCH', body: { role: 'admin' }, prefer: 'return=representation' })
    expect.soft(up.status >= 400 || (Array.isArray(up.body) && up.body.length === 0), `${p}: set their own role: ${up.status}`).toBe(true)
  }
  const react = await api('admin', '/rest/v1/users?id=eq.a0000000-0000-4000-8000-000000000004', { method: 'PATCH', body: { deactivated_at: null }, prefer: 'return=representation' })
  expect(react.status, 'admin reactivates directly (only admin-users may)').toBeGreaterThanOrEqual(400)
})

// Since 0081 (owner decision 2026-10-22) the database refuses prices to an engineer too: PostgREST's pre-request moves an engineer's
// request onto the role qtech_engineer, which has no SELECT on any price, total or rate column. `select=*` on such a table is refused
// (403); every other column still reads. So selling and supplier prices (m3, supplier) are leaks now, like hidden money.
const PRICE_COLUMNS: Record<string, string[]> = {
  rfq_items: ['quoted_unit_price_net'],
  supplier_quote_lines: ['unit_price', 'fx_rate_pkr', 'weight', 'weight_unit'], // weight: 0111 (the comparative statement is admin and sales only)
  quotations: ['lines', 'net_total', 'gst_total'],
  order_items: ['unit_price_net', 'supplier_unit_price'],
  purchase_orders: ['total', 'lines'],
  fx_rates: ['rate_pkr'],
}

test('engineer: no money of any kind in any table or view, column by column (prices included, 0081)', async () => {
  const leaks: string[] = []
  const refused: string[] = []
  for (const o of [...schema.tables, ...schema.views]) {
    const r = await api('engineer', `/rest/v1/${o}?select=*&limit=500`)
    if (r.status !== 200) {
      refused.push(`${o} ${r.status}`)
      continue
    }
    for (const l of moneyIn(o, r.body)) {
      if (l.rule === 'legacy') continue // BUG-RV-01, its own test
      if (l.rule === 'own') continue // the engineer's own target (s10 targets "S own")
      leaks.push(`${l.where}.${l.field} [${l.rule}] = ${l.value}`)
    }
  }
  test.info().annotations.push({ type: 'refused to the engineer (select=*)', description: refused.join(' ; ') })
  expect([...new Set(leaks)]).toEqual([])
  // Precondition: the admin reads the same money, so the engineer's silence is a refusal, not an empty table.
  for (const t of ['payments_in', 'invoices', 'expenses', 'order_costs', 'v_order_money', 'v_payment_net']) {
    const r = await api('admin', `/rest/v1/${t}?select=*&order_id=eq.${world.order.id}`)
    expect.soft((r.body as unknown[]).length, `precondition: the admin reads ${t} of the order`).toBeGreaterThan(0)
  }
})

test('engineer: every price, total and rate column is refused by the database; the rest reads; admin and sales unchanged (0081)', async () => {
  for (const [table, cols] of Object.entries(PRICE_COLUMNS)) {
    const all = await api('engineer', `/rest/v1/${table}?select=*&limit=1`)
    expect.soft(all.status, `engineer ${table}?select=*`).toBe(403)
    const ids = await api('engineer', `/rest/v1/${table}?select=id&limit=1`)
    expect.soft(ids.status, `engineer reads ${table}.id: ${ids.text.slice(0, 120)}`).toBe(200)
    for (const c of cols) {
      const r = await api('engineer', `/rest/v1/${table}?select=${c}&limit=1`)
      expect.soft(r.status, `engineer ${table}.${c}`).toBe(403)
      for (const p of ['admin', 'sales'] as const) {
        const ok = await api(p, `/rest/v1/${table}?select=${c}&limit=1`)
        expect.soft(ok.status, `${p} still reads ${table}.${c}`).toBe(200)
      }
    }
  }
  const item = await api('engineer', `/rest/v1/rfq_items?id=eq.${world.rfqItem}&select=description,qty`)
  expect((item.body as unknown[]).length, 'the engineer still reads the RFQ item itself').toBe(1)
  const totals = await api('engineer', `/rest/v1/v_order_state?order_id=eq.${world.order.id}&select=lifecycle,net,gst,gross`)
  expect(totals.status).toBe(200)
  expect(totals.body, 'the order totals are NULL for the engineer').toEqual([expect.objectContaining({ net: null, gst: null, gross: null })])
  const adminTotals = await api('admin', `/rest/v1/v_order_state?order_id=eq.${world.order.id}&select=gross`)
  expect((adminTotals.body as { gross: number | null }[])[0]?.gross, 'precondition: the admin gets the order total').not.toBeNull()
  const fx = await api('engineer', '/rest/v1/v_fx_latest?select=*')
  expect(fx.status, 'exchange rates are refused').toBe(403)
  for (const f of ['rank_item_quotes', 'customer_price_memory', 'po_line_prefill']) {
    const body = f === 'po_line_prefill' ? { p_supplier_order_id: world.leg } : { p_rfq_id: world.rfq.id }
    const r = await api('engineer', `/rest/v1/rpc/${f}`, { method: 'POST', body })
    expect.soft(r.status, `engineer calls ${f}`).toBeGreaterThanOrEqual(400)
    const s = await api('sales', `/rest/v1/rpc/${f}`, { method: 'POST', body })
    expect.soft(s.status, `sales still call ${f}`).toBe(200)
  }
})

test('engineer and sales: embedded selects reach no money table', async () => {
  const embeds = [
    `orders?id=eq.${world.order.id}&select=*,invoices(*),payments_in(*),order_costs(*),expenses(*)`,
    `supplier_orders?id=eq.${world.leg}&select=*,expenses(*)`,
    `companies?id=eq.${world.company.id}&select=*,invoices(*)`,
    `order_items?order_id=eq.${world.order.id}&select=*,orders(*,invoices(*),payments_in(*),order_costs(*))`,
    `expense_categories?select=*,expenses(*)`,
  ]
  for (const p of ['engineer', 'sales'] as const) {
    for (const path of embeds) {
      const r = await api(p, `/rest/v1/${path}`)
      if (r.status !== 200) {
        test.info().annotations.push({ type: 'embed refused', description: `${p} ${path}: ${r.status}` })
        continue
      }
      const hidden = JSON.stringify(r.body).match(/"(invoices|payments_in|order_costs|expenses)":\s*(\[\s*\{|\{)/g) ?? []
      const allowed = p === 'sales' ? hidden.filter(h => h.startsWith('"invoices"')) : []
      expect.soft(hidden.filter(h => !allowed.includes(h)), `${p} ${path}: embedded money rows`).toEqual([])
      expect.soft(moneyIn(path.split('?')[0], r.body).filter(l => l.rule === 'hidden' && !(p === 'sales' && /invoices/.test(l.where))), `${p} ${path}: hidden money values`).toEqual([])
    }
  }
  const admin = await api('admin', `/rest/v1/${embeds[0]}`)
  expect(JSON.stringify(admin.body), 'precondition: the admin gets the embedded payments').toContain(String(world.amounts.payment))
})

test('engineer: counts and HEAD requests reveal nothing about money tables', async () => {
  for (const t of ['payments_in', 'invoices', 'expenses', 'order_costs', 'recurring_expenses', 'v_order_money', 'v_payment_net', 'v_gst_register', 'audit_log']) {
    const r = await api('engineer', `/rest/v1/${t}?select=*`, { method: 'HEAD', prefer: 'count=exact' })
    const range = r.headers.get('content-range') ?? ''
    expect.soft(r.status === 401 || r.status === 403 || /\/0$/.test(range) || range === '', `engineer count of ${t}: ${r.status} ${range}`).toBe(true)
  }
})

test('engineer: functions return no hidden money', async () => {
  const leaks: string[] = []
  for (const f of schema.functions) {
    if (WRITES.has(f.name)) continue
    const r = await api('engineer', `/rest/v1/rpc/${f.name}`, { method: 'POST', body: argsFor(f.name, f.args) })
    if (r.status >= 400) continue
    for (const l of moneyIn(f.name, r.body)) if (l.rule === 'hidden' || l.rule === 'unclassified') leaks.push(`${f.name}.${l.field} [${l.rule}] = ${l.value}`)
    if (/^(money_exceptions_input|month_pnl_drift|month_pnl_adjusted)$/.test(f.name) && r.body !== null) leaks.push(`${f.name} answered ${r.text.slice(0, 80)}`)
  }
  expect(leaks).toEqual([])
  const search = await api('engineer', '/rest/v1/rpc/search_all', { method: 'POST', body: { q: world.invoice.number, lim: 25 } })
  expect((search.body as { kind: string }[]).filter(x => x.kind === 'invoice'), 'engineer finds no invoice by number').toEqual([])
  const sales = await api('sales', '/rest/v1/rpc/search_all', { method: 'POST', body: { q: world.invoice.number, lim: 25 } })
  expect((sales.body as { kind: string }[]).some(x => x.kind === 'invoice'), 'precondition: sales find it').toBe(true)
})

test('engineer: no GST receipt or expense receipt can be listed or downloaded', async () => {
  const path = `${world.tag}/receipt.pdf`
  const up = await fetch(`${API_URL}/storage/v1/object/gst-receipts/${path}`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/pdf' },
    body: Buffer.from('%PDF-1.4\n%verify-roles\n'),
  })
  expect(up.status, 'fixture receipt uploaded').toBeLessThan(300)
  for (const bucket of ['gst-receipts', 'expense-receipts']) {
    const list = await api('engineer', `/storage/v1/object/list/${bucket}`, { method: 'POST', body: { prefix: world.tag, limit: 100 } })
    expect.soft(list.status >= 400 || (Array.isArray(list.body) && list.body.length === 0), `engineer lists ${bucket}: ${list.status} ${list.text.slice(0, 80)}`).toBe(true)
  }
  const dl = await api('engineer', `/storage/v1/object/gst-receipts/${path}`)
  expect(dl.status, 'engineer downloads a GST receipt').toBeGreaterThanOrEqual(400)
  const sign = await api('engineer', `/storage/v1/object/sign/gst-receipts/${path}`, { method: 'POST', body: { expiresIn: 60 } })
  expect(sign.status, 'engineer signs a GST receipt URL').toBeGreaterThanOrEqual(400)
  const salesDl = await api('sales', `/storage/v1/object/gst-receipts/${path}`)
  expect(salesDl.status, 'precondition: sales download it').toBe(200)
})

test('0100: a file tagged has_prices (customer PO, supplier quote) is closed to an engineer as a row and as a download; sales and admin keep it', async () => {
  const name = 'customer-po.pdf'
  const path = `${world.tag}/${name}`
  const up = await fetch(`${API_URL}/storage/v1/object/rfq-files/${path}`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/pdf' },
    body: Buffer.from('%PDF-1.4' + String.fromCharCode(10) + '%verify-roles 0100' + String.fromCharCode(10)),
  })
  expect(up.status, 'fixture customer PO uploaded').toBeLessThan(300)
  const row = await service('/rest/v1/attachments', {
    method: 'POST',
    body: { bucket: 'rfq-files', path, file_name: name, mime_type: 'application/pdf', size_bytes: 24, rfq_id: world.rfq.id, has_prices: true },
    prefer: 'return=representation',
  })
  expect(row.status, 'fixture attachment row tagged has_prices').toBeLessThan(300)
  const mine = await api('engineer', `/rest/v1/attachments?has_prices=eq.true&select=id`)
  expect(mine.body, 'engineer reads no has_prices row').toEqual([])
  const byPath = await api('engineer', `/rest/v1/attachments?path=eq.${encodeURIComponent(path)}&select=id`)
  expect(byPath.body, 'nor the one by its path').toEqual([])
  const salesRow = await api('sales', `/rest/v1/attachments?path=eq.${encodeURIComponent(path)}&select=id`)
  expect((salesRow.body as unknown[]).length, 'precondition: sales read it').toBe(1)
  const list = await api('engineer', '/storage/v1/object/list/rfq-files', { method: 'POST', body: { prefix: world.tag, limit: 100 } })
  expect((Array.isArray(list.body) ? (list.body as { name: string }[]) : []).map(o => o.name), 'engineer lists no tagged file').not.toContain(name)
  const dl = await api('engineer', `/storage/v1/object/rfq-files/${path}`)
  expect(dl.status, 'engineer downloads the customer PO').toBeGreaterThanOrEqual(400)
  const sign = await api('engineer', `/storage/v1/object/sign/rfq-files/${path}`, { method: 'POST', body: { expiresIn: 60 } })
  expect(sign.status, 'engineer signs a URL for it').toBeGreaterThanOrEqual(400)
  for (const p of ['sales', 'admin'] as const) {
    const ok = await api(p, `/storage/v1/object/rfq-files/${path}`)
    expect(ok.status, `precondition: ${p} download it`).toBe(200)
  }
})

test('0100/0103: a customer PO uploaded by SALES through the app is closed to an engineer, whether the app tags it or the tag is forgotten', async () => {
  const sales = await tokenFor('sales')
  const up = async (name: string) => {
    const r = await fetch(`${API_URL}/storage/v1/object/rfq-files/${world.tag}/${name}`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, authorization: `Bearer ${sales?.access_token}`, 'content-type': 'application/pdf' },
      body: Buffer.from('%PDF-1.4 verify-roles sales upload'),
    })
    expect(r.status, `sales uploads ${name}`).toBeLessThan(300)
  }
  // (a) what uploadAttachment now writes: the tag. (b) the old bug: an insert that never says has_prices must still land closed (0103 flips the default to true).
  for (const [name, tag] of [['po-tagged.pdf', true], ['po-untagged.pdf', undefined]] as const) {
    await up(name)
    const path = `${world.tag}/${name}`
    const row = await api('sales', '/rest/v1/attachments', { method: 'POST', body: { bucket: 'rfq-files', path, file_name: name, mime_type: 'application/pdf', size_bytes: 33, rfq_id: world.rfq.id, ...(tag === undefined ? {} : { has_prices: tag }) }, prefer: 'return=representation' })
    expect(row.status, `sales records ${name}`).toBeLessThan(300)
    expect((row.body as { has_prices: boolean }[])[0].has_prices, `${name} is stored tagged`).toBe(true)
    expect(((await api('engineer', `/rest/v1/attachments?path=eq.${encodeURIComponent(path)}&select=id`)).body as unknown[]).length, `engineer lists ${name}`).toBe(0)
    const list = await api('engineer', '/storage/v1/object/list/rfq-files', { method: 'POST', body: { prefix: world.tag, limit: 100 } })
    expect((Array.isArray(list.body) ? (list.body as { name: string }[]) : []).map(o => o.name), `engineer lists the file ${name}`).not.toContain(name)
    expect((await api('engineer', `/storage/v1/object/rfq-files/${path}`)).status, `engineer downloads ${name}`).toBeGreaterThanOrEqual(400)
    expect((await api('sales', `/storage/v1/object/rfq-files/${path}`)).status, `precondition: sales download ${name}`).toBe(200)
  }
})

test('0101 (phase 7): an engineer sets the visit time and type on their own site only, and the engineer view of an order still holds no money', async () => {
  const mine = await api('engineer', `/rest/v1/orders?id=eq.${world.order.id}`, { method: 'PATCH', body: { commissioning_time: '10:00', visit_type: 'installation' }, prefer: 'return=representation' })
  expect(mine.status, 'the assigned engineer sets time and type').toBeLessThan(300)
  const back = await api('engineer', `/rest/v1/orders?id=eq.${world.order.id}&select=id,commissioning_time,visit_type`)
  expect(back.body).toEqual([{ id: world.order.id, commissioning_time: '10:00:00', visit_type: 'installation' }])
  const theirs = await api('engineer', `/rest/v1/orders?id=eq.${world.legacyOrder.id}`, { method: 'PATCH', body: { visit_type: 'survey' }, prefer: 'return=representation' })
  expect(theirs.status, 'an engineer not assigned to the site is refused').toBeGreaterThanOrEqual(400)
  expect(JSON.stringify(theirs.body)).toContain('not_assigned')
  const sales = await api('sales', `/rest/v1/orders?id=eq.${world.legacyOrder.id}`, { method: 'PATCH', body: { visit_type: 'survey', commissioning_time: '09:30' }, prefer: 'return=representation' })
  expect(sales.status, 'sales set them on any order').toBeLessThan(300)
  const money = await api('engineer', `/rest/v1/v_jobs?select=*`)
  const keys = new Set((Array.isArray(money.body) ? (money.body as Record<string, unknown>[]) : []).flatMap(r => Object.keys(r)))
  expect([...keys].filter(k => /(price|cost|value|amount|gst|gross|sell|net|margin)/i.test(k)), 'the jobs view has no money column for an engineer').toEqual([])
})

test('0093 and 0098 (C3 to C5): an engineer reads category counts but no price win, and cannot tag, rename or curate a category', async () => {
  const MCB = 'ca7e0000-0000-4000-8000-000000000001'
  const evidence = await api('engineer', '/rest/v1/v_supplier_category_evidence?select=*&limit=5')
  expect(evidence.status, 'counts are readable').toBeLessThan(300)
  const keys = new Set((Array.isArray(evidence.body) ? (evidence.body as Record<string, unknown>[]) : []).flatMap(r => Object.keys(r)))
  expect([...keys].filter(k => /(price|cost|value|amount|gst|gross|sell|net|margin)/i.test(k)), 'the evidence view has no money column').toEqual([])
  const wins = await api('engineer', '/rest/v1/rpc/supplier_category_price_wins', { method: 'POST', body: { p_family_ids: [MCB] } })
  for (const r of Array.isArray(wins.body) ? (wins.body as { wins: number | null; of_ranked: number | null }[]) : []) expect([r.wins, r.of_ranked], 'an engineer gets no price win').toEqual([null, null])
  const tag = await api('engineer', '/rest/v1/company_brands', { method: 'POST', body: { company_id: world.company.id, brand_id: MCB }, prefer: 'return=representation' })
  expect(tag.status, 'an engineer cannot tag a supplier with a category').toBeGreaterThanOrEqual(400)
  for (const p of ['engineer', 'sales'] as const) {
    const rename = await api(p, `/rest/v1/brands?id=eq.${MCB}`, { method: 'PATCH', body: { name: 'Renamed by ' + p }, prefer: 'return=representation' })
    expect(rename.status, `${p} cannot rename a curated category`).toBeGreaterThanOrEqual(400)
    expect(JSON.stringify(rename.body)).toContain('admin_only')
    const curate = await api(p, `/rest/v1/brands?id=eq.${MCB}`, { method: 'PATCH', body: { curated: false }, prefer: 'return=representation' })
    expect(curate.status, `${p} cannot un-curate it`).toBeGreaterThanOrEqual(400)
  }
  const still = await api('admin', `/rest/v1/brands?id=eq.${MCB}&select=name,curated`)
  expect(still.body).toEqual([{ name: 'MCB', curated: true }])
})

test('BUG-RV-01: the engineer reads no legacy order value or cost through the API', async () => {
  const got: string[] = []
  for (const [t, filter] of [['orders', `id=eq.${world.legacyOrder.id}`], ['order_items', `order_id=eq.${world.legacyOrder.id}`], ['supplier_orders', `order_id=eq.${world.legacyOrder.id}`]] as const) {
    const r = await api('engineer', `/rest/v1/${t}?${filter}&select=id,legacy_source`)
    for (const l of moneyIn(t, r.body)) if (l.rule === 'legacy') got.push(`${t}.${l.field}`)
  }
  expect(got).toEqual([])
})

test('legacy-only columns through the API: settled_before_cutover is refused', async () => {
  const inv = await api('sales', '/rest/v1/invoices', {
    method: 'POST',
    body: { company_id: world.company.id, number: `LEG-${world.tag}`, net_amount: 1, gst_amount: 0, legacy_source: { table: 'gst_invoices' }, settled_before_cutover: true },
  })
  expect(inv.status, 'sales insert an invoice settled before cutover').toBeGreaterThanOrEqual(400)
})

test('BUG-RV-02: app users cannot set legacy_source through the API', async () => {
  const r = await api('engineer', `/rest/v1/orders?id=eq.${world.order.id}`, { method: 'PATCH', body: { legacy_source: { forged: true } }, prefer: 'return=representation' })
  const landed = r.status < 300 && Array.isArray(r.body) && (r.body as { legacy_source: unknown }[])[0]?.legacy_source !== null
  expect(landed, `engineer PATCH orders.legacy_source: ${r.status}`).toBe(false)
})

test('BUG-RV-03: sales cannot create an invoice with no number and no date by adding a legacy flag', async () => {
  const r = await api('sales', '/rest/v1/invoices', {
    method: 'POST',
    body: { order_id: world.order.id, number: null, invoice_date: null, net_amount: 5, gst_amount: 0, legacy_flags: ['forged'] },
  })
  expect(r.status, `sales insert an undated, unnumbered invoice: ${r.text.slice(0, 120)}`).toBeGreaterThanOrEqual(400)
})
