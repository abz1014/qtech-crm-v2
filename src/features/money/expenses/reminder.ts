import { billPeriod } from '@/features/money/expenses/forMonth'
import { paidViaFor, recurringPaidOn, type Category, type PaidVia } from '@/features/money/expenses/model'

/*
 * The To do reminder for recurring bills (0138, owner: "a one-tap reminder for every bill"). The To do item lists what is due, each
 * line with an amount that can be changed first (electricity is not the same every month), and one "Record all (Rs X)" records
 * them. Pure: the screen and its tests share these.
 */

/** What the reminder needs to know about a bill (a RecurringFact, but not tied to the Today module). */
export interface ReminderBill {
  id: string
  label: string
  dayOfMonth: number | null
  active: boolean
  startMonth: string | null
  period?: string
  recorded: boolean
  categoryId?: string
  amount?: number
  paidVia?: PaidVia | null
  autoBook?: boolean
}

/** Active, started, not yet recorded for its month, and its day has come (a bill with no day is due from the 1st). */
export function isBillDue(t: ReminderBill, today: string): boolean {
  const day = Number(today.slice(8, 10))
  const period = t.period ?? today.slice(0, 7)
  return t.active && !t.recorded && (!t.startMonth || t.startMonth <= period) && (t.dayOfMonth ?? 1) <= day
}

export interface ReminderLine {
  id: string
  label: string
  categoryId: string
  /** The amount that will be recorded (the template's, unless the person changed it). */
  amount: number
  /** The template's own amount, to show a changed one. */
  usual: number
  period: string
  paidOn: string
  paidVia: PaidVia
  dayOfMonth: number | null
}

/** One line per due bill. `edits` holds an amount the person typed for a bill id (null: cleared). */
export function reminderLines(
  bills: readonly ReminderBill[],
  today: string,
  categories: readonly Category[],
  edits: Readonly<Record<string, number | null>> = {},
): ReminderLine[] {
  return bills
    .filter(b => isBillDue(b, today) && b.categoryId !== undefined && b.amount !== undefined)
    .map(b => {
      const usual = b.amount as number
      const typed = b.id in edits ? edits[b.id] : usual
      return {
        id: b.id,
        label: b.label,
        categoryId: b.categoryId as string,
        amount: typed ?? 0,
        usual,
        period: b.period ?? billPeriod({ dayOfMonth: b.dayOfMonth, categoryId: b.categoryId }, today),
        paidOn: recurringPaidOn({ dayOfMonth: b.dayOfMonth }, today),
        paidVia: b.paidVia ?? paidViaFor(b.categoryId as string, categories),
        dayOfMonth: b.dayOfMonth,
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label))
}

/** Lines the database would refuse (an amount of 0 or less). Recording waits until every amount is right. */
export const badLines = (lines: readonly ReminderLine[]): ReminderLine[] => lines.filter(l => !(l.amount > 0))

export const reminderTotal = (lines: readonly ReminderLine[]): number => lines.reduce((s, l) => s + (l.amount > 0 ? l.amount : 0), 0)
