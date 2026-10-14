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
  quotation_terms: string | null
  po_terms: string | null
  updated_at: string
}

export const COLS = [...TEXT_FIELDS, 'quotation_validity_days', 'updated_at'].join(', ')

const text = (max: number, what: string) => z.string().trim().max(max, `Keep ${what} under ${max} characters.`)

export const profileSchema = z.object({
  legal_name: text(200, 'the legal name'),
  address: text(500, 'the address'),
  phone: text(50, 'the phone number'),
  email: z.union([z.literal(''), text(200, 'the email').email('Enter a valid email address, or leave it empty.')]),
  website: text(200, 'the website'),
  ntn: text(50, 'the NTN'),
  strn: text(50, 'the STRN'),
  bank_name: text(200, 'the bank name'),
  bank_account_title: text(200, 'the account title'),
  bank_iban: text(60, 'the IBAN'),
  quotation_validity_days: z
    .number({ invalid_type_error: 'Enter the number of days a quotation stays valid.' })
    .int('Use whole days.')
    .min(1, 'A quotation must be valid for at least 1 day.')
    .max(365, 'Keep the validity to a year or less.'),
  quotation_terms: text(4000, 'the terms'),
  po_terms: text(4000, 'the terms'),
})
export type ProfileValues = z.infer<typeof profileSchema>

/** Form values from a row: empty text instead of null, so inputs stay controlled. */
export function toFormValues(p: CompanyProfile): ProfileValues {
  const v: Record<string, unknown> = { quotation_validity_days: p.quotation_validity_days }
  for (const f of TEXT_FIELDS) v[f] = p[f] ?? ''
  return v as ProfileValues
}

/** The update payload: blank text is stored as null, never as an empty string. */
export function toRow(v: ProfileValues): TablesUpdate<'company_profile'> {
  const row: TablesUpdate<'company_profile'> = { quotation_validity_days: v.quotation_validity_days }
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

