import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeAll, describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import { ToastProvider } from '@/ui/Toast'
import { qk } from '@/features/queryKeys'
import type { JobFacts, JobRow } from '@/features/jobs/api'
import JobsScreen from '@/features/jobs/JobsScreen'
import OrderMore from '@/features/orders/jobSlots/OrderMore'

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

function mount(j: JobRow, role: 'admin' | 'sales' | 'engineer', extra?: (c: QueryClient) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } } })
  seed(client, j, role !== 'engineer')
  extra?.(client)
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

// The More menus' code is loaded up front: the job page asks for it as soon as it draws, and a chunk that resolves after a test has
// ended logs into a closed worker (an unhandled teardown error on a slow machine).
beforeAll(async () => {
  await Promise.all([import('@/features/orders/jobSlots/OrderMoreInner'), import('@/features/rfqs/jobSlots/RfqMoreInner')])
})

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

  it('an enquiry-stage job (no order) never sits on Loading: the Money card says there is no money yet', async () => {
    mount(job({ stage: 'quotation', stageDetail: 'waiting for supplier prices', orderId: null }), 'admin')
    const money = await screen.findByRole('region', { name: 'Money for this job' })
    expect(money).toHaveTextContent('No money yet: no quotation has been sent.')
    expect(money).not.toHaveTextContent('Loading')
  })

  it('sales and engineers see no Money card on an enquiry-stage job', async () => {
    mount(job({ stage: 'quotation', orderId: null }), 'sales')
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByRole('region', { name: 'Money for this job' })).toBeNull()
    cleanup()
    mount(job({ stage: 'quotation', orderId: null }), 'engineer')
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByRole('region', { name: 'Money for this job' })).toBeNull()
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

  it('the header shows Customer PO, Supplier and Delivery for admin and sales; the stage still opens as before', async () => {
    for (const role of ['admin', 'sales'] as const) {
      const { container } = mount(job({}), role)
      const dl = await screen.findByLabelText('Key facts')
      expect(within(dl).getByText('Customer PO')).toBeInTheDocument()
      expect(within(dl).getByText('PO-77')).toBeInTheDocument()
      expect(within(dl).getByText('Supplier')).toBeInTheDocument()
      expect(within(dl).getByText('Not chosen yet')).toBeInTheDocument()
      expect(within(dl).getByText('Delivery')).toBeInTheDocument()
      expect(within(dl).getByText('Not ordered from the supplier yet')).toBeInTheDocument()
      expect(stagesOf(container).getByRole('button', { name: /Supplier order/ })).toHaveAttribute('aria-expanded', 'true')
      cleanup()
    }
  })

  it('an engineer sees Supplier and Delivery but never the Customer PO, in the page text or its markup', async () => {
    const { container } = mount(job({}), 'engineer')
    const dl = await screen.findByLabelText('Key facts')
    expect(within(dl).getByText('Supplier')).toBeInTheDocument()
    expect(within(dl).getByText('Delivery')).toBeInTheDocument()
    expect(container.innerHTML).not.toContain('PO-77')
    expect(container.textContent).not.toMatch(/Customer PO/)
  })

  it('an enquiry with no order has no key facts', async () => {
    mount(job({ stage: 'quotation', orderId: null }), 'admin')
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByLabelText('Key facts')).toBeNull()
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

const phoneMedia = () => {
  const real = window.matchMedia
  window.matchMedia = ((q: string) => ({ matches: q.includes('max-width: 767px'), media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia
  return () => { window.matchMedia = real }
}
const sectionIds = (c: HTMLElement) => [...c.querySelectorAll('[data-stages] > section')].map(e => e.id)

describe('Job page: the stage list', () => {
  it('on a phone the stage the job is at comes first, under the Next step band; on a computer the order is the ruler order', async () => {
    const off = phoneMedia()
    try {
      const { container } = mount(job({}), 'admin')
      await screen.findByRole('heading', { level: 1 })
      expect(sectionIds(container)).toEqual(['stage-3', 'stage-0', 'stage-1', 'stage-2', 'stage-4', 'stage-5', 'stage-6'])
      expect(stagesOf(container).getAllByRole('button')[0]).toHaveTextContent(/Supplier order/)
    } finally {
      off()
    }
    cleanup()
    const { container } = mount(job({}), 'admin')
    await screen.findByRole('heading', { level: 1 })
    expect(sectionIds(container)).toEqual(['stage-0', 'stage-1', 'stage-2', 'stage-3', 'stage-4', 'stage-5', 'stage-6'])
  })

  it('a finished job has no current stage, so nothing moves on a phone', async () => {
    const off = phoneMedia()
    try {
      const { container } = mount(job({ stage: 'paid', stageDetail: null }), 'admin')
      await screen.findByRole('heading', { level: 1 })
      expect(sectionIds(container)).toEqual(['stage-0', 'stage-1', 'stage-2', 'stage-3', 'stage-4', 'stage-5', 'stage-6'])
    } finally {
      off()
    }
  })

  it('a job that began as an order shows one grey row instead of two cards, and keeps the stage-0 and stage-1 ids', async () => {
    const { container } = mount(job({ key: 'O-45', kind: 'direct', rfqId: null, orderId: 'o45', stage: 'ordered', stageDetail: 'to source' }), 'sales')
    await screen.findByRole('heading', { level: 1 })
    const stages = stagesOf(container)
    expect(stages.getAllByText('No enquiry or quotation: this job started as an order')).toHaveLength(1)
    expect(stages.queryByRole('button', { name: /^Enquiry/ })).toBeNull()
    expect(stages.queryByRole('button', { name: /^Quotation/ })).toBeNull()
    expect(container.querySelector('#stage-0')).not.toBeNull()
    expect(container.querySelector('#stage-1')).not.toBeNull()
    expect(container.querySelectorAll('[data-stages] > section')).toHaveLength(6)
    expect(container.textContent).not.toMatch(/with no enquiry before it/)
  })

  it('on a phone a direct job still leads with its current stage, then the grey row', async () => {
    const off = phoneMedia()
    try {
      const { container } = mount(job({ key: 'O-45', kind: 'direct', rfqId: null, orderId: 'o45', stage: 'ordered', stageDetail: 'to source' }), 'sales')
      await screen.findByRole('heading', { level: 1 })
      expect(sectionIds(container)).toEqual(['stage-3', 'stage-0', 'stage-2', 'stage-4', 'stage-5', 'stage-6'])
    } finally {
      off()
    }
  })
})

describe('Job page: owner and contact', () => {
  it('Reassign owner is not in the header; admin finds it in More, once, on an order job and on an enquiry-only job', async () => {
    const user = userEvent.setup()
    for (const j of [job({}), job({ stage: 'quoted', stageDetail: 'waiting for the customer', orderId: null })]) {
      mount(j, 'admin', c => c.setQueryData(qk.rfqs.part('r1', 'header'), { id: 'r1', number: 139, customerRef: null, receivedOn: '2026-08-12', dueOn: null, isPriority: false, quotedOn: null, closedOn: null, closeReason: null, closeNote: null, notes: null, company: { id: 'c1', name: 'Harbour Textiles Limited', country: null, createdAt: null }, site: null, contactId: null, contact: null, owner: null, state: null }))
      await screen.findByRole('heading', { level: 1 })
      expect(screen.queryByRole('button', { name: 'Reassign owner' })).toBeNull()
      const more = await screen.findByRole('button', { name: 'More' })
      await waitFor(() => expect(more).toBeEnabled())
      await user.click(more)
      expect(await screen.findAllByRole('menuitem', { name: 'Reassign owner' })).toHaveLength(1)
      cleanup()
    }
  })

  it('sales is offered no Reassign owner', async () => {
    const user = userEvent.setup()
    mount(job({}), 'sales')
    await screen.findByRole('heading', { level: 1 })
    const more = await screen.findByRole('button', { name: 'More' })
    await waitFor(() => expect(more).toBeEnabled())
    await user.click(more)
    await screen.findAllByRole('menuitem')
    expect(screen.queryByRole('menuitem', { name: 'Reassign owner' })).toBeNull()
  })

  it('an engineer has the contact (name, Call, WhatsApp) once, right after On site, and not in the side column', async () => {
    const { container } = mount(job({}), 'engineer')
    const onSite = await screen.findByRole('region', { name: 'On site' })
    const panels = screen.getAllByRole('region', { name: 'Contact' })
    expect(panels).toHaveLength(1)
    expect(onSite.compareDocumentPosition(panels[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(panels[0].nextElementSibling).toBeNull()
    expect(container.querySelector('aside')?.contains(panels[0])).toBe(false)
    expect(within(panels[0]).getByText('Tariq Mehmood')).toBeInTheDocument()
    expect(within(panels[0]).getByRole('link', { name: /^Call Tariq Mehmood/ })).toBeInTheDocument()
    expect(within(panels[0]).getByRole('link', { name: /^WhatsApp/ })).toBeInTheDocument()
    // the On site card no longer repeats the person
    expect(onSite).not.toHaveTextContent('Tariq Mehmood')
  })

  it('an engineer reaches Call and WhatsApp before the delivery challans: On site, then Contact, then Delivery challans', async () => {
    mount(job({}), 'engineer')
    const onSite = await screen.findByRole('region', { name: 'On site' })
    const contact = screen.getByRole('region', { name: 'Contact' })
    const challans = await screen.findByRole('region', { name: 'Delivery challans' })
    const follows = (a: HTMLElement, b: HTMLElement) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(follows(onSite, contact)).toBe(true)
    expect(follows(contact, challans)).toBe(true)
    expect(onSite.contains(challans)).toBe(false)
  })

  it('admin and sales keep the contact in the side column', async () => {
    const { container } = mount(job({}), 'sales')
    await screen.findByRole('heading', { level: 1 })
    const panels = screen.getAllByRole('region', { name: 'Contact' })
    expect(panels).toHaveLength(1)
    expect(container.querySelector('aside')?.contains(panels[0])).toBe(true)
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

describe('Job page: the More menu', () => {
  const phoneOn = () => {
    const real = window.matchMedia
    window.matchMedia = ((q: string) => ({ matches: q.includes('max-width: 767px'), media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia
    return () => { window.matchMedia = real }
  }

  it('the trigger is drawn at once, disabled and busy, while the menu or its order is still loading', async () => {
    const j = job({})
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } } })
    seed(client, j, true)
    // the order's header is on its way and has not arrived
    client.removeQueries({ queryKey: qk.orders.part('o1', 'header') })
    void client.prefetchQuery({ queryKey: qk.orders.part('o1', 'header'), queryFn: () => new Promise(() => {}) })
    render(
      <QueryClientProvider client={client}>
        <SessionProvider value={{ status: 'signed-in', user: { id: 'u1', name: 'Faizan', role: 'admin' } }}>
          <ToastProvider><MemoryRouter>
            <OrderMore job={{ job: j, role: 'admin', money: true }} />
          </MemoryRouter></ToastProvider>
        </SessionProvider>
      </QueryClientProvider>,
    )
    // synchronously, with nothing awaited
    const more = screen.getByRole('button', { name: 'More' })
    expect(more).toHaveAttribute('aria-haspopup', 'menu')
    expect(more).toBeDisabled()
    expect(more).toHaveAttribute('aria-busy', 'true')
    // it stays that way until the header is there; then the real menu takes its place
    await new Promise(r => setTimeout(r, 50))
    expect(screen.getByRole('button', { name: 'More' })).toBeDisabled()
    act(() => {
      client.setQueryData(qk.orders.part('o1', 'header'), { id: 'o1', number: 1, companyId: 'c1', companyName: 'x', rfqId: 'r1', customerPo: null, orderedOn: '2026-09-02', paymentTermsDays: 30, needsCommissioning: false, plannedOn: null, doneOn: null, cancelledOn: null, cancelReason: null, imported: false, notes: null, site: null, contact: null, owner: null, state: null })
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'More' })).toBeEnabled())
  })

  it('on a phone a cancelled job with no next-step button still has More (admin), and an engineer has none', async () => {
    const off = phoneOn()
    try {
      const { unmount } = mount(job({ stage: 'cancelled', stageDetail: null }), 'admin')
      await screen.findByRole('heading', { level: 1, name: /Harbour Textiles Limited/ })
      const bar = screen.getByRole('toolbar', { name: 'Job actions' })
      expect(within(bar).getByRole('button', { name: 'More' })).toBeInTheDocument()
      await waitFor(() => expect(within(bar).getByRole('button', { name: 'More' })).toBeEnabled())
      unmount()
      cleanup()
      mount(job({ stage: 'cancelled', stageDetail: null }), 'engineer')
      await screen.findByRole('heading', { level: 1, name: /Harbour Textiles Limited/ })
      expect(screen.queryByRole('toolbar', { name: 'Job actions' })).toBeNull()
    } finally {
      off()
    }
  })
})
