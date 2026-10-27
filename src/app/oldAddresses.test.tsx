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
 * chip); ?old=1 keeps the old page. And Money's red dot: only while a real invoice is late.
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
        <Route path="/rfqs/*" element={<><OldAddress kind="rfq"><p>OLD RFQ PAGE</p></OldAddress><Where /></>} />
        <Route path="/orders/*" element={<><OldAddress kind="order"><p>OLD ORDER PAGE</p></OldAddress><Where /></>} />
        <Route path="/jobs/*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('old addresses open Jobs', () => {
  it('/rfqs/<id> opens the Job that holds the RFQ, query kept', async () => {
    mount('/rfqs/abc?x=1', c => (c.target === 'v_jobs' ? { data: [{ job_key: '139' }] } : { data: [] }))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/jobs/139?x=1'))
    expect(fake?.calls.find(c => c.target === 'v_jobs')?.ops.some(([n, a]) => n === 'eq' && a[0] === 'rfq_id' && a[1] === 'abc')).toBe(true)
  })

  it('/orders/<id> opens its Job; a cancelled order finds the Job through its RFQ', async () => {
    mount('/orders/o1', c => (c.target === 'v_jobs' ? { data: [{ job_key: 'O-45' }] } : { data: [] }))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/jobs/O-45'))
    fake?.uninstall()
    let n = 0
    const r = mount('/orders/o2', c => {
      if (c.target === 'v_jobs') return { data: n++ === 0 ? [] : [{ job_key: '139' }] }
      if (c.target === 'orders') return { data: [{ rfq_id: 'r9' }] }
      return { data: [] }
    })
    await waitFor(() => expect(r.getAllByTestId('where').at(-1)?.textContent).toBe('/jobs/139'))
  })

  it('an id with no Job is page not found, not a blank page', async () => {
    mount('/rfqs/nope')
    expect(await screen.findByText(/not found/i)).toBeInTheDocument()
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

  it('?old=1 keeps the old page, and remembers it on this device', () => {
    mount('/rfqs?old=1')
    expect(screen.getByText('OLD RFQ PAGE')).toBeInTheDocument()
    expect(screen.getByTestId('where').textContent).toBe('/rfqs?old=1')
    expect(window.localStorage.getItem('qtech.old-pages')).toBe('1')
  })

  it('once remembered, the old pages own links work without the flag; ?old=0 goes back to Jobs', async () => {
    window.localStorage.setItem('qtech.old-pages', '1')
    const r = mount('/orders/o1')
    expect(r.getByText('OLD ORDER PAGE')).toBeInTheDocument()
    r.unmount()
    fake?.uninstall()
    mount('/orders?old=0')
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/jobs'))
    expect(window.localStorage.getItem('qtech.old-pages')).toBeNull()
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
