import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import { businessToday } from '@/lib/dates'
import { qk } from '@/features/queryKeys'
import type { JobRow } from '@/features/jobs/api'
import type { JobContext } from '@/features/jobs/slots'
import { LegsPanel } from '@/features/orders/LegsPanel'
import type { OrderHeader, OrderItemRow, OrderLegRow } from '@/features/orders/api'
import InvoiceWork from '@/features/orders/jobSlots/InvoiceWork'
import PaymentWork from '@/features/orders/jobSlots/PaymentWork'
import { installFakeDb } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

/*
 * P5-D2: the order-side actions on the job page. The supplier-order and delivery stages split LegsPanel so "Delivered today" is on
 * exactly one of them; Create invoice is offered only once every supplier order with goods is delivered; the payment rows are the
 * admin's alone.
 */
afterEach(() => {
  cleanup()
  installFakeDb(() => ({})).uninstall()
})

const TODAY = businessToday()
const day = (n: number) => {
  const d = new Date(`${TODAY}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const order: OrderHeader = {
  id: 'o1', number: 38, companyId: 'c1', companyName: 'Punjab Cement Ltd', rfqId: null, customerPo: 'PO-1', orderedOn: day(-12), paymentTermsDays: 30,
  needsCommissioning: false, plannedOn: null, doneOn: null, cancelledOn: null, cancelReason: null, imported: false, notes: null, site: null, contact: null, owner: null,
  state: { lifecycle: 'active', goods: 'late', commissioning: 'n_a', invoicing: 'not_invoiced', dataTrust: 'ok', net: 100000, gst: 18000, gross: 118000, invoiced: 0 },
}
const legBase = { reference: null, receivedOn: null, deliveredOn: null, lastChasedOn: null, chaseCount: 0, inquiryId: null, leadTimes: [] as string[] }
const legs: OrderLegRow[] = [
  { ...legBase, id: 'la', supplierId: 's1', supplierName: 'Alpenmark Controls', currency: 'EUR', placedOn: null, expectedOn: null },
  { ...legBase, id: 'lb', supplierId: 's2', supplierName: 'Dubai Instrumentation', currency: 'USD', placedOn: day(-10), expectedOn: day(-3), reference: 'PI-123' },
]
const item = (over: Partial<OrderItemRow>): OrderItemRow => ({ id: 'i', number: 1, description: 'Item', brandName: null, model: null, qty: 1, unit: 'ea', isService: false, legId: null, rfqItemId: null, unitPriceNet: 1000, gstRate: 18, supplierUnitPrice: null, ...over })
const items = [item({ id: 'i1', number: 1, description: 'Actuator', legId: 'la' }), item({ id: 'i2', number: 2, description: 'Sensor', legId: 'lb' })]

function wrap(ui: React.ReactNode, role: 'admin' | 'sales' | 'engineer' = 'admin') {
  installFakeDb(() => ({ data: [] }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } } })
  return { client, ui: (
    <QueryClientProvider client={client}>
      <SessionProvider value={{ status: 'signed-in', user: { id: 'u1', name: 'Me', role } }}>
        <MemoryRouter>
          <ToastProvider>{ui}</ToastProvider>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>
  ) }
}

describe('LegsPanel split over the supplier-order and delivery stages', () => {
  const panel = (part: 'order' | 'delivery') => (
    <LegsPanel order={order} legs={legs} items={items} pos={[]} money isAdmin canEdit part={part} />
  )

  it('Supplier order stage: Add supplier and Issue PO; no delivery button, no goods chase', () => {
    render(wrap(panel('order')).ui)
    expect(screen.getByRole('button', { name: 'Add supplier' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Issue PO, Alpenmark Controls/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Delivered today/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Chase goods/ })).toBeNull()
  })

  it('Delivery stage: exactly one Delivered today and the goods chase; no PO or supplier buttons', () => {
    render(wrap(panel('delivery')).ui)
    expect(screen.getAllByRole('button', { name: /^Delivered today/ })).toHaveLength(1)
    expect(screen.getByRole('button', { name: /^Chase goods, Dubai Instrumentation/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Issue PO/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add supplier' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Deliveries' })).toBeInTheDocument()
  })

  it('together the two stages carry Delivered today once', () => {
    const a = wrap(panel('order'))
    const b = wrap(panel('delivery'))
    render(<>{a.ui}{b.ui}</>)
    expect(screen.getAllByRole('button', { name: /^Delivered today/ })).toHaveLength(1)
  })
})

const job = (role: 'admin' | 'sales' | 'engineer'): JobContext => ({
  job: { key: '139', kind: 'enquiry', rfqId: 'r1', orderId: 'o1', companyId: 'c1', companyName: 'x', siteName: null, ownerId: 'u1', ownerName: 'F', items: '', stage: 'delivered', stageDetail: null, isHistory: false, lastActivityOn: null, repeatOf: null, cancelledOrders: 0, engineerIds: [] } as JobRow,
  role,
  money: role !== 'engineer',
})

function seed(client: QueryClient, ls: OrderLegRow[]) {
  const raw = {
    legs: ls.map(l => ({ id: l.id, supplier_id: l.supplierId, currency: l.currency, reference: l.reference, placed_on: l.placedOn, expected_on: l.expectedOn, received_on: l.receivedOn, delivered_on: l.deliveredOn, last_chased_on: null, chase_count: 0, inquiry_id: null, created_at: '2026-01-01' })),
    names: new Map(ls.map(l => [l.supplierId, l.supplierName])),
    quoteLines: [],
  }
  client.setQueryData(qk.orders.part('o1', 'header'), order)
  client.setQueryData(qk.orders.part('o1', 'items'), items)
  client.setQueryData(qk.orders.part('o1', 'legs'), raw)
  client.setQueryData(qk.orders.part('o1', 'engineers'), [])
  client.setQueryData(qk.orders.part('o1', 'money'), { grossTarget: 118000, settled: 0, balance: 118000, paymentState: 'unpaid', dueOn: null, netSale: 100000, actualCost: 0, expectedCost: null, costsState: 'provisional', margin: null, marginState: 'provisional' })
}

describe('Invoice stage', () => {
  it('while a supplier order is still on order it says so and offers no Create invoice', async () => {
    const { client, ui } = wrap(<InvoiceWork job={job('admin')} />)
    seed(client, legs)
    render(ui)
    expect(await screen.findByText(/2 supplier orders are still on order\./)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create invoice' })).toBeNull()
  })

  it('once every supplier order is delivered, Create invoice is offered (and it is not the green button)', async () => {
    const delivered = legs.map(l => ({ ...l, placedOn: day(-10), deliveredOn: day(-1), receivedOn: day(-1) }))
    const { client, ui } = wrap(<InvoiceWork job={job('admin')} />)
    seed(client, delivered)
    render(ui)
    const b = await screen.findByRole('button', { name: 'Create invoice' })
    expect(b.className).not.toMatch(/bg-primary/)
    expect(screen.getByRole('button', { name: 'Record payment' })).toBeInTheDocument()
  })

  it('sales get Create invoice but not Record payment; an engineer gets nothing', async () => {
    const delivered = legs.map(l => ({ ...l, placedOn: day(-10), deliveredOn: day(-1), receivedOn: day(-1) }))
    const s = wrap(<InvoiceWork job={job('sales')} />, 'sales')
    seed(s.client, delivered)
    render(s.ui)
    expect(await screen.findByRole('button', { name: 'Create invoice' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record payment' })).toBeNull()
    cleanup()
    const e = wrap(<InvoiceWork job={job('engineer')} />, 'engineer')
    const { container } = render(e.ui)
    expect(container.querySelector('[data-invoice-work]')).toBeNull()
  })
})

describe('Payment stage', () => {
  it('draws nothing for sales or an engineer', () => {
    for (const role of ['sales', 'engineer'] as const) {
      const w = wrap(<PaymentWork job={job(role)} />, role)
      seed(w.client, legs)
      const { container } = render(w.ui)
      expect(container.querySelector('[data-payment-work]')).toBeNull()
      cleanup()
    }
  })
})
