import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installFakeDb, type FakeCall } from '@/test/fakeSupabase'
import { OldAddress } from '@/app/oldAddresses'
import { chipForOldList } from '@/app/oldAddressesModel'
import { navCountsFrom } from '@/app/shell/useNavCounts'
import { buildToday } from '@/features/today/rules'
import { importedStyleInputs } from '@/features/today/importedFixture'

/*
 * P5-F: the old RFQ and Order addresses open Jobs (an id opens its Job through v_jobs, a list opens the Jobs list with the matching
 * chip), with or without the retired ?old=1. And Money's red dot: only while a real invoice is late.
 */
function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname + l.search}</p>
}
let fake: ReturnType<typeof installFakeDb> | null = null
beforeEach(() => window.localStorage.clear())
afterEach(() => fake?.uninstall())

function mount(path: string, respond: (c: FakeCall) => { data?: unknown } = () => ({ data: [] })) {
  fake = installFakeDb(respond)
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/rfqs/*" element={<><OldAddress kind="rfq" /><Where /></>} />
        <Route path="/orders/*" element={<><OldAddress kind="order" /><Where /></>} />
        <Route path="/jobs/*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('old addresses open Jobs', () => {
  it('/rfqs/<id> opens the Job that holds the RFQ, query kept', async () => {
    mount('/rfqs/11111111-1111-4111-8111-111111111111?x=1', c => (c.target === 'v_jobs' ? { data: [{ job_key: '139' }] } : { data: [] }))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/jobs/139?x=1'))
    expect(fake?.calls.find(c => c.target === 'v_jobs')?.ops.some(([n, a]) => n === 'eq' && a[0] === 'rfq_id' && a[1] === '11111111-1111-4111-8111-111111111111')).toBe(true)
  })

  it('/orders/<id> opens its Job; a cancelled order finds the Job through its RFQ', async () => {
    mount('/orders/22222222-2222-4222-8222-222222222222', c => (c.target === 'v_jobs' ? { data: [{ job_key: 'O-45' }] } : { data: [] }))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/jobs/O-45'))
    fake?.uninstall()
    let n = 0
    const r = mount('/orders/33333333-3333-4333-8333-333333333333', c => {
      if (c.target === 'v_jobs') return { data: n++ === 0 ? [] : [{ job_key: '139' }] }
      if (c.target === 'orders') return { data: [{ rfq_id: 'r9' }] }
      return { data: [] }
    })
    await waitFor(() => expect(r.getAllByTestId('where').at(-1)?.textContent).toBe('/jobs/139'))
  })

  it('a failed lookup (offline, a server error) says so and offers Try again, not "not found"', async () => {
    let fail = true
    mount('/rfqs/44444444-4444-4444-8444-444444444444', c => {
      if (c.target === 'v_jobs') return fail ? { error: { message: 'Failed to fetch' } } : { data: [{ job_key: '139' }] }
      return { data: [] }
    })
    const retry = await screen.findByRole('button', { name: 'Try again' }, { timeout: 4000 })
    expect(screen.queryByText(/not found/i)).toBeNull()
    fail = false
    retry.click()
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/jobs/139'))
  })

  it('an id with no Job is page not found, not a blank page', async () => {
    mount('/rfqs/00000000-0000-4000-8000-000000000000')
    expect(await screen.findByText(/not found/i)).toBeInTheDocument()
  })

  it('an id that is not even an id (a mistyped link) is page not found, not "check your connection"', async () => {
    mount('/rfqs/not-a-uuid', c => (c.target === 'v_jobs' ? { error: { message: 'invalid input syntax for type uuid' } } : { data: [] }))
    expect(await screen.findByText(/not found/i)).toBeInTheDocument()
    expect(screen.queryByText(/check your connection/i)).toBeNull()
  })

  it('the lists open the Jobs list with the matching chip', async () => {
    mount('/rfqs')
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/jobs'))
    fake?.uninstall()
    mount('/orders?show=closed')
    await waitFor(() => expect(screen.getAllByTestId('where').at(-1)?.textContent).toBe('/jobs?chip=history'))
    expect(chipForOldList('?owner=mine')).toBe('mine')
    expect(chipForOldList('?tab=closed')).toBe('history')
    expect(chipForOldList('')).toBeNull()
  })

  it('the list redirect keeps the other parameters: new=1 (Order without enquiry) and the search text', async () => {
    mount('/orders?new=1')
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/jobs?new=1'))
    fake?.uninstall()
    mount('/rfqs?owner=all&q=RST%201158&show=closed')
    await waitFor(() => expect(screen.getAllByTestId('where').at(-1)?.textContent).toBe('/jobs?q=RST+1158&chip=history'))
  })

  it('the retired ?old=1 and ?old=0 switches are dropped: an old link with one still lands on the Job or the Jobs list', async () => {
    mount('/rfqs/11111111-1111-4111-8111-111111111111?old=1&x=1', c => (c.target === 'v_jobs' ? { data: [{ job_key: '139' }] } : { data: [] }))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/jobs/139?x=1'))
    fake?.uninstall()
    mount('/orders/22222222-2222-4222-8222-222222222222?old=0', c => (c.target === 'v_jobs' ? { data: [{ job_key: 'O-45' }] } : { data: [] }))
    await waitFor(() => expect(screen.getAllByTestId('where').at(-1)?.textContent).toBe('/jobs/O-45'))
    fake?.uninstall()
    mount('/rfqs?old=1')
    await waitFor(() => expect(screen.getAllByTestId('where').at(-1)?.textContent).toBe('/jobs'))
    fake?.uninstall()
    mount('/orders?old=1&show=closed')
    await waitFor(() => expect(screen.getAllByTestId('where').at(-1)?.textContent).toBe('/jobs?chip=history'))
  })

  it('a device that remembered the old pages (the retired localStorage flag) still opens Jobs', async () => {
    window.localStorage.setItem('qtech.old-pages', '1')
    mount('/orders/22222222-2222-4222-8222-222222222222', c => (c.target === 'v_jobs' ? { data: [{ job_key: 'O-45' }] } : { data: [] }))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/jobs/O-45'))
  })

  it('an address deeper than an id is page not found', async () => {
    mount('/orders/o1/extra')
    expect(await screen.findByText(/not found/i)).toBeInTheDocument()
  })
})

describe('Money\'s red dot', () => {
  const view = buildToday(importedStyleInputs())
  it('is on while a real invoice is late, for admin and sales; never for an engineer', () => {
    expect(navCountsFrom(view, 'admin').moneyLate).toBe(true)
    expect(navCountsFrom(view, 'sales').moneyLate).toBe(true)
    expect(navCountsFrom(view, 'engineer').moneyLate).toBeUndefined()
  })
  it('is off when the only late payment is on an imported order (it waits in the grey fold and raises nothing)', () => {
    const latePayment = { ...view.imported[0], rule: 'payment_overdue' as const, imported: true }
    const importedOnly = { ...view, active: [], waiting: [], stale: [], imported: [latePayment] }
    expect(view.imported.length, 'precondition: the fixture has imported tasks in the fold').toBeGreaterThan(0)
    expect(navCountsFrom(importedOnly, 'admin').moneyLate).toBe(false)
    expect(navCountsFrom(importedOnly, 'sales').moneyLate).toBe(false)
  })
  it('is off when nothing is late', () => {
    const none = { ...view, active: view.active.filter(i => i.rule !== 'payment_overdue'), waiting: [] }
    expect(navCountsFrom(none, 'admin').moneyLate).toBe(false)
  })
})
