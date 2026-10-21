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
