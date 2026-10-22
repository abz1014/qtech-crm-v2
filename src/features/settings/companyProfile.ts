import { z } from 'zod'
import type { TablesUpdate } from '@/types/database'

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
  'ntn',
  'strn',
  'bank_name',
  'bank_account_title',
  'bank_iban',
  'quotation_terms',
  'po_terms',
] as const
export type TextField = (typeof TEXT_FIELDS)[number]

export interface CompanyProfile {
  legal_name: string | null
  address: string | null
  phone: string | null
  email: string | null
  website: string | null
  ntn: string | null
  strn: string | null
  bank_name: string | null
  bank_account_title: string | null
  bank_iban: string | null
  quotation_validity_days: number
  default_payment_terms_days: number
  quotation_terms: string | null
  po_terms: string | null
  updated_at: string
}

export const COLS = [...TEXT_FIELDS, 'quotation_validity_days', 'default_payment_terms_days', 'updated_at'].join(', ')

/** 1234567-8, 12345678, 1234567, 35202-1234567-1, 3520212345671. */
export const NTN_RE = /^(?:\d{7}(?:-?\d)?|\d{5}-?\d{7}-?\d)$/

const text = (max: number, what: string) =>z.string().trim().max(max, `Keep ${what} under ${max} characters.`)

export const profileSchema = z.object({
  legal_name: text(200, 'the legal name'),
  address: text(500, 'the address'),
  phone: text(50, 'the phone number'),
  email: z.union([z.literal(''), text(200, 'the email').email('Enter a valid email address, or leave it empty.')]),
  website: text(200, 'the website'),
  // HW-47: the NTN prints on every sales-tax invoice, so only an NTN shape is kept: 7 digits and the check digit
  // (1234567-8), or a 13-digit CNIC used as the NTN (35202-1234567-1). Empty is still allowed.
  ntn: text(50, 'the NTN').refine(v => v === '' || NTN_RE.test(v), 'Enter the NTN as 7 digits and the check digit (1234567-8), or the 13-digit CNIC.'),
  strn: text(50, 'the STRN'),
  bank_name: text(200, 'the bank name'),
  bank_account_title: text(200, 'the account title'),
  bank_iban: text(60, 'the IBAN'),
  quotation_validity_days: z
    .number({ invalid_type_error: 'Enter the number of days a quotation stays valid.' })
    .int('Use whole days.')
    .min(1, 'A quotation must be valid for at least 1 day.')
    .max(365, 'Keep the validity to a year or less.'),
  default_payment_terms_days: z
    .number({ invalid_type_error: 'Enter the number of days customers have to pay.' })
    .int('Use whole days.')
    .min(0, 'Payment terms cannot be negative.')
    .max(365, 'Keep the terms to a year or less.'),
  quotation_terms: text(4000, 'the terms'),
  po_terms: text(4000, 'the terms'),
})
export type ProfileValues = z.infer<typeof profileSchema>

/** Form values from a row: empty text instead of null, so inputs stay controlled. */
export function toFormValues(p: CompanyProfile): ProfileValues {
  const v: Record<string, unknown> = {
    quotation_validity_days: p.quotation_validity_days,
    default_payment_terms_days: p.default_payment_terms_days,
  }
  for (const f of TEXT_FIELDS) v[f] = p[f] ?? ''
  return v as ProfileValues
}

/** The update payload: blank text is stored as null, never as an empty string. */
export function toRow(v: ProfileValues): TablesUpdate<'company_profile'> {
  const row: TablesUpdate<'company_profile'> = {
    quotation_validity_days: v.quotation_validity_days,
    default_payment_terms_days: v.default_payment_terms_days,
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
 * here: they print only when filled in. `title` is the banner's one line, `detail` says what each gap blocks.
 */
export function missingForDocuments(p: Pick<CompanyProfile, DocumentField>): { fields: DocumentField[]; title: string; detail: string } | null {
  const fields = (['legal_name', 'address', 'ntn', 'strn'] as const).filter(f => !p[f]?.trim())
  if (fields.length === 0) return null
  const pdf = fields.some(f => f === 'legal_name' || f === 'address')
  const gst = fields.some(f => f === 'ntn' || f === 'strn')
  const detail = [
    pdf ? 'Quotations, purchase orders and invoices print the legal name and address at the top.' : null,
    gst ? 'GST invoices also need the NTN and STRN.' : null,
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
