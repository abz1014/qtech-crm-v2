import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import type { SessionState } from '@/app/session'
import { installFakeDb, opArgs, type FakeCall } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'
import { header } from '@/features/orders/lib/stepFixtures'
import { VisitsSection } from '@/features/orders/visits/VisitsSection'

let fake: ReturnType<typeof installFakeDb> | null = null
afterEach(() => fake?.uninstall())

const ROWS = [
  { id: 'v1', order_id: 'o', visit_type: 'survey', visit_on: '2026-11-02', engineer_id: 'e1', notes: 'Look at the cable run', done_on: '2026-11-02' },
  { id: 'v2', order_id: 'o', visit_type: 'installation', visit_on: '2026-11-09', engineer_id: 'e1', notes: null, done_on: null },
  { id: 'v3', order_id: 'o', visit_type: 'service', visit_on: '2026-11-20', engineer_id: 'e2', notes: null, done_on: null },
]

function db(extra?: (c: FakeCall) => ReturnType<Parameters<typeof installFakeDb>[0]> | undefined) {
  return installFakeDb(c => {
    const own = extra?.(c)
    if (own) return own
    if (c.target === 'order_visits' && c.verb === 'select') return { data: ROWS }
    if (c.target === 'users') return { data: [{ id: 'e1', name: 'Hamza Sheikh' }, { id: 'e2', name: 'Bilal Chaudhry' }] }
    return { data: null }
  })
}

function mount(session: SessionState, props: { isEngineer: boolean; canEdit: boolean } = { isEngineer: false, canEdit: true }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <SessionProvider value={session}>
        <ToastProvider>
          <VisitsSection order={header({ needsCommissioning: true })} engineers={[{ id: 'e1', name: 'Hamza Sheikh' }]} {...props} />
        </ToastProvider>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

const admin: SessionState = { status: 'signed-in', user: { id: 'a1', name: 'Bilal Chaudhry', role: 'admin' } }
const engineer: SessionState = { status: 'signed-in', user: { id: 'e1', name: 'Hamza Sheikh', role: 'engineer' } }

describe('Visits on an order', () => {
  it('lists every visit with its type, engineer, notes and state, oldest first', async () => {
    fake = db()
    mount(admin)
    const list = await screen.findByRole('list', { name: 'Visits on this order' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent('Survey')
    expect(items[0]).toHaveTextContent('Done')
    expect(items[0]).toHaveTextContent('Look at the cable run')
    expect(items[1]).toHaveTextContent('Installation')
    expect(items[2]).toHaveTextContent('Service')
    expect(items[2]).toHaveTextContent('Bilal Chaudhry')
  })

  it('lets admin add a visit with just a type: installation is the start', async () => {
    fake = db()
    const user = userEvent.setup()
    mount(admin)
    await user.click(await screen.findByRole('button', { name: 'Add visit' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fake?.calls.some(c => c.verb === 'insert')).toBe(true))
    const call = fake!.calls.find(c => c.verb === 'insert')!
    expect(call.target).toBe('order_visits')
    expect(opArgs(call, 'insert')?.[0]).toEqual({ order_id: 'o', visit_type: 'installation', visit_on: null, engineer_id: null, notes: null })
  })

  it('marks a visit done with one tap', async () => {
    fake = db()
    const user = userEvent.setup()
    mount(admin)
    const list = await screen.findByRole('list', { name: 'Visits on this order' })
    await user.click(within(within(list).getAllByRole('listitem')[1]).getByRole('button', { name: 'Mark visit done' }))
    await waitFor(() => expect(fake?.calls.some(c => c.verb === 'update')).toBe(true))
    const call = fake!.calls.find(c => c.verb === 'update')!
    expect(call.ops).toContainEqual(['eq', ['id', 'v2']])
    expect(opArgs(call, 'update')?.[0]).toMatchObject({ done_on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })
  })

  it('shows an engineer only their own visits to change, and no way to add or delete', async () => {
    fake = db()
    mount(engineer, { isEngineer: true, canEdit: true })
    const list = await screen.findByRole('list', { name: 'Visits on this order' })
    const items = within(list).getAllByRole('listitem')
    // v1 is done (no Mark done), v2 is theirs, v3 is Bilal's
    expect(within(items[0]).queryByRole('button', { name: 'Mark visit done' })).toBeNull()
    expect(within(items[1]).getByRole('button', { name: 'Mark visit done' })).toBeInTheDocument()
    expect(within(items[2]).queryByRole('button', { name: 'Mark visit done' })).toBeNull()
    expect(within(items[2]).queryByRole('button', { name: 'Edit visit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add visit' })).toBeNull()
  })

  it('gives every role the service report of every visit', async () => {
    fake = db()
    mount(engineer, { isEngineer: true, canEdit: true })
    const list = await screen.findByRole('list', { name: 'Visits on this order' })
    expect(within(list).getAllByRole('button', { name: 'Service report' })).toHaveLength(3)
  })

  it('says so when there are no visits', async () => {
    fake = db(c => (c.target === 'order_visits' ? { data: [] } : undefined))
    mount(admin)
    expect(await screen.findByText('No visits yet.')).toBeInTheDocument()
  })
})
