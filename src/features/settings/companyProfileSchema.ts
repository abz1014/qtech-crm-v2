import { z } from 'zod'

/* The company profile form's rules (CompanyProfilePage). The model is companyProfile.ts; this is apart so zod comes only with the form. */
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
  default_payment_terms_days: z
    .number({ invalid_type_error: 'Enter the number of days customers have to pay.' })
    .int('Use whole days.')
    .min(0, 'Payment terms cannot be negative.')
    .max(365, 'Keep the terms to a year or less.'),
  quotation_terms: text(4000, 'the terms'),
  po_terms: text(4000, 'the terms'),
})
export type ProfileValues = z.infer<typeof profileSchema>
