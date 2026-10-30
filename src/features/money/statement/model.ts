import { paisaToFixed, toPaisa, type Amount } from '@/lib/money'

/*
 * A customer's statement of account (process audit 7, migration 0125). Pure arithmetic over the lines customer_statement() returns:
 * the opening balance is every line before the first day, the rows of the range carry a running balance, the closing balance is
 * where it ends. A positive balance is what the customer owes. All sums are whole paisa (bigint), never floats.
 *
 * Credit notes and refunds are being built on fix/money-integrity. A credit note is a CREDIT (the customer owes less), a refund is a
 * DEBIT (money paid back raises what they owe); both arrive here as lines with their own kind, so nothing in this file changes when
 * they merge.
 */
export type StatementKind = 'invoice' | 'payment' | 'credit_note' | 'refund'

export interface StatementLine {
  on: string
  kind: StatementKind
  ref: string | null
  orderNumber: number | null
  note: string | null
  debit: bigint
  credit: bigint
  seq: number
}

export interface StatementRow extends StatementLine {
  /** What the customer owes after this line. */
  balance: bigint
}

export interface Statement {
  from: string
  to: string
  opening: bigint
  rows: StatementRow[]
  closing: bigint
  charged: bigint
  credited: bigint
}

export interface RawStatementLine {
  line_on: string
  kind: string
  ref: string | null
  order_number: number | string | null
  note: string | null
  debit: Amount | null
  credit: Amount | null
  seq: number | null
}

const KINDS: readonly string[] = ['invoice', 'payment', 'credit_note', 'refund']

export function toLines(rows: readonly RawStatementLine[]): StatementLine[] {
  return rows
    .filter(r => KINDS.includes(r.kind))
    .map(r => ({
      on: r.line_on,
      kind: r.kind as StatementKind,
      ref: r.ref,
      orderNumber: r.order_number === null || r.order_number === undefined ? null : Number(r.order_number),
      note: r.note,
      debit: toPaisa(r.debit ?? 0),
      credit: toPaisa(r.credit ?? 0),
      seq: r.seq ?? 0,
    }))
}

const byOrder = (a: StatementLine, b: StatementLine) => (a.on < b.on ? -1 : a.on > b.on ? 1 : a.seq - b.seq || (a.ref ?? '').localeCompare(b.ref ?? ''))

export function buildStatement(lines: readonly StatementLine[], from: string, to: string): Statement {
  const sorted = [...lines].sort(byOrder)
  let balance = 0n
  for (const l of sorted) if (l.on < from) balance += l.debit - l.credit
  const opening = balance
  const rows: StatementRow[] = []
  let charged = 0n
  let credited = 0n
  for (const l of sorted) {
    if (l.on < from || l.on > to) continue
    balance += l.debit - l.credit
    charged += l.debit
    credited += l.credit
    rows.push({ ...l, balance })
  }
  return { from, to, opening, rows, closing: balance, charged, credited }
}

export const KIND_LABEL: Record<StatementKind, string> = {
  invoice: 'Invoice',
  payment: 'Payment received',
  credit_note: 'Credit note',
  refund: 'Refund paid',
}

/** "Rs 1,234.00" style amount for a statement cell, always with paisa so columns line up. */
export const fixed = (p: bigint): string => paisaToFixed(p)

/** The first day of the Pakistani financial year (1 July) that `today` falls in. */
export function financialYearStart(today: string): string {
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7))
  return `${m >= 7 ? y : y - 1}-07-01`
}
