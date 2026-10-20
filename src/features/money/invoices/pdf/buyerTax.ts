import type { BuyerTax } from '@/features/money/invoices/pdf/model'
import type { BuyerTaxPatch } from '@/features/money/invoices/pdf/api'

/*
 * The buyer's tax details form (companies columns, migration 0072): the pure rules. Every field is optional; the only rule
 * between them is that a buyer marked registered needs its STRN (it is printed on every invoice). Numbers are kept as typed
 * (spaces folded), so they print as on the FBR certificate. The database CHECKs accept digits, spaces and dashes; this asks for
 * a believable count of digits on top: an NTN is 7 digits and a check digit, a CNIC 13; an STRN 13 (or, for newer
 * registrations, the NTN or CNIC itself).
 */
export type Registered = 'yes' | 'no' | ''

export interface BuyerTaxValues {
  registered: Registered
  ntn: string
  strn: string
  invoiceAddress: string
}

export type BuyerTaxErrors = Partial<Record<keyof BuyerTaxValues, string>>

export function toValues(b: Pick<BuyerTax, 'salesTaxRegistered' | 'ntn' | 'strn' | 'invoiceAddress'> | null | undefined): BuyerTaxValues {
  const registered: Registered = b?.salesTaxRegistered === true ? 'yes' : b?.salesTaxRegistered === false ? 'no' : b?.strn?.trim() ? 'yes' : ''
  return { registered, ntn: b?.ntn ?? '', strn: b?.strn ?? '', invoiceAddress: b?.invoiceAddress ?? '' }
}

const fold = (s: string): string => s.replace(/\s+/g, ' ').trim()
const digitCount = (s: string): number => s.replace(/\D/g, '').length
const numberShaped = (s: string): boolean => /^[0-9][0-9 -]*[0-9]$/.test(s)

export const NTN_HELP = 'NTN (7 digits and a check digit, 1234567-8) or a person’s 13-digit CNIC.'
export const STRN_HELP = 'As on the sales-tax registration certificate: 13 digits, or the NTN for newer registrations.'

/** The patch to save, or the errors to show under the fields. */
export function validateBuyerTax(v: BuyerTaxValues): { ok: true; patch: BuyerTaxPatch } | { ok: false; errors: BuyerTaxErrors } {
  const errors: BuyerTaxErrors = {}
  const ntn = fold(v.ntn)
  const strn = v.registered === 'yes' ? fold(v.strn) : ''
  const address = v.invoiceAddress.trim()
  if (ntn && (!numberShaped(ntn) || ![7, 8, 13].includes(digitCount(ntn)))) {
    errors.ntn = `Type the ${NTN_HELP}`
  }
  if (v.registered === 'yes' && !strn) errors.strn = 'A registered buyer’s STRN is printed on every invoice. Type it, or choose Not registered.'
  else if (strn && (!numberShaped(strn) || ![7, 8, 13].includes(digitCount(strn)))) errors.strn = `Type the STRN ${STRN_HELP.charAt(0).toLowerCase()}${STRN_HELP.slice(1)}`
  if (address.length > 500) errors.invoiceAddress = 'Keep the address under 500 characters.'
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return {
    ok: true,
    patch: {
      ntn: ntn || null,
      strn: strn || null,
      sales_tax_registered: v.registered === 'yes' ? true : v.registered === 'no' ? false : null,
      invoice_address: address || null,
    },
  }
}
