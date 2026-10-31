import { fetchAll, requireSupabase } from '@/lib/supabase'
import { generateCSV, downloadCSV } from '@/lib/csvExport'

/*
 * Export data (process audit 8). The admin downloads the books as CSV files, one per kind: customers and suppliers, enquiries (RFQs),
 * orders, invoices, payments, expenses. Admin only: the page is behind the admin guard and row security returns nothing to anyone
 * else, so an engineer can never export a price. Each file holds the stored amounts, never a recomputed one (an invoice's net and GST
 * are the invoice's own), dates as YYYY-MM-DD, amounts as plain numbers in PKR. The browser builds the file; nothing is sent anywhere.
 */
export type ExportId = 'companies' | 'rfqs' | 'orders' | 'invoices' | 'payments' | 'expenses'

export interface ExportTable {
  headers: string[]
  rows: unknown[][]
}

export interface ExportKind {
  id: ExportId
  label: string
  about: string
  file: string
  run: () => Promise<ExportTable>
}

type Rec = Record<string, unknown>
const db = () => requireSupabase()
const all = <T extends Rec>(table: string, columns: string, order: string): Promise<T[]> =>
  fetchAll<T>((from, to) => db().from(table as never).select(columns).order(order).range(from, to) as unknown as PromiseLike<{ data: T[] | null; error: { code?: string; message: string } | null }>)

const nameMap = async (table: string, key = 'name'): Promise<Map<string, string>> => new Map((await all<Rec>(table, `id, ${key}`, 'id')).map(r => [String(r.id), String(r[key] ?? '')]))
const num = (v: unknown): number | string => (v === null || v === undefined || v === '' ? '' : Number(v))
const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v))
const orderNo = (v: unknown): string => (v === null || v === undefined ? '' : `ORD-${String(v).padStart(4, '0')}`)
const rfqNo = (v: unknown): string => (v === null || v === undefined ? '' : `RFQ-${String(v).padStart(4, '0')}`)

export function companiesTable(rows: readonly Rec[]): ExportTable {
  return {
    headers: ['Name', 'City', 'Country', 'Invoice address', 'NTN', 'STRN', 'Sales tax registered', 'Notes', 'Added on'],
    rows: rows.map(r => [txt(r.name), txt(r.city), txt(r.country), txt(r.invoice_address), txt(r.ntn), txt(r.strn), r.sales_tax_registered ? 'Yes' : 'No', txt(r.notes), txt(r.created_at).slice(0, 10)]),
  }
}

export function rfqsTable(rows: readonly Rec[], companies: ReadonlyMap<string, string>, users: ReadonlyMap<string, string>): ExportTable {
  return {
    headers: ['RFQ', 'Customer', 'Their reference', 'Received on', 'Quotation due on', 'Quoted on', 'Closed on', 'Closed because', 'Owner', 'Priority'],
    rows: rows.map(r => [rfqNo(r.number), companies.get(txt(r.company_id)) ?? '', txt(r.customer_ref), txt(r.received_on), txt(r.due_on), txt(r.quoted_on), txt(r.closed_on), txt(r.close_reason), users.get(txt(r.owner_id)) ?? '', r.is_priority ? 'Yes' : 'No']),
  }
}

export function ordersTable(rows: readonly Rec[], money: ReadonlyMap<string, Rec>, companies: ReadonlyMap<string, string>, users: ReadonlyMap<string, string>): ExportTable {
  return {
    headers: ['Order', 'Customer', 'Customer PO', 'Ordered on', 'Owner', 'Cancelled on', 'Total with GST (PKR)', 'Received (PKR)', 'Still to collect (PKR)', 'Payment', 'Due on'],
    rows: rows.map(r => {
      const m = money.get(txt(r.id))
      return [orderNo(r.number), companies.get(txt(r.company_id)) ?? '', txt(r.customer_po_number), txt(r.ordered_on), users.get(txt(r.owner_id)) ?? '', txt(r.cancelled_on), num(m?.gross_target), num(m?.settled), num(m?.receivable), txt(m?.payment_state), txt(m?.due_on)]
    }),
  }
}

export function invoicesTable(rows: readonly Rec[], orders: ReadonlyMap<string, string>, companies: ReadonlyMap<string, string>): ExportTable {
  return {
    headers: ['Invoice', 'Date', 'Customer', 'Order', 'Net (PKR)', 'GST (PKR)', 'Total (PKR)', 'PSID', 'GST deposited on'],
    rows: rows.map(r => [txt(r.number), txt(r.invoice_date), companies.get(txt(r.company_id)) ?? '', orders.get(txt(r.order_id)) ?? '', num(r.net_amount), num(r.gst_amount), Number(r.net_amount ?? 0) + Number(r.gst_amount ?? 0), txt(r.psid), txt(r.tax_deposited_on)]),
  }
}

export function paymentsTable(rows: readonly Rec[], orders: ReadonlyMap<string, string>, orderCompany: ReadonlyMap<string, string>): ExportTable {
  return {
    headers: ['Received on', 'Customer', 'Order', 'Amount (PKR)', 'Paid via', 'Reference', 'Voided on', 'Why voided'],
    rows: rows.map(r => [txt(r.received_on), orderCompany.get(txt(r.order_id)) ?? '', orders.get(txt(r.order_id)) ?? '', num(r.amount), txt(r.paid_via), txt(r.reference), txt(r.voided_at).slice(0, 10), txt(r.void_reason)]),
  }
}

export function expensesTable(rows: readonly Rec[], categories: ReadonlyMap<string, string>, payees: ReadonlyMap<string, string>, orders: ReadonlyMap<string, string>): ExportTable {
  return {
    headers: ['Paid on', 'Category', 'Description', 'Paid to', 'Order', 'Amount (PKR)', 'Input tax (PKR)', 'Paid via', 'For month'],
    rows: rows.map(r => [txt(r.paid_on), categories.get(txt(r.category_id)) ?? '', txt(r.description), payees.get(txt(r.payee_id)) ?? '', orders.get(txt(r.order_id)) ?? '', num(r.amount_pkr), num(r.input_tax_pkr), txt(r.paid_via), txt(r.period)]),
  }
}

export const EXPORTS: readonly ExportKind[] = [
  {
    id: 'companies',
    label: 'Customers and suppliers',
    about: 'Every company: name, city, tax numbers and notes.',
    file: 'companies',
    run: async () => companiesTable(await all('companies', 'name, city, country, invoice_address, ntn, strn, sales_tax_registered, notes, created_at', 'name')),
  },
  {
    id: 'rfqs',
    label: 'Enquiries (RFQs) and jobs',
    about: 'Every enquiry with its customer, dates, owner and why it closed.',
    file: 'rfqs',
    run: async () => {
      const [rows, companies, users] = await Promise.all([all('rfqs', 'number, company_id, customer_ref, received_on, due_on, quoted_on, closed_on, close_reason, owner_id, is_priority', 'number'), nameMap('companies'), nameMap('users')])
      return rfqsTable(rows, companies, users)
    },
  },
  {
    id: 'orders',
    label: 'Orders',
    about: 'Every order with what it is worth, what was received, what is still to collect and its due date.',
    file: 'orders',
    run: async () => {
      const [rows, money, companies, users] = await Promise.all([
        all('orders', 'id, number, company_id, customer_po_number, ordered_on, owner_id, cancelled_on', 'number'),
        all('v_order_money', 'order_id, gross_target, settled, receivable, payment_state, due_on', 'order_id'),
        nameMap('companies'),
        nameMap('users'),
      ])
      return ordersTable(rows, new Map(money.map(m => [txt(m.order_id), m])), companies, users)
    },
  },
  {
    id: 'invoices',
    label: 'Invoices',
    about: 'Every invoice with its net, GST and filing details.',
    file: 'invoices',
    run: async () => {
      const [rows, orders, companies] = await Promise.all([
        all('invoices', 'number, invoice_date, company_id, order_id, net_amount, gst_amount, psid, tax_deposited_on', 'invoice_date'),
        all<Rec>('orders', 'id, number', 'id').then(o => new Map(o.map(r => [txt(r.id), orderNo(r.number)]))),
        nameMap('companies'),
      ])
      return invoicesTable(rows, orders, companies)
    },
  },
  {
    id: 'payments',
    label: 'Payments received',
    about: 'Every payment from a customer, including ones that were cancelled.',
    file: 'payments',
    run: async () => {
      const [rows, orderRows, companies] = await Promise.all([
        all('payments_in', 'received_on, order_id, amount, paid_via, reference, voided_at, void_reason', 'received_on'),
        all<Rec>('orders', 'id, number, company_id', 'id'),
        nameMap('companies'),
      ])
      return paymentsTable(rows, new Map(orderRows.map(r => [txt(r.id), orderNo(r.number)])), new Map(orderRows.map(r => [txt(r.id), companies.get(txt(r.company_id)) ?? ''])))
    },
  },
  {
    id: 'expenses',
    label: 'Expenses',
    about: 'Every expense with its category, amount, input tax and how it was paid.',
    file: 'expenses',
    run: async () => {
      const [rows, categories, payees, orderRows] = await Promise.all([
        all('expenses', 'paid_on, category_id, description, payee_id, order_id, amount_pkr, input_tax_pkr, paid_via, period', 'paid_on'),
        nameMap('expense_categories'),
        nameMap('companies'),
        all<Rec>('orders', 'id, number', 'id'),
      ])
      return expensesTable(rows, categories, payees, new Map(orderRows.map(r => [txt(r.id), orderNo(r.number)])))
    },
  },
]

/** Builds the file and saves it: `qtech-<kind>-<date>.csv`. */
export async function downloadExport(kind: ExportKind, today: string): Promise<number> {
  const t = await kind.run()
  downloadCSV(generateCSV(t.headers, t.rows), `qtech-${kind.file}-${today}.csv`)
  return t.rows.length
}
