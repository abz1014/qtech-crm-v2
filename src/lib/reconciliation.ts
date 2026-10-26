// Ported from src/lib/finance/reconciliation.ts @ 7a29f3a (Q-Tech CRM v1). Rewritten for the v2 model (M07): the checks run over
// the new views and tables (v_order_money, v_order_basis, invoices, payments_in, expenses, supplier legs, POs) instead of the old
// order_value / cost_value columns, and a few v2-only checks are added (price basis unknown, costs left provisional on a settled
// order). Pure and framework-free: the caller fetches the rows (admin only) and this decides what needs a human look.
//
// What it is not: a score. Each exception is one fact, with the order it is about, so the panel can link to it.

export type ExceptionSeverity = 'critical' | 'warning'

export interface ReconciliationException {
  /** Stable key for React lists and dedup. */
  key: string
  severity: ExceptionSeverity
  category: string
  message: string
  /** The order this is about, so the panel can open /orders/:id. */
  orderId?: string
  /** The invoice this is about (the GST register shows it). */
  invoiceId?: string
}

/** Rounding allowance, in rupees (the same Rs 1 the views use). */
export const AMOUNT_TOLERANCE = 1
/** Relative tolerance on the GST-rate check. */
export const GST_TOLERANCE_PCT = 0.02
/** Used when an order has no item lines to read its own rate from (an imported order). */
const DEFAULT_GST_RATE = 0.18

// ------------------------------------------------------------------------------------------------ inputs

export interface RcOrder {
  id: string
  number: number
  orderedOn: string | null
  cancelled: boolean
  /** Legacy flag value_basis_unknown: no net is guessed, so margin and net cash leave it out. */
  basisUnknown: boolean
  /** Imported from the old CRM (orders.legacy_source is set; pending DB batch A). History: no finding is raised on it (redesign phase 0, D10). */
  legacy?: boolean
}

/** One row per order from v_order_basis and v_order_money. */
export interface RcMoney {
  orderId: string
  /** The gross the customer owes (G): invoiced gross if invoiced, else from the items. */
  grossTarget: number
  /** Σ payments_in.amount. */
  settled: number
  itemsNet: number
  itemsGross: number
  invoiceCount: number
  invoiceGross: number
  expectedCost: number | null
  actualCost: number
  costsComplete: boolean
}

export interface RcPayment {
  id: string
  orderId: string
  amount: number
  receivedOn: string
}

export interface RcExpense {
  id: string
  orderId: string | null
  legId: string | null
  /** The net cost the margin uses: amount less recoverable input tax. */
  cost: number
  paidOn: string
}

export interface RcInvoice {
  id: string
  number: string | null
  orderId: string | null
  invoiceDate: string | null
  net: number
  gst: number
  copyReceivedOn: string | null
  tcsSentOn: string | null
  clientReceivedOn: string | null
  taxDepositedOn: string | null
  /** An imported register row (legacy flags set): may be unlinked on purpose. */
  legacy: boolean
}

export interface RcLeg {
  id: string
  orderId: string
  label: string
  placedOn: string | null
  expectedOn: string | null
  receivedOn: string | null
  deliveredOn: string | null
  currency: string | null
}

/** The latest revision of a leg's PO. */
export interface RcPo {
  legId: string
  total: number
  currency: string
}

export interface ReconciliationInput {
  orders: readonly RcOrder[]
  money: readonly RcMoney[]
  payments: readonly RcPayment[]
  expenses: readonly RcExpense[]
  invoices: readonly RcInvoice[]
  legs: readonly RcLeg[]
  pos: readonly RcPo[]
  /**
   * Supplier payments per leg, summed by the database (money_exceptions_input()). When given it replaces summing `expenses`,
   * which then holds only the expenses that are findings by themselves. Absent: the sum is taken from `expenses`.
   */
  legPaid?: readonly { legId: string; paid: number }[]
}

// ------------------------------------------------------------------------------------------------ helpers

const pad = (n: number) => String(n).padStart(4, '0')
const ord = (n: number) => `ORD-${pad(n)}`
const money = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n)
const early = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b && a < b)

// ------------------------------------------------------------------------------------------------ the checks

export function computeReconciliationExceptions(input: ReconciliationInput): ReconciliationException[] {
  const out: ReconciliationException[] = []
  const ordersById = new Map(input.orders.map(o => [o.id, o]))
  const moneyBy = new Map(input.money.map(m => [m.orderId, m]))
  const label = (id: string) => {
    const o = ordersById.get(id)
    return o ? ord(o.number) : 'an order'
  }

  // ---- orders: price basis, payments against the total, costs against the expected cost
  for (const o of input.orders) {
    const m = moneyBy.get(o.id)
    if (o.basisUnknown) {
      out.push({
        key: `order-basis-unknown-${o.id}`,
        severity: 'warning',
        category: 'Is GST included?',
        message: `${ord(o.number)} has no recorded GST basis, so it is left out of margin, GST totals and net cash. Its payments still count in gross cash.`,
        orderId: o.id,
      })
    }
    if (!m || o.cancelled) continue

    // Customer payments exceed what the customer owes (DATA_MODEL 5a: reported here, never capped).
    if (m.settled - m.grossTarget > AMOUNT_TOLERANCE) {
      out.push({
        key: `order-overpaid-in-${o.id}`,
        severity: 'critical',
        category: 'Payments exceed total',
        message: `Customer payments (${money(m.settled)}) exceed the order's gross (${money(m.grossTarget)}) on ${ord(o.number)}`,
        orderId: o.id,
      })
    }
    // Invoiced gross exceeds the order's gross from its items.
    if (m.invoiceCount > 0 && m.invoiceGross - m.itemsGross > AMOUNT_TOLERANCE) {
      out.push({
        key: `order-invoiced-over-${o.id}`,
        severity: 'critical',
        category: 'Invoiced exceeds order',
        message: `Invoiced gross (${money(m.invoiceGross)}) exceeds the order's gross from its items (${money(m.itemsGross)}) on ${ord(o.number)}`,
        orderId: o.id,
      })
    }
    // Costs paid out exceed the expected cost that was set.
    if (m.expectedCost !== null && m.actualCost - m.expectedCost > AMOUNT_TOLERANCE) {
      out.push({
        key: `order-cost-over-expected-${o.id}`,
        severity: 'warning',
        category: 'Costs exceed expected',
        message: `Costs paid (${money(m.actualCost)}) are above the expected cost (${money(m.expectedCost)}) on ${ord(o.number)}`,
        orderId: o.id,
      })
    }
    // Paid in full but the margin is still provisional: a nudge to mark costs complete.
    if (!m.costsComplete && m.grossTarget > 0 && m.settled >= m.grossTarget - AMOUNT_TOLERANCE && !o.basisUnknown) {
      out.push({
        key: `order-settled-provisional-${o.id}`,
        severity: 'warning',
        category: 'Costs not marked complete',
        message: `${ord(o.number)} is paid in full but its margin is still provisional. Mark costs complete when every cost is in.`,
        orderId: o.id,
      })
    }
  }

  // ---- payments: placed on a cancelled order, or dated before the order
  for (const p of input.payments) {
    const o = ordersById.get(p.orderId)
    if (p.amount <= 0) {
      out.push({ key: `payment-nonpositive-${p.id}`, severity: 'critical', category: 'Impossible value', message: `A customer payment on ${label(p.orderId)} is not positive (${p.amount})`, orderId: p.orderId })
    }
    if (o?.cancelled) {
      out.push({ key: `payment-on-cancelled-${p.id}`, severity: 'warning', category: 'Payment on a cancelled order', message: `A payment of ${money(p.amount)} is recorded on ${ord(o.number)}, which is cancelled`, orderId: p.orderId })
    }
    if (o && early(p.receivedOn, o.orderedOn)) {
      out.push({
        key: `payment-before-order-${p.id}`,
        severity: 'warning',
        category: 'Dates out of sequence',
        message: `Customer payment (${p.receivedOn}) recorded before ${ord(o.number)} was placed (${o.orderedOn})`,
        orderId: p.orderId,
      })
    }
  }

  // ---- expenses: before the order, and supplier payments against the PO total
  for (const e of input.expenses) {
    const o = e.orderId ? ordersById.get(e.orderId) : undefined
    if (e.cost < 0) {
      out.push({ key: `expense-negative-${e.id}`, severity: 'critical', category: 'Impossible value', message: `An expense tagged to ${label(e.orderId ?? '')} has a negative cost (${e.cost})`, orderId: e.orderId ?? undefined })
    }
    if (o && early(e.paidOn, o.orderedOn)) {
      out.push({
        key: `expense-before-order-${e.id}`,
        severity: 'warning',
        category: 'Dates out of sequence',
        message: `Expense (${e.paidOn}) recorded before ${ord(o.number)} was placed (${o.orderedOn})`,
        orderId: e.orderId ?? undefined,
      })
    }
  }
  // Supplier payments tagged to a leg against its PO: only for a PKR leg, because the expense is in PKR and no rate is guessed here.
  const paidByLeg = new Map<string, number>()
  if (input.legPaid) for (const p of input.legPaid) paidByLeg.set(p.legId, p.paid)
  else for (const e of input.expenses) if (e.legId) paidByLeg.set(e.legId, (paidByLeg.get(e.legId) ?? 0) + e.cost)
  for (const po of input.pos) {
    const paid = paidByLeg.get(po.legId) ?? 0
    const leg = input.legs.find(l => l.id === po.legId)
    if (po.currency === 'PKR' && paid - po.total > AMOUNT_TOLERANCE) {
      out.push({
        key: `leg-overpaid-out-${po.legId}`,
        severity: 'critical',
        category: 'Payments exceed total',
        message: `Supplier payments (${money(paid)}) are more than the PO total (${money(po.total)}) on ${leg ? `${label(leg.orderId)} ${leg.label}` : 'a supplier order'}`,
        orderId: leg?.orderId,
      })
    }
  }

  // ---- supplier legs: dates in order
  for (const l of input.legs) {
    const where = `${label(l.orderId)} ${l.label}`
    if (early(l.expectedOn, l.placedOn)) {
      out.push({ key: `leg-expected-before-placed-${l.id}`, severity: 'warning', category: 'Dates out of sequence', message: `${where}: the expected date (${l.expectedOn}) is before it was placed (${l.placedOn})`, orderId: l.orderId })
    }
    if (early(l.deliveredOn, l.placedOn)) {
      out.push({ key: `leg-delivered-before-placed-${l.id}`, severity: 'warning', category: 'Dates out of sequence', message: `${where}: delivered (${l.deliveredOn}) before it was placed (${l.placedOn})`, orderId: l.orderId })
    }
  }

  // ---- invoices (the GST register): impossible values, rate, orphan link, the TCS trail, the deposit
  for (const g of input.invoices) {
    const order = g.orderId ? ordersById.get(g.orderId) : undefined
    const who = g.number ? `Invoice ${g.number}` : 'An invoice'
    const base = { invoiceId: g.id, orderId: g.orderId ?? undefined }
    if (g.net < 0 || g.gst < 0) {
      out.push({ key: `invoice-negative-${g.id}`, severity: 'critical', category: 'Impossible value', message: `${who} has a negative amount (net ${g.net}, GST ${g.gst})`, ...base })
    }
    if (g.gst > g.net + AMOUNT_TOLERANCE) {
      out.push({ key: `invoice-gst-exceeds-${g.id}`, severity: 'critical', category: 'Impossible value', message: `${who}: the GST (${g.gst}) exceeds its net (${g.net})`, ...base })
    } else if (g.net > 0) {
      // The order's own rate when it has item lines (so a zero-rated or mixed order is not a false alarm), else 18%.
      const m = g.orderId ? moneyBy.get(g.orderId) : undefined
      const rate = m && m.itemsNet > 0 ? (m.itemsGross - m.itemsNet) / m.itemsNet : DEFAULT_GST_RATE
      const expected = g.net * rate
      const off = expected > 0 ? Math.abs(g.gst - expected) / expected : g.gst > AMOUNT_TOLERANCE ? 1 : 0
      if (off > GST_TOLERANCE_PCT) {
        out.push({
          key: `invoice-gst-rate-${g.id}`,
          severity: 'warning',
          category: m && m.itemsNet > 0 ? "GST does not match the order's rate" : 'GST ≠ 18% of net',
          message: `${who}: GST of ${money(g.gst)} is ${(off * 100).toFixed(1)}% off the expected ${money(expected)} (${(rate * 100).toFixed(0)}% of net)`,
          ...base,
        })
      }
    }
    if (g.orderId && !order) {
      out.push({ key: `invoice-orphan-${g.id}`, severity: 'critical', category: 'No matching order', message: `${who} points at an order that no longer exists`, invoiceId: g.id })
    }
    if (order && early(g.invoiceDate, order.orderedOn)) {
      out.push({ key: `invoice-before-order-${g.id}`, severity: 'warning', category: 'Dates out of sequence', message: `${who} (${g.invoiceDate}) is dated before ${ord(order.number)} was placed (${order.orderedOn})`, ...base })
    }
    // The TCS courier trail should move forward: copy received, then sent, then the client has it.
    const trail: [string, string | null][] = [
      ['copy received', g.copyReceivedOn],
      ['TCS sent', g.tcsSentOn],
      ['client received', g.clientReceivedOn],
    ]
    const filled = trail.filter((t): t is [string, string] => Boolean(t[1]))
    for (let i = 1; i < filled.length; i++) {
      if (filled[i - 1][1] > filled[i][1]) {
        out.push({ key: `invoice-trail-${g.id}-${i}`, severity: 'warning', category: 'Dates out of sequence', message: `${who}: ${filled[i - 1][0]} (${filled[i - 1][1]}) is after ${filled[i][0]} (${filled[i][1]})`, ...base })
      }
    }
    if (early(g.taxDepositedOn, g.invoiceDate)) {
      out.push({ key: `invoice-deposit-before-${g.id}`, severity: 'warning', category: 'Dates out of sequence', message: `${who}: the tax deposit date (${g.taxDepositedOn}) is before the invoice date (${g.invoiceDate})`, ...base })
    }
  }

  // Imported records are history (redesign phase 0, D10: "Mistakes to fix" lists real mistakes in live data only). A finding about
  // an imported order, or an imported invoice, is dropped: the old CRM's books were kept there, and the one-off Review imported
  // (phase 2) is where an imported record that is still open gets looked at.
  const legacyOrders = new Set(input.orders.filter(o => o.legacy).map(o => o.id))
  const legacyInvoices = new Set(input.invoices.filter(g => g.legacy).map(g => g.id))
  const live = out.filter(e => !(e.orderId && legacyOrders.has(e.orderId)) && !(e.invoiceId && legacyInvoices.has(e.invoiceId)))

  // Most serious first, then in a stable order.
  const rank = (s: ExceptionSeverity) => (s === 'critical' ? 0 : 1)
  return live.sort((a, b) => rank(a.severity) - rank(b.severity) || a.key.localeCompare(b.key))
}

export function countBySeverity(list: readonly ReconciliationException[]): { critical: number; warning: number } {
  return { critical: list.filter(e => e.severity === 'critical').length, warning: list.filter(e => e.severity === 'warning').length }
}
