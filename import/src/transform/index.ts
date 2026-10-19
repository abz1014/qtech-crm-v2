import { str } from '../lib/text'
import type { Mappings } from '../mappings'
import { IMPORT_TABLES } from '../types'
import type { ImportTable, LegacyDump, NewRow, Reconciliation, TransformOptions, TransformResult } from '../types'
import { CompanyBook } from './companies'
import { Ctx } from './context'
import { Ledger } from './ledger'
import { transformMoney } from './money'
import { transformOrders } from './orders'
import { transformRfqs } from './rfqs'

export { CompanyBook, looksComposite, looseKey } from './companies'
export { itemDescription } from './orders'
export { looksCustomerIssued } from './rfqs'
export { SEEDED_CATEGORY_NAMES } from './money'

// Source tables the new model does not carry (DATA_MODEL section 7). Counted so the report can say what was left behind.
const DROPPED_BY_DESIGN: { table: string; note: string }[] = [
  { table: 'follow_up_actions', note: 'machine-generated, never edited; replaced by the Today work list' },
  { table: 'quarterly_targets', note: 'company-level targets measure a different thing; the admin enters per-person targets at cutover' },
  { table: 'cost_lines', note: 'costing calculator removed' },
  { table: 'costing_config', note: 'costing calculator removed' },
  { table: 'budgets', note: 'out of scope' },
  { table: 'employees', note: 'HR cut; export a CSV to the archive' },
  { table: 'attendance', note: 'HR cut; export a CSV to the archive' },
  { table: 'audit_log', note: 'old ids; stays in the archive dump' },
  { table: 'documents', note: 'expected to be empty (assumption 12)' },
]

/**
 * The whole transform: old tables in, new rows out. Pure: no clock (opts.asOf), no network, no database.
 * The same input always gives the same ids, rows and review lists.
 */
export function transformAll(dump: LegacyDump, maps: Mappings, opts: TransformOptions): TransformResult {
  const ctx = new Ctx(dump, maps, opts)
  const book = new CompanyBook(ctx)
  const ledger = new Ledger()

  // Families first, so a vendor's products_supplied can match them.
  const types = new Set<string>()
  for (const t of ['rfq_line_items', 'orders']) for (const r of ctx.rows(t)) types.add(str(r, 'product_type') ?? '')
  for (const t of [...types].filter(Boolean).sort()) book.family(t)

  // I02
  for (const c of ctx.rows('clients')) book.addCustomer('clients', c)
  for (const p of ctx.rows('prospects')) book.addCustomer('prospects', p)
  for (const v of ctx.rows('vendors')) book.addVendor(v)

  // I03, I04, I05
  const rfq = transformRfqs(ctx, book)
  const orders = transformOrders(ctx, book, rfq.rfqIds, rfq.rfqRefs, ledger)
  const money = transformMoney(ctx, book, orders, ledger)

  const companyTables = book.finish()

  const tables = {
    ...companyTables,
    rfqs: rfq.rfqs,
    rfq_items: rfq.rfq_items,
    supplier_inquiries: rfq.supplier_inquiries,
    supplier_quote_lines: rfq.supplier_quote_lines,
    orders: orders.orders,
    supplier_orders: orders.supplier_orders,
    order_items: orders.order_items,
    order_costs: orders.order_costs,
    order_engineers: orders.order_engineers,
    invoices: money.invoices,
    attachments: money.attachments,
    recurring_expenses: money.recurring_expenses,
    payments_in: money.payments_in,
    expenses: money.expenses,
  } satisfies Record<ImportTable, NewRow[]>

  const itemsNetByOrder = new Map(orders.groups.map(g => [g.newId, g] as const))
  const recon: Reconciliation = {
    payments: ledger.line('payments'),
    expensesByCategory: ledger.keysWithPrefix('expense:').map(k => ({ ...ledger.line(k), key: k.slice('expense:'.length) })),
    expensesTotal: ledger.line('expensesTotal'),
    orderValue: ledger.line('orderValue'),
    invoiceNet: ledger.line('invoiceNet'),
    invoiceGst: ledger.line('invoiceGst'),
    orderInvoice: [...money.invoiceNetByOrder].map(([orderId, invoiceNet]) => {
      const g = itemsNetByOrder.get(orderId)!
      return {
        orderId,
        poNumber: g.poNumber,
        itemsNet: g.itemsNet,
        invoiceNet,
        diff: Math.round((g.itemsNet - invoiceNet) * 100) / 100 + 0,
        basisUnknown: g.flags.has('value_basis_unknown'),
      }
    }),
  }

  const sourceNames = [
    'users',
    'clients',
    'prospects',
    'vendors',
    'rfqs',
    'rfq_line_items',
    'supplier_inquiries',
    'supplier_quotes',
    'orders',
    'order_engineers',
    'gst_invoices',
    'invoices',
    'payment_records',
    'order_payments',
    'supplier_payments',
    'payables',
    'payable_payments',
    'expenses',
    'recurring_expenses',
  ]

  const documents = (dump.tables['documents'] ?? []).length
  if (documents > 0) ctx.addReview('warnings', 'documents', '', 'documents', `${documents} rows: assumption 12 expected 0. Look at them before cutover.`)

  return {
    tables,
    storageCopies: money.storageCopies,
    numberFloors: rfq.numberFloors,
    review: ctx.review,
    recon,
    sourceCounts: sourceNames.map(table => ({ table, rows: (dump.tables[table] ?? []).length, dropped: ctx.droppedCount.get(table) ?? 0 })),
    importedCounts: IMPORT_TABLES.map(table => ({ table, rows: tables[table].length })),
    droppedByDesign: DROPPED_BY_DESIGN.map(d => ({ ...d, rows: Math.max((dump.tables[d.table] ?? []).length, dump.catalog?.counts?.[d.table] ?? 0) })),
  }
}
