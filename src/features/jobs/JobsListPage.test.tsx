import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import { installFakeDb, opArgs, type FakeCall } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'
import JobsListPage from '@/features/jobs/JobsListPage'

/*
 * The Jobs list (P5-B): three chips, the six columns, one green button, History is only is_history rows, and no money anywhere
 * (v_jobs has none, so an engineer's page is the office's page).
 */
const view = (key: string, over: Record<string, unknown> = {}) => ({
  job_key: key, kind: key.startsWith('O-') ? 'direct' : 'enquiry', rfq_id: key.startsWith('O-') ? null : `r${key}`, order_id: key.startsWith('O-') ? `o${key}` : null,
  company_id: 'c1', site_id: null, owner_id: 'u', items_summary: 'Flow meter RST 1158S +2 more', stage: 'supplier_ordered', stage_detail: 'supplier late, advance received',
  is_history: false, last_activity_on: '2026-10-19', repeat_of_job_key: null, cancelled_orders: 0, ...over,
})
const rows = [
  view('139'),
  view('140', { owner_id: 'other', stage: 'quoted', stage_detail: 'waiting for the customer' }),
  view('O-45', { owner_id: 'other', stage: 'ordered', stage_detail: 'to source', repeat_of_job_key: '139' }),
  view('120', { stage: 'paid', stage_detail: null, is_history: true }),
  view('121', { stage: 'lost', stage_detail: 'price too high', is_history: true }),
]
const fake = (c: FakeCall) => {
  if (c.target === 'v_jobs') return { data: rows }
  if (c.target === 'companies') return { data: [{ id: 'c1', name: 'Ibrahim Fibres Limited' }] }
  // the ids of orders imported from the old CRM (legacy_source set): Job O-45 is one of them
  if (c.target === 'orders') return { data: [{ id: 'oO-45' }] }
  if (c.target === 'users') return { data: [{ id: 'u', name: 'Faizan' }, { id: 'other', name: 'Hammad' }] }
  return { data: [] }
}

function mount(role: 'admin' | 'sales' | 'engineer', path = '/jobs') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SessionProvider value={{ status: 'signed-in', user: { id: 'u', name: 'Faizan', role } }}>
        <MemoryRouter initialEntries={[path]}>
          <ToastProvider>
            <JobsListPage />
          </ToastProvider>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
}
const desktopMedia = window.matchMedia
/** Below 640px the Jobs list draws cards instead of table rows. */
function phone() {
  window.matchMedia = ((q: string) => ({ matches: q.includes('max-width: 639px'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false, onchange: null })) as typeof window.matchMedia
}
afterEach(() => {
  window.matchMedia = desktopMedia
  installFakeDb(() => ({})).uninstall()
})

describe('Jobs list', () => {
  it('the admin opens on Open: every job that is not history, with the seven columns and one green button', async () => {
    installFakeDb(fake)
    const { container } = mount('admin')
    await waitFor(() => expect(screen.getAllByRole('row', { name: /Job 139/ }).length).toBeGreaterThan(0))
    expect(screen.getAllByRole('row', { name: /Job O-45/ }).length).toBeGreaterThan(0)
    expect(screen.queryAllByRole('row', { name: /Job 120/ })).toHaveLength(0)
    const headers = screen.getAllByRole('columnheader').map(h => h.textContent?.trim()).filter(Boolean)
    expect(headers).toEqual(['Job', 'Customer', 'Customer PO', 'Items', 'Where it stands', 'Next step', 'Owner'])
    expect([...container.querySelectorAll('button.bg-primary')]).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'New enquiry' })).toBeInTheDocument()
    expect(container).toHaveTextContent('Repeat of Job 139')
  })

  it('the customer cell shows two lines and the items cell one, with the whole text in the title', async () => {
    const longItems = 'Sample flow meter FM-100 DN50, sample pressure transmitter PT-20, sample level switch LS-3, sample junction box JB-9, sample cable gland M20'
    installFakeDb((c: FakeCall) => (c.target === 'v_jobs' ? { data: [view('139', { items_summary: longItems })] } : fake(c)))
    const { container } = mount('admin')
    await waitFor(() => expect(screen.getAllByRole('row', { name: /Job 139/ }).length).toBeGreaterThan(0))
    const clamped = [...container.querySelectorAll('table .line-clamp-2, table .line-clamp-1')] as HTMLElement[]
    expect(clamped.map(e => e.getAttribute('title'))).toEqual(expect.arrayContaining(['Ibrahim Fibres Limited', longItems]))
  })

  it('an imported line that already ends in "+1 more", plus two more lines, shows one count on the card and in the table', async () => {
    installFakeDb((c: FakeCall) => (c.target === 'v_jobs' ? { data: [view('139', { items_summary: 'IC TLC0838C 20PIN SMD ×6 +1 more +2 more' })] } : fake(c)))
    const { container } = mount('admin')
    await waitFor(() => expect(screen.getAllByRole('row', { name: /Job 139/ }).length).toBeGreaterThan(0))
    expect(container).toHaveTextContent('4 items · IC TLC0838C 20PIN SMD ×6')
    expect(container.textContent).not.toMatch(/\+\d+ more/)
  })

  it('History shows only the rows the database marks is_history', async () => {
    installFakeDb(fake)
    const user = userEvent.setup()
    mount('admin')
    await waitFor(() => expect(screen.getAllByRole('row', { name: /Job 139/ }).length).toBeGreaterThan(0))
    await user.click(screen.getByRole('radio', { name: /History/ }))
    await waitFor(() => expect(screen.getAllByRole('row', { name: /Job 120/ }).length).toBeGreaterThan(0))
    expect(screen.getAllByRole('row', { name: /Job 121/ })[0]).toHaveTextContent('Lost: price too high')
    expect(screen.queryAllByRole('row', { name: /Job 139/ })).toHaveLength(0)
  })

  it('an imported job is a live job but raises no red task: its step is grey and says Imported', async () => {
    installFakeDb(fake)
    mount('admin')
    await waitFor(() => expect(screen.getAllByRole('row', { name: /Job O-45/ }).length).toBeGreaterThan(0))
    const imported = screen.getAllByRole('row', { name: /Job O-45/ })[0]
    expect(imported).toHaveTextContent('Imported · Choose a supplier for the items')
    expect(imported.querySelector('[data-tone="now"]')).toBeNull()
    // a live job with the same kind of step keeps its tone
    const live = screen.getAllByRole('row', { name: /Job 139/ }).find(r => !/O-45/.test(r.textContent ?? ''))
    expect(live?.querySelector('[data-tone="late"]')).not.toBeNull()
  })

  it('a phone card has one status line: the stage in words, one next step, no dots and no repeated Imported', async () => {
    phone()
    installFakeDb(fake)
    mount('admin')
    await waitFor(() => expect(document.querySelectorAll('[data-card]').length).toBe(3))
    const cards = [...document.querySelectorAll('[data-card]')] as HTMLElement[]
    const live = cards.find(c => /Job 139/.test(c.textContent ?? ''))!
    expect(live.querySelector('[data-stage-line]')).toHaveTextContent('Stage 4 of 7 · Supplier order')
    expect(live.querySelectorAll('[data-stage-mini]')).toHaveLength(0)
    expect(live).toHaveTextContent('3 items · Flow meter RST 1158S')
    expect(live).toHaveTextContent('The goods are late: chase the supplier')
    expect(live).not.toHaveTextContent('Imported')
    const imported = cards.find(c => /Job O-45/.test(c.textContent ?? ''))!
    expect(imported).toHaveTextContent('Imported')
    expect(imported).toHaveTextContent('Choose a supplier for the items')
    expect(imported.textContent).not.toContain('Imported · ')
    expect(imported.querySelectorAll('[data-tone]')).toHaveLength(1)
  })

  it('a phone card shows the customer PO to the office and never to an engineer', async () => {
    phone()
    installFakeDb(c => (c.target === 'orders' ? { data: [{ id: 'oO-45', customer_po_number: 'PO-77' }] } : fake(c)))
    const admin = mount('admin')
    await waitFor(() => expect(admin.container.textContent).toContain('PO PO-77'))
    admin.unmount()
    const eng = mount('engineer')
    await waitFor(() => expect(eng.container.querySelectorAll('[data-card]').length).toBeGreaterThan(0))
    expect(eng.container.textContent).not.toContain('PO-77')
    expect(eng.container.textContent).not.toMatch(/PO PO/)
  })

  it('an engineer opens on Mine, sees no button to start an enquiry and no amount', async () => {
    installFakeDb(fake)
    const { container } = mount('engineer')
    await waitFor(() => expect(screen.getAllByRole('row', { name: /Job 139/ }).length).toBeGreaterThan(0))
    expect(screen.queryAllByRole('row', { name: /Job 140/ })).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'New enquiry' })).toBeNull()
    expect(container.textContent).not.toMatch(/PKR|Rs\.? ?\d/)
  })

  it('an engineer with no jobs sees the empty state and no "Showing 0" count line', async () => {
    installFakeDb(c => (c.target === 'v_jobs' ? { data: rows.filter(r => r.owner_id === 'other') } : fake(c)))
    mount('engineer')
    expect(await screen.findByText('No jobs are assigned to you')).toBeInTheDocument()
    expect(screen.queryByText(/Showing 0/)).toBeNull()
  })

  it('/jobs?new=1 (Order without enquiry) opens the new-order dialog once, for the office only', async () => {
    installFakeDb(fake)
    mount('sales', '/jobs?new=1')
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('an engineer who lands on ?new=1 gets no dialog', async () => {
    installFakeDb(fake)
    mount('engineer', '/jobs?new=1')
    await waitFor(() => expect(screen.getAllByRole('row', { name: /Job 139/ }).length).toBeGreaterThan(0))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  describe('Customer PO column and the stage filter', () => {
    const withPo = (c: FakeCall) => {
      if (c.target === 'orders' && String(opArgs(c, 'select')?.[0] ?? '').includes('customer_po_number')) return { data: [{ id: 'oO-45', customer_po_number: 'FIB-PO-8841' }] }
      return fake(c)
    }
    const asked = (calls: FakeCall[]) => calls.filter(c => String(opArgs(c, 'select')?.[0] ?? '').includes('customer_po_number'))
    const radios = () => screen.getAllByRole('radio').map(r => r.textContent?.trim())

    it('admin and sales get the Customer PO column after Customer, with the number on its row and a dash where there is none', async () => {
      for (const role of ['admin', 'sales'] as const) {
        installFakeDb(withPo)
        const { unmount } = mount(role, '/jobs?chip=open')
        await waitFor(() => expect(screen.getAllByRole('row', { name: /Job O-45/ })[0]).toHaveTextContent('FIB-PO-8841'))
        const headers = screen.getAllByRole('columnheader').map(h => h.textContent?.trim()).filter(Boolean)
        expect(headers.slice(0, 3)).toEqual(['Job', 'Customer', 'Customer PO'])
        expect(screen.getAllByRole('row', { name: /Job 139/ }).find(r => !/O-45/.test(r.textContent ?? ''))).not.toHaveTextContent('FIB-PO')
        expect(screen.getAllByRole('row', { name: /Job 139/ }).find(r => !/O-45/.test(r.textContent ?? ''))).toHaveTextContent('—')
        unmount()
      }
    })

    it('an engineer has no Customer PO column and the page never asks for customer_po_number', async () => {
      const { calls } = installFakeDb(withPo)
      const { container } = mount('engineer', '/jobs?chip=open')
      await waitFor(() => expect(screen.getAllByRole('row', { name: /Job O-45/ }).length).toBeGreaterThan(0))
      expect(screen.getAllByRole('columnheader').map(h => h.textContent?.trim()).filter(Boolean)).toEqual(['Job', 'Customer', 'Items', 'Where it stands', 'Next step', 'Owner'])
      expect(container.textContent).not.toContain('FIB-PO-8841')
      expect(asked(calls)).toHaveLength(0)
    })

    it('admin and sales are offered all six; an engineer four; History only All and Orders', async () => {
      installFakeDb(withPo)
      const user = userEvent.setup()
      const admin = mount('admin')
      await waitFor(() => expect(screen.getAllByRole('row', { name: /Job 139/ }).length).toBeGreaterThan(0))
      expect(radios().slice(-6)).toEqual(['All', 'Orders', 'Waiting for supplier', 'To deliver', 'To invoice', 'To be paid'])
      await user.click(screen.getByRole('radio', { name: /History/ }))
      await waitFor(() => expect(screen.getAllByRole('row', { name: /Job 120/ }).length).toBeGreaterThan(0))
      expect(radios().slice(-2)).toEqual(['All', 'Orders'])
      expect(screen.queryByRole('radio', { name: 'To invoice' })).toBeNull()
      admin.unmount()
      installFakeDb(withPo)
      mount('engineer')
      await waitFor(() => expect(screen.getAllByRole('row', { name: /Job 139/ }).length).toBeGreaterThan(0))
      expect(radios().slice(-4)).toEqual(['All', 'Orders', 'Waiting for supplier', 'To deliver'])
      expect(screen.queryByRole('radio', { name: 'To invoice' })).toBeNull()
      expect(screen.queryByRole('radio', { name: 'To be paid' })).toBeNull()
    })

    it('picking Waiting for supplier narrows the open jobs, says so, and an empty stage offers the way back', async () => {
      installFakeDb(withPo)
      const user = userEvent.setup()
      mount('admin', '/jobs?chip=open')
      await waitFor(() => expect(screen.getAllByRole('row', { name: /Job 140/ }).length).toBeGreaterThan(0))
      await user.click(screen.getByRole('radio', { name: 'Waiting for supplier' }))
      await waitFor(() => expect(screen.queryAllByRole('row', { name: /Job 140/ })).toHaveLength(0))
      expect(screen.getAllByRole('row', { name: /Job 139/ }).length).toBeGreaterThan(0)
      expect(screen.getByText(/Showing 2 open jobs · Waiting for supplier/)).toBeInTheDocument()
      await user.click(screen.getByRole('radio', { name: 'To invoice' }))
      expect(await screen.findByText('No open jobs to invoice')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Show all open jobs' }))
      await waitFor(() => expect(screen.getAllByRole('row', { name: /Job 140/ }).length).toBeGreaterThan(0))
    })

    it('an engineer who lands on ?stage=invoice sees every job (All), not an empty list', async () => {
      installFakeDb(withPo)
      mount('engineer', '/jobs?stage=invoice')
      await waitFor(() => expect(screen.getAllByRole('row', { name: /Job 139/ }).length).toBeGreaterThan(0))
      expect(screen.queryByText(/No .* to invoice/)).toBeNull()
    })
  })

  it('an engineer at desktop width never reads the word paid, even on a paid job in History', async () => {
    installFakeDb(fake)
    const { container } = mount('engineer', '/jobs?chip=history')
    await waitFor(() => expect(screen.getAllByRole('row', { name: /Job 120/ }).length).toBeGreaterThan(0))
    expect(container.textContent).toContain('All 7 stages done')
    expect(container.textContent).not.toMatch(/\bpaid\b/i)
  })
})
