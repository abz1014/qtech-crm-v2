import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { installFakeDb, type FakeCall } from '@/test/fakeSupabase'
import type { TodayData } from './api'
import { FIXTURE_ADMIN, FIXTURE_TODAY, importedStyleInputs } from './importedFixture'
import { TeamView } from './TeamView'

/*
 * Home, Team (owner 2026-11-17): under each person, their open jobs (owned, or put on as the engineer), the newest three with where
 * each stands in the Jobs list's words, each linked to its job, and "See all N open jobs" to Jobs filtered to them.
 */
const SALES = 'u-sales'
const ENG = 'u-eng'
const v = (key: string, over: Record<string, unknown> = {}) => ({
  job_key: key, kind: 'enquiry', rfq_id: `r${key}`, order_id: null, company_id: 'c1', site_id: null, owner_id: SALES, items_summary: 'Flow meter',
  stage: 'enquiry', stage_detail: 'suppliers not asked yet', is_history: false, last_activity_on: '2026-10-19', repeat_of_job_key: null, cancelled_orders: 0, ...over,
})
const rows = [
  v('201', { last_activity_on: '2026-11-10' }),
  v('202', { stage: 'asking_suppliers', stage_detail: '0 of 1 suppliers replied', last_activity_on: '2026-11-09' }),
  v('203', { stage: 'ordered', stage_detail: 'supplier order to place', order_id: 'o203', last_activity_on: '2026-11-08' }),
  v('204', { last_activity_on: '2026-11-01' }),
  v('205', { stage: 'paid', stage_detail: null, is_history: true }),
]
const fake = (c: FakeCall) => {
  if (c.target === 'v_jobs') return { data: rows }
  if (c.target === 'companies') return { data: [{ id: 'c1', name: 'Fictional Mills Ltd' }] }
  if (c.target === 'users') return { data: [{ id: SALES, name: 'Sales Person' }] }
  return { data: [] }
}

function data(): TodayData {
  return {
    ...importedStyleInputs(),
    gst: null, claims: null, health: null, clarifications: [], legs: [], jobs: [], snoozes: [], monthEnd: null, costs: [], invoices: [], recurring: [],
    receivables: [], orders: [], inquiries: [], rfqs: [],
    roles: { [FIXTURE_ADMIN]: 'admin', [SALES]: 'sales', [ENG]: 'engineer' },
    names: { [FIXTURE_ADMIN]: 'Admin Person', [SALES]: 'Sales Person', [ENG]: 'Engineer Person' },
    jobTitle: null,
    phone: null,
  }
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TeamView data={data()} today={FIXTURE_TODAY} selfId={FIXTURE_ADMIN} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
afterEach(() => installFakeDb(() => ({})).uninstall())

describe('Team view, open jobs', () => {
  it("lists a person's newest three open jobs with where each stands, linked to the job, and the way to all of them", async () => {
    installFakeDb(fake)
    const { container } = mount()
    const panel = container.querySelector(`[data-open-jobs="${SALES}"]`) as HTMLElement
    expect(await within(panel).findByText('4')).toBeInTheDocument()
    const links = [...panel.querySelectorAll('a[data-team-job]')]
    expect(links.map(a => a.getAttribute('data-team-job'))).toEqual(['201', '202', '203'])
    expect(links[0]).toHaveAttribute('href', '/jobs/201')
    expect(links.map(a => a.querySelector('[data-stands]')?.textContent)).toEqual(['RFQ · suppliers not asked yet', 'Quotation · 0 of 1 suppliers replied', 'Supplier order · supplier order to place'])
    expect(within(panel).getByRole('link', { name: 'See all 4 open jobs' })).toHaveAttribute('href', `/jobs?person=${SALES}`)
    // history is never an open job
    expect(panel).not.toHaveTextContent('RFQ-0205')
  })

  it('a person with no open jobs says so, with no link', async () => {
    installFakeDb(fake)
    const { container } = mount()
    const panel = container.querySelector(`[data-open-jobs="${ENG}"]`) as HTMLElement
    expect(await within(panel).findByText('No open jobs.')).toBeInTheDocument()
    expect(within(panel).queryAllByRole('link')).toHaveLength(0)
    expect(screen.getAllByRole('heading', { name: /Open jobs/ })).toHaveLength(2)
  })
})
