import { parseLegacyDate } from '../lib/dates'
import { legacyId, uuidv5 } from '../lib/ids'
import { clean, money, normName, num, str } from '../lib/text'
import type { Row } from '../lib/text'
import type { NewRow, StorageCopy } from '../types'
import type { CompanyBook } from './companies'
import type { Ctx } from './context'
import type { Ledger } from './ledger'
import type { OrderGroup, OrderOutput } from './orders'

// I05: invoices (GST register, bookkeeping invoices, orders.invoice_number), payments, expenses, recurring, receipt files.

export interface MoneyOutput {
  invoices: NewRow[]
  attachments: NewRow[]
  payments_in: NewRow[]
  expenses: NewRow[]
  recurring_expenses: NewRow[]
  storageCopies: StorageCopy[]
  /** new order id -> Σ invoice net, for the order/invoice reconciliation */
  invoiceNetByOrder: Map<string, number>
}

/** The categories migration 0025 seeds. A legacy category with exactly one of these names needs no mapping row. */
export const SEEDED_CATEGORY_NAMES = [
  'Salaries',
  'Rent',
  'Utilities',
  'Fuel & travel',
  'Office supplies & snacks',
  'Courier & postage',
  'Repairs & maintenance',
  'Bank charges',
  'Taxes & fees',
  'Other',
  'Supplier payment',
  'Freight',
  'Clearing',
  'Commissioning',
  'Subcontractor',
  'Owner drawings',
  'Loan repayment',
]
export const FALLBACK_CATEGORY = 'Other'
export const SUPPLIER_PAYMENT_CATEGORY = 'Supplier payment'

const FBR_GENERATED = new Set(['generated', 'fully generated', 'receipt received', 'deposited'])
const MAX_ATTACHMENT_BYTES = 5_242_880

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
}

function fileName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path
}
function ext(path: string): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(path)
  return m ? m[1]!.toLowerCase() : 'bin'
}

export function transformMoney(ctx: Ctx, book: CompanyBook, orders: OrderOutput, ledger: Ledger): MoneyOutput {
  const out: MoneyOutput = {
    invoices: [],
    attachments: [],
    payments_in: [],
    expenses: [],
    recurring_expenses: [],
    storageCopies: [],
    invoiceNetByOrder: new Map(),
  }
  const orderRowById = new Map(ctx.rows('orders').map(r => [String(r['id']), r]))
  const storage = new Map(ctx.dump.storage.map(o => [`${o.bucket}/${o.path}`, o]))
  const usedNumbers = new Set<string>()

  // ---------------------------------------------------------------- categories
  const seeded = new Map(SEEDED_CATEGORY_NAMES.map(n => [normName(n), n]))
  const categoryOf = (legacy: string | null): { name: string; unmapped: boolean } => {
    const key = normName(legacy)
    const mapped = ctx.maps.expenseCategories.get(key) ?? seeded.get(key)
    return mapped ? { name: mapped, unmapped: false } : { name: FALLBACK_CATEGORY, unmapped: true }
  }

  // ---------------------------------------------------------------- invoices
  const gstOldOrders = new Set(ctx.rows('gst_invoices').map(g => str(g, 'order_id')).filter((x): x is string => x !== null))

  const claimNumber = (raw: string | null, flags: string[], table: string, oldId: string): string | null => {
    if (raw === null) {
      flags.push('number_missing')
      return null
    }
    const key = raw.toLowerCase()
    if (usedNumbers.has(key)) {
      flags.push('number_duplicate')
      ctx.addReview('dropped_rows', table, oldId, raw, 'invoice number already used by another invoice: imported without a number (see legacy_source)')
      return null
    }
    usedNumbers.add(key)
    return raw
  }

  const dateOrFlag = (r: Row, col: string, table: string, label: string, flags: string[]): string | null => {
    const p = parseLegacyDate(r[col])
    if (p.status === 'invalid') {
      flags.push('invalid_date')
      ctx.addReview('unparseable_dates', table, String(r['id'] ?? r['invoice_id'] ?? r['payment_id'] ?? r['expense_id']), label, `${col} = "${String(r[col])}"`)
    }
    return p.date
  }

  const pushInvoice = (group: OrderGroup | null, companyId: string | null, row: NewRow): void => {
    row['order_id'] = group?.newId ?? null
    row['company_id'] = group ? null : companyId
    out.invoices.push(row)
    ledger.add('invoiceNet', 'neu', Number(row['net_amount']))
    ledger.add('invoiceGst', 'neu', Number(row['gst_amount']))
    if (group) out.invoiceNetByOrder.set(group.newId, money((out.invoiceNetByOrder.get(group.newId) ?? 0) + Number(row['net_amount'])))
  }

  // 1. gst_invoices -> invoices (+ receipt attachments)
  for (const g of ctx.rows('gst_invoices')) {
    const oldId = String(g['id'])
    // The old register shows `amount` as "Amount (incl GST)" and the net as amount - gst_amount (GstRegisterPage.tsx).
    const tax = num(g['gst_amount']) ?? 0
    const net = money((num(g['amount']) ?? 0) - tax)
    ledger.add('invoiceNet', 'old', net)
    ledger.add('invoiceGst', 'old', tax)
    const flags: string[] = []
    const label = str(g, 'gst_invoice_number') ?? oldId

    const group = str(g, 'order_id') !== null ? (orders.byOldId.get(str(g, 'order_id')!) ?? null) : null
    let companyId: string | null = null
    if (!group && str(g, 'client_name') !== null) {
      companyId = book.byCustomerName(str(g, 'client_name')!).companyId
      flags.push('company_from_name')
    }
    if (!group && companyId === null) {
      ctx.drop('gst_invoices', oldId, label, 'not linked to an imported order and no client name')
      ledger.add('invoiceNet', 'excluded', net)
      ledger.add('invoiceGst', 'excluded', tax)
      continue
    }
    if (net < 0 || tax < 0 || tax > net) {
      ctx.drop('gst_invoices', oldId, label, `amounts do not fit the new rules (net ${net}, GST ${tax}: GST must be between 0 and net)`)
      ledger.add('invoiceNet', 'excluded', net)
      ledger.add('invoiceGst', 'excluded', tax)
      continue
    }

    const status = (str(g, 'fbr_status') ?? 'Pending').toLowerCase()
    const psid = str(g, 'psid')
    const wasifOn = dateOrFlag(g, 'wasif_receipt_date', 'gst_invoices', label, flags)
    const depositedOn = dateOrFlag(g, 'tax_deposit_date', 'gst_invoices', label, flags)
    const invoiceDate = dateOrFlag(g, 'invoice_date', 'gst_invoices', label, flags)
    const copyOn = dateOrFlag(g, 'received_date', 'gst_invoices', label, flags)
    const tcsSent = dateOrFlag(g, 'tcs_sent_date', 'gst_invoices', label, flags)
    const clientOn = dateOrFlag(g, 'client_received_date', 'gst_invoices', label, flags)
    if (invoiceDate === null) flags.push('invoice_date_missing')

    // fbr_status mapping (DATA_MODEL section 7)
    if (FBR_GENERATED.has(status) && psid === null) flags.push('fbr_generated_legacy')
    const wasifBool = g['wasif_receipt_received'] === true
    const problems: string[] = []
    if (status === 'pending' && (wasifOn || depositedOn)) problems.push('status is Pending but a receipt or deposit date is set')
    if ((status === 'generated' || status === 'fully generated') && (wasifOn || depositedOn)) problems.push('status says only Generated but a later date is set')
    if (status === 'receipt received' && !wasifOn) problems.push('status is Receipt Received but there is no receipt date')
    if (status === 'receipt received' && depositedOn) problems.push('status is Receipt Received but a deposit date is set')
    if (status === 'deposited' && !depositedOn) problems.push('status is Deposited but there is no deposit date')
    if (wasifBool && !wasifOn) problems.push('receipt marked received but there is no receipt date')
    if (problems.length) {
      flags.push('fbr_status_mismatch')
      ctx.addReview('fbr_mismatches', 'gst_invoices', oldId, label, problems.join('; '))
    }
    const tcsReceiptDate = parseLegacyDate(g['tcs_receipt_date'])
    if (tcsReceiptDate.date !== null && tcsReceiptDate.date !== tcsSent) flags.push('tcs_receipt_date_differs')

    const bank = str(g, 'tax_deposit_bank')
    const notes = [str(g, 'notes'), bank ? `Deposit bank: ${bank}` : null].filter(Boolean).join('\n') || null

    const id = legacyId('invoice', `gst:${oldId}`)
    const row: NewRow = {
      id,
      ...(clean(g['created_at']) && parseLegacyDate(g['created_at']).status === 'ok' ? { created_at: clean(g['created_at']) } : {}),
      number: claimNumber(str(g, 'gst_invoice_number'), flags, 'gst_invoices', oldId),
      invoice_date: invoiceDate,
      net_amount: net,
      gst_amount: tax,
      copy_received_on: copyOn,
      tcs_sent_on: tcsSent,
      tcs_number: str(g, 'tcs_receipt_number'),
      client_received_on: clientOn,
      psid,
      wasif_receipt_on: wasifOn,
      tax_deposited_on: depositedOn,
      tax_deposit_amount: num(g['tax_deposit_amount']) && num(g['tax_deposit_amount'])! > 0 ? num(g['tax_deposit_amount']) : null,
      notes,
      legacy_flags: [...new Set(flags)].sort(),
      legacy_source: { table: 'gst_invoices', row: g },
    }
    pushInvoice(group, companyId, row)

    // wasif_receipt_file_path -> attachment (+ the file to copy)
    const path = str(g, 'wasif_receipt_file_path')
    if (path !== null) {
      const meta = storage.get(`gst-receipts/${path}`)
      if (!meta) {
        ctx.addReview('storage_missing', 'gst_invoices', oldId, label, `receipt file "${path}" is not in the dump's storage listing; no attachment made`)
      } else if (meta.size_bytes > MAX_ATTACHMENT_BYTES) {
        ctx.addReview('storage_missing', 'gst_invoices', oldId, label, `receipt file "${path}" is ${meta.size_bytes} bytes, over the 5 MB limit; no attachment made`)
      } else {
        const toPath = `${id}/${uuidv5(`receipt:${path}`)}.${ext(path)}`
        out.attachments.push({
          id: legacyId('attachment', `gst:${oldId}`),
          bucket: 'gst-receipts',
          path: toPath,
          file_name: fileName(path),
          mime_type: meta.mime_type || MIME[ext(path)] || 'application/octet-stream',
          size_bytes: meta.size_bytes,
          rfq_id: null,
          clarification_id: null,
          invoice_id: id,
          expense_id: null,
          order_id: null,
        })
        out.storageCopies.push({ fromBucket: 'gst-receipts', fromPath: path, toBucket: 'gst-receipts', toPath, invoiceId: id })
      }
    }
  }

  const paymentsByOldOrder = new Map<string, number>()
  for (const p of ctx.rows('order_payments')) {
    const k = str(p, 'order_id')
    if (k !== null) paymentsByOldOrder.set(k, money((paymentsByOldOrder.get(k) ?? 0) + (num(p['amount']) ?? 0)))
  }

  // 2. bookkeeping invoices, only where the order has no GST row and no orders.invoice_number
  for (const inv of ctx.rows('invoices')) {
    const oldId = String(inv['invoice_id'] ?? inv['id'])
    const amount = num(inv['invoice_amount']) ?? 0
    ledger.add('invoiceNet', 'old', amount)
    const oldOrder = str(inv, 'order_id')
    const label = str(inv, 'invoice_number') ?? oldId
    const orderRow = oldOrder !== null ? orderRowById.get(oldOrder) : undefined
    if (oldOrder !== null && (gstOldOrders.has(oldOrder) || (orderRow && str(orderRow, 'invoice_number') !== null))) {
      ctx.addReview('dropped_rows', 'invoices', oldId, label, 'the order already has a GST register row or an invoice number on the order: not imported twice')
      ledger.add('invoiceNet', 'excluded', amount)
      continue
    }
    const group = oldOrder !== null ? (orders.byOldId.get(oldOrder) ?? null) : null
    const clientId = str(inv, 'client_id')
    const companyId = !group && clientId !== null ? (book.clients.get(clientId)?.companyId ?? null) : null
    if (!group && companyId === null) {
      ctx.drop('invoices', oldId, label, 'not linked to an imported order or client')
      ledger.add('invoiceNet', 'excluded', amount)
      continue
    }
    // "Check whether this amount includes GST" is asked only of invoices tied to an order (customer PO).
    // An invoice with no order link imports without it; legacy_source keeps it traceable.
    const flags = group ? ['invoice_basis_unknown'] : []
    const invoiceDate = dateOrFlag(inv, 'issued_date', 'invoices', label, flags)
    if (invoiceDate === null) flags.push('invoice_date_missing')
    // amount_paid is NOT turned into payments; it is flagged when the payments we do have disagree.
    const paidOld = num(inv['amount_paid']) ?? 0
    const paidRows = oldOrder !== null ? (paymentsByOldOrder.get(oldOrder) ?? 0) : 0
    if (Math.abs(paidOld - paidRows) > 1) {
      flags.push('paid_per_old_invoice')
      ctx.addReview('dropped_rows', 'invoices', oldId, label, `old invoice says ${paidOld} paid, payment rows total ${paidRows}: no payment invented`)
    }
    const id = legacyId('invoice', `inv:${oldId}`)
    pushInvoice(group, companyId, {
      id,
      number: claimNumber(str(inv, 'invoice_number'), flags, 'invoices', oldId),
      invoice_date: invoiceDate,
      net_amount: Math.max(amount, 0),
      gst_amount: 0,
      notes: str(inv, 'notes'),
      legacy_flags: [...new Set(flags)].sort(),
      legacy_source: { table: 'invoices', row: inv },
    })
  }

  // 3. orders.invoice_number / invoice_date, where there is no GST row for that old order
  for (const [oldId, r] of orderRowById) {
    const number = str(r, 'invoice_number')
    if (number === null || gstOldOrders.has(oldId)) continue
    const group = orders.byOldId.get(oldId)
    const value = num(r['order_value']) ?? 0
    ledger.add('invoiceNet', 'old', value)
    if (!group) {
      ledger.add('invoiceNet', 'excluded', value)
      continue
    }
    const flags = ['invoice_basis_unknown']
    const invoiceDate = dateOrFlag(r, 'invoice_date', 'orders', number, flags)
    if (invoiceDate === null) flags.push('invoice_date_missing')
    pushInvoice(group, null, {
      id: legacyId('invoice', `order:${oldId}`),
      number: claimNumber(number, flags, 'orders', oldId),
      invoice_date: invoiceDate,
      net_amount: Math.max(value, 0),
      gst_amount: 0,
      legacy_flags: [...new Set(flags)].sort(),
      legacy_source: { table: 'orders', row: r },
    })
  }

  // ---------------------------------------------------------------- payments_in
  const seenPayment = new Set<string>() // group|amount|date, to spot payment_records that repeat an order_payments row
  // TODO(owner decision, later): who gets credit for old sales. Until then NOBODY does: credited_user_id is NULL on every
  // imported payment, so no legacy payment counts toward anyone's target (v_payment_net: excluded_reason 'unattributed').
  // The admin can assign credit afterwards; this run must not guess it.

  const addPayment = (table: 'order_payments' | 'payment_records', r: Row, oldId: string, group: OrderGroup | null, extraFlag: string | null): void => {
    const amount = num(r['amount']) ?? 0
    ledger.add('payments', 'old', amount)
    const label = str(r, 'reference') ?? oldId
    if (!group) {
      ctx.drop(table, oldId, label, 'not linked to an imported order')
      ledger.add('payments', 'excluded', amount)
      return
    }
    if (amount <= 0) {
      ctx.drop(table, oldId, label, `amount is ${amount} (must be above zero)`)
      ledger.add('payments', 'excluded', amount)
      return
    }
    const flags: string[] = extraFlag ? [extraFlag] : []
    let receivedOn = dateOrFlag(r, 'payment_date', table, label, flags)
    if (receivedOn === null) {
      receivedOn = parseLegacyDate(r['created_at']).date ?? ctx.opts.asOf
      flags.push('received_date_estimated')
    }
    if (table === 'payment_records') {
      if (seenPayment.has(`${group.newId}|${amount}|${receivedOn}`)) {
        ctx.drop(table, oldId, label, 'repeats a row already in order_payments')
        ledger.add('payments', 'excluded', amount)
        return
      }
    } else seenPayment.add(`${group.newId}|${amount}|${receivedOn}`)
    ledger.add('payments', 'neu', amount)
    out.payments_in.push({
      id: legacyId('payment', `${table}:${oldId}`),
      ...(clean(r['created_at']) && parseLegacyDate(r['created_at']).status === 'ok' ? { created_at: clean(r['created_at']) } : {}),
      order_id: group.newId,
      received_on: receivedOn,
      amount,
      credited_user_id: null,
      reference: str(r, 'reference') ?? str(r, 'notes'),
      // A payment the old system holds is a payment received. Always bank: the old payment_method (even "Cash") stays in
      // legacy_source and is not flagged.
      paid_via: 'bank',
      bank_month: null,
      legacy_flags: [...new Set(flags)].sort(),
      legacy_source: { table, row: r },
    })
  }

  for (const p of ctx.rows('order_payments')) {
    addPayment('order_payments', p, String(p['id']), orders.byOldId.get(String(p['order_id'])) ?? null, null)
  }
  // payment_records is dead (no page reads it): imported only where order_payments does not already hold the payment.
  const invoiceOrder = new Map(ctx.rows('invoices').map(i => [String(i['invoice_id'] ?? i['id']), str(i, 'order_id')]))
  for (const p of ctx.rows('payment_records')) {
    const oldOrder = invoiceOrder.get(String(p['invoice_id'])) ?? null
    addPayment('payment_records', p, String(p['payment_id'] ?? p['id']), oldOrder !== null ? (orders.byOldId.get(oldOrder) ?? null) : null, 'from_payment_records')
  }

  // ---------------------------------------------------------------- recurring_expenses
  const recurringIds = new Map<string, string>()
  for (const rec of ctx.rows('recurring_expenses')) {
    const oldId = String(rec['id'])
    const amount = num(rec['amount']) ?? 0
    if (amount <= 0) {
      ctx.drop('recurring_expenses', oldId, str(rec, 'label') ?? oldId, `amount is ${amount} (must be above zero)`)
      continue
    }
    const cat = categoryOf(str(rec, 'category'))
    if (cat.unmapped) ctx.addReview('category_unmapped', 'recurring_expenses', oldId, str(rec, 'label') ?? oldId, `legacy category "${str(rec, 'category') ?? ''}" -> ${cat.name}`)
    const dom = num(rec['day_of_month'])
    const sm = str(rec, 'start_month')
    const id = legacyId('recurring', oldId)
    recurringIds.set(oldId, id)
    out.recurring_expenses.push({
      id,
      ...(clean(rec['created_at']) && parseLegacyDate(rec['created_at']).status === 'ok' ? { created_at: clean(rec['created_at']) } : {}),
      label: str(rec, 'label') ?? '(no label)',
      _category: cat.name,
      amount,
      day_of_month: dom !== null && dom >= 1 && dom <= 28 ? Math.round(dom) : null,
      active: rec['active'] !== false,
      start_month: sm !== null && /^\d{4}-(0[1-9]|1[0-2])$/.test(sm) ? sm : null,
      notes: str(rec, 'notes'),
    })
  }

  // ---------------------------------------------------------------- expenses
  const seenRecurring = new Set<string>()
  const legSupplierOf = (group: OrderGroup, oldOrderId: string): { legId: string | null; supplierId: string | null } => {
    if (group.legs.length === 1) return { legId: group.legs[0]!.id, supplierId: group.legs[0]!.supplierId }
    const vendor = str(orderRowById.get(oldOrderId) ?? {}, 'vendor_id')
    const supplier = vendor !== null ? book.vendors.get(vendor) : undefined
    const leg = group.legs.find(l => l.supplierId === supplier)
    return { legId: leg?.id ?? null, supplierId: leg?.supplierId ?? supplier ?? null }
  }

  const addExpense = (
    table: 'expenses' | 'supplier_payments' | 'payable_payments',
    r: Row,
    oldId: string,
    spec: { categoryName: string; legacyCategory: string | null; dateCol: string; extraFlags: string[] },
  ): void => {
    const amount = num(r['amount']) ?? 0
    const cat = table === 'expenses' ? categoryOf(spec.legacyCategory) : { name: spec.categoryName, unmapped: false }
    const catKey = `expense:${cat.name}`
    ledger.add(catKey, 'old', amount)
    ledger.add('expensesTotal', 'old', amount)
    const label = str(r, 'description') ?? str(r, 'reference') ?? oldId
    if (amount <= 0) {
      ctx.drop(table, oldId, label, `amount is ${amount} (must be above zero)`)
      ledger.add(catKey, 'excluded', amount)
      ledger.add('expensesTotal', 'excluded', amount)
      return
    }
    const flags = [...spec.extraFlags]
    if (cat.unmapped) {
      flags.push('category_unmapped')
      ctx.addReview('category_unmapped', table, oldId, label, `legacy category "${spec.legacyCategory ?? ''}" -> ${cat.name}`)
    }
    let paidOn = dateOrFlag(r, spec.dateCol, table, label, flags)
    if (paidOn === null) {
      paidOn = parseLegacyDate(r['created_at']).date ?? ctx.opts.asOf
      if (!flags.includes('invalid_date')) flags.push('paid_date_estimated')
    }

    const oldOrder = str(r, 'order_id')
    let orderId: string | null = null
    let legId: string | null = null
    let payee: string | null = str(r, 'vendor_id') !== null ? (book.vendors.get(str(r, 'vendor_id')!) ?? null) : null
    if (oldOrder !== null) {
      const group = orders.byOldId.get(oldOrder)
      if (group) {
        orderId = group.newId
        if (table === 'supplier_payments') {
          const ls = legSupplierOf(group, oldOrder)
          legId = ls.legId
          payee = ls.supplierId
        }
      } else flags.push('order_missing')
    }

    let recurringId: string | null = null
    let period: string | null = null
    if (table === 'expenses' && str(r, 'recurring_id') !== null && recurringIds.has(str(r, 'recurring_id')!)) {
      period = str(r, 'period')
      const k = `${str(r, 'recurring_id')}|${period}`
      if (period !== null && /^\d{4}-(0[1-9]|1[0-2])$/.test(period) && !seenRecurring.has(k)) {
        seenRecurring.add(k)
        recurringId = recurringIds.get(str(r, 'recurring_id')!)!
      } else {
        period = null
        flags.push('recurring_period_duplicate')
      }
    }

    const notes = str(r, 'notes')
    const description = [str(r, 'description'), notes && notes !== str(r, 'description') ? notes : null].filter(Boolean).join(' - ') || null
    ledger.add(catKey, 'neu', amount)
    ledger.add('expensesTotal', 'neu', amount)
    out.expenses.push({
      id: legacyId('expense', `${table}:${oldId}`),
      ...(clean(r['created_at']) && parseLegacyDate(r['created_at']).status === 'ok' ? { created_at: clean(r['created_at']) } : {}),
      paid_on: paidOn,
      amount_pkr: amount,
      _category: cat.name,
      // Legacy rows are a bank payment that has not been ticked against a statement (bank_month stays empty).
      paid_via: 'bank',
      input_tax_pkr: 0,
      bank_month: null,
      description,
      order_id: orderId,
      supplier_order_id: legId,
      payee_id: payee,
      reference: str(r, 'reference') ?? str(r, 'reference_number'),
      recurring_id: recurringId,
      period,
      legacy_flags: [...new Set(flags)].sort(),
      legacy_source: { table, row: r },
    })
  }

  for (const e of ctx.rows('expenses')) {
    addExpense('expenses', e, String(e['expense_id'] ?? e['id']), {
      categoryName: '',
      legacyCategory: str(e, 'category'),
      dateCol: 'date',
      extraFlags: [],
    })
  }
  for (const sp of ctx.rows('supplier_payments')) {
    addExpense('supplier_payments', sp, String(sp['id']), { categoryName: SUPPLIER_PAYMENT_CATEGORY, legacyCategory: null, dateCol: 'payment_date', extraFlags: [] })
  }

  // payable_payments become expenses unless a supplier_payments row already records the same payment.
  const payableById = new Map(ctx.rows('payables').map(p => [String(p['payable_id'] ?? p['id']), p]))
  const supplierPayKeys = ctx.rows('supplier_payments').map(sp => ({
    amount: num(sp['amount']) ?? 0,
    date: parseLegacyDate(sp['payment_date']).date,
    id: String(sp['id']),
    supplier: orders.byOldId.get(String(sp['order_id']))?.legs.map(l => l.supplierId) ?? [],
  }))
  for (const pp of ctx.rows('payable_payments')) {
    const oldId = String(pp['payment_id'] ?? pp['id'])
    const payable = payableById.get(String(pp['payable_id']))
    const vendorCompany = payable && str(payable, 'vendor_id') !== null ? (book.vendors.get(str(payable, 'vendor_id')!) ?? null) : null
    const amount = num(pp['amount']) ?? 0
    const date = parseLegacyDate(pp['payment_date']).date
    const twin = supplierPayKeys.find(
      k => k.amount === amount && k.date !== null && k.date === date && (vendorCompany === null || k.supplier.length === 0 || k.supplier.includes(vendorCompany)),
    )
    if (twin) {
      ledger.add('expense:' + SUPPLIER_PAYMENT_CATEGORY, 'old', amount)
      ledger.add('expensesTotal', 'old', amount)
      ledger.add('expense:' + SUPPLIER_PAYMENT_CATEGORY, 'excluded', amount)
      ledger.add('expensesTotal', 'excluded', amount)
      ctx.drop('payable_payments', oldId, str(pp, 'reference_number') ?? oldId, `same payment as supplier_payments row ${twin.id}: counted once`)
      continue
    }
    const flags = ['from_payable_payment']
    if (payable && str(payable, 'linked_expense_id') !== null) {
      flags.push('possible_double_count_linked_expense')
      ctx.addReview(
        'cost_double_counts',
        'payable_payments',
        oldId,
        str(pp, 'reference_number') ?? oldId,
        `the payable is linked to expense ${String(payable['linked_expense_id'])}: the same cost may be counted in both`,
      )
    }
    addExpense('payable_payments', { ...pp, vendor_id: payable ? payable['vendor_id'] : null }, oldId, {
      categoryName: vendorCompany ? SUPPLIER_PAYMENT_CATEGORY : FALLBACK_CATEGORY,
      legacyCategory: null,
      dateCol: 'payment_date',
      extraFlags: flags,
    })
  }

  return out
}
