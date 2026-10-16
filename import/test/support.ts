import { fileURLToPath } from 'node:url'
import { readDump } from '../src/extract/dump'
import { loadMappings } from '../src/mappings'
import { transformAll } from '../src/transform'
import { isLegacyId } from '../src/lib/ids'
import { SEEDED_CATEGORY_NAMES } from '../src/transform/money'
import type { LegacyDump, NewRow, TransformResult } from '../src/types'

export const FIXTURE_DUMP = fileURLToPath(new URL('../fixtures/legacy', import.meta.url))
export const FIXTURE_MAPPINGS = fileURLToPath(new URL('../fixtures/mappings', import.meta.url))
export const AS_OF = '2025-03-01'

/** The fixture users of supabase/seed.sql: the people the old users map onto. */
export const V2_USERS = [
  { id: 'a0000000-0000-4000-8000-000000000001', name: 'Test Admin' },
  { id: 'a0000000-0000-4000-8000-000000000002', name: 'Test Sales' },
  { id: 'a0000000-0000-4000-8000-000000000003', name: 'Test Engineer' },
]

export function fixtureDump(): LegacyDump & { storageDir: string | null } {
  const d = readDump(FIXTURE_DUMP)
  return { ...d.dump, storageDir: d.storageDir }
}

export function run(dump: LegacyDump = fixtureDump()): TransformResult {
  return transformAll(dump, loadMappings(FIXTURE_MAPPINGS), { asOf: AS_OF, v2Users: V2_USERS })
}

export function rowsOf(r: TransformResult, table: keyof TransformResult['tables']): NewRow[] {
  return r.tables[table]
}

/** Deep copy so a test can edit the dump. */
export function cloneDump(d: LegacyDump): LegacyDump {
  return JSON.parse(JSON.stringify(d)) as LegacyDump
}

// ---------------------------------------------------------------------------------------------------------------------
// The database rules, replayed on the transform output. The load test proves them against the real schema; this makes a
// violation show up in a unit test first (and names the row).

type Rule = { name: string; ok: boolean }

export function violations(r: TransformResult): string[] {
  const t = r.tables
  const out: string[] = []
  const bad = (table: string, row: NewRow, why: string) => out.push(`${table} ${String(row['id'] ?? JSON.stringify(row).slice(0, 60))}: ${why}`)

  const ids = (table: keyof typeof t) => new Set(t[table].map(x => String(x['id'])))
  const idSets = {
    companies: ids('companies'), company_sites: ids('company_sites'), contacts: ids('contacts'), brands: ids('brands'),
    rfqs: ids('rfqs'), rfq_items: ids('rfq_items'), supplier_inquiries: ids('supplier_inquiries'), orders: ids('orders'),
    supplier_orders: ids('supplier_orders'), invoices: ids('invoices'), recurring_expenses: ids('recurring_expenses'),
  }
  const fk = (table: keyof typeof t, col: string, parent: keyof typeof idSets) => {
    for (const row of t[table]) {
      const v = row[col]
      if (v !== null && v !== undefined && !idSets[parent].has(String(v))) bad(table, row, `${col} -> missing ${parent} ${String(v)}`)
    }
  }
  fk('company_sites', 'company_id', 'companies')
  fk('contacts', 'company_id', 'companies')
  fk('contacts', 'site_id', 'company_sites')
  fk('company_brands', 'company_id', 'companies')
  fk('company_brands', 'brand_id', 'brands')
  fk('rfqs', 'company_id', 'companies')
  fk('rfqs', 'site_id', 'company_sites')
  fk('rfqs', 'contact_id', 'contacts')
  fk('rfq_items', 'rfq_id', 'rfqs')
  fk('rfq_items', 'brand_id', 'brands')
  fk('rfq_items', 'family_id', 'brands')
  fk('supplier_inquiries', 'rfq_id', 'rfqs')
  fk('supplier_inquiries', 'supplier_id', 'companies')
  fk('supplier_quote_lines', 'inquiry_id', 'supplier_inquiries')
  fk('supplier_quote_lines', 'rfq_item_id', 'rfq_items')
  fk('orders', 'company_id', 'companies')
  fk('orders', 'site_id', 'company_sites')
  fk('orders', 'rfq_id', 'rfqs')
  fk('supplier_orders', 'order_id', 'orders')
  fk('supplier_orders', 'supplier_id', 'companies')
  fk('order_items', 'order_id', 'orders')
  fk('order_items', 'supplier_order_id', 'supplier_orders')
  fk('order_items', 'brand_id', 'brands')
  fk('order_items', 'family_id', 'brands')
  fk('order_costs', 'order_id', 'orders')
  fk('order_engineers', 'order_id', 'orders')
  fk('invoices', 'order_id', 'orders')
  fk('invoices', 'company_id', 'companies')
  fk('attachments', 'invoice_id', 'invoices')
  fk('payments_in', 'order_id', 'orders')
  fk('expenses', 'order_id', 'orders')
  fk('expenses', 'supplier_order_id', 'supplier_orders')
  fk('expenses', 'payee_id', 'companies')
  fk('expenses', 'recurring_id', 'recurring_expenses')

  // every id is an import id, and unique
  for (const [table, rows] of Object.entries(t)) {
    const seen = new Set<string>()
    for (const row of rows) {
      if (row['id'] === undefined) continue
      const id = String(row['id'])
      if (!isLegacyId(id)) bad(table, row, 'id is not a version 5 UUID')
      if (seen.has(id)) bad(table, row, 'duplicate id')
      seen.add(id)
    }
  }

  const unique = (table: keyof typeof t, key: (row: NewRow) => string | null, label: string) => {
    const seen = new Set<string>()
    for (const row of t[table]) {
      const k = key(row)
      if (k === null) continue
      if (seen.has(k)) bad(table, row, `duplicate ${label}`)
      seen.add(k)
    }
  }
  const low = (v: unknown) => String(v).trim().toLowerCase()
  unique('companies', r => low(r['name']), 'company name')
  unique('company_sites', r => `${String(r['company_id'])}|${low(r['name'])}`, 'site name')
  unique('brands', r => low(r['name']), 'brand name')
  unique('company_brands', r => `${String(r['company_id'])}|${String(r['brand_id'])}`, 'company_brands key')
  unique('rfqs', r => (r['customer_ref'] ? `${String(r['company_id'])}|${String(r['customer_ref'])}` : null), 'customer_ref')
  unique('supplier_inquiries', r => `${String(r['rfq_id'])}|${String(r['supplier_id'])}`, '(rfq, supplier)')
  unique('supplier_quote_lines', r => `${String(r['inquiry_id'])}|${String(r['rfq_item_id'])}`, '(inquiry, item)')
  unique('orders', r => (r['customer_po_number'] && !(r['legacy_flags'] as string[]).includes('po_shared') ? `${String(r['company_id'])}|${String(r['customer_po_number'])}` : null), 'PO number')
  unique('invoices', r => (r['number'] ? String(r['number']) : null), 'invoice number')
  unique('expenses', r => (r['recurring_id'] ? `${String(r['recurring_id'])}|${String(r['period'])}` : null), '(recurring, period)')
  unique('order_engineers', r => `${String(r['order_id'])}|${String(r['user_id'])}`, 'engineer')
  unique('attachments', r => `${String(r['bucket'])}|${String(r['path'])}`, 'attachment path')

  const flags = (row: NewRow) => row['legacy_flags'] as string[]
  const date = (v: unknown) => v == null || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v))
  const check = (table: keyof typeof t, rules: (row: NewRow) => Rule[]) => {
    for (const row of t[table]) for (const rule of rules(row)) if (!rule.ok) bad(table, row, rule.name)
  }
  const month = /^\d{4}-(0[1-9]|1[0-2])$/

  check('companies', r => [{ name: 'name present', ok: !!r['name'] }, { name: 'legacy_source set', ok: r['legacy_source'] != null }])
  check('rfqs', r => [
    { name: 'owner or owner_unknown', ok: r['owner_id'] !== null || flags(r).includes('owner_unknown') },
    { name: 'close pair', ok: (r['close_reason'] === null) === (r['closed_on'] === null) },
    { name: 'close_reason in list', ok: r['close_reason'] === null || ['competitor', 'price', 'no_reply_to_clarification', 'customer_cancelled', 'could_not_source', 'we_were_late', 'other'].includes(String(r['close_reason'])) },
    { name: 'received_on present', ok: date(r['received_on']) && r['received_on'] !== null },
    { name: 'dates are dates', ok: date(r['due_on']) && date(r['quoted_on']) && date(r['closed_on']) },
    { name: 'legacy_source set', ok: r['legacy_source'] != null },
  ])
  check('rfq_items', r => [{ name: 'qty > 0', ok: Number(r['qty']) > 0 }, { name: 'description', ok: !!r['description'] }, { name: 'gst 0-100', ok: Number(r['gst_rate']) >= 0 && Number(r['gst_rate']) <= 100 }])
  check('supplier_quote_lines', r => [
    { name: 'unit_price > 0', ok: Number(r['unit_price']) > 0 },
    { name: 'currency is 3 capitals', ok: /^[A-Z]{3}$/.test(String(r['currency'])) },
    { name: 'currency_unverified on every legacy line', ok: flags(r).includes('currency_unverified') },
  ])
  check('orders', r => [
    { name: 'owner or owner_unknown', ok: r['owner_id'] !== null || flags(r).includes('owner_unknown') },
    { name: 'ordered_on or undated', ok: r['ordered_on'] !== null || flags(r).includes('undated') },
    { name: 'terms >= 0', ok: r['payment_terms_days'] === null || Number(r['payment_terms_days']) >= 0 },
    { name: 'dates are dates', ok: date(r['ordered_on']) && date(r['commissioning_planned_on']) && date(r['commissioning_done_on']) },
  ])
  check('order_items', r => [{ name: 'qty > 0', ok: Number(r['qty']) > 0 }, { name: 'price >= 0', ok: Number(r['unit_price_net']) >= 0 }, { name: 'description', ok: !!r['description'] }])
  check('supplier_orders', r => [{ name: 'dates are dates', ok: date(r['placed_on']) && date(r['expected_on']) && date(r['received_on']) && date(r['delivered_on']) }, { name: 'currency stays empty', ok: r['currency'] == null }])
  check('order_costs', r => [{ name: 'cost >= 0', ok: Number(r['expected_cost_pkr']) >= 0 }])
  check('invoices', r => [
    { name: 'order or company', ok: r['order_id'] != null || r['company_id'] != null },
    { name: 'gst between 0 and net', ok: Number(r['gst_amount']) >= 0 && Number(r['gst_amount']) <= Number(r['net_amount']) },
    { name: 'number or a flag', ok: r['number'] != null || flags(r).length > 0 },
    { name: 'date or a flag', ok: r['invoice_date'] != null || flags(r).length > 0 },
    { name: 'dates are dates', ok: date(r['invoice_date']) && date(r['copy_received_on']) && date(r['tcs_sent_on']) && date(r['client_received_on']) && date(r['wasif_receipt_on']) && date(r['tax_deposited_on']) },
  ])
  check('attachments', r => [
    { name: 'size within 5 MB', ok: Number(r['size_bytes']) <= 5_242_880 },
    { name: 'exactly one parent', ok: [r['rfq_id'], r['invoice_id'], r['expense_id']].filter(x => x != null).length === 1 },
    { name: 'bucket matches parent', ok: r['invoice_id'] != null && r['bucket'] === 'gst-receipts' },
  ])
  check('payments_in', r => [
    { name: 'amount > 0', ok: Number(r['amount']) > 0 },
    { name: 'received_on present', ok: typeof r['received_on'] === 'string' },
    { name: 'paid_via bank, not ticked', ok: r['paid_via'] === 'bank' && r['bank_month'] === null },
    { name: 'order present', ok: !!r['order_id'] },
  ])
  check('expenses', r => [
    { name: 'amount > 0', ok: Number(r['amount_pkr']) > 0 },
    { name: 'paid_on present', ok: typeof r['paid_on'] === 'string' },
    { name: 'paid_via bank, not ticked', ok: r['paid_via'] === 'bank' && r['bank_month'] === null },
    { name: 'input tax 0', ok: r['input_tax_pkr'] === 0 },
    { name: 'category is a known name', ok: SEEDED_CATEGORY_NAMES.includes(String(r['_category'])) },
    { name: 'recurring pair', ok: (r['recurring_id'] === null) === (r['period'] === null) || r['recurring_id'] === null },
    { name: 'period is YYYY-MM', ok: r['period'] === null || month.test(String(r['period'])) },
  ])
  check('recurring_expenses', r => [
    { name: 'amount > 0', ok: Number(r['amount']) > 0 },
    { name: 'day 1-28 or empty', ok: r['day_of_month'] === null || (Number(r['day_of_month']) >= 1 && Number(r['day_of_month']) <= 28) },
    { name: 'start_month YYYY-MM or empty', ok: r['start_month'] === null || month.test(String(r['start_month'])) },
  ])
  // Every legacy-marked table must carry its original row.
  for (const table of ['rfqs', 'rfq_items', 'supplier_inquiries', 'supplier_quote_lines', 'orders', 'supplier_orders', 'order_items', 'invoices', 'payments_in', 'expenses'] as const) {
    for (const row of t[table]) if (row['legacy_source'] == null) bad(table, row, 'legacy_source is empty (it is the legacy marker)')
  }
  return out
}
