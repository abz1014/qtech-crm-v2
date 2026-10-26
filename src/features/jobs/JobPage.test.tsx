import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import { ToastProvider } from '@/ui/Toast'
import { qk } from '@/features/queryKeys'
import type { JobFacts, JobRow } from '@/features/jobs/api'
import JobsScreen from '@/features/jobs/JobsScreen'

/*
 * The Job page (P5-C), drawn from a seeded query cache: the ruler, the next-step band with its one green button, the stages as an
 * accordion, the right column, and what an engineer does not get (no money panel, nothing about invoices or payment).
 */
const job = (over: Partial<JobRow>): JobRow => ({
  key: '139', kind: 'enquiry', rfqId: 'r1', orderId: 'o1', companyId: 'c1', companyName: 'Harbour Textiles Limited', siteName: null, ownerId: 'u1', ownerName: 'Faizan',
  items: 'Flowmeter +2 more', stage: 'supplier_ordered', stageDetail: 'supplier late, advance received', isHistory: false, lastActivityOn: '2026-10-19', repeatOf: null, cancelledOrders: 0, engineerIds: [], ...over,
})
const facts = (j: JobRow): JobFacts => ({
  job: j, customerRef: '80955', receivedOn: '2026-08-12', dueOn: null, notes: null, closedOn: null, closeReason: null,
  contact: { name: 'Tariq Mehmood', phone: '0300 555 0142', email: null, jobTitle: null }, site: null, orderNumber: j.kind === 'direct' ? 45 : null,
})

function seed(client: QueryClient, j: JobRow, money: boolean) {
  client.setQueryData(qk.jobs.part(j.key, 'facts'), facts(j))
  if (j.rfqId) {
    client.setQueryData(qk.rfqs.part(j.rfqId, 'items'), [{ id: 'i1', number: 1, description: 'Flowmeter', brandId: null, brandName: null, familyId: null, qty: 2, unit: 'nos' }])
    client.setQueryData([...qk.rfqs.part(j.rfqId, 'inquiries'), money ? 'prices' : 'no-prices'], [])
    client.setQueryData(qk.rfqs.part(j.rfqId, 'attachments'), [])
    if (money) client.setQueryData([...qk.rfqs.part(j.rfqId, 'quotations'), 'prices'], [])
  }
  if (j.orderId) {
    const o = j.orderId
    client.setQueryData(qk.orders.part(o, 'header'), { id: o, number: 1, companyId: 'c1', companyName: 'x', rfqId: j.rfqId, customerPo: 'PO-77', orderedOn: '2026-09-02', paymentTermsDays: 30, needsCommissioning: false, plannedOn: null, doneOn: null, cancelledOn: null, cancelReason: null, imported: false, notes: null, site: null, contact: null, owner: null, state: null })
    client.setQueryData(qk.orders.part(o, 'items'), [])
    client.setQueryData(qk.orders.part(o, 'legs'), { legs: [], names: new Map(), quoteLines: [] })
    client.setQueryData(qk.orders.part(o, 'engineers'), [])
    client.setQueryData(qk.orders.part(o, 'files'), [])
    if (money) {
      client.setQueryData(qk.orders.part(o, 'money'), { grossTarget: 1392400, settled: 417720, balance: 974680, paymentState: 'part', dueOn: null, netSale: 1180000, actualCost: 0, expectedCost: null, costsState: 'provisional', margin: null, marginState: 'provisional' })
      client.setQueryData([...qk.jobs.part(j.key, 'invoices'), o], [])
    }
  }
}

function mount(j: JobRow, role: 'admin' | 'sales' | 'engineer') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } } })
  seed(client, j, role !== 'engineer')
  return render(
    <QueryClientProvider client={client}>
      <SessionProvider value={{ status: 'signed-in', user: { id: 'u1', name: 'Faizan', role } }}>
        <ToastProvider><MemoryRouter initialEntries={[`/jobs/${j.key}`]}>
          <Routes>
            <Route path="/jobs/*" element={<JobsScreen />} />
          </Routes>
        </MemoryRouter></ToastProvider>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

const stagesOf = (c: HTMLElement) => within(c.querySelector('[data-stages]') as HTMLElement)

describe('Job page', () => {
  it('Job 139: the header, a seven-stop ruler at Supplier order, one green button, and the current stage open', async () => {
    const { container } = mount(job({}), 'admin')
    expect(await screen.findByRole('heading', { level: 1, name: /Harbour Textiles Limited/ })).toHaveTextContent('Job 139')
    const ruler = screen.getByRole('list', { name: 'Stages of this job' })
    expect(within(ruler).getAllByRole('listitem')).toHaveLength(7)
    expect(within(ruler).getByText('Supplier order').closest('li')).toHaveAttribute('aria-current', 'step')
    expect(container.querySelector('[data-stage-phone]')).toHaveTextContent('Stage 4 of 7 · Supplier order')
    expect([...container.querySelectorAll('button.bg-primary')]).toHaveLength(1)
    expect(stagesOf(container).getByRole('button', { name: /Supplier order/ })).toHaveAttribute('aria-expanded', 'true')
    expect(stagesOf(container).getByRole('button', { name: /Enquiry/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('admin sees the Money panel; it says "Costs not entered yet" while costs are 0 and profit is not known', async () => {
    mount(job({}), 'admin')
    const money = await screen.findByRole('region', { name: 'Money for this job' })
    expect(money).toHaveTextContent('Costs not entered yet')
    expect(money).toHaveTextContent('Not known yet')
    expect(money).toHaveTextContent('974,680')
  })

  it('an engineer gets no Money panel, no amount and nothing about invoices or payment', async () => {
    const { container } = mount(job({}), 'engineer')
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByRole('region', { name: 'Money for this job' })).toBeNull()
    expect(container.textContent).not.toMatch(/PKR|1,392,400|974,680|advance received/)
    const billing = stagesOf(container).getByRole('button', { name: /Billing/ })
    expect(billing).toHaveTextContent('Handled by the office')
    // the engineer's screen never says Invoice (verify-roles: ENGINEER_MONEY_WORDS)
    expect(container.textContent).not.toMatch(/Invoic/i)
  })

  it('clicking a stop opens its stage', async () => {
    const user = userEvent.setup()
    const { container } = mount(job({}), 'admin')
    await screen.findByRole('heading', { level: 1 })
    await user.click(stagesOf(container).getByRole('button', { name: /Enquiry/ }))
    expect(stagesOf(container).getByRole('button', { name: /Enquiry/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('region', { name: 'Enquiry stage' })).toHaveTextContent('Flowmeter')
  })

  it('Job O-45 (an order with no enquiry) starts at Order and links to the job it repeats', async () => {
    const { container } = mount(job({ key: 'O-45', kind: 'direct', rfqId: null, orderId: 'o45', stage: 'ordered', stageDetail: 'to source', repeatOf: '139' }), 'sales')
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByRole('link', { name: 'Repeat of Job 139' })).toHaveAttribute('href', '/jobs/139')
    const ruler = screen.getByRole('list', { name: 'Stages of this job' })
    expect(within(ruler).getAllByText('none')).toHaveLength(2)
    expect(container.querySelector('[data-stage-phone]')).toHaveTextContent('Stage 4 of 7 · Supplier order')
  })

  it('a lost job ends with its reason and has no button', async () => {
    const { container } = mount(job({ stage: 'lost', stageDetail: 'price too high', orderId: null, isHistory: true }), 'admin')
    await screen.findByRole('heading', { level: 1 })
    expect(container.querySelector('[data-stage-ending]')).toHaveTextContent('Lost: price too high')
    expect(container.querySelectorAll('button.bg-primary')).toHaveLength(0)
  })

  it('no such job: Page not found', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    client.setQueryData(qk.jobs.part('9999', 'facts'), null)
    render(
      <QueryClientProvider client={client}>
        <SessionProvider value={{ status: 'signed-in', user: { id: 'u1', name: 'F', role: 'admin' } }}>
          <ToastProvider><MemoryRouter initialEntries={['/jobs/9999']}>
            <Routes>
              <Route path="/jobs/*" element={<JobsScreen />} />
            </Routes>
          </MemoryRouter></ToastProvider>
        </SessionProvider>
      </QueryClientProvider>,
    )
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
  })
})

describe('Job page: the enquiry-side actions stay on the page (P5-D1)', () => {
  function Where() {
    const l = useLocation()
    return <output data-testid="where">{`${l.pathname}${l.search}`}</output>
  }
  function mountAt(j: JobRow, role: 'admin' | 'sales' | 'engineer') {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } } })
    seed(client, j, role !== 'engineer')
    return render(
      <QueryClientProvider client={client}>
        <SessionProvider value={{ status: 'signed-in', user: { id: 'u1', name: 'Faizan', role } }}>
          <ToastProvider><MemoryRouter initialEntries={[`/jobs/${j.key}`]}>
            <Where />
            <Routes>
              <Route path="/jobs/*" element={<JobsScreen />} />
            </Routes>
          </MemoryRouter></ToastProvider>
        </SessionProvider>
      </QueryClientProvider>,
    )
  }

  it('Send quotation opens the Quotation stage and the Issue quotation address, and does not leave the page', async () => {
    const user = userEvent.setup()
    const { container } = mountAt(job({ stage: 'prices_in', stageDetail: '3 of 3 items priced', orderId: null }), 'sales')
    await screen.findByRole('heading', { level: 1 })
    await user.click(screen.getByRole('button', { name: 'Send quotation' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/jobs/139?issue=1')
    expect(stagesOf(container).getByRole('button', { name: /Quotation/ })).toHaveAttribute('aria-expanded', 'true')
  })

  it('Mark won asks for the order on this page (?won=1), from the next-step band', async () => {
    const user = userEvent.setup()
    mountAt(job({ stage: 'quoted', stageDetail: 'waiting for the customer', orderId: null }), 'admin')
    await screen.findByRole('heading', { level: 1 })
    await user.click(screen.getByRole('button', { name: 'Mark won' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/jobs/139?won=1')
  })

  it('an engineer has no Send quotation or Mark won', async () => {
    mountAt(job({ stage: 'quoted', stageDetail: 'waiting for the customer', orderId: null }), 'engineer')
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByRole('button', { name: 'Send quotation' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Mark won' })).toBeNull()
  })
})
