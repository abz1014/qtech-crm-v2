import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { installFakeDb, opArgs, type FakeCall } from '@/test/fakeSupabase'
import { listMyClaims, loadCashInHand } from '@/features/money/expenses/claimsApi'
import { listExpenses, listExpensesBetween } from '@/features/money/expenses/api'
import { listInvoiceableOrders, listGstRegister } from '@/features/money/invoices/api'
import { fetchReceivablesList, getReceivablesSummary, getPaymentOrder, listPaymentsReceived, listHeldAdvances } from '@/features/money/payments/api'
import { loadPnlMonths } from '@/features/money/monthEnd/api'
import { Select } from '@/ui/form/Select'
import { withArchiveTag } from '@/features/money/lib/archiveLabel'

/* Archive (0141) in the money area: LIST reads drop archived rows; NUMBER reads never carry the filter; pickers keep archived items and say so. */

afterEach(() => installFakeDb(() => ({})).uninstall())

const archivedFilters = (calls: FakeCall[]) => calls.filter(c => c.ops.some(([n, a]) => n === 'eq' && (a as unknown[])[0] === 'archived'))
const empty = (c: FakeCall) => ({ data: c.target === 'rpc:lookup_labels' ? { companies: {}, orders: {}, legs: {} } : [] })

describe('list reads add the archived filter', () => {
  it("an engineer's own claims (expense_claims is safe for an engineer)", async () => {
    const db = installFakeDb(empty)
    await listMyClaims()
    const c = db.calls.find(x => x.target === 'expense_claims')!
    expect(c.ops.find(([n, a]) => n === 'eq' && (a as unknown[])[0] === 'archived')?.[1]).toEqual(['archived', false])
  })
})

describe('number reads never carry the archived filter', () => {
  it('receivables, the summary, held advances, cash in hand', async () => {
    const db = installFakeDb(empty)
    await fetchReceivablesList()
    await getReceivablesSummary('2026-11-17')
    await listHeldAdvances()
    await loadCashInHand()
    expect(db.calls.length).toBeGreaterThan(3)
    expect(archivedFilters(db.calls)).toEqual([])
  })
  it('the GST register and a month view', async () => {
    const db = installFakeDb(empty)
    await listGstRegister()
    await loadPnlMonths()
    expect(db.calls.map(c => c.target)).toEqual(expect.arrayContaining(['v_gst_register', 'v_month_pnl']))
    expect(archivedFilters(db.calls)).toEqual([])
  })
  it('the month-total pages (expenses, payments received) and the expense report read stay whole', async () => {
    const db = installFakeDb(empty)
    await listExpenses('2026-11')
    await listExpensesBetween('2026-10', '2026-11')
    await listPaymentsReceived('2026-11')
    expect(archivedFilters(db.calls)).toEqual([])
  })
})

describe('pickers keep archived items and mark them', () => {
  it('the invoiceable orders read selects archived and returns it, without filtering on it', async () => {
    const db = installFakeDb(c =>
      c.target === 'v_order_state'
        ? { data: [{ order_id: 'o1', number: 5, company_id: 'c1', archived: true }, { order_id: 'o2', number: 6, company_id: 'c1', archived: false }] }
        : { data: { companies: { c1: 'Ravi Agro' }, orders: {}, legs: {} } },
    )
    const orders = await listInvoiceableOrders()
    expect(orders.map(o => o.archived)).toEqual([true, undefined])
    expect(String(opArgs(db.calls.find(c => c.target === 'v_order_state')!, 'select'))).toContain('archived')
    expect(archivedFilters(db.calls)).toEqual([])
  })
  it("the payment dialog's invoices select archived and are not filtered", async () => {
    const db = installFakeDb(c => (c.target === 'invoices' ? { data: [{ id: 'i1', number: 'INV-1', net_amount: 100, gst_amount: 18, archived: true }] } : { data: [] }))
    await getPaymentOrder('o1')
    const inv = db.calls.find(c => c.target === 'invoices')!
    expect(String(opArgs(inv, 'select'))).toContain('archived')
    expect(archivedFilters(db.calls)).toEqual([])
  })
  it('renders "In Archive" beside an archived option and nothing beside a live one', () => {
    render(
      <Select
        aria-label="Invoice"
        options={[
          { value: 'a', label: withArchiveTag('INV-1 · PKR 118', true) },
          { value: 'b', label: withArchiveTag('INV-2 · PKR 50', false) },
        ]}
      />,
    )
    expect(screen.getByRole('option', { name: 'INV-1 · PKR 118 · In Archive' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'INV-2 · PKR 50' })).toBeInTheDocument()
  })
})
