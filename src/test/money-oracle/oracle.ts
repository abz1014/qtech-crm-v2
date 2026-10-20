/*
 * The money oracle: an independent reference model of Q-Tech's bookkeeping rules, for tests only.
 *
 * Written from the rules (DATA_MODEL 2.13 to 2.19, 5, 5a, A6; DECISIONS; docs/MONEY_REVIEW.md and the owner decisions of
 * 2026-10-19), NOT from the app's code: nothing here imports from src/features or src/lib. Every amount is an exact integer
 * number of paisa (bigint); every rounding is half away from zero, as Postgres numeric does it. Dates are YYYY-MM-DD strings
 * and calendar arithmetic is done on day numbers (no Date, no time zone), so the model cannot drift with the machine's clock.
 *
 * The rules, in one place:
 *   line net        round(qty x unit price, 2)                       qty 3 dp, price 2 dp
 *   line GST        round(line net x rate / 100, 0)  whole rupees per line; rate 0 = exempt
 *   order basis     any invoice: N = sum invoice net, G = sum invoice gross; none: N, G from the lines
 *   payment split   net = round(amount x N / G, 2), GST = amount - net; none when the order is basis-unknown or G = 0
 *   settled         G > 0 and paid >= G - 1 (Rs 1 allowance); balance = max(G - paid, 0); overpaid = max(paid - G, 0)
 *   due date        first invoice date + (order terms, else the company default)
 *   overdue         due date before today and not settled
 *   receivables     a cancelled order is listed only when it has an invoice (D-MR3)
 *   aging           payments up to the date applied oldest invoice first; remaining gross bucketed 0-30/31-60/61-90/90+;
 *                   an order paid with no invoice yet is an advance; settled-before-cutover invoices are fully received
 *   margin          net sale (invoice net if invoiced, else line net) less tagged expenses' net cost (amount - input tax)
 *   P&L (cash)      by payment / expense date and Karachi calendar month; result = net in - order costs - overheads
 *   GST month       by invoice date; output GST never netted with input tax (input tax by expense date)
 *   we owe          committed (latest PO total, else qty x supplier price) x rate (PKR = 1; else the latest rate at most 30
 *                   days before the date, manual first on a day) less paid (supplier payments' net cost); settled within 3%
 *   month close     a closed month's P&L is frozen at close; a later change to it is shown in the first open month after the
 *                   last closed one; over all months the results still add up to the live books
 *   cash in vs out  (owner decision 2026-10-20) by Karachi month: in = every payment received, gross, voided ones left out;
 *                   out = every expense paid, gross (input tax in), every category. A quarter is a calendar quarter.
 *   profit invoiced (owner decision 2026-10-20) sales = invoice net by invoice date; an order's order-cost expenses count in the
 *                   later of their paid month and the order's first invoice month, are held while it has none, and go in the
 *                   later of paid and cancel month once a never-invoiced order is cancelled; untagged order costs and
 *                   overheads count when paid (net of input tax); drawings and loan repayments are not costs
 */

export type Paisa = bigint

// ------------------------------------------------------------------------------------------------ exact decimals

/** n / d rounded half away from zero. */
export function roundDiv(n: bigint, d: bigint): bigint {
  if (d === 0n) throw new Error('division by zero')
  const neg = n < 0n !== d < 0n
  const an = n < 0n ? -n : n
  const ad = d < 0n ? -d : d
  const q = (2n * an + ad) / (2n * ad)
  return neg ? -q : q
}

/** Decimal text as an integer scaled by 10^scale. Throws if the text has more decimals than the scale (no silent rounding). */
export function dec(text: string, scale: number): bigint {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text)
  if (!m) throw new Error(`oracle: not a decimal "${text}"`)
  const frac = m[3] ?? ''
  if (frac.length > scale) throw new Error(`oracle: "${text}" has more than ${scale} decimals`)
  const v = BigInt(m[2] + frac.padEnd(scale, '0'))
  return m[1] === '-' ? -v : v
}

/** Paisa as "1234.50" (the text Postgres prints for numeric(14,2)). */
export function rs(p: Paisa): string {
  const neg = p < 0n
  const a = neg ? -p : p
  return `${neg ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`
}

export const maxP = (a: Paisa, b: Paisa): Paisa => (a > b ? a : b)
export const minP = (a: Paisa, b: Paisa): Paisa => (a < b ? a : b)
export const sumP = (xs: Iterable<Paisa>): Paisa => {
  let t = 0n
  for (const x of xs) t += x
  return t
}

// ------------------------------------------------------------------------------------------------ calendar (no Date)

/** Days since 1970-01-01 for a proleptic Gregorian date (H. Hinnant's days_from_civil). */
export function dayNumber(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) throw new Error(`oracle: not a date "${iso}"`)
  let y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  y -= mo <= 2 ? 1 : 0
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const doy = Math.floor((153 * (mo + (mo > 2 ? -3 : 9)) + 2) / 5) + d - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

export function fromDayNumber(z0: number): string {
  const z = z0 + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp + (mp < 10 ? 3 : -9)
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0)
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export const addDays = (iso: string, n: number): string => fromDayNumber(dayNumber(iso) + n)
export const daysFrom = (a: string, b: string): number => dayNumber(b) - dayNumber(a)
export const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
export const daysInMonth = (y: number, m: number): number => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
/** "2026-02" for any date in February 2026. */
export const monthOf = (iso: string): string => iso.slice(0, 7)
export function lastDayOf(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number)
  return `${monthKey}-${String(daysInMonth(y, m)).padStart(2, '0')}`
}
export function nextMonth(monthKey: string, by = 1): string {
  const [y, m] = monthKey.split('-').map(Number)
  const t = y * 12 + (m - 1) + by
  return `${String(Math.floor(t / 12)).padStart(4, '0')}-${String((t % 12) + 1).padStart(2, '0')}`
}
/** 0 = Monday ... 6 = Sunday. 1970-01-01 was a Thursday. */
export const weekday = (iso: string): number => (((dayNumber(iso) + 3) % 7) + 7) % 7
/** n working days after a date (Saturday and Sunday are not working days). */
export function addWorkingDays(iso: string, n: number): string {
  let d = iso
  let left = n
  while (left > 0) {
    d = addDays(d, 1)
    if (weekday(d) < 5) left -= 1
  }
  return d
}

/** The Karachi calendar date of an instant (UTC+5 all year: Pakistan has no daylight saving). */
export function karachiDate(epochMs: number): string {
  return fromDayNumber(Math.floor((epochMs + 5 * 3_600_000) / 86_400_000))
}

// ------------------------------------------------------------------------------------------------ lines and orders

export interface Line {
  /** Up to 3 decimals (numeric(12,3)), > 0. */
  qty: string
  /** Up to 2 decimals (numeric(14,2)), >= 0. */
  price: string
  /** Percent, up to 2 decimals; 0 is exempt. */
  rate: string
}

export const lineNet = (l: Pick<Line, 'qty' | 'price'>): Paisa => roundDiv(dec(l.qty, 3) * dec(l.price, 2), 1000n)
/** round(net x rate / 100, 0) rupees, in paisa. */
export const lineGst = (net: Paisa, rate: string): Paisa => roundDiv(net * dec(rate, 2), 1_000_000n) * 100n

export interface Totals {
  net: Paisa
  gst: Paisa
  gross: Paisa
}
export function itemsTotal(lines: readonly Line[]): Totals {
  let net = 0n
  let gst = 0n
  for (const l of lines) {
    const n = lineNet(l)
    net += n
    gst += lineGst(n, l.rate)
  }
  return { net, gst, gross: net + gst }
}

/** GST on an invoice net typed as one amount, 18% or exempt (the invoice dialog's own rule, whole rupees). */
export const invoiceGst = (net: Paisa, exempt: boolean): Paisa => (exempt || net <= 0n ? 0n : roundDiv(net * 18n, 10_000n) * 100n)

/** Legacy "price was gross": unit price / (1 + rate / 100), to the paisa (resolve_value_basis 'gross'). */
export const netFromGrossPrice = (pricePaisa: Paisa, rate: string): Paisa => roundDiv(pricePaisa * 10_000n, 10_000n + dec(rate, 2))

/** qty (3 dp) x a price of up to 6 decimals, rounded to the paisa (supplier prices, PO lines). */
export const productP = (qty: string, price: string, priceScale = 6): Paisa => roundDiv(dec(qty, 3) * dec(price, priceScale), 10n ** BigInt(3 + priceScale - 2))

/** A foreign amount (paisa-scaled) x a rate (6 dp), rounded once to the paisa. */
export const convertP = (foreignP: Paisa, rate6: bigint): Paisa => roundDiv(foreignP * rate6, 1_000_000n)

export interface Order {
  id: string
  number: number
  companyId: string
  ownerId: string | null
  lines: Line[]
  /** orders.payment_terms_days; null follows the company default. */
  terms: number | null
  cancelledOn: string | null
  basisUnknown: boolean
  costsComplete: boolean
  expectedCost: Paisa | null
}

export interface Invoice {
  id: string
  orderId: string | null
  number: string
  /** null only on legacy rows. */
  date: string | null
  net: Paisa
  gst: Paisa
  settledBeforeCutover?: boolean
  taxDepositedOn?: string | null
  psid?: string | null
}

export interface Payment {
  id: string
  orderId: string
  date: string
  amount: Paisa
  /** Whose target it counts towards; null = unattributed (still company cash). */
  credited: string | null
  /** Voided (0073): kept as history, left out of every figure. */
  voided?: boolean
}

export type Group = 'overhead' | 'order_cost' | 'non_pnl'

export interface Expense {
  id: string
  date: string
  amount: Paisa
  inputTax: Paisa
  grp: Group
  categoryId: string
  orderId: string | null
  legId: string | null
  supplierPayment: boolean
}

export interface Basis {
  basis: 'invoice' | 'items'
  invoiceCount: number
  invoiceNet: Paisa
  invoiceGross: Paisa
  items: Totals
  n: Paisa
  g: Paisa
}

export function basisOf(order: Order, invoices: readonly Invoice[]): Basis {
  const mine = invoices.filter(i => i.orderId === order.id)
  const items = itemsTotal(order.lines)
  const invoiceNet = sumP(mine.map(i => i.net))
  const invoiceGross = sumP(mine.map(i => i.net + i.gst))
  const inv = mine.length > 0
  return { basis: inv ? 'invoice' : 'items', invoiceCount: mine.length, invoiceNet, invoiceGross, items, n: inv ? invoiceNet : items.net, g: inv ? invoiceGross : items.gross }
}

export type Excluded = 'basis_unknown' | 'zero_value' | 'unattributed' | null

export interface PaymentSplit {
  payment: Payment
  excluded: Excluded
  net: Paisa | null
  gst: Paisa | null
  countsInCash: boolean
  countsInTarget: boolean
}

export function splitPayment(p: Payment, order: Order, b: Basis): PaymentSplit {
  const excluded: Excluded = order.basisUnknown ? 'basis_unknown' : b.g === 0n ? 'zero_value' : p.credited === null ? 'unattributed' : null
  const split = excluded === 'basis_unknown' || excluded === 'zero_value'
  const net = split ? null : roundDiv(p.amount * b.n, b.g)
  return { payment: p, excluded, net, gst: net === null ? null : p.amount - net, countsInCash: !split, countsInTarget: excluded === null }
}

export interface Receivable {
  orderId: string
  gross: Paisa
  settled: Paisa
  balance: Paisa
  overpaid: Paisa
  settledOk: boolean
  dueOn: string | null
  overdue: boolean
  state: 'overdue' | 'settled' | 'part' | 'unpaid'
  /** order_receivables() lists it (a cancelled order only with an invoice). */
  listed: boolean
}

export interface Books {
  orders: Order[]
  invoices: Invoice[]
  payments: Payment[]
  expenses: Expense[]
  /** company_profile.default_payment_terms_days */
  defaultTerms: number
}

export function receivableOf(order: Order, books: Pick<Books, 'invoices' | 'payments' | 'defaultTerms'>, today: string): Receivable {
  const b = basisOf(order, books.invoices)
  const settled = sumP(books.payments.filter(p => p.orderId === order.id).map(p => p.amount))
  const settledOk = b.g > 0n && settled >= b.g - 100n
  const dates = books.invoices.filter(i => i.orderId === order.id && i.date !== null).map(i => i.date as string).sort()
  const dueOn = dates.length ? addDays(dates[0], order.terms ?? books.defaultTerms) : null
  const overdue = dueOn !== null && dueOn < today && !settledOk
  return {
    orderId: order.id,
    gross: b.g,
    settled,
    balance: maxP(b.g - settled, 0n),
    overpaid: maxP(settled - b.g, 0n),
    settledOk,
    dueOn,
    overdue,
    state: overdue ? 'overdue' : settledOk ? 'settled' : settled > 0n ? 'part' : 'unpaid',
    listed: order.cancelledOn === null || b.invoiceCount > 0,
  }
}

export interface OrderMoney extends Receivable {
  netSale: Paisa
  actualCost: Paisa
  margin: Paisa | null
  marginState: 'basis_unknown' | 'provisional' | 'final'
}

export function orderMoneyOf(order: Order, books: Books, today: string): OrderMoney {
  const r = receivableOf(order, books, today)
  const b = basisOf(order, books.invoices)
  const netSale = b.basis === 'invoice' ? b.invoiceNet : b.items.net
  const actualCost = sumP(books.expenses.filter(e => e.orderId === order.id).map(e => e.amount - e.inputTax))
  return {
    ...r,
    netSale,
    actualCost,
    margin: order.basisUnknown ? null : netSale - actualCost,
    marginState: order.basisUnknown ? 'basis_unknown' : order.costsComplete ? 'final' : 'provisional',
  }
}

/** What a customer owes in all (the company page): over its orders as receivables lists them. */
export function companyMoney(companyId: string, books: Books, today: string): { gross: Paisa; received: Paisa; balance: Paisa; overpaid: Paisa } {
  const rows = books.orders.filter(o => o.companyId === companyId).map(o => receivableOf(o, books, today)).filter(r => r.listed)
  return {
    gross: sumP(rows.map(r => r.gross)),
    received: sumP(rows.map(r => r.settled)),
    balance: sumP(rows.map(r => r.balance)),
    overpaid: sumP(rows.map(r => r.overpaid)),
  }
}

// ------------------------------------------------------------------------------------------------ aging

export type Bucket = '0-30' | '31-60' | '61-90' | '90+'
export const bucketOf = (age: number): Bucket => (age <= 30 ? '0-30' : age <= 60 ? '31-60' : age <= 90 ? '61-90' : '90+')

export interface AgingInvoice {
  invoiceId: string
  orderId: string | null
  gross: Paisa
  applied: Paisa
  remaining: Paisa
  age: number
  bucket: Bucket
}

export function agingAsOf(asOf: string, books: Pick<Books, 'invoices' | 'payments'>): { invoices: AgingInvoice[]; advances: { orderId: string; held: Paisa }[] } {
  const inv = books.invoices.filter(i => i.date !== null && i.date <= asOf && !i.settledBeforeCutover)
  const paidBy = new Map<string, Paisa>()
  for (const p of books.payments) if (p.date <= asOf) paidBy.set(p.orderId, (paidBy.get(p.orderId) ?? 0n) + p.amount)
  const out: AgingInvoice[] = []
  const byOrder = new Map<string, Invoice[]>()
  const unlinked: Invoice[] = []
  for (const i of inv) {
    if (i.orderId === null) unlinked.push(i)
    else byOrder.set(i.orderId, [...(byOrder.get(i.orderId) ?? []), i])
  }
  const push = (i: Invoice, applied: Paisa) => {
    const gross = i.net + i.gst
    const age = daysFrom(i.date as string, asOf)
    if (gross - applied > 0n) out.push({ invoiceId: i.id, orderId: i.orderId, gross, applied, remaining: gross - applied, age, bucket: bucketOf(age) })
  }
  for (const [orderId, list] of byOrder) {
    // the Rs 1 allowance of order_receivables (BUG-M3): an order paid to within Rs 1 of what it is invoiced is settled, not aged
    const invoiced = sumP(list.map(i => i.net + i.gst))
    if (invoiced > 0n && (paidBy.get(orderId) ?? 0n) >= invoiced - 100n) continue
    // oldest first: date, then number, then id (byte order, as Postgres "C"-like comparison of these ASCII strings)
    const sorted = [...list].sort((a, b) => cmp(a.date as string, b.date as string) || cmp(a.number, b.number) || cmp(a.id, b.id))
    let left = paidBy.get(orderId) ?? 0n
    for (const i of sorted) {
      const gross = i.net + i.gst
      const applied = minP(gross, maxP(left, 0n))
      left -= applied
      push(i, applied)
    }
  }
  for (const i of unlinked) push(i, 0n)
  const advances: { orderId: string; held: Paisa }[] = []
  for (const [orderId, held] of paidBy) if (held > 0n && !byOrder.has(orderId)) advances.push({ orderId, held })
  return { invoices: out, advances }
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

// ------------------------------------------------------------------------------------------------ P&L, GST month, team

export interface MonthPnl {
  month: string
  netIn: Paisa
  gstIn: Paisa
  unresolvedGross: Paisa
  orderCosts: Paisa
  overheads: Paisa
  nonPnl: Paisa
  cashOut: Paisa
  inputTax: Paisa
  result: Paisa
  afterDrawings: Paisa
}

export function monthPnlLive(month: string, books: Books): MonthPnl {
  let netIn = 0n
  let gstIn = 0n
  let unresolved = 0n
  for (const p of books.payments) {
    if (monthOf(p.date) !== month || p.voided) continue
    const order = books.orders.find(o => o.id === p.orderId) as Order
    const s = splitPayment(p, order, basisOf(order, books.invoices))
    if (s.countsInCash) {
      netIn += s.net as Paisa
      gstIn += s.gst as Paisa
    } else unresolved += p.amount
  }
  const ex = books.expenses.filter(e => monthOf(e.date) === month)
  const net = (g: Group) => sumP(ex.filter(e => e.grp === g).map(e => e.amount - e.inputTax))
  const orderCosts = net('order_cost')
  const overheads = net('overhead')
  const nonPnl = net('non_pnl')
  const result = netIn - orderCosts - overheads
  return {
    month,
    netIn,
    gstIn,
    unresolvedGross: unresolved,
    orderCosts,
    overheads,
    nonPnl,
    cashOut: sumP(ex.map(e => e.amount)),
    inputTax: sumP(ex.map(e => e.inputTax)),
    result,
    afterDrawings: result - nonPnl,
  }
}

export function gstMonth(month: string, books: Pick<Books, 'invoices' | 'expenses'>): { count: number; net: Paisa; gst: Paisa; toDeposit: Paisa; inputTax: Paisa } {
  const inv = books.invoices.filter(i => i.date !== null && monthOf(i.date) === month)
  return {
    count: inv.length,
    net: sumP(inv.map(i => i.net)),
    gst: sumP(inv.map(i => i.gst)),
    toDeposit: sumP(inv.filter(i => !i.taxDepositedOn).map(i => i.gst)),
    inputTax: sumP(books.expenses.filter(e => monthOf(e.date) === month).map(e => e.inputTax)),
  }
}

/** Net credited per person in a month: payments that count towards a target. */
export function teamMonth(month: string, books: Books): Map<string, { net: Paisa; count: number }> {
  const out = new Map<string, { net: Paisa; count: number }>()
  for (const p of books.payments) {
    if (monthOf(p.date) !== month) continue
    const order = books.orders.find(o => o.id === p.orderId) as Order
    const s = splitPayment(p, order, basisOf(order, books.invoices))
    if (!s.countsInTarget) continue
    const cur = out.get(p.credited as string) ?? { net: 0n, count: 0 }
    out.set(p.credited as string, { net: cur.net + (s.net as Paisa), count: cur.count + 1 })
  }
  return out
}

/** On pace = round(target x days elapsed / days in quarter, 2); today counts as elapsed. */
export function onPace(target: Paisa, quarterStartIso: string, today: string): Paisa {
  const [y, m] = quarterStartIso.split('-').map(Number)
  const next = `${String(m + 3 > 12 ? y + 1 : y).padStart(4, '0')}-${String(((m + 2) % 12) + 1).padStart(2, '0')}-01`
  const total = daysFrom(quarterStartIso, next)
  const elapsed = Math.min(Math.max(daysFrom(quarterStartIso, today) + 1, 0), total)
  return roundDiv(target * BigInt(elapsed), BigInt(total))
}

// ------------------------------------------------------------------------------------------------ we owe

export interface Leg {
  id: string
  orderId: string
  currency: string | null
  placedOn: string | null
  /** qty x supplier price of each priced line, before rounding: [qty (3 dp), price (4 dp)] */
  priced: Array<[string, string]>
  /** Latest PO revision: total (paisa-scaled in the PO currency) and its currency; null when no PO. */
  po: { total: Paisa; currency: string } | null
}

export interface Rate {
  currency: string
  /** PKR per unit, up to 6 decimals. */
  rate: string
  asOf: string
  manual: boolean
}

export interface Payable {
  legId: string
  currency: string
  /** committed in the leg currency, scaled 10^7 (qty 3 dp x price 4 dp) or the PO total scaled to the same */
  committed7: bigint | null
  rate: string | null
  committedPkr: Paisa | null
  paid: Paisa
  owed: Paisa | null
  state: 'settled' | 'owing' | 'unpriced' | 'no_rate'
  overpaid: boolean
}

export function payablesAsOf(asOf: string, legs: readonly Leg[], orders: readonly Order[], expenses: readonly Expense[], rates: readonly Rate[]): Payable[] {
  const out: Payable[] = []
  for (const l of legs) {
    if (l.placedOn === null || l.placedOn > asOf) continue
    const o = orders.find(x => x.id === l.orderId) as Order
    if (o.cancelledOn !== null && o.cancelledOn <= asOf) continue
    const currency = (l.po ? l.po.currency : l.currency) ?? 'PKR'
    const committed7 = l.po ? l.po.total * 100_000n : l.priced.length ? l.priced.reduce((s, [q, p]) => s + dec(q, 3) * dec(p, 4), 0n) : null
    const paid = sumP(expenses.filter(e => e.legId === l.id && e.supplierPayment && e.date <= asOf).map(e => e.amount - e.inputTax))
    let rate: string | null = null
    if (currency === 'PKR') rate = '1'
    else {
      const usable = rates
        .filter(r => r.currency === currency && r.asOf <= asOf && daysFrom(r.asOf, asOf) <= 30)
        .sort((a, b) => cmp(b.asOf, a.asOf) || Number(b.manual) - Number(a.manual))
      rate = usable[0]?.rate ?? null
    }
    let committedPkr: Paisa | null = null
    if (committed7 !== null && rate !== null) {
      const r6 = dec(rate.includes('.') ? rate : `${rate}.0`, 6)
      committedPkr = roundDiv(committed7 * r6, 100_000n * 1_000_000n)
    }
    const raw = committedPkr === null ? null : committedPkr - paid
    out.push({
      legId: l.id,
      currency,
      committed7,
      rate,
      committedPkr,
      paid,
      owed: raw === null ? null : maxP(raw, 0n),
      state: committed7 === null ? 'unpriced' : rate === null ? 'no_rate' : (raw as Paisa) * 100n <= 3n * (committedPkr as Paisa) ? 'settled' : 'owing',
      overpaid: raw !== null && raw < 0n,
    })
  }
  return out
}

// ------------------------------------------------------------------------------------------------ month close (frozen P&L)

export type PnlFields = Pick<MonthPnl, 'netIn' | 'gstIn' | 'unresolvedGross' | 'orderCosts' | 'overheads' | 'nonPnl'>
const FIELDS: (keyof PnlFields)[] = ['netIn', 'gstIn', 'unresolvedGross', 'orderCosts', 'overheads', 'nonPnl']
const zero = (): PnlFields => ({ netIn: 0n, gstIn: 0n, unresolvedGross: 0n, orderCosts: 0n, overheads: 0n, nonPnl: 0n })
const pick = (p: MonthPnl): PnlFields => ({ netIn: p.netIn, gstIn: p.gstIn, unresolvedGross: p.unresolvedGross, orderCosts: p.orderCosts, overheads: p.overheads, nonPnl: p.nonPnl })
const minus = (a: PnlFields, b: PnlFields): PnlFields => Object.fromEntries(FIELDS.map(f => [f, a[f] - b[f]])) as PnlFields
const plus = (a: PnlFields, b: PnlFields): PnlFields => Object.fromEntries(FIELDS.map(f => [f, a[f] + b[f]])) as PnlFields
export const resultOf = (f: PnlFields): Paisa => f.netIn - f.orderCosts - f.overheads

/**
 * The owner's rule for a closed month (D-MR2), as a ledger: closing saves the month's own figures, plus every change to an
 * earlier closed month not yet shown anywhere; reopening throws the month's saved figures away. Each month shows its saved
 * figures if closed, else its live ones, and the first open month after the last closed one also shows what moved since.
 */
export class CloseLedger {
  private snaps = new Map<string, { own: PnlFields; adjust: PnlFields }>()
  constructor(private live: (month: string) => PnlFields) {}

  close(month: string): void {
    if (this.snaps.has(month)) return
    this.snaps.set(month, { own: this.live(month), adjust: zero() })
    const shown = this.pending()
    this.snaps.set(month, { own: this.live(month), adjust: shown })
  }

  reopen(month: string): void {
    this.snaps.delete(month)
  }

  isClosed(month: string): boolean {
    return this.snaps.has(month)
  }

  /** Live less saved over the closed months, less what earlier closes already showed. */
  pending(): PnlFields {
    let drift = zero()
    let done = zero()
    for (const [m, s] of this.snaps) {
      drift = plus(drift, minus(this.live(m), s.own))
      done = plus(done, s.adjust)
    }
    return minus(drift, done)
  }

  /** The month the pending changes show in: the month after the last closed one. */
  target(): string | null {
    const ms = [...this.snaps.keys()].sort()
    return ms.length ? nextMonth(ms[ms.length - 1]) : null
  }

  /** What the P&L shows for a month: its own figures and the adjustment counted in it. */
  shown(month: string): { own: PnlFields; adjust: PnlFields; result: Paisa } {
    const s = this.snaps.get(month)
    const own = s ? s.own : this.live(month)
    const adjust = s ? s.adjust : month === this.target() ? this.pending() : zero()
    return { own, adjust, result: resultOf(own) + resultOf(adjust) }
  }
}

export const livePnlFields = (books: Books) => (month: string): PnlFields => pick(monthPnlLive(month, books))

// ------------------------------------------------------------------------------------------------ cash in vs out, profit invoiced

export interface CashMonth {
  in: Paisa
  payments: number
  out: Paisa
  expenses: number
}

/** The money trail of a month: gross, voided payments out, every expense category in. */
export function cashMonth(month: string, books: Pick<Books, 'payments' | 'expenses'>): CashMonth {
  const pays = books.payments.filter(p => !p.voided && monthOf(p.date) === month)
  const ex = books.expenses.filter(e => monthOf(e.date) === month)
  return { in: sumP(pays.map(p => p.amount)), payments: pays.length, out: sumP(ex.map(e => e.amount)), expenses: ex.length }
}

/** The month an expense counts in on the invoiced basis, or null (not a cost, or held for an order not yet invoiced). */
export function costMonth(e: Expense, books: Pick<Books, 'orders' | 'invoices'>): string | null {
  const paid = monthOf(e.date)
  if (e.grp === 'non_pnl') return null
  if (e.grp === 'overhead' || e.orderId === null) return paid
  const dates = books.invoices.filter(i => i.orderId === e.orderId && i.date !== null).map(i => i.date as string).sort()
  const later = (a: string, b: string) => (a > b ? a : b)
  if (dates.length) return later(monthOf(dates[0]), paid)
  const cancelled = books.orders.find(o => o.id === e.orderId)?.cancelledOn ?? null
  return cancelled ? later(monthOf(cancelled), paid) : null
}

export interface ProfitMonth {
  sales: Paisa
  salesGst: Paisa
  invoices: number
  orderCosts: Paisa
  overheads: Paisa
  profit: Paisa
  orderCostsPaid: Paisa
  nonPnlPaid: Paisa
  inputTaxPaid: Paisa
}

export function profitMonth(month: string, books: Books): ProfitMonth {
  const inv = books.invoices.filter(i => i.date !== null && monthOf(i.date) === month)
  const net = (e: Expense) => e.amount - e.inputTax
  const counted = books.expenses.filter(e => costMonth(e, books) === month)
  const paid = books.expenses.filter(e => monthOf(e.date) === month)
  const sales = sumP(inv.map(i => i.net))
  const orderCosts = sumP(counted.filter(e => e.grp === 'order_cost').map(net))
  const overheads = sumP(counted.filter(e => e.grp === 'overhead').map(net))
  return {
    sales,
    salesGst: sumP(inv.map(i => i.gst)),
    invoices: inv.length,
    orderCosts,
    overheads,
    profit: sales - orderCosts - overheads,
    orderCostsPaid: sumP(paid.filter(e => e.grp === 'order_cost').map(net)),
    nonPnlPaid: sumP(paid.filter(e => e.grp === 'non_pnl').map(net)),
    inputTaxPaid: sumP(paid.map(e => e.inputTax)),
  }
}

/** The calendar quarter's months: "2026-Q4" -> 2026-10, 2026-11, 2026-12. */
export const quarterMonths = (key: string): string[] => {
  const first = (Number(key.slice(6)) - 1) * 3 + 1
  return [0, 1, 2].map(i => `${key.slice(0, 4)}-${String(first + i).padStart(2, '0')}`)
}
