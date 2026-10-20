// The load test. It needs the local Supabase stack (supabase start + db reset), so it is skipped unless IMPORT_LOAD_TEST=1.
// CI (db.yml) runs it with:  eval "$(npx supabase status -o env | sed 's/^/export /')"; IMPORT_LOAD_TEST=1 npm run test:import
// It talks only to API_URL, which must be a local stack (the same guard the CLI uses checks that), and signs in only as the
// fixture users of supabase/seed.sql. Nothing here can reach a remote project.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import '../src/lib/ws-shim'
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isLegacyId } from '../src/lib/ids'
import { parseDump } from '../src/extract/dump'
import { assertTargetAllowed } from '../src/load/guard'
import { isLegacyMarker, loadLegacy } from '../src/load/loader'
import { IMPORT_TABLES } from '../src/types'
import type { TransformResult } from '../src/types'
import { AS_OF, FIXTURE_DUMP, FIXTURE_MAPPINGS, fixtureDump, run, V2_USERS } from './support'

const ENABLED = process.env['IMPORT_LOAD_TEST'] === '1'
const API_URL = process.env['API_URL'] ?? ''
const ANON_KEY = process.env['ANON_KEY'] ?? ''
const SERVICE_ROLE_KEY = process.env['SERVICE_ROLE_KEY'] ?? ''
const PASSWORD = 'fixture-only-password' // supabase/seed.sql
const ADMIN = V2_USERS[0]!.id

const result: TransformResult = run()

let db: SupabaseClient
const v2 = {
  zeta: crypto.randomUUID(),
  fourStars: crypto.randomUUID(),
  moxa: crypto.randomUUID(),
  rfqZeta: crypto.randomUUID(),
  rfqFourStars: crypto.randomUUID(),
  orderZeta: crypto.randomUUID(),
  invoiceZeta: crypto.randomUUID(),
}

function ok<T>(r: { data: T; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`)
  return r.data
}

async function rows(client: SupabaseClient, table: string, columns = '*'): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from(table).select(columns).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    const page = (data ?? []) as unknown as Record<string, unknown>[]
    out.push(...page)
    if (page.length < 1000) break
  }
  return out
}

async function legacyIds(table: string): Promise<string[]> {
  return (await rows(db, table, 'id')).map(r => String(r['id'])).filter(isLegacyId).sort()
}

async function signedIn(email: string): Promise<SupabaseClient> {
  const c = createClient(API_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw new Error(`sign-in ${email}: ${error.message}`)
  return c
}

function cli(args: string[], env: Record<string, string>): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'import/src/cli.ts', ...args], {
    env: { PATH: process.env['PATH'] ?? '', ...env },
    encoding: 'utf8',
  })
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` }
}

const cliArgs = (outDir: string) => ['load', '--dump', FIXTURE_DUMP, '--mappings', FIXTURE_MAPPINGS, '--as-of', AS_OF, '--out', outDir]
const cliEnv = () => ({ IMPORT_TARGET_URL: API_URL, IMPORT_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY })

describe.skipIf(!ENABLED)('the import against the local stack', () => {
  beforeAll(async () => {
    expect(assertTargetAllowed(API_URL, SERVICE_ROLE_KEY, { iKnowThisIsLive: false, allowProjectRefs: [] }).kind).toBe('local')
    db = createClient(API_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

    // Rows v2 made before the import: same-named records to reuse, and unique keys the import must not collide with.
    ok(await db.from('companies').insert([{ id: v2.zeta, name: 'Zeta Fibres Limited' }, { id: v2.fourStars, name: 'Four Stars' }]), 'v2 companies')
    ok(await db.from('brands').insert({ id: v2.moxa, name: 'Moxa', kind: 'brand' }), 'v2 brand')
    ok(
      await db.from('rfqs').insert([
        { id: v2.rfqZeta, company_id: v2.zeta, owner_id: ADMIN, customer_ref: 'PR-4521' },
        { id: v2.rfqFourStars, company_id: v2.fourStars, owner_id: ADMIN },
      ]),
      'v2 rfqs',
    )
    ok(await db.from('orders').insert({ id: v2.orderZeta, company_id: v2.zeta, owner_id: ADMIN, customer_po_number: '251809' }), 'v2 order')
    ok(await db.from('invoices').insert({ id: v2.invoiceZeta, order_id: v2.orderZeta, number: 'INV-0004', invoice_date: '2025-01-01', net_amount: 1, gst_amount: 0 }), 'v2 invoice')
  })

  afterAll(async () => {
    if (!db) return
    // Leave the database as found: remove everything the import made (an empty load does that), then the v2 rows.
    const empty: TransformResult = { ...result, tables: Object.fromEntries(IMPORT_TABLES.map(t => [t, []])) as unknown as TransformResult['tables'], storageCopies: [] }
    await loadLegacy({ db, result: empty, storageDir: null })
    await db.from('invoices').delete().eq('id', v2.invoiceZeta)
    await db.from('orders').delete().eq('id', v2.orderZeta)
    await db.from('rfqs').delete().in('id', [v2.rfqZeta, v2.rfqFourStars])
    await db.from('brands').delete().eq('id', v2.moxa)
    await db.from('companies').delete().in('id', [v2.zeta, v2.fourStars])
  })

  const snapshot = async () => Object.fromEntries(await Promise.all(IMPORT_TABLES.filter(t => !['company_brands', 'order_costs', 'order_engineers'].includes(t)).map(async t => [t, await legacyIds(t)] as const)))
  const numbers = async (table: string) => (await rows(db, table, 'id,number')).filter(r => isLegacyId(String(r['id']))).map(r => [String(r['id']), r['number']]).sort()

  let first: Awaited<ReturnType<typeof snapshot>>
  let firstRfqNumbers: unknown[]
  let firstOrderNumbers: unknown[]

  it('loads the fixtures through the CLI and reads them back', async () => {
    const r = cli(cliArgs('import/.data/out-load-test'), cliEnv())
    expect(r.out).toContain('Read-back check passed.')
    expect(r.status).toBe(0)

    first = await snapshot()
    firstRfqNumbers = await numbers('rfqs')
    firstOrderNumbers = await numbers('orders')
    // Same-named v2 records are reused, not duplicated.
    const expected = (table: keyof TransformResult['tables'], reused = 0) => result.tables[table].length - reused
    expect(first['companies']).toHaveLength(expected('companies', 2))
    expect(first['rfqs']).toHaveLength(expected('rfqs'))
    expect(first['orders']).toHaveLength(21)
    expect(first['order_items']).toHaveLength(22)
    expect(first['invoices']).toHaveLength(18)
    expect(first['payments_in']).toHaveLength(expected('payments_in'))
    expect(first['expenses']).toHaveLength(expected('expenses'))
    expect(first['brands']).toHaveLength(expected('brands', 1))
  })

  it('a second run gives the same ids, the same row counts and the same RFQ and order numbers', async () => {
    const r = cli(cliArgs('import/.data/out-load-test'), cliEnv())
    expect(r.out).toContain('Read-back check passed.')
    expect(r.status).toBe(0)
    const second = await snapshot()
    expect(second).toEqual(first)
    expect(await numbers('rfqs')).toEqual(firstRfqNumbers)
    expect(await numbers('orders')).toEqual(firstOrderNumbers)
    // and v2 made its numbers first: the import numbers come after them
    const v2Numbers = (await rows(db, 'rfqs', 'id,number')).filter(x => !isLegacyId(String(x['id']))).map(x => Number(x['number']))
    const importNumbers = firstRfqNumbers.map(x => Number((x as unknown[])[1]))
    expect(Math.min(...importNumbers)).toBeGreaterThan(Math.max(...v2Numbers))
    // our own series continue after the highest of v2's numbers and the highest imported Q-Tech number (RFQ-0177). The
    // counters were moved by earlier tests, so v2's own numbers are not small here.
    expect(Math.min(...importNumbers)).toBe(Math.max(...v2Numbers, 177) + 1)
  })

  it('does not touch rows v2 made, and reuses what v2 already holds', async () => {
    expect(await rows(db, 'companies', 'id,name,legacy_source')).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: v2.zeta, name: 'Zeta Fibres Limited', legacy_source: null }), expect.objectContaining({ id: v2.fourStars, legacy_source: null })]),
    )
    expect((await rows(db, 'rfqs', 'id')).map(r => r['id'])).toEqual(expect.arrayContaining([v2.rfqZeta, v2.rfqFourStars]))
    expect(ok(await db.from('orders').select('id,customer_po_number').eq('id', v2.orderZeta), 'v2 order')).toHaveLength(1)
    expect(ok(await db.from('invoices').select('id').eq('id', v2.invoiceZeta), 'v2 invoice')).toHaveLength(1)

    const names = (await rows(db, 'companies', 'name')).map(r => String(r['name']).toLowerCase())
    expect(names.filter(n => n === 'four stars')).toHaveLength(1)
    expect(names.filter(n => n === 'zeta fibres limited')).toHaveLength(1)
    // Red Lion's order leg points at the v2 company, and Moxa's company carries the v2 brand
    const legs = await rows(db, 'supplier_orders', 'supplier_id')
    expect(legs.some(l => l['supplier_id'] === v2.fourStars)).toBe(true)
    const cb = await rows(db, 'company_brands', 'company_id,brand_id')
    expect(cb.some(x => x['brand_id'] === v2.moxa)).toBe(true)
  })

  it('does not collide with unique keys a v2 record already holds: they are dropped from the import, flagged and listed', async () => {
    const rfqs = await rows(db, 'rfqs', 'id,customer_ref,legacy_flags,company_id')
    const imported = rfqs.filter(r => isLegacyId(String(r['id'])) && r['company_id'] === v2.zeta)
    expect(imported.some(r => r['customer_ref'] === 'PR-4521')).toBe(false)
    expect(imported.some(r => (r['legacy_flags'] as string[]).includes('customer_ref_duplicate'))).toBe(true)
    const orders = await rows(db, 'orders', 'id,customer_po_number,legacy_flags')
    const po = orders.find(o => isLegacyId(String(o['id'])) && o['customer_po_number'] === '251809')!
    expect(po['legacy_flags']).toContain('po_shared')
    const invs = await rows(db, 'invoices', 'id,number,legacy_flags')
    const noNumber = invs.filter(i => isLegacyId(String(i['id'])) && i['number'] === null && (i['legacy_flags'] as string[]).includes('number_duplicate'))
    expect(noNumber.length).toBeGreaterThanOrEqual(1)
  })

  it('credits nobody: every imported payment has no credited user, and no legacy payment counts toward a target', async () => {
    const admin = await signedIn('admin@test.invalid')
    const pays = (await rows(admin, 'payments_in', 'id,credited_user_id')).filter(p => isLegacyId(String(p['id'])))
    expect(pays.length).toBeGreaterThan(5)
    expect(pays.every(p => p['credited_user_id'] === null)).toBe(true)
    const net = (await rows(admin, 'v_payment_net', 'payment_id,counts_in_target')).filter(p => isLegacyId(String(p['payment_id'])))
    expect(net.length).toBe(pays.length)
    expect(net.every(p => p['counts_in_target'] === false)).toBe(true)
  })

  it('refuses to run while an imported payment is voided in v2 (it would come back counted); Undo clears the void', async () => {
    const admin = await signedIn('admin@test.invalid')
    const pay = (await rows(admin, 'payments_in', 'id,bank_month')).find(p => isLegacyId(String(p['id'])) && p['bank_month'] === null)!
    ok(await admin.rpc('void_payment', { p_payment_id: pay['id'], p_reason: 'load test' }), 'void an imported payment')
    await expect(loadLegacy({ db, result, storageDir: null })).rejects.toThrow(/REFUSED, nothing was deleted[\s\S]*1 imported payment\(s\) were voided or corrected in v2/)
    ok(await admin.rpc('restore_payment', { p_payment_id: pay['id'] }), 'undo the void')
    expect(ok(await db.from('payments_in').select('voided_at').eq('id', pay['id']), 'read back')).toEqual([{ voided_at: null }])
  })

  it('leaves no audit rows behind for the import, and keeps the audit rows of v2 records', async () => {
    const audit = await rows(db, 'audit_log', 'record_id,changed_by')
    expect(audit.filter(a => isLegacyId(String(a['record_id'])) && a['changed_by'] === null)).toHaveLength(0)
    expect(audit.some(a => a['record_id'] === v2.rfqZeta)).toBe(true)
  })

  it('stores the merged order with both invoices, and the receipt file', async () => {
    const merged = result.tables.orders.find(o => o['customer_po_number'] === '000001')!
    const inv = ok(await db.from('invoices').select('number,net_amount').eq('order_id', String(merged['id'])), 'merged invoices')
    expect((inv ?? []).map(i => i.number).sort()).toEqual(['INV-0001', 'INV-0009'])
    expect(ok(await db.from('order_items').select('id').eq('order_id', String(merged['id'])), 'merged items')).toHaveLength(2)

    const att = result.tables.attachments[0]!
    const file = await db.storage.from('gst-receipts').download(String(att['path']))
    expect(file.error).toBeNull()
    expect(await file.data!.text()).toBe(readFileSync(join(FIXTURE_DUMP, 'storage', 'gst-receipts', 'receipts', 'g1.pdf'), 'utf8'))
  })

  it('money in the database equals the report: payments, expenses, invoices, and the views admin reads', async () => {
    const admin = await signedIn('admin@test.invalid')
    const sum = (xs: Record<string, unknown>[], col: string) => Math.round(xs.reduce((s, r) => s + Number(r[col]), 0) * 100) / 100
    const legacy = (xs: Record<string, unknown>[]) => xs.filter(r => isLegacyId(String(r['id'])))

    // payments_in = the payment rows plus the payments derived from the old paid status
    const paymentsTotal = Math.round((result.recon.payments.neu + result.recon.paymentsFromStatus.neu) * 100) / 100
    expect(result.recon.paymentsFromStatusCount).toBeGreaterThan(0)
    expect(sum(legacy(await rows(admin, 'payments_in', 'id,amount')), 'amount')).toBe(paymentsTotal)
    const derived = (await rows(admin, 'payments_in', 'id,amount,paid_via,bank_month,credited_user_id,legacy_flags')).filter(
      p => isLegacyId(String(p['id'])) && (p['legacy_flags'] as string[]).includes('payment_date_estimated'),
    )
    expect(derived).toHaveLength(result.recon.paymentsFromStatusCount)
    expect(derived.every(p => p['paid_via'] === 'bank' && p['bank_month'] === null && p['credited_user_id'] === null)).toBe(true)
    expect(sum(legacy(await rows(admin, 'expenses', 'id,amount_pkr')), 'amount_pkr')).toBe(result.recon.expensesTotal.neu)
    expect(sum(legacy(await rows(admin, 'invoices', 'id,net_amount')), 'net_amount')).toBe(result.recon.invoiceNet.neu)
    expect(sum(legacy(await rows(admin, 'invoices', 'id,gst_amount')), 'gst_amount')).toBe(result.recon.invoiceGst.neu)

    // per category, as the reports group them
    const cats = await rows(admin, 'expense_categories', 'id,name')
    const nameOf = new Map(cats.map(c => [String(c['id']), String(c['name'])]))
    const byCat = new Map<string, number>()
    for (const e of legacy(await rows(admin, 'expenses', 'id,amount_pkr,category_id'))) {
      const n = nameOf.get(String(e['category_id']))!
      byCat.set(n, Math.round(((byCat.get(n) ?? 0) + Number(e['amount_pkr'])) * 100) / 100)
    }
    for (const line of result.recon.expensesByCategory) expect(byCat.get(line.key) ?? 0).toBe(line.neu)

    // v_order_money works on imported data: settled = the payments, margin comes from the net sale less tagged cost
    const money = await rows(admin, 'v_order_money', 'order_id,net_sale,settled,actual_cost,margin,margin_state')
    const mine = money.filter(m => isLegacyId(String(m['order_id'])))
    expect(mine).toHaveLength(21)
    expect(sum(mine, 'settled')).toBe(paymentsTotal)
    // an order marked payment_received with no payment rows is settled by the derived payment
    const ew9 = result.tables.orders.find(o => o['customer_po_number'] === 'EW-9')!
    expect(Number(mine.find(m => m['order_id'] === ew9['id'])!['settled'])).toBe(60000)
    const o1 = result.tables.orders.find(o => o['customer_po_number'] === '252446')!
    const m1 = mine.find(m => m['order_id'] === o1['id'])!
    expect(Number(m1['net_sale'])).toBe(1244310)
    // the unproven orders show "basis unknown" and no margin, never a guessed one
    const unknown = mine.filter(m => m['margin_state'] === 'basis_unknown')
    expect(unknown).toHaveLength(16)
    expect(unknown.every(m => m['margin'] === null)).toBe(true)
  })

  it('a paid invoice with no order is settled before cutover: not owed, no payment, still in the GST register', async () => {
    const admin = await signedIn('admin@test.invalid')
    const sales = await signedIn('sales@test.invalid')
    const want = result.tables.invoices.filter(i => i['settled_before_cutover'] === true).map(i => String(i['id'])).sort()
    expect(want.length).toBe(result.recon.settledBeforeCutover.count)
    expect(want.length).toBeGreaterThan(0)
    const got = (await rows(admin, 'invoices', 'id,order_id,settled_before_cutover'))
      .filter(i => isLegacyId(String(i['id'])) && i['settled_before_cutover'] === true)
    expect(got.map(i => String(i['id'])).sort()).toEqual(want)
    expect(got.every(i => i['order_id'] === null)).toBe(true)
    // not owed: no aging row ("who owes us") for any of them
    const aging = ok(await admin.rpc('aging_as_of', { p_date: AS_OF }), 'aging_as_of') as { invoice_id: string | null }[]
    expect(aging.some(a => a.invoice_id !== null && want.includes(a.invoice_id))).toBe(false)
    // still a sale: the GST register lists every one
    const reg = (await rows(sales, 'v_gst_register', 'invoice_id')).map(r => String(r['invoice_id']))
    expect(want.every(id => reg.includes(id))).toBe(true)
    // nobody in the app can clear it
    const cleared = await admin.from('invoices').update({ settled_before_cutover: false }).eq('id', want[0]!)
    expect(cleared.error).not.toBeNull()
  })

  it('row security still holds with the data in: engineers and sales see no money, anonymous sees nothing', async () => {
    const engineer = await signedIn('engineer@test.invalid')
    const sales = await signedIn('sales@test.invalid')
    const anon = createClient(API_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

    // staff read the CRM itself
    for (const c of [engineer, sales]) {
      expect((await rows(c, 'rfqs', 'id')).length).toBeGreaterThan(10)
      expect((await rows(c, 'orders', 'id')).length).toBeGreaterThan(10)
      expect((await rows(c, 'companies', 'id')).length).toBeGreaterThan(10)
      // money is admin only
      for (const t of ['payments_in', 'expenses', 'order_costs', 'recurring_expenses']) expect(await rows(c, t, '*')).toHaveLength(0)
      expect(await rows(c, 'v_order_money', '*')).toHaveLength(0)
      expect(await rows(c, 'v_payment_net', '*')).toHaveLength(0)
    }
    // 0078 (BUG-RV-01): imported rows carry only the money-free marker in legacy_source; the old rows are not readable
    for (const t of ['orders', 'order_items', 'supplier_orders', 'rfqs', 'rfq_items', 'supplier_quote_lines', 'supplier_inquiries', 'companies']) {
      const got = (await rows(engineer, t, 'id,legacy_source')).filter(r => isLegacyId(String(r['id'])) && r['legacy_source'] !== null)
      if (t === 'orders' || t === 'rfqs') expect(got.length, `${t}: imported rows the engineer reads`).toBeGreaterThan(0)
      expect(got.filter(r => !isLegacyMarker(r['legacy_source'])), `${t}: legacy_source holds only the marker`).toEqual([])
    }
    expect(JSON.stringify(await rows(engineer, 'orders', 'legacy_source'))).not.toMatch(/value|cost|gst|price|amount/i)

    // invoices and the GST register: sales yes, engineers no
    expect((await rows(sales, 'invoices', 'id')).length).toBeGreaterThan(5)
    expect((await rows(sales, 'v_gst_register', 'invoice_id')).length).toBeGreaterThan(5)
    expect(await rows(engineer, 'invoices', 'id')).toHaveLength(0)
    expect(await rows(engineer, 'v_gst_register', '*')).toHaveLength(0)

    // writes are still refused where they were
    const refused = await engineer.from('payments_in').insert({ order_id: result.tables.orders[0]!['id'], amount: 1 })
    expect(refused.error).not.toBeNull()
    const refusedSales = await sales.from('expenses').insert({ amount_pkr: 1, category_id: 'ca7e0000-0000-4000-8000-000000000010' })
    expect(refusedSales.error).not.toBeNull()
    // engineers and sales cannot call the import helpers
    expect((await engineer.rpc('import_purge_audit', { p_ids: [] })).error).not.toBeNull()
    expect((await sales.rpc('import_reset_numbers')).error).not.toBeNull()

    // the receipt file: admin and sales only
    const att = String(result.tables.attachments[0]!['path'])
    expect((await engineer.storage.from('gst-receipts').download(att)).error).not.toBeNull()
    expect((await sales.storage.from('gst-receipts').download(att)).error).toBeNull()

    // anonymous: nothing
    for (const t of ['rfqs', 'orders', 'companies', 'payments_in', 'invoices', 'expenses']) {
      const r = await anon.from(t).select('id').limit(1)
      expect(r.error !== null || (r.data ?? []).length === 0).toBe(true)
    }
    expect((await anon.rpc('import_purge_audit', { p_ids: [] })).error).not.toBeNull()
  })

  it('the CLI refuses the legacy project, an unlisted live project, and a missing flag, before it connects to anything', () => {
    const legacy = cli(cliArgs('import/.data/out-refusal'), { IMPORT_TARGET_URL: 'https://vptyhluvgnjpvkcbhxsf.supabase.co', IMPORT_SERVICE_ROLE_KEY: 'sb_secret_x' })
    expect(legacy.status).toBe(1)
    expect(legacy.out).toMatch(/legacy project/)
    const legacyFlagged = cli([...cliArgs('import/.data/out-refusal'), '--i-know-this-is-live', '--allow-project-ref', 'vptyhluvgnjpvkcbhxsf'], {
      IMPORT_TARGET_URL: 'https://vptyhluvgnjpvkcbhxsf.supabase.co',
      IMPORT_SERVICE_ROLE_KEY: 'sb_secret_x',
    })
    expect(legacyFlagged.status).toBe(1)
    expect(legacyFlagged.out).toMatch(/legacy project/)
    const unflagged = cli(cliArgs('import/.data/out-refusal'), { IMPORT_TARGET_URL: 'https://abcdefghijklmnopqrst.supabase.co', IMPORT_SERVICE_ROLE_KEY: 'sb_secret_x' })
    expect(unflagged.status).toBe(1)
    expect(unflagged.out).toMatch(/live project/)
    const unlisted = cli([...cliArgs('import/.data/out-refusal'), '--i-know-this-is-live'], { IMPORT_TARGET_URL: 'https://abcdefghijklmnopqrst.supabase.co', IMPORT_SERVICE_ROLE_KEY: 'sb_secret_x' })
    expect(unlisted.status).toBe(1)
    expect(unlisted.out).toMatch(/allowlist/)
    const noEnv = cli(cliArgs('import/.data/out-refusal'), {})
    expect(noEnv.status).toBe(1)
    expect(noEnv.out).toMatch(/No target URL/)
  })

  it('the offline report command needs no database and writes the review lists', () => {
    const out = execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'import/src/cli.ts', 'report', '--dump', FIXTURE_DUMP, '--mappings', FIXTURE_MAPPINGS, '--as-of', AS_OF, '--out', 'import/.data/out-report'], {
      env: { PATH: process.env['PATH'] ?? '' },
      encoding: 'utf8',
    })
    expect(out).toContain('Reconciles: **yes**')
  })

  it('dump.sql, run read-only against a stand-in for the old database, gives JSON that reads back to the same import', () => {
    const dbUrl = process.env['DB_URL'] ?? ''
    expect(dbUrl).toMatch(/@(127\.0\.0\.1|localhost):/) // local stack only
    const dir = mkdtempSync(join(tmpdir(), 'dumpsql-'))
    try {
      // 1. a stand-in "old" schema built from the fixture (a table the fixture lacks stays missing: that path is tested too)
      const ddl = execFileSync(process.execPath, ['import/dump/make-old-schema.mjs', join(FIXTURE_DUMP, 'dump.json'), 'old_fixture'], { encoding: 'utf8' })
      writeFileSync(join(dir, 'schema.sql'), ddl)
      execFileSync('psql', [dbUrl, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', join(dir, 'schema.sql')], { stdio: 'pipe' })
      // 2. the script, pointed at that schema, inside a read-only transaction
      const script = readFileSync('import/dump/dump.sql', 'utf8')
      expect(script).toContain("'public'::text as sch")
      writeFileSync(join(dir, 'dump.sql'), script.replace("'public'::text as sch", "'old_fixture'::text as sch"))
      const raw = execFileSync('psql', [dbUrl, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', 'begin read only', '-f', join(dir, 'dump.sql'), '-c', 'rollback'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      // 3. read it with the real reader and compare the transform of both
      const parsed = parseDump(raw.trim())
      const meta = parsed.dump.meta as { tables_missing: string[]; postgres: string }
      expect(meta.postgres).toMatch(/PostgreSQL/)
      expect(meta.tables_missing).toEqual(expect.arrayContaining(['employees']))
      const users = (parsed.dump.tables['users'] ?? []).map(u => Object.keys(u))
      expect(users.every(k => !k.includes('password'))).toBe(true)
      expect(Object.keys(parsed.dump.catalog?.details ?? {})).toEqual(expect.arrayContaining(['columns', 'checks', 'functions']))
      const canon = (v: unknown): unknown =>
        Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== null).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, canon(x)])) : v
      const fromDb = run({ ...parsed.dump, storage: fixtureDump().storage })
      expect(JSON.stringify(canon(fromDb.tables))).toBe(JSON.stringify(canon(run().tables)))
      expect(JSON.stringify(canon(fromDb.recon))).toBe(JSON.stringify(canon(run().recon)))
    } finally {
      try {
        execFileSync('psql', [dbUrl, '-X', '-q', '-c', 'drop schema if exists old_fixture cascade'], { stdio: 'pipe' })
      } catch {
        /* the stack is thrown away after the job */
      }
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('the fixture dump is unchanged by all of this', () => {
    expect(fixtureDump().tables['orders']).toHaveLength(22)
  })
})
