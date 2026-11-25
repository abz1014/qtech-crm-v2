import type { TablesUpdate } from '@/types/database'
import type { ProfileValues } from '@/features/settings/companyProfileSchema'

// The form's schema (zod) is its own module, so a page that only reads the profile (an order's terms, a PDF's letterhead)
// does not download zod with it (perf/lcp).
export type { ProfileValues } from '@/features/settings/companyProfileSchema'

/*
 * company_profile (DATA_MODEL 2.27): the pure model. One row, id = 1, created by a migration. Every
 * field is optional except the validity days, which has a default. Missing legal name or address
 * blocks only PDF generation (R20), never saving. The calls are in api.ts, the hooks in hooks.ts.
 */
export const TEXT_FIELDS = [
  'legal_name',
  'address',
  'phone',
  'email',
  'website',
  'sales_email',
  'sales_phone',
  'ntn',
  'strn',
  'bank_name',
  'bank_account_title',
  'bank_iban',
  'quotation_terms',
  'quotation_warranty',
  'quotation_closing',
  'po_terms',
] as const
export type TextField = (typeof TEXT_FIELDS)[number]

export interface CompanyProfile {
  legal_name: string | null
  address: string | null
  phone: string | null
  email: string | null
  website: string | null
  /** The quotation's signature block: the sales email and the sales cell number (0147). */
  sales_email: string | null
  sales_phone: string | null
  ntn: string | null
  strn: string | null
  bank_name: string | null
  bank_account_title: string | null
  bank_iban: string | null
  quotation_validity_days: number
  default_payment_terms_days: number
  quotation_terms: string | null
  /** The two standard paragraphs under the quotation's terms (0147): the warranty, then the closing line. */
  quotation_warranty: string | null
  quotation_closing: string | null
  po_terms: string | null
  /** The lowest running number the next new quotation may take (QTS-<code>-<number>, 0147). */
  quote_next_number: number
  updated_at: string
}

/** Bank and tax identifiers: the database refuses these to an engineer (migration 0108), so no engineer screen may select them. */
export const FINANCIAL_FIELDS = ['ntn', 'strn', 'bank_name', 'bank_account_title', 'bank_iban'] as const satisfies readonly TextField[]

export const COLS = [...TEXT_FIELDS, 'quotation_validity_days', 'default_payment_terms_days', 'quote_next_number', 'updated_at'].join(', ')
/**
 * Payment terms and the quotation and purchase order wording: an engineer's screens never show them (gate 2, answer 10: they carry
 * money words; no engineer issues a quotation or a purchase order, and an order's terms are drawn only where prices are seen).
 */
const ENGINEER_LEFT_OUT = ['quotation_terms', 'quotation_warranty', 'quotation_closing', 'po_terms'] as const satisfies readonly TextField[]
/** What an engineer reads: the business details only (no financial columns, no terms). */
export const COLS_NO_FINANCIAL = [
  ...TEXT_FIELDS.filter(f => !(FINANCIAL_FIELDS as readonly string[]).includes(f) && !(ENGINEER_LEFT_OUT as readonly string[]).includes(f)),
  'updated_at',
].join(', ')

/** A row read without the financial columns and the terms, completed with nulls and the database defaults so it has the full shape. */
export function withoutFinancials(row: Partial<CompanyProfile>): CompanyProfile {
  return {
    ...row,
    ntn: null,
    strn: null,
    bank_name: null,
    bank_account_title: null,
    bank_iban: null,
    quotation_terms: null,
    quotation_warranty: null,
    quotation_closing: null,
    po_terms: null,
    quote_next_number: DEFAULT_QUOTE_NEXT_NUMBER,
    quotation_validity_days: DEFAULT_QUOTATION_VALIDITY_DAYS,
    default_payment_terms_days: FALLBACK_PAYMENT_TERMS_DAYS,
  } as CompanyProfile
}

/** The column default of quote_next_number (migration 0147): the owner's last hand-made quotation was number 4809. */
export const DEFAULT_QUOTE_NEXT_NUMBER = 4810

/** The column default of quotation_validity_days (migration 0021). */
const DEFAULT_QUOTATION_VALIDITY_DAYS = 30

/** 1234567-8, 12345678, 1234567, 35202-1234567-1, 3520212345671. */
export const NTN_RE = /^(?:\d{7}(?:-?\d)?|\d{5}-?\d{7}-?\d)$/

/** Form values from a row: empty text instead of null, so inputs stay controlled. */
export function toFormValues(p: CompanyProfile): ProfileValues {
  const v: Record<string, unknown> = {
    quotation_validity_days: p.quotation_validity_days,
    default_payment_terms_days: p.default_payment_terms_days,
    quote_next_number: p.quote_next_number,
  }
  for (const f of TEXT_FIELDS) v[f] = p[f] ?? ''
  return v as ProfileValues
}

/** The update payload: blank text is stored as null, never as an empty string. */
export function toRow(v: ProfileValues): TablesUpdate<'company_profile'> {
  const row: TablesUpdate<'company_profile'> = {
    quotation_validity_days: v.quotation_validity_days,
    default_payment_terms_days: v.default_payment_terms_days,
    quote_next_number: v.quote_next_number,
  }
  for (const f of TEXT_FIELDS) row[f] = v[f].trim() === '' ? null : v[f].trim()
  return row
}

/** PDFs (quotations, POs) cannot be issued until both are set. */
export function missingForPdf(p: Pick<CompanyProfile, 'legal_name' | 'address'>): ('legal_name' | 'address')[] {
  const out: ('legal_name' | 'address')[] = []
  if (!p.legal_name?.trim()) out.push('legal_name')
  if (!p.address?.trim()) out.push('address')
  return out
}

export type DocumentField = 'legal_name' | 'address' | 'ntn' | 'strn'
const DOC_LABELS: Record<DocumentField, string> = { legal_name: 'Legal name', address: 'Address', ntn: 'NTN', strn: 'STRN' }

/**
 * What the documents still need (audit 2026-10-22): the legal name and address for every PDF, and the NTN and STRN for a GST
 * (sales-tax) invoice, the same four the invoice readiness check asks for (money/invoices/pdf/model.ts). Bank details are not
 * here: they print only when filled in. `title` is the banner's one line, `detail` says what each gap blocks, naming only the
 * fields that are empty (screen review 2026-11-24, item 21: "also need the NTN and STRN" read as if a saved NTN were missing).
 */
export function missingForDocuments(p: Pick<CompanyProfile, DocumentField>): { fields: DocumentField[]; title: string; detail: string } | null {
  const fields = (['legal_name', 'address', 'ntn', 'strn'] as const).filter(f => !p[f]?.trim())
  if (fields.length === 0) return null
  const pdf = fields.some(f => f === 'legal_name' || f === 'address')
  const gst = fields.filter(f => f === 'ntn' || f === 'strn').map(f => DOC_LABELS[f])
  const detail = [
    pdf ? 'Quotations, purchase orders and invoices print the legal name and address at the top.' : null,
    gst.length ? `GST invoices also need the ${gst.join(' and ')}.` : null,
  ]
    .filter(Boolean)
    .join(' ')
  return { fields: [...fields], title: `Missing for documents: ${fields.map(f => DOC_LABELS[f]).join(', ')}`, detail }
}

/** What the database falls back to when the profile cannot be read yet (the column default in migration 0059). */
export const FALLBACK_PAYMENT_TERMS_DAYS = 30

/**
 * The payment terms that apply to an order (audit Y1). An order's own terms always win, including 0; with none, the company
 * default applies, so the due date and the payment-overdue reminder exist for every invoiced order. `isDefault` is what the
 * screens print as "default terms".
 */
export function effectiveTerms(ownDays: number | null, defaultDays: number | null | undefined): { days: number; isDefault: boolean } {
  if (ownDays !== null) return { days: ownDays, isDefault: false }
  return { days: defaultDays ?? FALLBACK_PAYMENT_TERMS_DAYS, isDefault: true }
}

/** "Terms 30 days from invoice", with "(default terms)" when the order has none of its own. */
export function termsLabel(ownDays: number | null, defaultDays: number | null | undefined): string {
  const t = effectiveTerms(ownDays, defaultDays)
  return `Terms ${t.days} days from invoice${t.isDefault ? ' (default terms)' : ''}`
}
