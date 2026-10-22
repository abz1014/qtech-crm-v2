import { paisaToFixed, toPaisa } from '@/lib/money'
import { isMonthKey } from '@/features/money/monthKey'
import { GROUP_LABEL, monthEnd, monthKeyLabel, monthStart, type CategoryGroup } from '@/features/money/expenses/model'

/*
 * Bank tick (M12): the pure rules. No React and no database, so every rule is unit-tested.
 *
 * A statement month M ("2026-10") shows, for money in (bank payments) and money out (bank expenses plus FBR deposits):
 *  - the lines already ticked against M (bank_month / tax_bank_month = M), whatever their own date;
 *  - the lines not ticked yet and dated up to the end of M. Those dated before M are "older".
 * Cash items never appear (paid_via = 'cash'). An FBR deposit is one bank debit for a PSID, however many invoices it
 * covers, so the invoices of a PSID are ONE line that ticks together. Amounts are the bank amounts: for an expense the
 * full debit (amount_pkr, input tax included), for a deposit the deposit amount (the GST amount when none was typed).
 */
export interface RawPayment {
  id: string
  receivedOn: string
  amount: string
  reference: string | null
  orderRef: string | null
  company: string | null
  bankMonth: string | null
}

export interface RawExpense {
  id: string
  paidOn: string
  amount: string
  inputTax: string
  categoryName: string
  grp: CategoryGroup
  note: string | null
  payee: string | null
  orderRef: string | null
  leg: string | null
  bankMonth: string | null
}

export interface RawDeposit {
  id: string
  number: string | null
  invoiceDate: string | null
  company: string | null
  psid: string | null
  depositedOn: string
  amount: string
  bankMonth: string | null
}

export interface RawBank {
  payments: RawPayment[]
  expenses: RawExpense[]
  deposits: RawDeposit[]
}

export interface BankKid {
  id: string
  date: string | null
  number: string | null
  company: string | null
  amount: string
}

export interface BankLine {
  /** Stable key: the row id, or "psid:<psid>" for a group. */
  key: string
  kind: 'payment' | 'expense' | 'fbr'
  dir: 'in' | 'out'
  /** The database rows this line ticks: one id, or every invoice of the PSID. */
  ids: string[]
  date: string
  title: string
  /** The second line, as parts the screen can lay out ("ORD-0042", "IBFT advance"). */
  sub: string[]
  amount: string
  ticked: boolean
  older: boolean
  kids?: BankKid[]
  /** An FBR payment's full PSID (the row shows its last four digits). */
  psid?: string | null
}

export interface BankSide {
  ticked: BankLine[]
  open: BankLine[]
  older: BankLine[]
}

export interface BankView {
  in: BankSide
  out: BankSide
}

export interface Totals {
  tickedIn: { amount: string; count: number }
  tickedOut: { amount: string; count: number }
  openIn: { amount: string; count: number }
  openOut: { amount: string; count: number; older: number }
}

const sum = (lines: readonly { amount: string }[]): string => paisaToFixed(lines.reduce((n, l) => n + toPaisa(l.amount), 0n))
const byDateDesc = (a: BankLine, b: BankLine) => (a.date === b.date ? a.key.localeCompare(b.key) : a.date < b.date ? 1 : -1)

/** "Rent, Office rent"; the category alone when the detail only repeats it ("Salaries", not "Salaries, Salaries"). */
const joinTitle = (head: string, tail: string | null | undefined) =>
  tail?.trim() && tail.trim().toLowerCase() !== head.trim().toLowerCase() ? `${head}, ${tail.trim()}` : head

/** "PSID …2216": the last four digits, enough to find it on the statement without squeezing the row; the full PSID is in `psid`. */
export const shortPsid = (psid: string): string => {
  const digits = psid.replace(/\D/g, '')
  return digits.length > 4 ? `PSID …${digits.slice(-4)}` : `PSID ${psid}`
}

/** The text under a line's title for an item dated before the statement month: "September, not ticked then". */
export const olderNote = (date: string): string => `${monthKeyLabel(date.slice(0, 7)).split(' ')[0]}, not ticked then`

const present = (xs: readonly (string | null | undefined | false)[]): string[] => xs.filter((x): x is string => !!x)

function paymentLine(p: RawPayment, month: string): BankLine {
  const ticked = p.bankMonth === monthStart(month)
  const older = !ticked && p.receivedOn < monthStart(month)
  return {
    key: p.id,
    kind: 'payment',
    dir: 'in',
    ids: [p.id],
    date: p.receivedOn,
    title: p.company ?? 'Payment received',
    sub: older ? present([p.orderRef, olderNote(p.receivedOn)]) : present([p.orderRef, p.reference]),
    amount: p.amount,
    ticked,
    older,
  }
}

function expenseLine(e: RawExpense, month: string): BankLine {
  const ticked = e.bankMonth === monthStart(month)
  const older = !ticked && e.paidOn < monthStart(month)
  const tax = toPaisa(e.inputTax) > 0n ? `input tax ${Number(e.inputTax).toLocaleString('en-US')}` : null
  const sub = older ? [olderNote(e.paidOn)] : e.orderRef ? present([e.orderRef, e.leg, tax]) : present([GROUP_LABEL[e.grp], tax])
  return {
    key: e.id,
    kind: 'expense',
    dir: 'out',
    ids: [e.id],
    date: e.paidOn,
    title: joinTitle(e.categoryName, e.payee ?? e.note),
    sub,
    amount: e.amount,
    ticked,
    older,
  }
}

/** FBR deposits: one line per PSID (an invoice with no PSID is a line of its own). */
function depositLines(deps: readonly RawDeposit[], month: string): BankLine[] {
  const groups = new Map<string, RawDeposit[]>()
  for (const d of deps) {
    const k = d.psid?.trim() ? `psid:${d.psid.trim()}` : `invoice:${d.id}`
    groups.set(k, [...(groups.get(k) ?? []), d])
  }
  const start = monthStart(month)
  return [...groups.entries()].map(([key, members]) => {
    const ticked = members.every(m => m.bankMonth === start)
    const date = members
      .map(m => m.depositedOn)
      .sort()
      .at(-1) as string
    const older = !ticked && date < start
    const psid = members[0].psid?.trim()
    const numbers = members.map(m => m.number).filter((n): n is string => !!n)
    return {
      key,
      kind: 'fbr' as const,
      dir: 'out' as const,
      ids: members.map(m => m.id),
      date,
      title: 'FBR payment',
      psid: psid ?? null,
      sub: [psid ? shortPsid(psid) : 'no PSID recorded', `${members.length} ${members.length === 1 ? 'invoice' : 'invoices'}: ${numbers.join(', ') || 'no number'}`],
      amount: sum(members),
      ticked,
      older,
      kids: members
        .map(m => ({
          id: m.id,
          date: m.invoiceDate,
          number: m.number,
          company: m.company,
          amount: m.amount,
        }))
        .sort((a, b) => ((a.date ?? '') < (b.date ?? '') ? 1 : -1)),
    }
  })
}

/**
 * Which raw rows belong to month M, and how they are grouped. A PSID whose invoices are ticked against different months
 * only shows the members that are in play for M (ticked against M, or not ticked), so a late invoice added to an old PSID
 * is a line of its own to tick.
 */
export function buildBankView(raw: RawBank, month: string): BankView {
  const start = monthStart(month)
  const end = monthEnd(month)
  const inPlay = (bankMonth: string | null, day: string) => bankMonth === start || (bankMonth === null && day <= end)

  const ins = raw.payments.filter(p => inPlay(p.bankMonth, p.receivedOn)).map(p => paymentLine(p, month))
  const exps = raw.expenses.filter(e => inPlay(e.bankMonth, e.paidOn)).map(e => expenseLine(e, month))
  const deps = depositLines(
    raw.deposits.filter(d => inPlay(d.bankMonth, d.depositedOn)),
    month,
  )
  const outs = [...exps, ...deps]

  const split = (lines: BankLine[]): BankSide => ({
    ticked: lines.filter(l => l.ticked).sort(byDateDesc),
    open: lines.filter(l => !l.ticked && !l.older).sort(byDateDesc),
    older: lines.filter(l => !l.ticked && l.older).sort(byDateDesc),
  })
  return { in: split(ins), out: split(outs) }
}

export function bankTotals(v: BankView): Totals {
  const open = (s: BankSide) => [...s.open, ...s.older]
  return {
    tickedIn: { amount: sum(v.in.ticked), count: v.in.ticked.length },
    tickedOut: { amount: sum(v.out.ticked), count: v.out.ticked.length },
    openIn: { amount: sum(open(v.in)), count: open(v.in).length },
    openOut: {
      amount: sum(open(v.out)),
      count: open(v.out).length,
      older: v.out.older.length,
    },
  }
}

/** The raw data after one tick (or untick) of a line: the instant update shown before the server answers. */
export function applyTick(raw: RawBank, line: Pick<BankLine, 'kind' | 'ids'>, month: string | null): RawBank {
  const bankMonth = month ? monthStart(month) : null
  const hit = (id: string) => line.ids.includes(id)
  if (line.kind === 'payment')
    return {
      ...raw,
      payments: raw.payments.map(p => (hit(p.id) ? { ...p, bankMonth } : p)),
    }
  if (line.kind === 'expense')
    return {
      ...raw,
      expenses: raw.expenses.map(e => (hit(e.id) ? { ...e, bankMonth } : e)),
    }
  return {
    ...raw,
    deposits: raw.deposits.map(d => (hit(d.id) ? { ...d, bankMonth } : d)),
  }
}

/** The statement a person is most likely reconciling: last month. */
export function defaultStatementMonth(today: string): string {
  const [y, m] = today.slice(0, 7).split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 2, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export { isMonthKey }

/** The earliest month a Month-end or bank link may open (nothing in the books is older). */
export const FIRST_OPENABLE_MONTH = '2000-01'

/**
 * A month from the address that may be opened: well formed, not before 2000 and not after this month (HE-21). A future month
 * has nothing to check or match, so a link to one falls back to the default month, as Reports does.
 */
export const isOpenableMonth = (s: string | null, today: string): s is string =>
  isMonthKey(s) && s >= FIRST_OPENABLE_MONTH && s <= today.slice(0, 7)
