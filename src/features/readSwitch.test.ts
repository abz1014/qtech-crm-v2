import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'
import { installFakeDb, opArgs, type FakeCall } from '@/test/fakeSupabase'
import { orderRef } from '@/lib/refs'
import { getPaymentOrder, getReceivablesSummary, listReceivables, type ReceivablesListRow } from '@/features/money/payments/api'
import { receivableTotals, type PaymentState, type ReceivableRow } from '@/features/money/payments/model'
import { toInquiryFact, toReceivableFact } from '@/features/today/api'
import { companyNames, orderRefs } from '@/features/money/expenses/api'
import { legLabels } from '@/features/money/bank/api'
import { INVOICEABLE_FILTER, listInvoiceableOrders } from '@/features/money/invoices/api'
import { listLegKept } from '@/features/orders/api'
import { nextOrderStep, type OrderFacts, type StepLeg } from '@/features/orders/lib/orderSteps'

/*
 * Round 2 (r2/fast-reads): the client reads moved to the 0074/0076 RPCs (receivables_list, receivables_summary,
 * today_inquiry_facts, lookup_labels) and to server-side filters. Each test below runs the OLD mapping (the code as it was,
 * copied here) and the NEW read against the same simulated database, and requires identical results. What the SQL itself
 * returns is proven by pgTAP and supabase/perf/0074_db_perf.sql; this proves the client maps it the same way.
 */

let fake: ReturnType<typeof installFakeDb> | null = null
afterEach(() => {
  fake?.uninstall()
  fake = null
})

// ------------------------------------------------------------------ a small world

interface Raw {
  order_id: string
  order_number: number
  company_id: string
  owner_id: string | null
  gross_target: number
  settled: number
  balance: number
  overpaid_by: number
  due_on: string | null
  is_overdue: boolean
  payment_state: PaymentState
  last_reminded_on: string | null
  reminder_count: number
}
interface World {
  raw: Raw[]
  companies: { id: string; name: string; city: string | null }[]
  invoices: { order_id: string; number: string | null; invoice_date: string | null }[]
}

const STATES: PaymentState[] = ['unpaid', 'part', 'overdue', 'settled']
const day = fc.integer({ min: 1, max: 28 }).map(d => `2026-09-${String(d).padStart(2, '0')}`)
const worldArb: fc.Arbitrary<World> = fc
  .record({
    n: fc.integer({ min: 0, max: 12 }),
    seeds: fc.array(
      fc.record({
        company: fc.integer({ min: 0, max: 3 }),
        gross: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 900000 }).map(p => p / 100)),
        paid: fc.integer({ min: 0, max: 900000 }).map(p => p / 100),
        state: fc.constantFrom(...STATES),
        due: fc.option(day, { nil: null }),
        reminded: fc.option(day, { nil: null }),
        invoices: fc.integer({ min: 0, max: 3 }),
        owner: fc.option(fc.constantFrom('u1', 'u2'), { nil: null }),
      }),
      { minLength: 12, maxLength: 12 },
    ),
  })
  .map(({ n, seeds }) => {
    const companies = [0, 1, 2, 3].map(i => ({ id: `c${i}`, name: `Company ${i}`, city: i % 2 ? 'Lahore' : null }))
    const raw: Raw[] = []
    const invoices: World['invoices'] = []
    seeds.slice(0, n).forEach((s, i) => {
      const id = `o${i}`
      raw.push({
        order_id: id,
        order_number: i + 1,
        company_id: `c${s.company}`,
        owner_id: s.owner,
        gross_target: s.gross,
        settled: s.paid,
        balance: Math.max(s.gross - s.paid, 0),
        overpaid_by: Math.max(s.paid - s.gross, 0),
        due_on: s.due,
        is_overdue: s.state === 'overdue',
        payment_state: s.state,
        last_reminded_on: s.reminded,
        reminder_count: s.reminded ? 1 : 0,
      })
      for (let k = 0; k < s.invoices; k++) invoices.push({ order_id: id, number: k === 2 ? null : `INV-${i}-${k}`, invoice_date: `2026-0${k + 1}-1${i % 10}` })
    })
    return { raw, companies, invoices }
  })

/** receivables_list() as 0074 defines it, over the world. */
function receivablesList(w: World, a: { p_state?: string; p_company_id?: string; p_order_id?: string; p_with_value?: boolean }): ReceivablesListRow[] {
  return w.raw
    .filter(r => !a.p_order_id || r.order_id === a.p_order_id)
    .filter(r => !a.p_company_id || r.company_id === a.p_company_id)
    .filter(r => !a.p_with_value || r.gross_target > 0)
    .filter(r => !a.p_state || (a.p_state === 'open' ? r.payment_state !== 'settled' : r.payment_state === a.p_state))
    .sort((x, y) => x.order_number - y.order_number)
    .map(r => ({
      ...r,
      company_name: w.companies.find(c => c.id === r.company_id)?.name ?? null,
      invoice_numbers: w.invoices
        .filter(v => v.order_id === r.order_id && v.number)
        .sort((x, y) => (x.invoice_date ?? '9999').localeCompare(y.invoice_date ?? '9999'))
        .map(v => v.number as string),
    }))
}

const rpcArgs = (call: FakeCall) => (opArgs(call, 'args')?.[0] ?? {}) as Record<string, string | boolean | undefined>

/** One fake database that answers both the old reads and the new RPCs. */
function serve(w: World) {
  fake = installFakeDb(call => {
    const range = opArgs(call, 'range') as [number, number] | undefined
    const page = <T,>(rows: T[]) => (range ? rows.slice(range[0], range[1] + 1) : rows)
    const inIds = (opArgs(call, 'in')?.[1] ?? []) as string[]
    switch (call.target) {
      case 'rpc:order_receivables': {
        const id = rpcArgs(call).p_order_id
        return { data: w.raw.filter(r => !id || r.order_id === id) }
      }
      case 'rpc:receivables_list':
        return { data: page(receivablesList(w, rpcArgs(call))) }
      case 'companies':
        return { data: w.companies.filter(c => inIds.includes(c.id)) }
      case 'invoices':
        return { data: page(w.invoices.filter(v => inIds.includes(v.order_id)).sort((x, y) => (x.invoice_date ?? '9999').localeCompare(y.invoice_date ?? '9999'))) }
      case 'payments_in':
        return { data: [] }
      default:
        return { data: [] }
    }
  })
}

// ------------------------------------------------------------------ the old mappings, as they were

const num = (v: number | string | null | undefined) => (v === null || v === undefined ? 0 : Number(v))
function oldToRow(r: Raw, names: Map<string, string>, invoices: Map<string, string[]>): ReceivableRow {
  return {
    orderId: r.order_id,
    orderNumber: Number(r.order_number),
    companyId: r.company_id,
    companyName: names.get(r.company_id) ?? '',
    ownerId: r.owner_id,
    invoiceNumbers: invoices.get(r.order_id) ?? [],
    gross: num(r.gross_target),
    settled: num(r.settled),
    balance: num(r.balance),
    overpaidBy: num(r.overpaid_by),
    dueOn: r.due_on,
    isOverdue: !!r.is_overdue,
    state: r.payment_state ?? 'unpaid',
    lastRemindedOn: r.last_reminded_on,
    reminderCount: num(r.reminder_count),
    imported: false,
  }
}
function oldMaps(w: World, raw: Raw[]) {
  const names = new Map(w.companies.filter(c => raw.some(r => r.company_id === c.id)).map(c => [c.id, c.name]))
  const invoices = new Map<string, string[]>()
  const ids = new Set(raw.map(r => r.order_id))
  for (const v of [...w.invoices].filter(v => ids.has(v.order_id)).sort((x, y) => (x.invoice_date ?? '9999').localeCompare(y.invoice_date ?? '9999'))) {
    if (!v.number) continue
    invoices.set(v.order_id, [...(invoices.get(v.order_id) ?? []), v.number])
  }
  return { names, invoices }
}
function oldListReceivables(w: World): ReceivableRow[] {
  const raw = w.raw.filter(r => num(r.gross_target) > 0)
  const { names, invoices } = oldMaps(w, raw)
  return raw.map(r => oldToRow(r, names, invoices))
}

// ------------------------------------------------------------------ Who owes us

describe('Who owes us reads receivables_list (paged) with the same rows as order_receivables + companies + invoices', () => {
  it('listReceivables: identical rows, in the same order', async () => {
    await fc.assert(
      fc.asyncProperty(worldArb, async w => {
        serve(w)
        expect(await listReceivables()).toEqual(oldListReceivables(w))
        fake?.uninstall()
      }),
      { numRuns: 200, seed: 20261020 },
    )
  })

  it('listReceivables reads every page past 1,000 rows (the old unpaged RPC stopped at 1,000)', async () => {
    const w: World = {
      companies: [{ id: 'c0', name: 'A', city: null }],
      invoices: [],
      raw: Array.from({ length: 2345 }, (_, i) => ({ order_id: `o${i}`, order_number: i + 1, company_id: 'c0', owner_id: null, gross_target: 10, settled: 0, balance: 10, overpaid_by: 0, due_on: null, is_overdue: false, payment_state: 'unpaid' as const, last_reminded_on: null, reminder_count: 0 })),
    }
    serve(w)
    expect((await listReceivables()).length).toBe(2345)
    expect(fake?.calls.filter(c => c.target === 'rpc:receivables_list')).toHaveLength(3)
  })

  it('getPaymentOrder: the same row for any order (incl. a zero-gross one, which the dialog still reads)', async () => {
    await fc.assert(
      fc.asyncProperty(worldArb, async w => {
        serve(w)
        for (const r of w.raw) {
          const { names, invoices } = oldMaps(w, [r])
          expect((await getPaymentOrder(r.order_id))?.row).toEqual(oldToRow(r, names, invoices))
        }
        expect(await getPaymentOrder('missing')).toBeNull()
        fake?.uninstall()
      }),
      { numRuns: 60, seed: 7 },
    )
  })

  it('getReceivablesSummary maps every receivables_summary column onto the ReceivableTotals the page used to compute', async () => {
    await fc.assert(
      fc.asyncProperty(worldArb, async w => {
        const want = receivableTotals(oldListReceivables(w), '2026-10-20')
        fake = installFakeDb(() => ({
          data: [
            {
              open_count: want.openCount,
              outstanding: String(want.outstanding),
              overdue_count: want.overdueCount,
              overdue: String(want.overdue),
              reminder_due_count: want.reminderDueCount,
              not_yet_due_count: want.notYetDueCount,
              not_yet_due: String(want.notYetDue),
              not_invoiced_count: want.notInvoicedCount,
              not_invoiced: String(want.notInvoiced),
              gross: String(want.gross),
              settled: String(want.settled),
              settled_count: 0,
            },
          ],
        }))
        expect(await getReceivablesSummary('2026-10-20')).toEqual(want)
        expect(opArgs(fake.calls[0], 'args')?.[0]).toEqual({ p_today: '2026-10-20' })
        fake.uninstall()
      }),
      { numRuns: 50, seed: 3 },
    )
  })
})

// ------------------------------------------------------------------ Today

describe('Today reads only the overdue receivables (receivables_list p_state overdue)', () => {
  it('the same ReceivableFacts as order_receivables filtered on is_overdue', () => {
    fc.assert(
      fc.property(worldArb, w => {
        const labels = new Map(w.companies.map(c => [c.id, c.city ? `${c.name} — ${c.city}` : c.name]))
        const old = w.raw.filter(r => r.is_overdue).map(r => toReceivableFact(r, labels))
        const now = receivablesList(w, { p_state: 'overdue' }).map(r => toReceivableFact(r, labels))
        expect(now).toEqual(old)
      }),
      { numRuns: 200, seed: 11 },
    )
  })

  it('today_inquiry_facts rows become the same InquiryFacts the five old reads built', () => {
    // The old reads, for one enquiry awaiting a reply and one with answers to relay (answered after the last relay).
    const names = new Map([['s1', 'Alpenmark'], ['s2', 'Dubai Instr']])
    const old = [
      { id: 'i1', rfqId: 'r1', supplierId: 's1', supplierName: names.get('s1'), sentOn: '2026-10-01', lastChasedOn: '2026-10-05', lastChasedBy: 'u1', chaseCount: 2, responseState: 'awaiting', answersToRelay: 0, answeredOn: null, replied: 4, medianReplyDays: 2.5 },
      { id: 'i2', rfqId: 'r1', supplierId: 's2', supplierName: names.get('s2'), sentOn: null, lastChasedOn: null, lastChasedBy: null, chaseCount: 0, responseState: 'quoted', answersToRelay: 1, answeredOn: '2026-10-18', replied: 0, medianReplyDays: null },
    ]
    const rpc = [
      { inquiry_id: 'i1', rfq_id: 'r1', supplier_id: 's1', supplier_name: 'Alpenmark', sent_on: '2026-10-01', last_chased_on: '2026-10-05', last_chased_by: 'u1', chase_count: 2, response_state: 'awaiting', answers_to_relay: 0, answered_on: null, replied: 4, median_reply_days: '2.5' },
      { inquiry_id: 'i2', rfq_id: 'r1', supplier_id: 's2', supplier_name: 'Dubai Instr', sent_on: null, last_chased_on: null, last_chased_by: null, chase_count: 0, response_state: 'quoted', answers_to_relay: 1, answered_on: '2026-10-18', replied: null, median_reply_days: null },
    ]
    expect(rpc.map(toInquiryFact)).toEqual(old)
  })
})

// ------------------------------------------------------------------ lookup_labels

describe('label lookups go through lookup_labels (ids in the body) with the same labels', () => {
  const orders = [
    { id: 'o1', number: 38, company_id: 'c1', company_name: 'Indus' },
    { id: 'o2', number: 7, company_id: 'c2', company_name: 'Fauji' },
  ]
  const legs = [
    { id: 'l1', order_id: 'o1', supplier_id: 's1', created_at: '2026-01-01' },
    { id: 'l2', order_id: 'o1', supplier_id: 's2', created_at: '2026-01-02' },
    { id: 'l3', order_id: 'o2', supplier_id: 's1', created_at: '2026-01-01' },
  ]
  /** lookup_labels as 0074 defines it. */
  const serveLabels = () => {
    fake = installFakeDb(call => {
      const a = rpcArgs(call) as unknown as { p_company_ids?: string[]; p_order_ids?: string[]; p_leg_ids?: string[] }
      const position = (l: (typeof legs)[number]) => legs.filter(x => x.order_id === l.order_id && (x.created_at < l.created_at || (x.created_at === l.created_at && x.id < l.id))).length
      return {
        data: {
          companies: Object.fromEntries([['c1', 'Indus'], ['c2', 'Fauji']].filter(([id]) => a.p_company_ids?.includes(id))),
          orders: Object.fromEntries(orders.filter(o => a.p_order_ids?.includes(o.id)).map(o => [o.id, { number: o.number, company_id: o.company_id, company_name: o.company_name }])),
          legs: Object.fromEntries(legs.filter(l => a.p_leg_ids?.includes(l.id)).map(l => [l.id, { order_id: l.order_id, supplier_id: l.supplier_id, position: position(l) }])),
        },
      }
    })
  }

  it('company names, order refs and supplier-order letters', async () => {
    serveLabels()
    expect(await companyNames(['c1', 'c2', 'nope'])).toEqual({ c1: 'Indus', c2: 'Fauji' })
    expect(await orderRefs(['o1', 'o2'])).toEqual({ o1: orderRef(38), o2: orderRef(7) })
    // old: "supplier order A/B" by created_at among the order's legs
    expect(await legLabels(['l2', 'l3'])).toEqual({ l2: 'supplier order B', l3: 'supplier order A' })
    expect(fake?.calls.every(c => c.target === 'rpc:lookup_labels')).toBe(true)
    expect(await companyNames([])).toEqual({})
  })
})

// ------------------------------------------------------------------ invoiceable orders

describe('listInvoiceableOrders filters v_order_state on the server', () => {
  it('keeps exactly the not-cancelled, not-fully-invoiced orders (a null state too), newest first, with no 300 cap', async () => {
    const states = Array.from({ length: 450 }, (_, i) => ({
      order_id: `o${i}`,
      number: i + 1,
      company_id: `c${i % 3}`,
      lifecycle: i % 7 === 0 ? 'cancelled' : 'active',
      invoicing_state: i % 5 === 0 ? 'fully_invoiced' : i % 11 === 0 ? null : 'part',
    }))
    fake = installFakeDb(call => {
      if (call.target === 'rpc:lookup_labels') return { data: { companies: { c0: 'A', c1: 'B', c2: 'C' }, orders: {}, legs: {} } }
      expect(opArgs(call, 'neq')).toEqual(['lifecycle', 'cancelled'])
      expect(opArgs(call, 'or')).toEqual([INVOICEABLE_FILTER])
      const range = opArgs(call, 'range') as [number, number]
      const rows = states.filter(s => s.lifecycle !== 'cancelled' && (s.invoicing_state === null || s.invoicing_state !== 'fully_invoiced')).sort((a, b) => b.number - a.number)
      return { data: rows.slice(range[0], range[1] + 1) }
    })
    const got = await listInvoiceableOrders()
    // the old mapping without its .limit(300): not cancelled, and not in the fully-invoiced set
    const want = states
      .filter(s => s.lifecycle !== 'cancelled' && s.invoicing_state !== 'fully_invoiced')
      .sort((a, b) => b.number - a.number)
      .map(s => ({ id: s.order_id, ref: orderRef(s.number), company: ['A', 'B', 'C'][Number(s.company_id.slice(1))] }))
    expect(got).toEqual(want)
    expect(got.length).toBeGreaterThan(300)
  })
})

// ------------------------------------------------------------------ orders list legs

describe('the orders list leaves placed-and-delivered supplier orders on the server', () => {
  const legArb = fc.record({
    id: fc.uuid(),
    supplierName: fc.constantFrom('Alpenmark', 'Dubai'),
    placedOn: fc.option(day, { nil: null }),
    expectedOn: fc.option(day, { nil: null }),
    deliveredOn: fc.option(day, { nil: null }),
  })
  const factsArb = fc.record({
    role: fc.constantFrom('admin', 'sales', 'engineer'),
    lifecycle: fc.constantFrom('active', 'done', 'cancelled'),
    basisUnknown: fc.boolean(),
    goods: fc.constantFrom('to_source', 'to_place', 'late', 'on_order', 'partly_delivered', 'received', 'delivered', 'n_a'),
    commissioning: fc.constantFrom('to_plan', 'planned', 'done', 'n_a'),
    plannedOn: fc.option(day, { nil: null }),
    invoicing: fc.constantFrom('not_invoiced', 'part', 'fully_invoiced', null),
    gross: fc.option(fc.integer({ min: 0, max: 1000 }), { nil: null }),
    payment: fc.constantFrom('unpaid', 'part', 'overdue', 'settled', null),
    balance: fc.option(fc.integer({ min: 0, max: 1000 }), { nil: null }),
    dueOn: fc.option(day, { nil: null }),
    costsState: fc.constantFrom('complete', 'provisional', null),
    legs: fc.array(legArb, { maxLength: 5 }),
    today: day,
  })

  it('the Next step is the same with every supplier order and with only the kept ones', () => {
    fc.assert(
      fc.property(factsArb, (f: OrderFacts) => {
        const kept = f.legs.filter((l: StepLeg) => listLegKept({ placed_on: l.placedOn, delivered_on: l.deliveredOn }))
        expect(nextOrderStep({ ...f, legs: kept })).toEqual(nextOrderStep(f))
      }),
      { numRuns: 2000, seed: 5 },
    )
  })
})
