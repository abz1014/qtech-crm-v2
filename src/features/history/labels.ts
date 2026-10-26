import { HISTORY_TABLES } from '@/features/history/api'

/*
 * What each column of a history table is called, and how its value is shown. The words match the screens' own labels (Amount,
 * Date paid, Paid to ...). 'hide' is an explicit decision that a column is not worth showing (ids, stamps, internal flags);
 * labels.test.ts fails when a column of src/types/database.ts has neither a label nor a hide, so a new column cannot slip by.
 */
export type ColumnKind = 'money' | 'date' | 'datetime' | 'bool' | 'ref' | 'enum' | 'text' | 'lines' | 'hide'

export interface ColumnSpec {
  kind: ColumnKind
  label: string
  /** enum: stored value to words. */
  words?: Record<string, string>
  /** date: shown as a month ("Oct 2026"). */
  month?: boolean
  /** What an empty value reads as ("Not ticked"). Default: "empty". */
  empty?: string
}

const hide: ColumnSpec = { kind: 'hide', label: '' }
const t = (label: string, empty?: string): ColumnSpec => ({ kind: 'text', label, empty })
const m = (label: string): ColumnSpec => ({ kind: 'money', label })
const d = (label: string): ColumnSpec => ({ kind: 'date', label })
const dt = (label: string): ColumnSpec => ({ kind: 'datetime', label })
const b = (label: string): ColumnSpec => ({ kind: 'bool', label })
const r = (label: string): ColumnSpec => ({ kind: 'ref', label })
const lines = (label: string): ColumnSpec => ({ kind: 'lines', label })
const paidVia = (label = 'Paid via'): ColumnSpec => ({ kind: 'enum', label, words: { bank: 'Bank', cash: 'Cash' } })
const ticked: ColumnSpec = { kind: 'date', label: 'Ticked in bank', month: true, empty: 'Not ticked' }

/** Columns that mean the same on every table, and are never shown. */
export const ALWAYS_HIDDEN = ['id', 'created_at', 'created_by', 'updated_at', 'updated_by', 'model_tokens', 'legacy_source', 'legacy_flags'] as const

/** The child tables shown under a record (0090 history_sources). */
export const HISTORY_CHILD_TABLES = [
  'rfq_items',
  'supplier_inquiries',
  'clarifications',
  'attachments',
  'order_items',
  'supplier_orders',
  'order_costs',
  'order_engineers',
] as const

export const LABELS: Record<string, Record<string, ColumnSpec>> = {
  rfqs: {
    close_note: t('Closing note'),
    close_reason: t('Why it closed'),
    closed_on: d('Closed on'),
    company_id: r('Company'),
    contact_id: r('Contact'),
    customer_ref: t('Customer reference'),
    due_on: d('Quotation due'),
    due_time: t('Due time'),
    is_priority: b('Top priority'),
    notes: t('Notes'),
    number: t('RFQ number'),
    owner_id: r('Owner'),
    quoted_on: d('Quoted on'),
    received_on: d('Date received'),
    site_id: r('Site'),
  },
  orders: {
    cancel_reason: t('Why it was cancelled'),
    cancelled_on: d('Cancelled on'),
    commissioning_done_on: d('Commissioning done'),
    commissioning_planned_on: d('Commissioning planned'),
    company_id: r('Company'),
    contact_id: r('Contact'),
    customer_po_number: t('Customer PO number'),
    needs_commissioning: b('Needs commissioning'),
    notes: t('Notes'),
    number: t('Order number'),
    ordered_on: d('Order date'),
    owner_id: r('Owner'),
    payment_terms_days: t('Payment terms (days)'),
    rfq_id: hide,
    site_id: r('Site'),
  },
  invoices: {
    client_received_on: d('Client received on'),
    company_id: r('Company'),
    copy_received_on: d('Copy received on'),
    gst_amount: m('GST'),
    invoice_date: d('Invoice date'),
    last_reminded_on: d('Last reminded on'),
    net_amount: m('Net amount'),
    notes: t('Notes'),
    number: t('Invoice number'),
    order_id: hide,
    psid: t('PSID'),
    reminder_count: t('Reminders sent'),
    settled_before_cutover: hide,
    tax_bank_month: { ...ticked, label: 'Tax ticked in bank' },
    tax_deposit_amount: m('Tax deposited'),
    tax_deposited_on: d('Tax deposited on'),
    tcs_number: t('TCS number'),
    tcs_sent_on: d('TCS sent on'),
    wasif_receipt_on: d('Owner receipt on'),
  },
  payments_in: {
    amount: m('Amount'),
    bank_month: ticked,
    corrects_payment_id: hide,
    credited_user_id: r('Credited to'),
    order_id: hide,
    paid_via: paidVia(),
    received_on: d('Date received'),
    reference: t('Reference'),
    void_reason: t('Why it was cancelled'),
    voided_at: dt('Cancelled at'),
    voided_by: r('Cancelled by'),
  },
  expenses: {
    amount_pkr: m('Amount'),
    bank_month: ticked,
    category_id: r('Category'),
    description: t('Detail'),
    fx_amount: t('Foreign amount'),
    fx_currency: t('Currency'),
    input_tax_pkr: m('Input tax'),
    order_id: hide,
    paid_on: d('Date paid'),
    paid_via: paidVia(),
    payee_id: r('Paid to'),
    period: hide,
    recurring_id: hide,
    reference: t('Reference'),
    supplier_order_id: hide,
  },
  quotations: {
    contact_id: r('Contact'),
    delivery_text: t('Delivery'),
    gst_total: m('GST'),
    issued_on: d('Issued on'),
    lines: lines('Lines'),
    net_total: m('Net total'),
    notes: t('Notes'),
    number: t('Quotation number'),
    payment_terms: t('Payment terms'),
    pdf_path: hide,
    revision: t('Revision'),
    rfq_id: hide,
    signatory_id: r('Signed by'),
    valid_until: d('Valid until'),
  },
  purchase_orders: {
    currency: t('Currency'),
    delivery_terms: t('Delivery terms'),
    incoterm: t('Incoterm'),
    issued_on: d('Issued on'),
    lines: lines('Lines'),
    notes: t('Notes'),
    number: t('Purchase order number'),
    payment_terms: t('Payment terms'),
    pdf_path: hide,
    revision: t('Revision'),
    ship_to: t('Ship to'),
    signatory_id: r('Signed by'),
    supplier_order_id: hide,
    // in the supplier's currency, so not a PKR amount
    total: t('Total'),
  },
  companies: {
    city: t('City'),
    country: t('Country'),
    invoice_address: t('Invoice address'),
    name: t('Company name'),
    notes: t('Notes'),
    ntn: t('NTN'),
    sales_tax_registered: b('Registered for sales tax'),
    strn: t('STRN'),
  },
  contacts: {
    company_id: hide,
    email: t('Email'),
    job_title: t('Job title'),
    name: t('Name'),
    notes: t('Notes'),
    phone: t('Phone'),
    site_id: r('Site'),
  },
  company_sites: { address: t('Address'), company_id: hide, name: t('Site name') },
  recurring_expenses: {
    active: b('Active'),
    amount: m('Amount'),
    category_id: r('Category'),
    day_of_month: t('Day of month'),
    label: t('Name'),
    notes: t('Notes'),
    paid_via: paidVia(),
    start_month: { kind: 'date', label: 'Starts in', month: true },
  },
  // ---- child tables
  rfq_items: {
    brand_id: r('Brand'),
    description: t('Description'),
    family_id: hide,
    gst_rate: t('GST rate'),
    position: hide,
    qty: t('Quantity'),
    quoted_lead_time: t('Lead time'),
    quoted_unit_price_net: m('Unit price, net'),
    rfq_id: hide,
    unit: t('Unit'),
  },
  supplier_inquiries: {
    chase_count: hide,
    last_chased_by: hide,
    last_chased_on: d('Last chased on'),
    last_relayed_at: hide,
    no_offer_on: d('No offer on'),
    no_offer_reason: t('Why no offer'),
    notes: t('Notes'),
    rfq_id: hide,
    sent_on: d('Sent on'),
    supplier_id: r('Supplier'),
  },
  clarifications: {
    answer: t('Answer'),
    answered_at: dt('Answered at'),
    ask_count: hide,
    first_asked_at: hide,
    last_asked_at: hide,
    last_asked_by: hide,
    question: t('Question'),
    raised_by_inquiry_id: hide,
    rfq_id: hide,
    rfq_item_id: hide,
    withdrawn_at: dt('Withdrawn at'),
  },
  attachments: {
    bucket: hide,
    clarification_id: hide,
    expense_id: hide,
    file_name: t('File'),
    invoice_id: hide,
    mime_type: hide,
    order_id: hide,
    path: hide,
    rfq_id: hide,
    size_bytes: hide,
  },
  order_items: {
    brand_id: r('Brand'),
    description: t('Description'),
    family_id: hide,
    gst_rate: t('GST rate'),
    is_service: b('Service'),
    order_id: hide,
    position: hide,
    qty: t('Quantity'),
    rfq_item_id: hide,
    supplier_order_id: hide,
    supplier_unit_price: t('Supplier unit price'),
    unit: t('Unit'),
    unit_price_net: m('Unit price, net'),
  },
  supplier_orders: {
    chase_count: hide,
    currency: t('Currency'),
    delivered_on: d('Delivered on'),
    expected_on: d('Expected on'),
    inquiry_id: hide,
    last_chased_by: hide,
    last_chased_on: d('Last chased on'),
    order_id: hide,
    placed_on: d('Placed on'),
    received_on: d('Received on'),
    reference: t('Reference'),
    supplier_id: r('Supplier'),
  },
  order_costs: {
    costs_complete_at: dt('Costs marked complete'),
    costs_complete_by: hide,
    expected_cost_pkr: m('Expected cost'),
    order_id: hide,
  },
  order_engineers: { order_id: hide, user_id: r('Engineer') },
}

/** Every table whose columns must be named: the record kinds and their children. */
export const TABLES_WITH_LABELS: readonly string[] = [...HISTORY_TABLES, ...HISTORY_CHILD_TABLES]

/** "was_sent_on" to "Was sent on": a column the labels do not know yet (only an admin is sent those keys). */
export function humanise(column: string): string {
  const words = column.replace(/_/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** How a column is named and shown; undefined means it is not known (neither labelled nor hidden). */
export function columnSpec(table: string, column: string): ColumnSpec | undefined {
  if ((ALWAYS_HIDDEN as readonly string[]).includes(column)) return hide
  return LABELS[table]?.[column]
}

/** The same, with an unknown column shown as plain text under a humanised name rather than lost. */
export function specFor(table: string, column: string): ColumnSpec {
  return columnSpec(table, column) ?? { kind: 'text', label: humanise(column) }
}
