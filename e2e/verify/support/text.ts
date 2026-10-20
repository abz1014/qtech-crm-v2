/*
 * EVERY visible word the verify suites look for lives in this one file: button and field names (used with getByRole / getByLabel),
 * headings, toast and error sentences, and the way figures are printed. Selectors themselves are by role, label, test id or aria;
 * only the words come from here. When the UX branches rename a button or reword a sentence, this is the only file to change.
 *
 * Group by area. A spec imports what it needs: `import { COMMON, SALES } from '../support/text'`.
 */

/** Words used on many screens. */
export const COMMON = {
  undo: 'Undo',
  cancel: 'Cancel',
  save: 'Save',
  done: 'Done',
  signIn: 'Sign in',
  email: 'Email',
  password: 'Password',
  noAccessHeading: /no access|not available to you|you do not have access/i,
  notFound: /not found|does not exist|isn.t here/i,
  /** mapPgError's network sentence (src/lib/pgErrors.ts), shown when a save cannot reach the server. */
  network: 'Check your connection and try again. Trying again will not create a duplicate.',
  /** The month-lock trigger's sentence (P0001), passed through to the screen unchanged. */
  closedMonth: (monthLabel: string) => `${monthLabel} is closed. An admin can reopen it.`,
  nav: { today: 'Today', rfqs: 'RFQs', orders: 'Orders', companies: 'Companies', money: 'Money', reports: 'Reports' },
} as const

/*
 * How figures are printed (src/lib/money.ts formatPaisa): western thousands grouping, paisa only when non-zero, a true minus
 * sign (U+2212). Tests compute the expected figure BY HAND (in a comment) and format it with these, never with app code.
 */
const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/** 316240 -> "316,240"; 1234.5 -> "1,234.50"; -84500 -> "−84,500". `always` keeps .00 on whole amounts. */
export function amount(n: number, opts: { always?: boolean } = {}): string {
  const paisa = Math.round(Math.abs(n) * 100)
  const whole = group(String(Math.floor(paisa / 100)))
  const cents = paisa % 100
  const frac = opts.always || cents !== 0 ? `.${String(cents).padStart(2, '0')}` : ''
  return `${n < 0 ? '−' : ''}${whole}${frac}`
}

/** "PKR 316,240" (the currency prefix the dialogs and totals print). */
export const pkr = (n: number, opts: { always?: boolean } = {}): string => `PKR ${amount(n, opts)}`

/** A regex that finds the figure anywhere in a text, whatever sits before or after it ("PKR 1,234", "Rs 1,234", "1,234 due"). */
export const figure = (n: number): RegExp => new RegExp(`(^|[^\\d,.])${amount(n).replace(/[.,]/g, m => `\\${m}`)}(?![\\d,]|\\.\\d)`)

export * from './text-sales'
export * from './text-quotes'
export * from './text-orders'
export * from './text-money'
export * from './text-books'
export * from './text-admin'
export * from './text-roles'
export * from './text-resilience'
