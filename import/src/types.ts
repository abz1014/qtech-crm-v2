import type { Row } from './lib/text'

export type { Row }

/** Old table name -> its rows, exactly as the old database holds them. */
export type LegacyTables = Partial<Record<string, Row[]>>

/** One object in the old storage buckets (metadata from the dump; the file itself is read from the dump folder). */
export interface StorageObjectMeta {
  bucket: string
  path: string
  size_bytes: number
  mime_type: string
}

export interface LegacyDump {
  tables: LegacyTables
  storage: StorageObjectMeta[]
  /** Free-text provenance (when and how the dump was made). Never contains credentials. */
  meta: Record<string, unknown>
}

/** Insert order = foreign-key order. Deletion runs in the reverse. */
export const IMPORT_TABLES = [
  'companies',
  'company_sites',
  'contacts',
  'brands',
  'company_brands',
  'rfqs',
  'rfq_items',
  'supplier_inquiries',
  'supplier_quote_lines',
  'orders',
  'supplier_orders',
  'order_items',
  'order_costs',
  'order_engineers',
  'invoices',
  'attachments',
  'recurring_expenses',
  'payments_in',
  'expenses',
] as const
export type ImportTable = (typeof IMPORT_TABLES)[number]

/** Keys starting with an underscore are transform-only metadata. The loader strips them before it inserts. */
export type NewRow = Row

export interface ReviewItem {
  /** File name stem of the review CSV this item belongs to. */
  list: string
  table: string
  oldId: string
  label: string
  detail: string
}

export interface StorageCopy {
  fromBucket: string
  fromPath: string
  toBucket: string
  toPath: string
  invoiceId: string
}

export interface V2User {
  id: string
  name: string
}

export interface TransformOptions {
  /** "Today" for the staleness lists (RFQs quoted more than 180 days ago). Injected so tests are deterministic. */
  asOf: string
  /** The users that exist in the new project. null (offline report) gives each person a placeholder id. */
  v2Users: V2User[] | null
}

export interface MoneyLine {
  key: string
  old: number
  neu: number
  excluded: number
  diff: number
}

export interface Reconciliation {
  payments: MoneyLine
  expensesByCategory: MoneyLine[]
  expensesTotal: MoneyLine
  /** Σ order_value (old) against Σ item net (new). */
  orderValue: MoneyLine
  /** Σ invoice amounts (old, all three sources) against Σ invoice net (new). */
  invoiceNet: MoneyLine
  invoiceGst: MoneyLine
  /** For every new order with at least one invoice: items net against invoice net. */
  orderInvoice: { orderId: string; poNumber: string | null; itemsNet: number; invoiceNet: number; diff: number; basisUnknown: boolean }[]
}

export interface SourceCount {
  table: string
  rows: number
  /** rows that could not be imported (listed in dropped_rows) */
  dropped: number
}

export interface TransformResult {
  tables: Record<ImportTable, NewRow[]>
  storageCopies: StorageCopy[]
  /** Highest Q-Tech own number seen per series; the loader makes v2's counters continue after them. */
  numberFloors: { rfq: number; order: number; quotation: number; po: number }
  review: ReviewItem[]
  recon: Reconciliation
  sourceCounts: SourceCount[]
  importedCounts: { table: ImportTable; rows: number }[]
  /** Source tables that are dropped by design, with their row counts (for the report). */
  droppedByDesign: { table: string; rows: number; note: string }[]
}
