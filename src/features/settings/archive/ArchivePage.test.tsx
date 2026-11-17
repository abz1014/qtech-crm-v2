import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes } from '@/app/routes'
import { SessionProvider } from '@/app/SessionProvider'
import { ArchivePage } from '@/features/settings/archive/ArchivePage'
import { settingsLinksFor } from '@/features/settings/settingsLinks'
import { installFakeDb, opArgs, type FakeCall } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

const csv = vi.hoisted(() => ({ downloadCSV: vi.fn() }))
vi.mock('@/lib/csvExport', async orig => ({ ...(await orig<typeof import('@/lib/csvExport')>()), downloadCSV: csv.downloadCSV }))

let fake: ReturnType<typeof installFakeDb> | undefined
afterEach(() => fake?.uninstall())

const PREVIEW = [
  { entity: 'rfq', would_hide: 10, of_which_imported: 4, of_which_open: 1, open_amount_pkr: 0, already_unhidden: 0 },
  { entity: 'invoice', would_hide: 5, of_which_imported: 5, of_which_open: 2, open_amount_pkr: 120000, already_unhidden: 1 },
]
const ROWS = [
  { id: 'r1', entity: 'rfq', ref: 'RFQ-0001', company_id: 'c1', company_name: 'Acme Mills', doc_date: '2025-02-03', amount: null, is_imported: true, is_unhidden: false },
  { id: 'r2', entity: 'rfq', ref: 'RFQ-0002', company_id: 'c1', company_name: 'Acme Mills', doc_date: '2025-03-03', amount: 500, is_imported: false, is_unhidden: true },
]

function handler(enabled = false) {
  return (c: FakeCall) => {
    if (c.target === 'archive_settings') return { data: { enabled, cutoff: '2026-01-01' } }
    if (c.target === 'rpc:archive_preview') return { data: PREVIEW }
    if (c.target === 'rpc:archive_list') return { data: ROWS }
    return { data: true }
  }
}

function mount(path = '/settings/archive', enabled = false, client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })) {
  fake = installFakeDb(handler(enabled))
  render(
    <QueryClientProvider client={client}>
      <SessionProvider value={{ status: 'signed-in', user: { id: 'u', name: 'Ayesha', role: 'admin' } }}>
        <MemoryRouter initialEntries={[path]}>
          <ToastProvider>
            <ArchivePage />
          </ToastProvider>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
  return client
}
const calls = (target: string) => fake!.calls.filter(c => c.target === target)
const argsOf = (c: FakeCall) => opArgs(c, 'args')?.[0] as Record<string, unknown>

describe('Settings > Archive', () => {
  it('shows the state, the preview rows and the totals', async () => {
    mount()
    expect(await screen.findByTestId('archive-state')).toHaveTextContent('Off')
    expect(screen.getByTestId('archive-status')).toHaveTextContent(/hidden from lists\. Totals still count them/)
    const table = await screen.findByRole('table', { name: 'What would be archived' })
    const row = (name: string) => within(table).getByText(name).closest('tr') as HTMLElement
    expect(row('Invoices')).toHaveTextContent('120,000')
    expect(row('Invoices')).toHaveTextContent('5')
    expect(row('RFQs')).toHaveTextContent('10')
    const total = within(table).getByText('Total').closest('tr') as HTMLElement
    expect(total).toHaveTextContent('15')
    expect(total).toHaveTextContent('120,000')
    expect(argsOf(calls('rpc:archive_preview')[0])).toEqual({ p_cutoff: '2026-01-01' })
  })

  it('Download CSV hands the preview to the file download', async () => {
    mount()
    await screen.findByRole('table', { name: 'What would be archived' })
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }))
    expect(csv.downloadCSV).toHaveBeenCalledTimes(1)
    expect(csv.downloadCSV.mock.calls[0][0]).toContain('"Invoices"')
  })

  it('switching on asks first, then calls archive_set and refreshes every query', async () => {
    const client = mount()
    const spy = vi.spyOn(client, 'invalidateQueries')
    await userEvent.click(await screen.findByRole('button', { name: 'Switch on' }))
    expect(await screen.findByText(/will be kept but hidden from lists/)).toBeInTheDocument()
    expect(calls('rpc:archive_set')).toHaveLength(0)
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Switch on' }))
    await waitFor(() => expect(calls('rpc:archive_set')).toHaveLength(1))
    expect(argsOf(calls('rpc:archive_set')[0])).toEqual({ p_enabled: true, p_cutoff: '2026-01-01' })
    await waitFor(() => expect(spy).toHaveBeenCalledWith())
  })

  it('Cancel changes nothing', async () => {
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Switch on' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(calls('rpc:archive_set')).toHaveLength(0)
  })

  it('browse reads the company query parameter', async () => {
    mount('/settings/archive?company=c1')
    await screen.findByTestId('archive-rows')
    expect(argsOf(calls('rpc:archive_list')[0])).toMatchObject({ p_entity: 'rfq', p_company_id: 'c1', p_limit: 50, p_offset: 0 })
    expect(screen.getByTestId('archive-company-filter')).toHaveTextContent('Acme Mills')
  })

  it('rows link to the record, and Unarchive and Put back in Archive call the functions', async () => {
    const client = mount()
    const spy = vi.spyOn(client, 'invalidateQueries')
    const r1 = await screen.findByTestId('archive-row-r1')
    expect(within(r1).getByRole('link', { name: 'RFQ-0001' })).toHaveAttribute('href', '/rfqs/r1')
    await userEvent.click(within(r1).getByRole('button', { name: 'Unarchive' }))
    await waitFor(() => expect(calls('rpc:archive_unhide')).toHaveLength(1))
    expect(argsOf(calls('rpc:archive_unhide')[0])).toEqual({ p_entity: 'rfq', p_id: 'r1' })
    const r2 = screen.getByTestId('archive-row-r2')
    expect(within(r2).getByText('Shown')).toBeInTheDocument()
    await userEvent.click(within(r2).getByRole('button', { name: 'Put back in Archive' }))
    await waitFor(() => expect(calls('rpc:archive_rehide')).toHaveLength(1))
    expect(argsOf(calls('rpc:archive_rehide')[0])).toEqual({ p_entity: 'rfq', p_id: 'r2' })
    expect(spy).toHaveBeenCalledWith()
  })

  it('a kind with no page of its own shows no link', async () => {
    mount()
    await screen.findByTestId('archive-rows')
    fake!.uninstall()
    fake = installFakeDb(c => (c.target === 'rpc:archive_list' ? { data: [{ ...ROWS[0], entity: 'invoice', id: 'i1', ref: 'INV-1' }] } : handler()(c)))
    await userEvent.selectOptions(screen.getByLabelText('Kind'), 'invoice')
    const row = await screen.findByTestId('archive-row-i1')
    expect(within(row).queryByRole('link')).toBeNull()
  })
})

describe('/settings/archive access', () => {
  function at(role: string) {
    installFakeDb(handler())
    return render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SessionProvider value={{ status: 'signed-in', user: { id: 'u', name: 'Someone', role } }}>
          <MemoryRouter initialEntries={['/settings/archive']}>
            <ToastProvider>
              <AppRoutes />
            </ToastProvider>
          </MemoryRouter>
        </SessionProvider>
      </QueryClientProvider>,
    )
  }
  it('admin opens the screen', async () => {
    at('admin')
    expect(await screen.findByTestId('archive-page')).toBeInTheDocument()
  })
  for (const role of ['sales', 'engineer'])
    it(`${role} sees the no-access page, never the screen`, async () => {
      at(role)
      expect(await screen.findByRole('heading', { name: /Archive is for/ })).toBeInTheDocument()
      expect(screen.queryByTestId('archive-page')).toBeNull()
    })
  it('the Settings menu lists Archive for admin only', () => {
    expect(settingsLinksFor('admin').some(l => l.to === '/settings/archive')).toBe(true)
    expect(settingsLinksFor('sales').some(l => l.to === '/settings/archive')).toBe(false)
    expect(settingsLinksFor('engineer').some(l => l.to === '/settings/archive')).toBe(false)
  })
})
