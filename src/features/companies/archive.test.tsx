import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import { ArchiveLine } from '@/features/companies/ArchiveLine'
import { SitesPanel } from '@/features/companies/SitesPanel'
import { getCompanyHistory, getSupplierStats, listCompanies, type CompanyHistory } from '@/features/companies/api'
import { installFakeDb, opArgs, type FakeCall } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

/*
 * Archive (migration 0141) on the company page: the RFQ and order lists drop archived rows, the archived counts come from engineer-safe
 * sources, company stats stay unfiltered, and "N older items in Archive" is a link for admin and text for everyone else.
 */
let uninstall: (() => void) | undefined
afterEach(() => uninstall?.())

const hidesArchived = (c: FakeCall) => c.ops.some(([n, a]) => n === 'eq' && a[0] === 'archived' && a[1] === false)
const countsArchived = (c: FakeCall) => c.ops.some(([n, a]) => n === 'eq' && a[0] === 'archived' && a[1] === true)
const touchesArchived = (c: FakeCall) => c.ops.some(([, a]) => a[0] === 'archived')

const historyFake = () =>
  installFakeDb(c => {
    if (countsArchived(c)) return { data: null, count: c.target === 'rfqs' ? 3 : 2 }
    if (c.target === 'rfqs') return { data: [{ id: 'r1', number: 7, site_id: null, received_on: '2026-11-18', due_on: null, customer_ref: null, close_reason: null }] }
    if (c.target === 'orders')
      return {
        data: [
          { id: 'o1', number: 1, site_id: null, ordered_on: '2026-11-18', rfq_id: 'r1' },
          { id: 'o2', number: 2, site_id: null, ordered_on: '2020-01-01', rfq_id: null },
        ],
      }
    // v_order_state: only o1 is visible; the hidden o2 is archived
    if (c.target === 'v_order_state') return { data: [{ order_id: 'o1', lifecycle: 'active', goods_state: 'n_a', invoicing_state: null }] }
    return { data: [] }
  })

describe('company page archive: lists and counts', () => {
  it('drops archived RFQs and orders, never names `archived` on the orders table, and counts what it hid', async () => {
    const db = historyFake()
    uninstall = db.uninstall
    const h = await getCompanyHistory('c1', false)
    expect(h.rfqs.map(r => r.id)).toEqual(['r1'])
    expect(h.orders.map(o => o.id)).toEqual(['o1'])
    expect(h.archived).toEqual({ rfqs: 3, orders: 2 })
    const reads = db.calls.filter(c => c.verb === 'select')
    expect(hidesArchived(reads.find(c => c.target === 'rfqs' && !countsArchived(c))!)).toBe(true)
    expect(hidesArchived(reads.find(c => c.target === 'v_order_state' && !countsArchived(c))!)).toBe(true)
    expect(reads.filter(c => c.target === 'orders').some(touchesArchived)).toBe(false)
    const orderCount = reads.find(c => c.target === 'v_order_state' && countsArchived(c))!
    expect(opArgs(orderCount, 'select')?.[1]).toEqual({ count: 'exact', head: true })
  })
})

describe('company page archive: stats and detail stay unfiltered', () => {
  it('the companies list counts (a stat) and a supplier record (detail) never filter on archived', async () => {
    const db = installFakeDb(() => ({ data: [] }))
    uninstall = db.uninstall
    await listCompanies()
    await getSupplierStats('c1')
    expect(db.calls.length).toBeGreaterThan(1)
    expect(db.calls.some(touchesArchived)).toBe(false)
  })
})

const wrap = (ui: React.ReactNode, role: 'admin' | 'sales' | 'engineer') => (
  <QueryClientProvider client={new QueryClient()}>
    <SessionProvider value={{ status: 'signed-in', user: { id: 'u', name: 'Someone', role } }}>
      <MemoryRouter>
        <ToastProvider>{ui}</ToastProvider>
      </MemoryRouter>
    </SessionProvider>
  </QueryClientProvider>
)

describe('company page archive: the "older items" line', () => {
  it('is a link to the Archive page for an admin', () => {
    render(wrap(<ArchiveLine companyId="c1" count={5} isAdmin />, 'admin'))
    expect(screen.getByRole('link', { name: '5 older items in Archive' })).toHaveAttribute('href', '/settings/archive?company=c1')
  })

  it('is plain text for sales and an engineer, singular for one, and absent for none', () => {
    for (const role of ['sales', 'engineer'] as const) {
      const { unmount } = render(wrap(<ArchiveLine companyId="c1" count={1} isAdmin={false} />, role))
      expect(screen.getByText('1 older item in Archive')).toBeInTheDocument()
      expect(screen.queryByRole('link')).toBeNull()
      unmount()
    }
    const none = render(wrap(<ArchiveLine companyId="c1" count={0} isAdmin />, 'admin'))
    expect(none.container.textContent).toBe('')
  })

  it('the Sites panel adds the two archived counts together and passes the role through', () => {
    const history: CompanyHistory = { rfqs: [], orders: [], archived: { rfqs: 3, orders: 2 } }
    const panel = (isAdmin: boolean) => <SitesPanel companyId="c1" sites={[]} history={history} isAdmin={isAdmin} loading={false} error={false} onAddSite={() => {}} onEditSite={() => {}} />
    const admin = render(wrap(panel(true), 'admin'))
    expect(screen.getByRole('link', { name: '5 older items in Archive' })).toBeInTheDocument()
    admin.unmount()
    render(wrap(panel(false), 'sales'))
    expect(screen.getByText('5 older items in Archive')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /older items/ })).toBeNull()
  })
})
