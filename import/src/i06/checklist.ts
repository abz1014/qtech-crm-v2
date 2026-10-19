import { parseLegacyDate } from '../lib/dates'
import { clean, money, normName, num, str } from '../lib/text'
import type { Row } from '../lib/text'
import { normPo } from '../mappings'
import type { LegacyDump } from '../types'

// I06: the DATA_MODEL section 8 assumptions, answered from a dump (dump.sql's output). For each one:
//   confirmed  the data agrees with the assumption
//   adjusted   the data disagrees (or needs handling); the evidence says what, and what the import does about it
//   unknown    the dump cannot tell (not in the dump, or the table is empty); the evidence says what to check by hand
// Pure: dump in, list out. Nothing here connects to anything.

export type Verdict = 'confirmed' | 'adjusted' | 'unknown'
export interface ChecklistItem {
  n: number
  assumption: string
  verdict: Verdict
  evidence: string
}

const EXPECTED_COLUMNS: Record<string, string[]> = {
  rfqs: ['id', 'client_id', 'company_name', 'rfq_date', 'assigned_to', 'priority', 'status', 'notes', 'converted_order_id', 'rfq_number', 'quote_sent_date', 'quote_deadline', 'loss_reason', 'loss_notes'],
  orders: ['id', 'client_id', 'vendor_id', 'sales_person_id', 'order_value', 'cost_value', 'status', 'notes', 'confirmed_date', 'rfq_id', 'customer_po_number', 'customer_po_date', 'payment_terms_days', 'delivery_date', 'invoice_number', 'invoice_date'],
  clients: ['id', 'company_name', 'industry', 'contact_person', 'phone', 'email', 'address'],
  vendors: ['id', 'name', 'country', 'products_supplied'],
  supplier_inquiries: ['id', 'rfq_id', 'vendor_id', 'sent_at', 'status'],
  supplier_quotes: ['id', 'rfq_id', 'vendor_id', 'inquiry_id', 'received_at', 'unit_price', 'currency', 'lead_time_days'],
  rfq_line_items: ['id', 'rfq_id', 'product_type', 'quantity', 'specification'],
  order_engineers: ['id', 'order_id', 'engineer_id', 'start_date', 'expected_completion', 'commissioning_status'],
  users: ['id', 'name', 'role'],
}
const KNOWN_ORDER_STATUSES = ['quotation', 'po_received', 'procurement', 'in_transit', 'delivered', 'payment_received', 'completed']
const DATE_COLUMNS: [string, string][] = [
  ['rfqs', 'rfq_date'], ['rfqs', 'quote_deadline'], ['rfqs', 'quote_sent_date'], ['supplier_inquiries', 'sent_at'],
  ['orders', 'customer_po_date'], ['orders', 'delivery_date'], ['orders', 'invoice_date'], ['order_payments', 'payment_date'],
  ['supplier_payments', 'payment_date'], ['expenses', 'date'], ['payment_records', 'payment_date'], ['invoices', 'issued_date'],
  ['gst_invoices', 'invoice_date'], ['gst_invoices', 'received_date'], ['gst_invoices', 'tcs_sent_date'], ['gst_invoices', 'tcs_receipt_date'],
  ['gst_invoices', 'client_received_date'], ['gst_invoices', 'wasif_receipt_date'], ['gst_invoices', 'tax_deposit_date'],
  ['order_engineers', 'start_date'], ['order_engineers', 'expected_completion'],
]

const list = (xs: string[], max = 6): string => (xs.length <= max ? xs.join(', ') : `${xs.slice(0, max).join(', ')} and ${xs.length - max} more`)

export function runChecklist(dump: LegacyDump): ChecklistItem[] {
  const T = (t: string): Row[] => dump.tables[t] ?? []
  const has = (t: string) => t in dump.tables
  const count = (t: string): number => Math.max(T(t).length, dump.catalog?.counts?.[t] ?? 0)
  const detail = (k: string): unknown => dump.catalog?.details?.[k]
  const out: ChecklistItem[] = []
  const add = (n: number, assumption: string, verdict: Verdict, evidence: string) => out.push({ n, assumption, verdict, evidence })

  // 1. columns, types, nullability
  {
    const cols = detail('columns') as Record<string, { column: string; type: string }[]> | undefined
    const problems: string[] = []
    let checked = 0
    for (const [table, expected] of Object.entries(EXPECTED_COLUMNS)) {
      const have = cols?.[table]?.map(c => c.column) ?? Object.keys(T(table)[0] ?? {})
      if (have.length === 0) continue
      checked++
      const missing = expected.filter(c => !have.includes(c))
      if (missing.length) problems.push(`${table} lacks ${missing.join(', ')}`)
    }
    const ct = cols?.['orders']?.find(c => c.column === 'confirmed_date')?.type
    if (checked === 0) add(1, 'Columns of the 12 tables without DDL match the reconstructed types', 'unknown', 'No catalog and no rows to read the columns from.')
    else if (problems.length) add(1, 'Columns of the 12 tables without DDL match the reconstructed types', 'adjusted', `${problems.join('; ')}. The transform reads a missing column as empty; check what replaced it.`)
    else add(1, 'Columns of the 12 tables without DDL match the reconstructed types', 'confirmed', `${checked} tables checked against ${cols ? 'the catalog' : 'their row keys'}${ct ? `; orders.confirmed_date is ${ct}` : ''}.`)
  }

  // 2. text date formats
  {
    const fmt = { iso: 0, other: 0, invalid: 0 }
    const bad: string[] = []
    for (const [t, c] of DATE_COLUMNS) {
      for (const r of T(t)) {
        const raw = clean(r[c])
        if (raw === null) continue
        const p = parseLegacyDate(raw)
        if (p.status === 'invalid') {
          fmt.invalid++
          if (bad.length < 5) bad.push(`${t}.${c} "${raw}"`)
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) fmt.iso++
        else fmt.other++
      }
    }
    const total = fmt.iso + fmt.other + fmt.invalid
    if (total === 0) add(2, 'Text date columns hold YYYY-MM-DD; count the unparseable', 'unknown', 'No date values in the dump.')
    else if (fmt.invalid === 0 && fmt.other === 0) add(2, 'Text date columns hold YYYY-MM-DD; count the unparseable', 'confirmed', `${total} values, all YYYY-MM-DD.`)
    else add(2, 'Text date columns hold YYYY-MM-DD; count the unparseable', 'adjusted', `${total} values: ${fmt.iso} YYYY-MM-DD, ${fmt.other} read as day-first or timestamp, ${fmt.invalid} unparseable (${bad.join('; ')}). Unparseable ones are flagged invalid_date and listed in unparseable_dates.csv.`)
  }

  // 3. duplicate identifiers
  {
    const dup = (rows: Row[], key: (r: Row) => string): number => {
      const seen = new Map<string, number>()
      for (const r of rows) {
        const k = key(r)
        if (k) seen.set(k, (seen.get(k) ?? 0) + 1)
      }
      return [...seen.values()].filter(n => n > 1).length
    }
    const rfq = dup(T('rfqs'), r => (str(r, 'rfq_number') ? `${str(r, 'client_id') ?? normName(r['company_name'])}|${normName(r['rfq_number'])}` : ''))
    const po = dup(T('orders'), r => (str(r, 'customer_po_number') ? `${str(r, 'client_id')}|${normPo(r['customer_po_number'])}` : ''))
    const gst = dup(T('gst_invoices'), r => normName(r['gst_invoice_number']))
    const blank = T('gst_invoices').filter(r => str(r, 'gst_invoice_number') === null).length
    if (!has('rfqs') && !has('orders')) add(3, 'Duplicate counts on rfq_number, customer_po_number, gst_invoice_number', 'unknown', 'Tables not in the dump.')
    else if (rfq + po + gst + blank === 0) add(3, 'Duplicate counts on rfq_number, customer_po_number, gst_invoice_number', 'confirmed', 'No duplicate RFQ numbers per customer, PO numbers per customer, or GST invoice numbers; none blank.')
    else add(3, 'Duplicate counts on rfq_number, customer_po_number, gst_invoice_number', 'adjusted', `${rfq} repeated RFQ number(s) per customer, ${po} repeated PO number(s) per customer, ${gst} repeated and ${blank} blank GST invoice number(s). The import merges decided PO clashes, flags the rest po_shared, and imports a repeated invoice number without the number.`)
  }

  // 4. RFQs with more than one order
  {
    const per = new Map<string, number>()
    for (const o of T('orders')) {
      const k = str(o, 'rfq_id')
      if (k) per.set(k, (per.get(k) ?? 0) + 1)
    }
    const multi = [...per.values()].filter(n => n > 1).length
    if (!has('orders')) add(4, 'RFQs with more than one order', 'unknown', 'No orders in the dump.')
    else add(4, 'RFQs with more than one order', multi === 0 ? 'confirmed' : 'adjusted', multi === 0 ? 'No RFQ has two orders.' : `${multi} RFQ(s) have several orders. v2 allows it (orders.rfq_id is not unique); each order keeps its link.`)
  }

  // 5 and 25. supplier_quotes link and currencies
  {
    const q = T('supplier_quotes')
    const keys = Object.keys(q[0] ?? {})
    const link = keys.filter(k => /item/.test(k))
    const cur = new Map<string, number>()
    for (const r of q) cur.set((str(r, 'currency') ?? '(empty)').toUpperCase(), (cur.get((str(r, 'currency') ?? '(empty)').toUpperCase()) ?? 0) + 1)
    if (q.length === 0) {
      add(5, 'supplier_quotes has no item-level link; currencies in use', 'unknown', 'No supplier quotes in the dump.')
      add(25, 'Real non-PKR rows in supplier_quotes', 'unknown', 'No supplier quotes in the dump.')
    } else {
      add(5, 'supplier_quotes has no item-level link; currencies in use', link.length ? 'adjusted' : 'confirmed', link.length ? `Columns that look like an item link: ${link.join(', ')}. Use them instead of item_guessed.` : `No item-level column among: ${keys.join(', ')}. Currencies: ${[...cur].map(([k, v]) => `${k} ${v}`).join(', ')}.`)
      const non = [...cur].filter(([k]) => k !== 'PKR')
      add(25, 'Real non-PKR rows in supplier_quotes', 'confirmed', non.length ? `${non.reduce((s, [, v]) => s + v, 0)} of ${q.length} rows are not PKR (${non.map(([k, v]) => `${k} ${v}`).join(', ')}); every row is flagged currency_unverified because the old app hardcoded PKR.` : `All ${q.length} rows say PKR; still flagged currency_unverified (hardcoded default).`)
    }
  }

  // 6. order statuses and payments
  {
    const st = new Map<string, number>()
    for (const o of T('orders')) st.set(str(o, 'status') ?? '(empty)', (st.get(str(o, 'status') ?? '(empty)') ?? 0) + 1)
    const unknownSt = [...st.keys()].filter(k => !KNOWN_ORDER_STATUSES.includes(k))
    const paidIds = new Set(T('order_payments').map(p => str(p, 'order_id')))
    const withPay = T('orders').filter(o => paidIds.has(str(o, 'id'))).length
    if (!has('orders')) add(6, 'Order status values present; which orders have payments', 'unknown', 'No orders in the dump.')
    else add(6, 'Order status values present; which orders have payments', unknownSt.length ? 'adjusted' : 'confirmed', `Statuses: ${[...st].map(([k, v]) => `${k} ${v}`).join(', ')}. ${withPay} of ${T('orders').length} orders have payment rows.${unknownSt.length ? ` Unexpected status(es): ${unknownSt.join(', ')}: treated as not yet delivered.` : ''}`)
  }

  // 7. cost double count
  {
    const sp = new Set(T('supplier_payments').map(p => str(p, 'order_id')))
    const inv = T('expenses').filter(e => /inventory|procurement/i.test(str(e, 'category') ?? '') && str(e, 'order_id') && sp.has(str(e, 'order_id')))
    const orders = new Set(inv.map(e => str(e, 'order_id')))
    if (!has('expenses') && !has('supplier_payments')) add(7, 'Supplier payments overlap Inventory/Procurement expenses', 'unknown', 'Tables not in the dump.')
    else add(7, 'Supplier payments overlap Inventory/Procurement expenses', orders.size ? 'adjusted' : 'confirmed', orders.size ? `${orders.size} order(s) have both: flagged cost_possible_double_count and listed in cost_double_counts.csv. The owner decides which to delete.` : 'No order has both.')
  }

  // 8. dead bookkeeping tables
  {
    const names = ['invoices', 'payment_records', 'payables', 'payable_payments']
    const n = names.map(t => `${t} ${count(t)}`)
    const dupPay = T('payment_records').filter(p => T('order_payments').some(o => num(o['amount']) === num(p['amount']) && str(o, 'payment_date') === str(p, 'payment_date'))).length
    const live = names.some(t => count(t) > 20)
    if (names.every(t => !has(t))) add(8, 'invoices, payment_records, payables, payable_payments are seed-only', 'unknown', 'Tables not in the dump.')
    else add(8, 'invoices, payment_records, payables, payable_payments are seed-only', live ? 'adjusted' : 'confirmed', `${n.join(', ')}; ${dupPay} payment_records row(s) repeat an order_payments row. ${live ? 'More than seed-sized: review them in the report.' : 'Small enough to be seed data; the import still reads them (rules in docs/IMPORT.md).'}`)
  }

  // 9. GST register
  {
    const g = T('gst_invoices')
    const linked = g.filter(r => str(r, 'order_id')).length
    const noPsid = g.filter(r => /^(generated|fully generated)$/i.test(str(r, 'fbr_status') ?? '') && !str(r, 'psid')).length
    if (!has('gst_invoices')) add(9, 'GST register size, links, Generated rows without a PSID', 'unknown', 'No gst_invoices in the dump.')
    else add(9, 'GST register size, links, Generated rows without a PSID', 'confirmed', `${g.length} rows, ${linked} linked to an order, ${noPsid} Generated or Fully Generated with an empty PSID (flagged fbr_generated_legacy).`)
  }

  // 10. received_date and tcs_receipt_date
  {
    const g = T('gst_invoices')
    const rec = g.filter(r => str(r, 'received_date')).length
    const tcs = g.filter(r => str(r, 'tcs_receipt_date'))
    const differ = tcs.filter(r => str(r, 'tcs_receipt_date') !== str(r, 'tcs_sent_date')).length
    if (g.length === 0) add(10, 'received_date is the courier copy date; tcs_receipt_date equals tcs_sent_date', 'unknown', 'No GST rows.')
    else if (rec === 0 && differ === 0) add(10, 'received_date is the courier copy date; tcs_receipt_date equals tcs_sent_date', 'confirmed', `received_date is empty on all ${g.length} rows (the old form has no such field) and tcs_receipt_date never differs from tcs_sent_date: copy_received_on can be dropped.`)
    else add(10, 'received_date is the courier copy date; tcs_receipt_date equals tcs_sent_date', 'adjusted', `${rec} row(s) have received_date; ${differ} of ${tcs.length} tcs_receipt_date values differ from tcs_sent_date (flag tcs_receipt_date_differs). Keep copy_received_on.`)
  }

  // 11. receipts bucket
  {
    const objs = dump.storage
    const paths = T('gst_invoices').map(r => str(r, 'wasif_receipt_file_path')).filter((x): x is string => x !== null)
    const have = new Set(objs.map(o => o.path))
    const missing = paths.filter(p => !have.has(p))
    const bytes = objs.reduce((s, o) => s + o.size_bytes, 0)
    if (objs.length === 0 && paths.length > 0) add(11, 'gst-receipts bucket count and size; every file path resolves', 'unknown', `${paths.length} receipt path(s) in the register but no storage listing in the dump.`)
    else if (paths.length === 0 && objs.length === 0) add(11, 'gst-receipts bucket count and size; every file path resolves', 'unknown', 'No receipt paths and no storage listing.')
    else add(11, 'gst-receipts bucket count and size; every file path resolves', missing.length ? 'adjusted' : 'confirmed', `${objs.length} object(s), ${bytes} bytes; ${paths.length} register path(s); ${missing.length} unresolved${missing.length ? ` (${list(missing, 3)})` : ''}. Files over 5 MB are not attached.`)
  }

  // 12. documents, extra database objects
  {
    const docs = count('documents')
    const trig = (detail('triggers') as { table: string; name: string }[] | undefined)?.map(t => `${t.table}.${t.name}`)
    const fns = detail('functions') as string[] | undefined
    const views = detail('views') as string[] | undefined
    const cron = detail('cron') as { name: string }[] | undefined
    if (!dump.catalog) add(12, 'documents is empty; no live triggers, functions, views or cron jobs outside the repo', 'unknown', `documents has ${docs} row(s) in the dump, but there is no catalog (the dump was not made with dump.sql): list the triggers, functions, views and cron jobs by hand.`)
    else {
      const extras = [trig?.length ? `triggers: ${list(trig)}` : '', fns?.length ? `functions: ${list(fns, 10)}` : '', views?.length ? `views: ${list(views)}` : '', cron?.length ? `cron: ${list(cron.map(c => c.name))}` : ''].filter(Boolean)
      add(12, 'documents is empty; no live triggers, functions, views or cron jobs outside the repo', docs === 0 && extras.length === 0 ? 'confirmed' : 'adjusted', `documents has ${docs} row(s). ${extras.length ? `Objects present, compare each with the old repo's migrations: ${extras.join('; ')}.` : 'No triggers, functions, views or cron jobs.'}`)
    }
  }

  // 13. users
  {
    const u = T('users')
    const prov = detail('auth_providers') as Record<string, number> | undefined
    const roles = new Map<string, number>()
    for (const r of u) roles.set(str(r, 'role') ?? '(none)', (roles.get(str(r, 'role') ?? '(none)') ?? 0) + 1)
    const nonEmail = prov ? Object.keys(prov).filter(k => k !== 'email') : []
    if (u.length === 0) add(13, 'Number of users, roles, and no non-email login providers', 'unknown', 'No users in the dump.')
    else add(13, 'Number of users, roles, and no non-email login providers', nonEmail.length ? 'adjusted' : prov ? 'confirmed' : 'unknown', `${u.length} user(s) (${[...roles].map(([k, v]) => `${k} ${v}`).join(', ')}). ${prov ? `Login providers: ${Object.entries(prov).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}.` : 'No auth catalog in the dump: check providers in the dashboard.'}`)
  }

  // 14. names
  {
    const cn = new Set([...T('clients'), ...T('prospects')].map(r => normName(r['company_name'])).filter(Boolean))
    const vn = T('vendors').map(r => str(r, 'name')).filter((x): x is string => x !== null)
    const comp = vn.filter(n => /[()]|\bvia\b|\//i.test(n))
    add(14, 'Distinct client and vendor names, to build the merge and parse lists', cn.size + vn.length ? 'confirmed' : 'unknown', `${cn.size} distinct customer name(s), ${vn.length} vendor(s), ${comp.length} vendor name(s) that look composite and need a vendor_parse.csv line${comp.length ? `: ${list(comp, 4)}` : ''}.`)
  }

  // 15 and 16. GST rounding and rate
  {
    const g = T('gst_invoices').filter(r => (num(r['amount']) ?? 0) > 0 && (num(r['gst_amount']) ?? 0) > 0)
    let exact = 0
    let off = 0
    const rate: string[] = []
    for (const r of g) {
      const gross = num(r['amount'])!
      const tax = num(r['gst_amount'])!
      if (Math.abs(tax - Math.round((gross * 18) / 118)) <= 0.5) exact++
      else if (Math.abs(tax - (gross * 18) / 118) > 2) {
        off++
        rate.push(`${str(r, 'gst_invoice_number') ?? str(r, 'id')} (${money(((tax / (gross - tax)) * 100))}%)`)
      }
    }
    if (g.length === 0) {
      add(15, 'GST rounding of the net-proven invoices (per line or per invoice)', 'unknown', 'No GST rows with an amount.')
      add(16, 'No GST other than 18% or 0', 'unknown', 'No GST rows with an amount.')
    } else {
      add(15, 'GST rounding of the net-proven invoices (per line or per invoice)', 'confirmed', `${exact} of ${g.length} invoices equal round(amount x 18/118) to the rupee: the old app rounds once per invoice, from an amount that includes GST.`)
      add(16, 'No GST other than 18% or 0', off === 0 ? 'confirmed' : 'adjusted', off === 0 ? `All ${g.length} invoices are within Rs 2 of 18%.` : `${off} invoice(s) are not 18%: ${list(rate)}. Items import at 18%; correct those invoices' lines after import.`)
    }
  }

  // 17. Postgres version
  {
    const v = /PostgreSQL (\d+)/.exec(String(dump.meta['postgres'] ?? ''))
    if (!v) add(17, 'Postgres version at least 15 on the new project', 'unknown', 'The dump has no version; this is about the NEW project (check Settings, Infrastructure).')
    else add(17, 'Postgres version at least 15 on the new project', 'unknown', `The old project runs PostgreSQL ${v[1]}. The assumption is about the new project: check it in its dashboard (CI runs the same migrations on the local stack).`)
  }

  // 18. free tier slot
  add(18, 'Free-tier project slot available; Edge Function secrets list carried over', 'unknown', 'Not in the dump. The owner checks the dashboard: two projects at most (old and new), and writes down ALLOWED_ORIGINS and the other Edge Function secret names (not values).')

  // 19. fully paid orders against invoice gross
  {
    const gstBy = new Map<string, { gross: number }>()
    for (const g of T('gst_invoices')) {
      const k = str(g, 'order_id')
      if (k) gstBy.set(k, { gross: money((gstBy.get(k)?.gross ?? 0) + (num(g['amount']) ?? 0)) })
    }
    const paid = new Map<string, number>()
    for (const p of T('order_payments')) {
      const k = str(p, 'order_id')
      if (k) paid.set(k, money((paid.get(k) ?? 0) + (num(p['amount']) ?? 0)))
    }
    const cand = T('orders').filter(o => str(o, 'status') === 'payment_received' && gstBy.has(String(o['id'])) && paid.has(String(o['id'])))
    const short = cand.filter(o => Math.abs(paid.get(String(o['id']))! - gstBy.get(String(o['id']))!.gross) > 1)
    if (cand.length === 0) add(19, 'Fully paid orders: payments equal invoice gross within Rs 1', 'unknown', 'No order is both marked payment_received and has a GST invoice and payment rows.')
    else add(19, 'Fully paid orders: payments equal invoice gross within Rs 1', short.length ? 'adjusted' : 'confirmed', `${cand.length} order(s) checked; ${short.length} differ${short.length ? ` (${list(short.map(o => str(o, 'customer_po_number') ?? String(o['id'])))}): reconciliation items, not a model change` : ''}.`)
  }

  // 20. PO 000001
  {
    const hits = T('orders').filter(o => normPo(o['customer_po_number']) === '000001')
    const ids = new Set(hits.map(o => String(o['id'])))
    const inv = T('gst_invoices').filter(g => ids.has(String(g['order_id']))).length + T('invoices').filter(g => ids.has(String(g['order_id']))).length + hits.filter(o => str(o, 'invoice_number')).length
    const pay = T('order_payments').filter(p => ids.has(String(p['order_id']))).length
    const exp = T('expenses').filter(e => ids.has(String(e['order_id']))).length + T('supplier_payments').filter(p => ids.has(String(p['order_id']))).length
    if (!has('orders')) add(20, 'PO 000001 Unit A and B: find every row of both units', 'unknown', 'No orders in the dump.')
    else add(20, 'PO 000001 Unit A and B: find every row of both units', hits.length === 2 ? 'confirmed' : 'adjusted', `${hits.length} order(s) carry PO 000001; ${inv} invoice row(s), ${pay} payment(s), ${exp} expense or supplier payment row(s) hang off them (all move to the merged order).${hits.length === 2 ? '' : ' The merge expects exactly two: check the PO number spelling and po_clashes.csv.'}`)
  }

  // 21. quarterly targets
  {
    const q = T('quarterly_targets')
    add(21, 'quarterly_targets row count and contents (archived only)', has('quarterly_targets') ? 'confirmed' : 'unknown', has('quarterly_targets') ? `${q.length} row(s)${q.length ? `: ${list(q.map(r => `${String(r['year'])} Q${String(r['quarter'])} = ${String(r['target_value'])}`))}` : ''}. Dropped; the admin enters per-person targets at cutover.` : 'Table not in the dump.')
  }

  // 22. owner reliability
  {
    const own = new Map<string, number>()
    let n = 0
    for (const r of [...T('rfqs'), ...T('orders')]) {
      const k = str(r, 'assigned_to') ?? str(r, 'sales_person_id')
      n++
      if (k) own.set(k, (own.get(k) ?? 0) + 1)
    }
    const top = [...own].sort((a, b) => b[1] - a[1])[0]
    const name = top ? (str(T('users').find(u => u['id'] === top[0]) ?? {}, 'name') ?? top[0]) : null
    if (n === 0) add(22, 'How reliable orders.sales_person_id is', 'unknown', 'No RFQs or orders.')
    else add(22, 'How reliable orders.sales_person_id is', 'adjusted', `${top ? `${name} owns ${top[1]} of ${n} RFQs and orders (${Math.round((top[1] / n) * 100)}%)` : 'No owners recorded'}. Owner rule: nobody gets credit for old sales; imported payments carry no credited user, so reliability does not affect targets.`)
  }

  // 23. received_at
  {
    const q = T('supplier_quotes').filter(r => str(r, 'received_at') && str(r, 'created_at'))
    const same = q.filter(r => {
      const a = parseLegacyDate(r['received_at']).date
      const b = parseLegacyDate(r['created_at']).date
      return a !== null && a === b
    }).length
    if (q.length === 0) add(23, 'supplier_quotes.received_at holds real reply dates', 'unknown', 'No quotes with both received_at and created_at.')
    else add(23, 'supplier_quotes.received_at holds real reply dates', 'adjusted', `${same} of ${q.length} quotes have received_at on the same day they were typed in. The old screen stamps received_at when the quote is entered, so it is the entry time, not the supplier's reply: not imported as a reply date; legacy lines stay out of reply-time medians.`)
  }

  // 24. exchange-rate source
  add(24, 'open.er-api.com terms allow a nightly server-side fetch; its PKR rate is within 2% of the bank rate', 'unknown', 'Not in the dump. Read the provider terms and compare one week of rates by hand.')

  return out.sort((a, b) => a.n - b.n)
}

export function renderChecklist(items: ChecklistItem[]): string {
  const tally = { confirmed: 0, adjusted: 0, unknown: 0 }
  for (const i of items) tally[i.verdict]++
  return [
    '# I06 assumption checklist (DATA_MODEL section 8)',
    '',
    `${tally.confirmed} confirmed, ${tally.adjusted} adjusted, ${tally.unknown} unknown.`,
    '',
    ...items.flatMap(i => [`${String(i.n).padStart(2, ' ')}. [${i.verdict.toUpperCase()}] ${i.assumption}`, `      ${i.evidence}`]),
    '',
  ].join('\n')
}
