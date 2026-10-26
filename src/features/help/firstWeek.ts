/*
 * The first-week checklist per role (learnability spec 5.1). Every item is read from records the business already keeps
 * (created_by, last_chased_by, the audit log); nothing new is recorded about people. The owner sees it on Settings › Team for
 * the first 14 days after someone is added. Coaching, not monitoring: the same list is the person's own next steps.
 */
export type FirstWeekItemId =
  | 'phone'
  | 'rfq'
  | 'ask'
  | 'price'
  | 'quotation'
  | 'chase'
  | 'photo'
  | 'delivered'
  | 'commissioning'
  | 'payment'
  | 'expenses'
  | 'invoice'
  | 'tcs-fbr'
  | 'bank'

export interface FirstWeekItem {
  id: FirstWeekItemId
  label: string
}

const PHONE: FirstWeekItem = { id: 'phone', label: 'Add your phone number' }

export const FIRST_WEEK: Record<string, FirstWeekItem[]> = {
  sales: [
    PHONE,
    { id: 'rfq', label: 'Log an RFQ' },
    { id: 'ask', label: 'Ask suppliers' },
    { id: 'price', label: 'Enter a supplier price' },
    { id: 'quotation', label: 'Issue a quotation' },
    { id: 'chase', label: 'Chase from To do' },
  ],
  engineer: [
    PHONE,
    { id: 'photo', label: 'Save a photo or note with Paste or photo' },
    { id: 'delivered', label: 'Mark goods delivered or received' },
    { id: 'commissioning', label: 'Mark a commissioning job done' },
  ],
  // "Add a person" (spec item 6) is left out: people are added by the admin-users function, which the audit log does not see.
  admin: [
    { id: 'payment', label: 'Record a payment' },
    { id: 'expenses', label: 'Add expenses' },
    { id: 'invoice', label: 'Create an invoice' },
    { id: 'tcs-fbr', label: 'Mark TCS or FBR' },
    { id: 'bank', label: 'Match the bank statement for a month' },
  ],
}

export const FIRST_WEEK_DAYS = 14

/** When each item was first done, per person: { userId: { rfq: '2026-10-20T…' } }. */
export type FirstWeekFacts = Record<string, Partial<Record<FirstWeekItemId, string>>>

export interface FirstWeekMember {
  id: string
  role: string
  phone: string | null
  created_at: string
  deactivated_at: string | null
}

/** Shown for an active person added in the last 14 days. */
export function inFirstWeeks(m: FirstWeekMember, now: Date = new Date()): boolean {
  const since = Date.parse(m.created_at)
  return !m.deactivated_at && Number.isFinite(since) && now.getTime() - since <= FIRST_WEEK_DAYS * 86_400_000
}

export interface FirstWeekRow extends FirstWeekItem {
  /** When it was first done; null while open. The phone item has no date, so it reads 'set'. */
  doneOn: string | null
}

export function firstWeekRows(m: FirstWeekMember, facts: FirstWeekFacts): FirstWeekRow[] {
  const mine = facts[m.id] ?? {}
  return (FIRST_WEEK[m.role] ?? []).map(item => ({
    ...item,
    doneOn: item.id === 'phone' ? (m.phone ? 'set' : null) : (mine[item.id] ?? null),
  }))
}
