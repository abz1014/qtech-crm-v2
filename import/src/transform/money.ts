import { addDays, parseLegacyDate } from '../lib/dates'
import { legacyId, uuidv5 } from '../lib/ids'
import { clean, money, normName, num, str } from '../lib/text'
import type { Row } from '../lib/text'
import { normInvoiceNumber } from '../mappings'
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
  /** How many payments_in rows were derived from the old paid status or the owner's list (not from payment rows). */
  paymentsFromStatusCount: number
}

/** One imported invoice, as the payment and still-owed steps need it. */
interface InvoiceInfo {
  id: string
  /** the legacyId key of the invoice ('gst:<old id>', 'inv:<old id>', 'order:<old id>') */
  key: string
  number: string | null
  table: 'gst_invoices' | 'invoices' | 'orders'
  oldId: string
  group: OrderGroup | null
  companyId: string | null
  invoiceDate: string | null
  gross: number
  po: string | null
  /** due dates of the old bookkeeping invoice(s) behind it (itself, or its twins) */
  oldDue: string[]
  /** paid so far: allocated payment rows, payments derived from status, or status-paid amounts that could not be placed */
  paid: number
}

/** A PO number as the matcher compares it: no "PO" prefix, no "#", no spaces, upper case, no trailing punctuation. */
export function normPoToken(v: string): string {
  return v
    .toUpperCase()
    .replace(/[\s#]/g, '')
    .replace(/^P\.?O\.?(?:NO\.?|NUMBER)?:?/, '')
    .replace(/^[:.-]+|[.,;:]+$/g, '')
}

/** The PO numbers in a register cell or an order's PO field: "253074 & 252993 & 254040" gives three. */
export function poTokens(v: string | null): string[] {
  if (v === null) return []
  return [...new Set(v.split(/\s*(?:&|,|;|\+|\/|\band\b)\s*/i).map(normPoToken).filter(Boolean))]
}

/** The PO written in free text: "PO 251809.", "PO# 251809 (Unit A)", "PO# 1 & 2". Not "Position". */
export function poFromNotes(notes: string | null): string | null {
  if (notes === null) return null
  const m = /\bP\.?O(?![a-z])\.?\s*(?:#|no\.?|number)?\s*[:.]?\s*([a-z0-9][a-z0-9\-/]*(?:\s*(?:&|,|\band\b)\s*\d[a-z0-9\-/]*)*)/i.exec(notes)
  return m ? m[1]!.trim() : null
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
    paymentsFromStatusCount: 0,
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

  const orderCompany = new Map(orders.orders.map(o => [String(o['id']), String(o['company_id'])]))
  const infos: InvoiceInfo[] = []
  const pushInvoice = (
    group: OrderGroup | null,
    companyId: string | null,
    row: NewRow,
    meta: { key: string; table: InvoiceInfo['table']; oldId: string; po: string | null; oldDue: string[] },
  ): void => {
    row['order_id'] = group?.newId ?? null
    row['company_id'] = group ? null : companyId
    out.invoices.push(row)
    infos.push({
      id: String(row['id']),
      ...meta,
      number: (row['number'] as string | null) ?? null,
      group,
      companyId: group ? (orderCompany.get(group.newId) ?? null) : companyId,
      invoiceDate: (row['invoice_date'] as string | null) ?? null,
      gross: money(Number(row['net_amount']) + Number(row['gst_amount'])),
      paid: 0,
    })
    ledger.add('invoiceNet', 'neu', Number(row['net_amount']))
    ledger.add('invoiceGst', 'neu', Number(row['gst_amount']))
    if (group) out.invoiceNetByOrder.set(group.newId, money((out.invoiceNetByOrder.get(group.newId) ?? 0) + Number(row['net_amount'])))
  }

  // ---------------------------------------------------------------- the GST register wins (owner decision 2026-10-19)
  // A bookkeeping invoice (old `invoices`) is the same sale as a GST register row when, for the same customer (through the
  // company merge), its PO equals one of the register row's PO numbers. The register row is imported; the bookkeeping
  // invoice is not (dropped_rows + invoice_duplicates.csv, so the owner can check every match).
  interface GstPre {
    row: Row
    oldId: string
    number: string | null
    gross: number
    net: number
    tax: number
    group: OrderGroup | null
    companies: Set<string>
    tokens: Set<string>
    importable: boolean
  }
  const gstPre: GstPre[] = ctx.rows('gst_invoices').map(g => {
    // The old register shows `amount` as "Amount (incl GST)" and the net as amount - gst_amount (GstRegisterPage.tsx).
    const tax = num(g['gst_amount']) ?? 0
    const gross = num(g['amount']) ?? 0
    const net = money(gross - tax)
    const group = str(g, 'order_id') !== null ? (orders.byOldId.get(str(g, 'order_id')!) ?? null) : null
    const client = str(g, 'client_name')
    const companies = new Set<string>()
    if (group) companies.add(orderCompany.get(group.newId)!)
    if (client !== null) companies.add(book.customerCompanyId(client))
    return {
      row: g,
      oldId: String(g['id']),
      number: str(g, 'gst_invoice_number'),
      gross: money(gross),
      net,
      tax,
      group,
      companies,
      tokens: new Set([...poTokens(str(g, 'customer_po_number')), ...poTokens(group?.poNumber ?? null)]),
      importable: (group !== null || client !== null) && !(net < 0 || tax < 0 || tax > net),
    }
  })

  interface BookPre {
    row: Row
    oldId: string
    amount: number
    group: OrderGroup | null
    po: string | null
    status: string
    amountPaid: number
    due: string | null
    twin: GstPre | null
    /** the same PO on a register row of another customer: listed for the owner, not matched */
    nearMiss: GstPre | null
  }
  const bookPre: BookPre[] = ctx.rows('invoices').map(inv => {
    const oldOrder = str(inv, 'order_id')
    const orderRow = oldOrder !== null ? orderRowById.get(oldOrder) : undefined
    const group = oldOrder !== null ? (orders.byOldId.get(oldOrder) ?? null) : null
    const companies = new Set<string>()
    if (group) companies.add(orderCompany.get(group.newId)!)
    const clientId = str(inv, 'client_id')
    const clientCompany = clientId !== null ? book.clients.get(clientId)?.companyId : undefined
    if (clientCompany) companies.add(clientCompany)
    const po = poFromNotes(str(inv, 'notes')) ?? (orderRow ? (str(orderRow, 'customer_po_number') ?? poFromNotes(str(orderRow, 'notes'))) : null)
    const tokens = poTokens(po)
    const candidates = tokens.length ? gstPre.filter(g => g.importable && tokens.some(t => g.tokens.has(t))) : []
    const twin = candidates.find(g => [...g.companies].some(c => companies.has(c))) ?? null
    return {
      row: inv,
      oldId: String(inv['invoice_id'] ?? inv['id']),
      amount: num(inv['invoice_amount']) ?? 0,
      group,
      po,
      status: (str(inv, 'payment_status') ?? '').toLowerCase(),
      amountPaid: num(inv['amount_paid']) ?? 0,
      due: parseLegacyDate(inv['due_date']).date,
      twin,
      nearMiss: twin ? null : (candidates[0] ?? null),
    }
  })
  const twinsOf = new Map<GstPre, BookPre[]>()
  for (const b of bookPre) if (b.twin) twinsOf.set(b.twin, [...(twinsOf.get(b.twin) ?? []), b])
  const gstPreOf = new Map<InvoiceInfo, GstPre>()
  const bookPreById = new Map(bookPre.map(b => [b.oldId, b]))

  // 1. gst_invoices -> invoices (+ receipt attachments)
  for (const pre of gstPre) {
    const g = pre.row
    const oldId = pre.oldId
    const { tax, net } = pre
    ledger.add('invoiceNet', 'old', net)
    ledger.add('invoiceGst', 'old', tax)
    const flags: string[] = []
    const label = str(g, 'gst_invoice_number') ?? oldId

    let group = pre.group
    const twins = twinsOf.get(pre) ?? []
    if (!group && twins.length) {
      // A register row with no order link takes the order of its bookkeeping twin(s), when they all point to one order.
      const twinGroups = [...new Set(twins.map(b => b.group))]
      if (twinGroups.length === 1 && twinGroups[0] !== null) {
        group = twinGroups[0]!
        flags.push('order_from_bookkeeping_twin')
      }
    }
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
    pushInvoice(group, companyId, row, {
      key: `gst:${oldId}`,
      table: 'gst_invoices',
      oldId,
      po: str(g, 'customer_po_number') ?? group?.poNumber ?? null,
      oldDue: twins.map(b => b.due).filter((x): x is string => x !== null),
    })
    gstPreOf.set(infos.at(-1)!, pre)

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

  const recordInvoices = new Set(ctx.rows('payment_records').map(p => str(p, 'invoice_id')).filter((x): x is string => x !== null))

  // 2. bookkeeping invoices: not where the GST register has the same sale, the order has a GST row, or orders.invoice_number
  for (const pre of bookPre) {
    const inv = pre.row
    const oldId = pre.oldId
    const amount = pre.amount
    ledger.add('invoiceNet', 'old', amount)
    const oldOrder = str(inv, 'order_id')
    const label = str(inv, 'invoice_number') ?? oldId
    const orderRow = oldOrder !== null ? orderRowById.get(oldOrder) : undefined
    const dupFields = (g: GstPre, match: string) => ({
      bookkeeping_invoice: label,
      po: pre.po,
      amount,
      gst_invoice: g.number ?? g.oldId,
      gst_gross: g.gross,
      ratio: g.gross ? Math.round((amount / g.gross) * 10000) / 10000 : null,
      match,
    })
    if (pre.twin) {
      const g = pre.twin
      ctx.drop('invoices', oldId, label, `duplicate of GST invoice ${g.number ?? g.oldId}`)
      ctx.addReview(
        'invoice_duplicates',
        'invoices',
        oldId,
        label,
        `same customer and PO as GST invoice ${g.number ?? g.oldId}: the register row is imported, this one is not`,
        dupFields(g, 'duplicate'),
      )
      ledger.add('invoiceNet', 'excluded', amount)
      continue
    }
    if (pre.nearMiss) {
      const g = pre.nearMiss
      ctx.addReview(
        'invoice_duplicates',
        'invoices',
        oldId,
        label,
        `GST invoice ${g.number ?? g.oldId} has the same PO but another customer: NOT treated as a duplicate (both imported). If it is the same customer, add the name to company_merge.csv.`,
        dupFields(g, 'not matched: customer differs'),
      )
    }
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
    // Where the old database holds payment rows for this invoice (or its order), the rows are the payments and amount_paid
    // only flags a disagreement. Without rows, the paid status becomes a payment (below, owner decision 2026-10-19).
    const paidOld = pre.amountPaid
    const paidRows = oldOrder !== null ? (paymentsByOldOrder.get(oldOrder) ?? 0) : 0
    if ((paidRows > 0 || recordInvoices.has(oldId)) && Math.abs(paidOld - paidRows) > 1) {
      flags.push('paid_per_old_invoice')
      ctx.addReview(
        'dropped_rows',
        'invoices',
        oldId,
        label,
        `old invoice says ${paidOld} paid, payment rows total ${paidRows}: the rows are imported, nothing is derived from the status`,
      )
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
    }, { key: `inv:${oldId}`, table: 'invoices', oldId, po: pre.po, oldDue: pre.due !== null ? [pre.due] : [] })
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
    }, { key: `order:${oldId}`, table: 'orders', oldId, po: str(r, 'customer_po_number'), oldDue: [] })
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

  // ---------------------------------------------------------------- payments derived from the old paid status
  // Owner decision 2026-10-19: the old database has no payment rows for most sales; "paid" lives in invoices.payment_status
  // (Paid / Partial with amount_paid) and orders.status = payment_received. That status becomes a payment received
  // (bank, not ticked, credited to nobody, date estimated). Never where payment rows already exist (no double count).
  const rowPaidByGroup = new Map<string, number>()
  for (const p of out.payments_in) rowPaidByGroup.set(String(p['order_id']), money((rowPaidByGroup.get(String(p['order_id'])) ?? 0) + Number(p['amount'])))
  const invoicesByGroup = new Map<string, InvoiceInfo[]>()
  for (const i of infos) if (i.group) invoicesByGroup.set(i.group.newId, [...(invoicesByGroup.get(i.group.newId) ?? []), i])
  const byDate = (a: InvoiceInfo, b: InvoiceInfo) => (a.invoiceDate ?? '9999').localeCompare(b.invoiceDate ?? '9999') || a.id.localeCompare(b.id)
  // Payment rows are per order: they settle the order's invoices oldest first (for the still-owed list only).
  for (const [gid, list] of invoicesByGroup) {
    let left = rowPaidByGroup.get(gid) ?? 0
    for (const i of [...list].sort(byDate)) {
      const take = Math.min(left, Math.max(i.gross - i.paid, 0))
      i.paid = money(i.paid + take)
      left = money(left - take)
    }
  }
  const hasRows = (g: OrderGroup | null) => g !== null && rowPaidByGroup.has(g.newId)

  const orderRowsOf = (g: OrderGroup | null): Row[] => (g ? g.oldIds.map(k => orderRowById.get(k)).filter((r): r is Row => r !== undefined) : [])
  const termsOf = (g: OrderGroup | null): number | null => orderRowsOf(g).map(r => num(r['payment_terms_days'])).find((x): x is number => x !== null && x >= 0) ?? null
  const capAsOf = (d: string): string => (d > ctx.opts.asOf ? ctx.opts.asOf : d)
  const plusTerms = (invoiceDate: string | null, g: OrderGroup | null): string | null => {
    const terms = termsOf(g)
    return invoiceDate !== null && terms !== null ? addDays(invoiceDate, Math.round(terms)) : null
  }
  /** The old invoice due date, else the order's payment_due_date, else invoice date + terms, else invoice date; never after asOf. */
  const statusDate = (oldDue: string[], g: OrderGroup | null, invoiceDate: string | null): string => {
    const due = [...oldDue].sort().at(-1) ?? null
    const orderDue = orderRowsOf(g).map(r => parseLegacyDate(r['payment_due_date']).date).filter((x): x is string => x !== null).sort()[0] ?? null
    return capAsOf(due ?? orderDue ?? plusTerms(invoiceDate, g) ?? invoiceDate ?? ctx.opts.asOf)
  }

  const derive = (p: { invoice: InvoiceInfo; group: OrderGroup | null; amount: number; receivedOn: string; flags: string[]; basis: string; key: string; source: Record<string, unknown> }): void => {
    const amount = money(p.amount)
    if (amount <= 0) return
    p.invoice.paid = money(p.invoice.paid + amount)
    ledger.add('paymentsFromStatus', 'old', amount)
    const label = p.invoice.number ?? p.invoice.oldId
    if (!p.group) {
      ledger.add('paymentsFromStatus', 'excluded', amount)
      ctx.addReview(
        'payments_not_placed',
        p.invoice.table,
        p.invoice.oldId,
        label,
        `${amount} paid per ${p.basis}, but the invoice is not linked to an order and a payment needs one: no payment recorded`,
      )
      return
    }
    ledger.add('paymentsFromStatus', 'neu', amount)
    out.paymentsFromStatusCount++
    out.payments_in.push({
      id: legacyId('payment', p.key),
      order_id: p.group.newId,
      received_on: p.receivedOn,
      amount,
      credited_user_id: null,
      reference: p.invoice.number,
      paid_via: 'bank',
      bank_month: null,
      legacy_flags: [...new Set([...p.flags, 'payment_date_estimated'])].sort(),
      legacy_source: { derived_from: p.basis, invoice: { table: p.invoice.table, old_id: p.invoice.oldId, number: p.invoice.number }, ...p.source },
    })
  }
  const paidAmount = (b: BookPre): number => (b.status === 'paid' && b.amountPaid <= 0 ? b.amount : b.amountPaid)

  // (a) bookkeeping invoices marked Paid / Partial: on the invoice they end up as (themselves, or their GST twin)
  for (const i of infos) {
    if (i.table === 'invoices') {
      const b = bookPreById.get(i.oldId)!
      if ((b.status !== 'paid' && b.status !== 'partial') || hasRows(i.group) || recordInvoices.has(b.oldId)) continue
      const partial = b.status === 'partial'
      derive({
        invoice: i,
        group: i.group,
        amount: partial ? Math.min(b.amountPaid, i.gross) : paidAmount(b),
        receivedOn: statusDate(i.oldDue, i.group, i.invoiceDate),
        flags: ['paid_per_old_invoice_status', ...(partial ? ['payment_partial_legacy'] : [])],
        basis: `old invoice status ${b.status}`,
        key: `status:${i.key}`,
        source: { table: 'invoices', row: b.row },
      })
    } else if (i.table === 'gst_invoices') {
      const pre = gstPreOf.get(i)!
      const twins = twinsOf.get(pre) ?? []
      const paidTwins = twins.filter(b => b.status === 'paid' || b.status === 'partial')
      if (!paidTwins.length || twins.some(b => recordInvoices.has(b.oldId))) continue
      if (i.group) {
        if (hasRows(i.group)) continue
        // All twins Paid: the GST invoice is paid in full (its gross). Otherwise what was recorded, capped at the gross.
        const all = twins.every(b => b.status === 'paid')
        derive({
          invoice: i,
          group: i.group,
          amount: all ? i.gross : Math.min(paidTwins.reduce((s, b) => s + paidAmount(b), 0), i.gross),
          receivedOn: statusDate(i.oldDue, i.group, i.invoiceDate),
          flags: ['paid_per_old_invoice_status', ...(all ? [] : ['payment_partial_legacy'])],
          basis: `old invoice status of ${twins.map(b => str(b.row, 'invoice_number') ?? b.oldId).join(', ')}`,
          key: `status:${i.key}`,
          source: { table: 'invoices', rows: twins.map(b => b.row) },
        })
      } else {
        // The register row covers several orders (one per PO): each twin's payment goes on the twin's own order.
        let room = i.gross
        for (const b of paidTwins) {
          if (hasRows(b.group)) continue
          const amount = Math.min(b.status === 'partial' ? Math.min(b.amountPaid, b.amount) : paidAmount(b), room)
          room = money(room - Math.max(amount, 0))
          derive({
            invoice: i,
            group: b.group,
            amount,
            receivedOn: statusDate(b.due !== null ? [b.due] : [], b.group, parseLegacyDate(b.row['issued_date']).date ?? i.invoiceDate),
            flags: ['paid_per_old_invoice_status', 'payment_on_twin_order', ...(b.status === 'partial' ? ['payment_partial_legacy'] : [])],
            basis: `old invoice status of ${str(b.row, 'invoice_number') ?? b.oldId}`,
            key: `status:${i.key}:${b.oldId}`,
            source: { table: 'invoices', row: b.row },
          })
        }
      }
    }
  }

  // (b) orders marked payment_received: every invoice of the order with no payment yet is paid in full
  for (const g of orders.groups) {
    const rows = orderRowsOf(g)
    if (!rows.length || !rows.every(r => (str(r, 'status') ?? '').toLowerCase() === 'payment_received') || hasRows(g)) continue
    for (const i of [...(invoicesByGroup.get(g.newId) ?? [])].sort(byDate)) {
      if (i.paid > 0) continue
      derive({
        invoice: i,
        group: g,
        amount: i.gross,
        receivedOn: statusDate(i.oldDue, g, i.invoiceDate),
        flags: ['paid_per_order_status'],
        basis: 'old order status payment_received',
        key: `order-status:${i.key}`,
        source: { table: 'orders', rows },
      })
    }
  }

  // (c) the owner's list (legacy_invoice_status.csv): paid = a full payment of what is open; owed = stays open, unlisted
  const statusFor = (i: InvoiceInfo) => (i.number !== null ? ctx.maps.legacyInvoiceStatus.get(normInvoiceNumber(i.number)) : undefined)
  const known = new Set(infos.filter(i => i.number !== null).map(i => normInvoiceNumber(i.number)))
  for (const no of ctx.maps.legacyInvoiceStatus.keys()) {
    if (!known.has(no)) ctx.addReview('warnings', 'legacy_invoice_status', no, no, 'legacy_invoice_status.csv names an invoice number the import does not have: line ignored')
  }
  for (const i of infos) {
    const open = money(i.gross - i.paid)
    if (statusFor(i) !== 'paid' || open <= 1) continue
    derive({
      invoice: i,
      group: i.group,
      amount: open,
      receivedOn: capAsOf(plusTerms(i.invoiceDate, i.group) ?? i.invoiceDate ?? ctx.opts.asOf),
      flags: ['paid_per_owner_list'],
      basis: 'the owner list legacy_invoice_status.csv',
      key: `owner-list:${i.key}`,
      source: { table: 'legacy_invoice_status', invoice_number: i.number },
    })
  }

  // (d) everything else old and unpaid is listed, not assumed
  for (const i of infos) {
    const open = money(i.gross - i.paid)
    if (open <= 1 || statusFor(i) === 'owed') continue
    ctx.addReview('still_owed', i.table, i.oldId, i.number ?? '(no number)', `${open} of ${i.gross} open: paid, or still owed? Answer in legacy_invoice_status.csv`, {
      invoice_number: i.number,
      customer: book.companyName(i.companyId),
      invoice_date: i.invoiceDate,
      gross: i.gross,
      open,
      po: i.po,
      linked_to_order: i.group ? 'yes' : 'no',
    })
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
