// Shared by the four chase generators (customer clarification, supplier quote, supplier goods, payment reminder).
// Wording ships as mocked (docs/design/mockups/g2-chase-texts.html and g2-money.html): polite first, firmer once
// the matter is more than 30 days old (DECISIONS 2026-10-14). Pure, no framework.

import { longDay } from './dateText'
import type { EnquiryVariant } from './enquiryDraft'

/** A matter older than this many days gets the firmer wording. Counted from the first ask, the enquiry, the due date or the invoice due date. */
export const FIRM_AFTER_DAYS = 30

export const COMPANY_NAME = 'Q-Tech Solutions'

export interface ChaseSignature {
  name: string
  company: string
  jobTitle?: string | null
  /** users.phone: printed on its own line under an email signature. */
  phone?: string | null
}

export interface ChaseText {
  variant: EnquiryVariant
  /** Email only. */
  subject: string | null
  body: string
}

export const isFirm = (days: number | null | undefined): boolean => days !== null && days !== undefined && days > FIRM_AFTER_DAYS

/** WhatsApp bolds with asterisks; email does not. */
export const boldFor = (variant: EnquiryVariant) => (t: string) => (variant === 'email' ? t : `*${t}*`)

/** "Monday 30 November", or "5:00 pm today" when the date is today (or earlier). */
export function byDayText(iso: string, today: string): string {
  return iso <= today ? '5:00 pm today' : longDay(iso)
}

/** Greeting in the approved shapes. Email has the salutation on two lines. */
export function greetingFor(variant: EnquiryVariant, contactName: string | null): string {
  if (variant === 'email') return contactName ? `Dear ${contactName},\nAssalam o Alaikum.` : 'Dear Sir or Madam,\nAssalam o Alaikum.'
  return contactName ? `Assalam o Alaikum ${contactName},` : 'Assalam o Alaikum,'
}

export function signOff(variant: EnquiryVariant, sig: ChaseSignature): string[] {
  if (variant === 'email') return ['With best regards,', sig.name, sig.jobTitle ? `${sig.jobTitle}, ${sig.company}` : sig.company, ...(sig.phone ? [sig.phone] : [])]
  return ['Regards,', sig.name, sig.company]
}

/** What goes on the clipboard: an email carries its subject on the first line. */
export function chaseClipboardText(t: Pick<ChaseText, 'subject' | 'body'>): string {
  return t.subject ? `Subject: ${t.subject}\n\n${t.body}` : t.body
}

/** "17:00:00" from the database, "17:00" on screen. Null for no time. */
export function timeText(t: string | null | undefined): string | null {
  const m = t ? /^(\d{2}):(\d{2})/.exec(t) : null
  return m ? `${m[1]}:${m[2]}` : null
}

export function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim().replace(/[\s,;.]+$/, '')
}

/** "21 and 27 November" from two ISO dates in the same month, else "21 October and 27 November". */
export function twoDaysText(a: string, b: string): string {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  if (a === b) return `${bd} ${months[bm - 1]}`
  if (ay === by && am === bm) return `${ad} and ${bd} ${months[bm - 1]}`
  return `${ad} ${months[am - 1]}${ay === by ? '' : ` ${ay}`} and ${bd} ${months[bm - 1]}${ay === by ? '' : ` ${by}`}`
}
