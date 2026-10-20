import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isLegacyId } from '../lib/ids'
import { money, normName } from '../lib/text'
import { IMPORT_TABLES } from '../types'
import type { ImportTable, NewRow, ReviewItem, TransformResult } from '../types'

// The load step. Service role, idempotent, and it never touches rows v2 created.
//
// "Legacy marker": every id the import makes is a version 5 UUID (lib/ids.ts); v2 makes version 4. A run first deletes
// every row of the import tables whose id is version 5 (and, where the table has legacy_source, whose legacy_source is
// set), in reverse foreign-key order, then inserts the transform output. Companies, brands and sites that v2 already
// holds under the same normalised name are reused, not duplicated and not deleted.
//
// PostgREST has no multi-statement transaction, so a run is not atomic. It is safe to re-run: every run starts by
// removing what the previous run left, and a run that stops half way leaves only legacy rows behind.

const PAGE = 1000
const CHUNK = 200

type Db = SupabaseClient

/** Tables in deletion order (reverse of foreign-key order). legacySource = the table has a legacy_source column. */
const DELETE_ORDER: { table: string; legacySource: boolean }[] = [
  { table: 'attachments', legacySource: false },
  { table: 'payments_in', legacySource: true },
  { table: 'expenses', legacySource: true },
  { table: 'recurring_expenses', legacySource: false },
  { table: 'invoices', legacySource: true },
  { table: 'order_items', legacySource: true },
  { table: 'supplier_orders', legacySource: true },
  { table: 'orders', legacySource: true },
  { table: 'supplier_quote_lines', legacySource: true },
  { table: 'supplier_inquiries', legacySource: true },
  { table: 'rfq_items', legacySource: true },
  { table: 'rfqs', legacySource: true },
  { table: 'contacts', legacySource: false },
  { table: 'company_sites', legacySource: false },
  { table: 'brands', legacySource: false },
  { table: 'companies', legacySource: true },
]

/** Foreign keys that point at import tables. A v2-made row on the child side would be changed or deleted by our delete. */
const FK_EDGES: { child: string; col: string; parent: string }[] = [
  { child: 'company_sites', col: 'company_id', parent: 'companies' },
  { child: 'contacts', col: 'company_id', parent: 'companies' },
  { child: 'contacts', col: 'site_id', parent: 'company_sites' },
  { child: 'rfqs', col: 'company_id', parent: 'companies' },
  { child: 'rfqs', col: 'site_id', parent: 'company_sites' },
  { child: 'rfqs', col: 'contact_id', parent: 'contacts' },
  { child: 'rfq_items', col: 'rfq_id', parent: 'rfqs' },
  { child: 'rfq_items', col: 'brand_id', parent: 'brands' },
  { child: 'rfq_items', col: 'family_id', parent: 'brands' },
  { child: 'supplier_inquiries', col: 'rfq_id', parent: 'rfqs' },
  { child: 'supplier_inquiries', col: 'supplier_id', parent: 'companies' },
  { child: 'supplier_quote_lines', col: 'inquiry_id', parent: 'supplier_inquiries' },
  { child: 'supplier_quote_lines', col: 'rfq_item_id', parent: 'rfq_items' },
  { child: 'clarifications', col: 'rfq_id', parent: 'rfqs' },
  { child: 'orders', col: 'company_id', parent: 'companies' },
  { child: 'orders', col: 'site_id', parent: 'company_sites' },
  { child: 'orders', col: 'contact_id', parent: 'contacts' },
  { child: 'orders', col: 'rfq_id', parent: 'rfqs' },
  { child: 'supplier_orders', col: 'order_id', parent: 'orders' },
  { child: 'supplier_orders', col: 'supplier_id', parent: 'companies' },
  { child: 'order_items', col: 'order_id', parent: 'orders' },
  { child: 'order_items', col: 'brand_id', parent: 'brands' },
  { child: 'order_items', col: 'family_id', parent: 'brands' },
  { child: 'order_items', col: 'supplier_order_id', parent: 'supplier_orders' },
  { child: 'order_items', col: 'rfq_item_id', parent: 'rfq_items' },
  { child: 'invoices', col: 'order_id', parent: 'orders' },
  { child: 'invoices', col: 'company_id', parent: 'companies' },
  { child: 'payments_in', col: 'order_id', parent: 'orders' },
  { child: 'payments_in', col: 'corrects_payment_id', parent: 'payments_in' },
  { child: 'expenses', col: 'order_id', parent: 'orders' },
  { child: 'expenses', col: 'supplier_order_id', parent: 'supplier_orders' },
  { child: 'expenses', col: 'payee_id', parent: 'companies' },
  { child: 'expenses', col: 'recurring_id', parent: 'recurring_expenses' },
  { child: 'attachments', col: 'rfq_id', parent: 'rfqs' },
  { child: 'attachments', col: 'invoice_id', parent: 'invoices' },
  { child: 'attachments', col: 'expense_id', parent: 'expenses' },
  { child: 'attachments', col: 'order_id', parent: 'orders' },
]

/** Columns whose values are company, brand or site ids, rewritten when v2 already has the same-named record. */
const REMAP_COLUMNS: { table: string; col: string; kind: 'company' | 'brand' | 'site' }[] = [
  { table: 'company_sites', col: 'company_id', kind: 'company' },
  { table: 'contacts', col: 'company_id', kind: 'company' },
  { table: 'contacts', col: 'site_id', kind: 'site' },
  { table: 'company_brands', col: 'company_id', kind: 'company' },
  { table: 'company_brands', col: 'brand_id', kind: 'brand' },
  { table: 'rfqs', col: 'company_id', kind: 'company' },
  { table: 'rfqs', col: 'site_id', kind: 'site' },
  { table: 'rfq_items', col: 'brand_id', kind: 'brand' },
  { table: 'rfq_items', col: 'family_id', kind: 'brand' },
  { table: 'supplier_inquiries', col: 'supplier_id', kind: 'company' },
  { table: 'orders', col: 'company_id', kind: 'company' },
  { table: 'orders', col: 'site_id', kind: 'site' },
  { table: 'supplier_orders', col: 'supplier_id', kind: 'company' },
  { table: 'order_items', col: 'brand_id', kind: 'brand' },
  { table: 'order_items', col: 'family_id', kind: 'brand' },
  { table: 'invoices', col: 'company_id', kind: 'company' },
  { table: 'expenses', col: 'payee_id', kind: 'company' },
]

export class LoadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LoadError'
  }
}

function fail(what: string, e: { message: string; code?: string; details?: string; hint?: string }): never {
  throw new LoadError(`${what}: ${e.message}${e.code ? ` [${e.code}]` : ''}${e.details ? ` (${e.details})` : ''}${e.hint ? ` hint: ${e.hint}` : ''}`)
}

type Filter = { kind: 'notNull'; col: string } | { kind: 'isNull'; col: string } | { kind: 'in'; col: string; values: string[] }

async function fetchAll(db: Db, table: string, columns: string, filters: Filter[] = []): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = []
  for (let from = 0; ; from += PAGE) {
    let q = db.from(table).select(columns)
    for (const f of filters) {
      if (f.kind === 'notNull') q = q.not(f.col, 'is', null)
      else if (f.kind === 'isNull') q = q.is(f.col, null)
      else q = q.in(f.col, f.values)
    }
    const { data, error } = await q.order(columns.split(',')[0]!.trim()).range(from, from + PAGE - 1)
    if (error) fail(`read ${table}`, error)
    const page = (data ?? []) as unknown as Record<string, unknown>[]
    rows.push(...page)
    if (page.length < PAGE) break
  }
  return rows
}

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

export interface LoadOptions {
  db: Db
  result: TransformResult
  /** Folder holding storage/<bucket>/<path> files from the dump, or null when the dump has none. */
  storageDir: string | null
  log?: (line: string) => void
}

export interface LoadSummary {
  deleted: Record<string, number>
  inserted: Record<string, number>
  reused: { companies: number; brands: number; sites: number }
  auditRowsRemoved: number
  storage: { copied: number; missing: number; removed: number }
  review: ReviewItem[]
  /** Disagreements found by the read-back check. Empty = the database holds exactly what the transform produced. */
  mismatches: string[]
}

const strip = (row: NewRow): NewRow => Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith('_')))

export async function loadLegacy(opts: LoadOptions): Promise<LoadSummary> {
  const { db, result } = opts
  const log = opts.log ?? (() => undefined)
  const review: ReviewItem[] = []
  const tables = Object.fromEntries(IMPORT_TABLES.map(t => [t, result.tables[t].map(r => ({ ...r }))])) as Record<ImportTable, NewRow[]>

  // ---------------------------------------------------------------- 0. preconditions
  const { count: closed, error: closedErr } = await db.from('closed_months').select('month', { count: 'exact', head: true })
  if (closedErr) fail('read closed_months', closedErr)
  if ((closed ?? 0) > 0) throw new LoadError('A month is already closed. The import runs before any month is closed (there is no service-role bypass of the month lock).')

  const cats = await fetchAll(db, 'expense_categories', 'id,name')
  const catId = new Map(cats.map(c => [normName(c['name']), String(c['id'])]))
  const wanted = new Set<string>()
  for (const t of ['expenses', 'recurring_expenses'] as const) for (const r of tables[t]) wanted.add(String(r['_category']))
  const missing = [...wanted].filter(n => !catId.has(normName(n)))
  if (missing.length) {
    throw new LoadError(`Expense categories missing in the target project: ${missing.join(', ')}. Fix expense_categories.csv or add the category first.`)
  }

  // ---------------------------------------------------------------- 1. nothing v2 made may hang off a legacy row
  const legacyByTable = new Map<string, string[]>()
  for (const t of DELETE_ORDER) {
    const rows = await fetchAll(db, t.table, 'id', t.legacySource ? [{ kind: 'notNull', col: 'legacy_source' }] : [])
    legacyByTable.set(t.table, rows.map(r => String(r['id'])).filter(isLegacyId))
  }
  const conflicts: string[] = []
  for (const e of FK_EDGES) {
    if (!(legacyByTable.get(e.parent)?.length)) continue
    const rows = await fetchAll(db, e.child, `id,${e.col}`, [{ kind: 'notNull', col: e.col }])
    const n = rows.filter(r => isLegacyId(String(r[e.col])) && !isLegacyId(String(r['id']))).length
    if (n > 0) conflicts.push(`${n} row(s) of ${e.child}.${e.col} made in v2 point at imported ${e.parent}`)
  }
  const costRows = await fetchAll(db, 'order_costs', 'order_id,created_by', [{ kind: 'notNull', col: 'created_by' }])
  const v2Costs = costRows.filter(r => isLegacyId(String(r['order_id']))).length
  if (v2Costs > 0) conflicts.push(`${v2Costs} order cost(s) entered in v2 sit on imported orders`)
  // 0073: a run deletes and re-inserts every imported payment, so one voided in v2 would come back counted again.
  const voided = (await fetchAll(db, 'payments_in', 'id', [{ kind: 'notNull', col: 'voided_at' }])).filter(r => isLegacyId(String(r['id']))).length
  if (voided > 0) conflicts.push(`${voided} imported payment(s) were voided or corrected in v2 (a re-import would count them again)`)
  if (conflicts.length) {
    throw new LoadError(
      `REFUSED, nothing was deleted: rows made in v2 depend on imported rows.\n  - ${conflicts.join('\n  - ')}\nA re-import would change or delete them. Resolve those first.`,
    )
  }

  // ---------------------------------------------------------------- 2. remove what the previous run left
  const deleted: Record<string, number> = {}
  const touchedIds = new Set<string>()
  const removedFiles: { bucket: string; path: string }[] = []
  const att = legacyByTable.get('attachments') ?? []
  if (att.length) {
    for (const part of chunks(att, 100)) {
      const rows = await fetchAll(db, 'attachments', 'id,bucket,path', [{ kind: 'in', col: 'id', values: part }])
      for (const r of rows) removedFiles.push({ bucket: String(r['bucket']), path: String(r['path']) })
    }
  }
  for (const t of DELETE_ORDER) {
    const ids = legacyByTable.get(t.table) ?? []
    for (const part of chunks(ids, 100)) {
      const { error } = await db.from(t.table).delete().in('id', part)
      if (error) fail(`delete from ${t.table}`, error)
    }
    deleted[t.table] = ids.length
    ids.forEach(i => touchedIds.add(i))
    if (ids.length) log(`removed ${ids.length} legacy row(s) from ${t.table}`)
  }
  let filesRemoved = 0
  const byBucket = new Map<string, string[]>()
  for (const f of removedFiles) byBucket.set(f.bucket, [...(byBucket.get(f.bucket) ?? []), f.path])
  for (const [bucket, paths] of byBucket) {
    const { error } = await db.storage.from(bucket).remove(paths)
    if (!error) filesRemoved += paths.length
  }

  // ---------------------------------------------------------------- 3. reuse what v2 already holds under the same name
  const reused = { companies: 0, brands: 0, sites: 0 }
  const remap = { company: new Map<string, string>(), brand: new Map<string, string>(), site: new Map<string, string>() }

  const existingCompanies = new Map((await fetchAll(db, 'companies', 'id,name')).map(c => [normName(c['name']), String(c['id'])]))
  tables.companies = tables.companies.filter(c => {
    const hit = existingCompanies.get(normName(c['name']))
    if (!hit) return true
    remap.company.set(String(c['id']), hit)
    reused.companies++
    return false
  })
  const existingBrands = new Map((await fetchAll(db, 'brands', 'id,name')).map(b => [normName(b['name']), String(b['id'])]))
  tables.brands = tables.brands.filter(b => {
    const hit = existingBrands.get(normName(b['name']))
    if (!hit) return true
    remap.brand.set(String(b['id']), hit)
    reused.brands++
    return false
  })
  if (remap.company.size) {
    const existingSites = new Map(
      (await fetchAll(db, 'company_sites', 'id,company_id,name', [{ kind: 'in', col: 'company_id', values: [...remap.company.values()] }])).map(s => [
        `${String(s['company_id'])}|${normName(s['name'])}`,
        String(s['id']),
      ]),
    )
    tables.company_sites = tables.company_sites.filter(s => {
      const target = remap.company.get(String(s['company_id']))
      const hit = target ? existingSites.get(`${target}|${normName(s['name'])}`) : undefined
      if (!hit) return true
      remap.site.set(String(s['id']), hit)
      reused.sites++
      return false
    })
  }
  for (const rc of REMAP_COLUMNS) {
    const map = remap[rc.kind]
    if (!map.size) continue
    for (const row of tables[rc.table as ImportTable]) {
      const v = row[rc.col]
      if (typeof v === 'string' && map.has(v)) row[rc.col] = map.get(v)
    }
  }
  if (reused.companies + reused.brands + reused.sites) log(`reusing v2 records: ${reused.companies} companies, ${reused.brands} brands, ${reused.sites} sites`)

  // ---------------------------------------------------------------- 4. unique keys a v2 trial record may already hold
  const flag = (row: NewRow, f: string) => {
    const cur = row['legacy_flags'] as string[]
    if (!cur.includes(f)) cur.push(f)
    cur.sort()
  }
  const trialRfqs = (await fetchAll(db, 'rfqs', 'id,company_id,customer_ref,received_on', [{ kind: 'isNull', col: 'legacy_source' }])).filter(r => !isLegacyId(String(r['id'])))
  const refKeys = new Set(trialRfqs.filter(r => r['customer_ref']).map(r => `${String(r['company_id'])}|${String(r['customer_ref'])}`))
  const dayKeys = new Map<string, string>()
  for (const r of trialRfqs) dayKeys.set(`${String(r['company_id'])}|${String(r['received_on'])}`, String(r['id']))
  for (const row of tables.rfqs) {
    const ref = row['customer_ref'] as string | null
    if (ref && refKeys.has(`${String(row['company_id'])}|${ref}`)) {
      row['customer_ref'] = null
      flag(row, 'customer_ref_duplicate')
      review.push({ list: 'trial_duplicates', table: 'rfqs', oldId: String(row['id']), label: ref, detail: 'a v2 RFQ for the same company already has this customer reference: imported without it' })
    } else if (dayKeys.has(`${String(row['company_id'])}|${String(row['received_on'])}`)) {
      review.push({ list: 'trial_duplicates', table: 'rfqs', oldId: String(row['id']), label: String(row['received_on']), detail: `possible duplicate of v2 RFQ ${dayKeys.get(`${String(row['company_id'])}|${String(row['received_on'])}`)}: same company, same day` })
    }
  }
  const trialOrders = await fetchAll(db, 'orders', 'id,company_id,customer_po_number,legacy_flags', [{ kind: 'notNull', col: 'customer_po_number' }])
  const poKeys = new Set(trialOrders.filter(o => !isLegacyId(String(o['id']))).map(o => `${String(o['company_id'])}|${String(o['customer_po_number'])}`))
  for (const row of tables.orders) {
    if (row['customer_po_number'] && poKeys.has(`${String(row['company_id'])}|${String(row['customer_po_number'])}`)) {
      flag(row, 'po_shared')
      review.push({ list: 'po_clashes', table: 'orders', oldId: String(row['id']), label: String(row['customer_po_number']), detail: 'a v2 order for the same company already uses this PO number: imported with po_shared' })
    }
  }
  const numbers = new Set((await fetchAll(db, 'invoices', 'id,number', [{ kind: 'notNull', col: 'number' }])).filter(i => !isLegacyId(String(i['id']))).map(i => String(i['number'])))
  for (const row of tables.invoices) {
    if (row['number'] && numbers.has(String(row['number']))) {
      review.push({ list: 'trial_duplicates', table: 'invoices', oldId: String(row['id']), label: String(row['number']), detail: 'a v2 invoice already has this number: imported without it' })
      row['number'] = null
      flag(row, 'number_duplicate')
    }
  }

  // ---------------------------------------------------------------- 5. our own numbers continue after the highest one in use (v2's, or imported Q-Tech numbers)
  {
    const f = result.numberFloors
    const { error } = await db.rpc('import_reset_numbers', {
      p_rfq_min: f.rfq,
      p_order_min: f.order,
      p_quotation_min: f.quotation,
      p_po_min: f.po,
    })
    if (error) fail('import_reset_numbers', error)
  }

  // ---------------------------------------------------------------- 6. insert
  const inserted: Record<string, number> = {}
  for (const table of IMPORT_TABLES) {
    const rows = tables[table].map(r => {
      const out = strip(r)
      if (table === 'expenses' || table === 'recurring_expenses') out['category_id'] = catId.get(normName(r['_category']))
      return out
    })
    for (const part of chunks(rows, CHUNK)) {
      const { error } =
        table === 'company_brands'
          ? await db.from(table).upsert(part, { onConflict: 'company_id,brand_id', ignoreDuplicates: true })
          : // defaultToNull: false = a key a row does not carry takes the column default (created_at, paid_via...), not NULL.
            await db.from(table).insert(part, { defaultToNull: false })
      if (error) {
        // Find the row that broke the batch, so the message names it.
        for (const one of part) {
          const r = await db.from(table).insert(one, { defaultToNull: false })
          if (r.error) fail(`insert into ${table} (row ${String(one['id'] ?? JSON.stringify(one))})`, r.error)
        }
        fail(`insert into ${table}`, error)
      }
    }
    inserted[table] = rows.length
    for (const r of rows) if (typeof r['id'] === 'string' && isLegacyId(r['id'])) touchedIds.add(r['id'])
    if (rows.length) log(`inserted ${rows.length} row(s) into ${table}`)
  }

  // ---------------------------------------------------------------- 7. receipt files
  const storage = { copied: 0, missing: 0, removed: filesRemoved }
  for (const c of result.storageCopies) {
    const file = opts.storageDir ? join(opts.storageDir, c.fromBucket, c.fromPath) : null
    if (!file || !existsSync(file)) {
      storage.missing++
      review.push({ list: 'storage_missing', table: 'attachments', oldId: c.invoiceId, label: c.fromPath, detail: 'the file is not in the dump folder; the attachment row exists but its file was not copied' })
      continue
    }
    const meta = result.tables.attachments.find(a => a['path'] === c.toPath)
    const { error } = await db.storage.from(c.toBucket).upload(c.toPath, readFileSync(file), { upsert: true, contentType: String(meta?.['mime_type'] ?? 'application/octet-stream') })
    if (error) fail(`copy ${c.fromPath}`, error)
    storage.copied++
  }

  // ---------------------------------------------------------------- 8. take the import's own audit rows out again
  let auditRowsRemoved = 0
  for (const part of chunks([...touchedIds], 500)) {
    const { data, error } = await db.rpc('import_purge_audit', { p_ids: part })
    if (error) fail('import_purge_audit', error)
    auditRowsRemoved += Number(data ?? 0)
  }

  // ---------------------------------------------------------------- 9. read it back
  const mismatches = await verify(db, tables, result)
  return { deleted, inserted, reused, auditRowsRemoved, storage, review, mismatches }
}

/** Counts and money totals as the database holds them now, against what the transform said it produced. */
export async function verify(db: Db, tables: Record<ImportTable, NewRow[]>, result: TransformResult): Promise<string[]> {
  const bad: string[] = []
  const count = async (table: string) => {
    const ids = await fetchAll(db, table, 'id')
    return ids.filter(r => isLegacyId(String(r['id']))).length
  }
  for (const t of ['rfqs', 'rfq_items', 'supplier_inquiries', 'supplier_quote_lines', 'orders', 'supplier_orders', 'order_items', 'invoices', 'payments_in', 'expenses', 'recurring_expenses', 'attachments', 'contacts'] as const) {
    const n = await count(t)
    if (n !== tables[t].length) bad.push(`${t}: expected ${tables[t].length} imported rows, found ${n}`)
  }
  const sum = async (table: string, col: string) =>
    money((await fetchAll(db, table, `id,${col}`)).filter(r => isLegacyId(String(r['id']))).reduce((s, r) => s + Number(r[col]), 0))
  const checks: [string, number, number][] = [
    ['payments_in.amount', await sum('payments_in', 'amount'), Math.round((result.recon.payments.neu + result.recon.paymentsFromStatus.neu) * 100) / 100],
    ['expenses.amount_pkr', await sum('expenses', 'amount_pkr'), result.recon.expensesTotal.neu],
    ['invoices.net_amount', await sum('invoices', 'net_amount'), result.recon.invoiceNet.neu],
    ['invoices.gst_amount', await sum('invoices', 'gst_amount'), result.recon.invoiceGst.neu],
  ]
  for (const [name, got, want] of checks) if (got !== want) bad.push(`${name}: database ${got}, transform ${want}`)
  // settled before cutover (owner decision 2026-10-19): exactly the invoices the transform marked, no more, no fewer
  const settledWant = new Set(tables.invoices.filter(r => r['settled_before_cutover'] === true).map(r => String(r['id'])))
  const settledGot = new Set(
    (await fetchAll(db, 'invoices', 'id,settled_before_cutover')).filter(r => isLegacyId(String(r['id'])) && r['settled_before_cutover'] === true).map(r => String(r['id'])),
  )
  const settledOff = [...settledWant].filter(id => !settledGot.has(id)).length + [...settledGot].filter(id => !settledWant.has(id)).length
  if (settledOff) bad.push(`invoices.settled_before_cutover: database ${settledGot.size} marked, transform ${settledWant.size}, ${settledOff} differ`)
  return bad
}
