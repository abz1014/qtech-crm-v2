import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import type { SessionState } from '@/app/session'
import { BankTickPage } from '@/features/money/bank/BankTickPage'
import type { RawBank } from '@/features/money/bank/model'
import { axeViolations } from '@/test/axe'

const h = vi.hoisted(() => ({ load: vi.fn(), set: vi.fn() }))
vi.mock('@/features/money/bank/api', () => ({ loadBank: h.load, setBankMonth: h.set }))
vi.mock('@/lib/dates', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/dates')>()),
  businessToday: () => '2026-11-06',
}))

const DATA: RawBank = {
  payments: [
    {
      id: 'p1',
      receivedOn: '2026-10-26',
      amount: '700000.00',
      reference: 'IBFT advance',
      orderRef: 'ORD-0042',
      company: 'Sargodha Fertilizer Co.',
      bankMonth: null,
    },
    {
      id: 'p2',
      receivedOn: '2026-10-20',
      amount: '800000.00',
      reference: 'IBFT 3310',
      orderRef: 'ORD-0027',
      company: 'Indus Textile Mills',
      bankMonth: '2026-10-01',
    },
  ],
  expenses: [
    {
      id: 'e1',
      paidOn: '2026-10-30',
      amount: '100000.00',
      inputTax: '0.00',
      categoryName: 'Salaries',
      grp: 'overhead',
      note: 'support staff',
      payee: null,
      orderRef: null,
      leg: null,
      bankMonth: null,
    },
    {
      id: 'e0',
      paidOn: '2026-09-30',
      amount: '1150.00',
      inputTax: '0.00',
      categoryName: 'Bank charges',
      grp: 'overhead',
      note: null,
      payee: null,
      orderRef: null,
      leg: null,
      bankMonth: null,
    },
  ],
  deposits: [
    {
      id: 'i1',
      number: 'INV-2284',
      invoiceDate: '2026-10-07',
      company: 'Margalla Steel',
      psid: '4471 9038 2216',
      depositedOn: '2026-10-31',
      amount: '392400.00',
      bankMonth: null,
    },
    {
      id: 'i2',
      number: 'INV-2271',
      invoiceDate: '2026-09-28',
      company: 'Lahore Beverage',
      psid: '4471 9038 2216',
      depositedOn: '2026-10-31',
      amount: '71100.00',
      bankMonth: null,
    },
  ],
}

let store: RawBank = DATA
const me: SessionState = { status: 'signed-in', user: { id: 'bilal', name: 'Bilal Chaudhry', role: 'admin' } }
function mount(path = '/money/month-end/bank?month=2026-10') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <SessionProvider value={me}>
        <MemoryRouter initialEntries={[path]}>
          <BankTickPage />
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  h.load.mockReset()
  h.set.mockReset()
  // A small stand-in for the database: a tick is written, and the next read shows it.
  store = structuredClone(DATA)
  h.load.mockImplementation(async () => structuredClone(store))
  h.set.mockImplementation(async (kind: string, ids: string[], month: string | null) => {
    const bankMonth = month ? `${month}-01` : null
    const rows = kind === 'payment' ? store.payments : kind === 'expense' ? store.expenses : store.deposits
    for (const r of rows) if (ids.includes(r.id)) r.bankMonth = bankMonth
  })
})

describe('Match bank statement (M12, the old Bank tick)', () => {
  it('is reached from Month end with a back link, never a third strip of tabs', async () => {
    mount()
    await screen.findByTestId('bank-out')
    expect(screen.getByRole('heading', { name: 'Match bank statement', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Month end' })).toHaveAttribute('href', '/money/month-end?month=2026-10')
    expect(screen.queryByRole('navigation', { name: 'Month-end views' })).toBeNull()
  })

  it('shows the two lists, the four totals and the not-ticked chip', async () => {
    mount()
    const out = await screen.findByTestId('bank-out')
    expect(within(screen.getByTestId('bank-in')).getByText('Sargodha Fertilizer Co.')).toBeInTheDocument()
    expect(within(out).getByText('Salaries, support staff')).toBeInTheDocument()
    expect(within(out).getByText('FBR deposit · PSID 4471 9038 2216')).toBeInTheDocument()
    expect(within(out).getByText('Older, not ticked in an earlier month')).toBeInTheDocument()
    const sums = screen.getByRole('region', { name: 'Running ticked totals' })
    expect(within(sums).getByText('Ticked, money in').parentElement).toHaveTextContent('800,000')
    expect(within(sums).getByText('Not ticked, out').parentElement).toHaveTextContent('564,650')
    expect(screen.getByTestId('bank-state')).toHaveTextContent('4 not ticked') // p1, e1, e0 and one PSID group
    // the group lists its invoices
    expect(within(out).getByText(/INV-2271/, { selector: '.num' })).toBeInTheDocument()
  })

  it('one tap ticks a line: the totals move at once and one request is made', async () => {
    const user = userEvent.setup()
    mount()
    const inList = await screen.findByTestId('bank-in')
    await user.click(within(inList).getByRole('checkbox', { name: /Sargodha Fertilizer/ }))
    await waitFor(() => expect(h.set).toHaveBeenCalledTimes(1))
    expect(h.set).toHaveBeenCalledWith('payment', ['p1'], '2026-10')
    const sums = screen.getByRole('region', { name: 'Running ticked totals' })
    expect(within(sums).getByText('Ticked, money in').parentElement).toHaveTextContent('1,500,000')
    expect(within(inList).getByRole('checkbox', { name: /Sargodha Fertilizer/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('one tap ticks a whole PSID group (both invoices in one request) and the same tap undoes it', async () => {
    const user = userEvent.setup()
    mount()
    const out = await screen.findByTestId('bank-out')
    await user.click(within(out).getByRole('checkbox', { name: /FBR deposit/ }))
    await waitFor(() => expect(h.set).toHaveBeenCalledWith('fbr', ['i1', 'i2'], '2026-10'))
    expect(within(out).getByRole('checkbox', { name: /FBR deposit/ })).toHaveAttribute('aria-checked', 'true')
    await user.click(within(out).getByRole('checkbox', { name: /FBR deposit/ }))
    await waitFor(() => expect(h.set).toHaveBeenLastCalledWith('fbr', ['i1', 'i2'], null))
    expect(h.set).toHaveBeenCalledTimes(2)
  })

  it('a refused tick goes back and says why, closed-month sentence included', async () => {
    h.set.mockRejectedValueOnce({ code: 'P0001', message: 'September 2026 is closed. An admin can reopen it.' })
    const user = userEvent.setup()
    mount()
    const inList = await screen.findByTestId('bank-in')
    await user.click(within(inList).getByRole('checkbox', { name: /Sargodha Fertilizer/ }))
    expect(await screen.findByText('September 2026 is closed. An admin can reopen it.')).toBeInTheDocument()
    await waitFor(() =>
      expect(within(inList).getByRole('checkbox', { name: /Sargodha Fertilizer/ })).toHaveAttribute('aria-checked', 'false'),
    )
  })

  it('says Everything ticked when nothing is left, and the empty month says so', async () => {
    h.load.mockResolvedValue({ payments: [{ ...DATA.payments[1] }], expenses: [], deposits: [] })
    mount()
    await waitFor(() => expect(screen.getByTestId('bank-state')).toHaveTextContent('Everything ticked'))
    h.load.mockResolvedValue({ payments: [], expenses: [], deposits: [] })
    mount('/money/month-end/bank?month=2026-08')
    expect(await screen.findByText('Nothing to tick for August 2026')).toBeInTheDocument()
  })

  it('opens on last month when none is asked for, and does not go past this month', async () => {
    mount('/money/month-end/bank')
    await screen.findByTestId('bank-in')
    expect(h.load).toHaveBeenCalledWith('2026-10')
    expect(screen.getByRole('button', { name: 'Next month' })).toBeEnabled()
  })

  it('a failed load offers Try again and has no axe violations', async () => {
    h.load.mockRejectedValueOnce(new Error('boom'))
    const user = userEvent.setup()
    mount()
    expect(await screen.findByText('The bank statement lines did not load')).toBeInTheDocument()
    h.load.mockResolvedValue(structuredClone(DATA))
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByTestId('bank-in')
    expect(await axeViolations(document.body)).toEqual([])
  })
})
