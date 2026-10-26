import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import { installFakeDb, type FakeCall } from '@/test/fakeSupabase'
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
  if (c.target === 'users') return { data: [{ id: 'u', name: 'Faizan' }, { id: 'other', name: 'Hammad' }] }
  return { data: [] }
}

function mount(role: 'admin' | 'sales' | 'engineer', path = '/jobs') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SessionProvider value={{ status: 'signed-in', user: { id: 'u', name: 'Faizan', role } }}>
        <MemoryRouter initialEntries={[path]}>
          <JobsListPage />
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
}
afterEach(() => installFakeDb(() => ({})).uninstall())

describe('Jobs list', () => {
  it('the admin opens on Open: every job that is not history, with the six columns and one green button', async () => {
    installFakeDb(fake)
    const { container } = mount('admin')
    await waitFor(() => expect(screen.getAllByRole('row', { name: /Job 139/ }).length).toBeGreaterThan(0))
    expect(screen.getAllByRole('row', { name: /Job O-45/ }).length).toBeGreaterThan(0)
    expect(screen.queryAllByRole('row', { name: /Job 120/ })).toHaveLength(0)
    const headers = screen.getAllByRole('columnheader').map(h => h.textContent?.trim()).filter(Boolean)
    expect(headers).toEqual(['Job', 'Customer', 'Items', 'Where it stands', 'Next step', 'Owner'])
    expect([...container.querySelectorAll('button.bg-primary')]).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'New enquiry' })).toBeInTheDocument()
    expect(container).toHaveTextContent('Repeat of Job 139')
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

  it('an engineer opens on Mine, sees no button to start an enquiry and no amount', async () => {
    installFakeDb(fake)
    const { container } = mount('engineer')
    await waitFor(() => expect(screen.getAllByRole('row', { name: /Job 139/ }).length).toBeGreaterThan(0))
    expect(screen.queryAllByRole('row', { name: /Job 140/ })).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'New enquiry' })).toBeNull()
    expect(container.textContent).not.toMatch(/PKR|Rs\.? ?\d/)
  })
})
