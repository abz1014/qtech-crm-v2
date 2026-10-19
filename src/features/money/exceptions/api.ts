import { requireSupabase, unwrap } from '@/lib/supabase'
import type { ReconciliationInput } from '@/lib/reconciliation'

/*
 * The rows the reconciliation checks read (M07). ADMIN ONLY. The database does the heavy part: money_exceptions_input() (0057)
 * returns only the rows that can produce a finding, plus the orders and money rows those findings look up, in the shape of
 * ReconciliationInput; for anyone who is not an admin it returns NULL, which reads as "nothing to check". The checks themselves
 * stay pure (src/lib/reconciliation.ts) and decide exactly what is an exception.
 */
export const EMPTY_RECONCILIATION_INPUT: ReconciliationInput = { orders: [], money: [], payments: [], expenses: [], invoices: [], legs: [], pos: [], legPaid: [] }

/** The jsonb document of money_exceptions_input() as the checks' input. A missing list is an empty one. */
export function toReconciliationInput(doc: unknown): ReconciliationInput {
  if (doc === null || doc === undefined || typeof doc !== 'object') return EMPTY_RECONCILIATION_INPUT
  const d = doc as Partial<Record<keyof ReconciliationInput, unknown>>
  const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
  return {
    orders: list(d.orders),
    money: list(d.money),
    payments: list(d.payments),
    expenses: list(d.expenses),
    invoices: list(d.invoices),
    legs: list(d.legs),
    pos: list(d.pos),
    legPaid: list(d.legPaid),
  }
}

export async function getReconciliationInput(): Promise<ReconciliationInput> {
  const db = requireSupabase()
  return toReconciliationInput(unwrap(await db.rpc('money_exceptions_input')))
}
