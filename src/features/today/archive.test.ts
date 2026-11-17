import { afterEach, describe, expect, it } from 'vitest'
import { filterRows, installFakeDb, type FakeCall } from '@/test/fakeSupabase'
import { loadTodayData } from './api'
import { navCountsFrom } from '@/app/shell/useNavCounts'
import { buildToday } from './rules'

/*
 * Archive feature, Today: every list and alert read drops archived rows (hideArchived = .eq('archived', false)); the number reads are
 * untouched; and an engineer's reads never name `archived` on the base tables orders, quotations or purchase_orders (42501).
 */
const TODAY = '2026-11-20'
const ENGINEER_LIMITED = ['orders', 'quotations', 'purchase_orders']
const touchesArchived = (c: FakeCall) => c.ops.some(([n, a]) => n === 'eq' && a[0] === 'archived')

const data: Record<string, Record<string, unknown>[]> = {
  v_rfq_state: [
    { rfq_id: 'r1', number: 1, owner_id: 'u1', company_id: 'c1', received_on: '2026-11-18', due_on: '2026-11-20', outcome: 'open', bid_state: 'to_bid', companies: { name: 'Indus', city: null } },
    { rfq_id: 'r2', number: 2, owner_id: 'u1', company_id: 'c1', received_on: '2026-10-01', due_on: '2026-10-05', outcome: 'open', bid_state: 'to_bid', archived: true, companies: { name: 'Indus', city: null } },
  ],
  v_order_state: [
    { order_id: 'o1', number: 10, company_id: 'c1', owner_id: 'u1', lifecycle: 'active', goods_state: 'n_a', commissioning_state: 'to_plan', invoicing_state: 'invoiced' },
    { order_id: 'o2', number: 11, company_id: 'c1', owner_id: 'u1', lifecycle: 'active', goods_state: 'n_a', commissioning_state: 'to_plan', invoicing_state: 'invoiced', archived: true },
  ],
  v_inquiry_state: [{ inquiry_id: 'i1' }, { inquiry_id: 'i2', archived: true }],
  v_invoice_state: [
    { invoice_id: 'v1', order_id: 'o1', needs_fbr_attention: true },
    { invoice_id: 'v2', order_id: 'o2', needs_fbr_attention: true, archived: true },
  ],
  expense_claims: [{ created_at: '2026-11-18T05:00:00Z' }, { created_at: '2026-09-01T05:00:00Z', archived: true }],
  order_engineers: [{ order_id: 'o1' }, { order_id: 'o2' }],
  orders: [{ id: 'o1', number: 10, company_id: 'c1' }, { id: 'o2', number: 11, company_id: 'c1' }],
  companies: [{ id: 'c1', name: 'Indus', city: null }],
  users: [{ id: 'u1', role: 'sales', name: 'Sana' }],
  clarifications: [],
  supplier_orders: [],
}

function install() {
  return installFakeDb((call: FakeCall) => {
    if (call.verb === 'rpc') return { data: call.target === 'rpc:today_inquiry_facts' ? [{ inquiry_id: 'i1', rfq_id: 'r1', supplier_id: 's1' }, { inquiry_id: 'i2', rfq_id: 'r1', supplier_id: 's1' }] : [] }
    const rows = data[call.target]
    if (!rows) return { data: [] }
    // honour the archived filter like PostgREST; ignore everything else
    return { data: filterRows(rows, { ...call, ops: call.ops.filter(([n, a]) => n === 'eq' && a[0] === 'archived') }) }
  })
}

afterEach(() => setupDone?.uninstall())
let setupDone: ReturnType<typeof install> | undefined

describe('Today: archived records are not listed', () => {
  it('drops archived rfqs, orders, enquiries, invoices and claims from the facts', async () => {
    setupDone = install()
    const d = await loadTodayData({ id: 'u1', role: 'admin' }, TODAY)
    expect(d.rfqs.map(r => r.id)).toEqual(['r1'])
    expect(d.orders.map(o => o.id)).toEqual(['o1'])
    expect(d.inquiries.map(i => i.id)).toEqual(['i1'])
    expect(d.invoices.map(i => i.id)).toEqual(['v1'])
    expect(d.claims?.pending).toBe(1)
  })

  it('the filter is on every list read, and absent from the number reads', async () => {
    setupDone = install()
    await loadTodayData({ id: 'u1', role: 'admin' }, TODAY)
    const filtered = new Set(setupDone.calls.filter(touchesArchived).map(c => c.target))
    for (const t of ['v_rfq_state', 'v_order_state', 'v_invoice_state', 'v_inquiry_state', 'expense_claims', 'clarifications', 'supplier_orders']) expect(filtered.has(t), t).toBe(true)
    // numbers and reference reads stay whole: receivables total, cash, targets, GST, month end, recurring check, users, companies
    for (const t of ['invoices', 'expenses', 'companies', 'users', 'rpc:month_end_status', 'rpc:my_target_progress', 'recurring_expenses']) expect(filtered.has(t), t).toBe(false)
  })

  it('nav badges count only what the filtered Today lists hold', async () => {
    setupDone = install()
    const d = await loadTodayData({ id: 'u1', role: 'admin' }, TODAY)
    const view = buildToday({ ...d, today: TODAY, user: { id: 'u1', role: 'admin' }, roleOf: id => (id ? (d.roles[id] ?? null) : null) })
    const ids = [...view.active, ...view.waiting].map(i => i.subjectId)
    expect(ids).not.toContain('r2')
    expect(ids).not.toContain('o2')
    expect(navCountsFrom(view, 'admin').today ?? 0).toBe(view.now.length)
  })
})

describe('Today: the engineer limit', () => {
  it('never selects archived on orders, quotations or purchase_orders; orders go through the views', async () => {
    setupDone = install()
    const d = await loadTodayData({ id: 'u1', role: 'engineer' }, TODAY)
    const bad = setupDone.calls.filter(c => ENGINEER_LIMITED.includes(c.target) && touchesArchived(c))
    expect(bad).toEqual([])
    const jobStates = setupDone.calls.filter(c => c.target === 'v_order_state' && c.ops.some(([n, a]) => n === 'in' && a[0] === 'order_id'))
    expect(jobStates.length).toBeGreaterThan(0)
    expect(jobStates.every(touchesArchived)).toBe(true)
    expect(d.jobs.map(j => j.orderId)).toEqual(['o1'])
    expect(d.orders.map(o => o.id)).toEqual(['o1'])
  })
})
