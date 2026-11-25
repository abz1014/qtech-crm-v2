import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RatesTable } from '@/features/settings/RatesTable'
import { ratesStatusLine } from '@/features/settings/ratesModel'
import { buildRateRows } from '@/features/fx/ratesModel'
import { SessionContext } from '@/app/session'
import { SettingsHomePage } from '@/features/settings/SettingsHomePage'
import type { FxLatestRow } from '@/features/rfqs/api'

const h = vi.hoisted(() => ({ state: { data: [] as unknown[], isLoading: false, isError: false, refetch: vi.fn() } }))
vi.mock('@/features/rfqs/hooks', () => ({ useFxLatest: () => h.state }))

const row = (currency: string, ratePkr: number, ageDays: number, staleness: FxLatestRow['staleness'], source = 'auto'): FxLatestRow => ({
  currency,
  ratePkr,
  asOf: '2026-11-26',
  source,
  ageDays,
  staleness,
})

const RATES = [
  row('AED', 75.8, 52, 'unusable'),
  row('CNY', 38.42, 14, 'stale', 'manual'),
  row('EUR', 301.15, 1, 'fresh'),
  row('USD', 278.4, 1, 'fresh'),
]

beforeEach(() => {
  h.state = { data: RATES, isLoading: false, isError: false, refetch: vi.fn() }
})

describe('exchange rate table (one table for Settings home and Exchange rates, review 21)', () => {
  it('lists USD, EUR, CNY, AED first, then the rest A to Z, then currencies with no rate', () => {
    const rows = buildRateRows([row('JPY', 1.8, 0, 'fresh'), ...RATES, row('GBP', 350, 0, 'fresh')])
    expect(rows.map(r => r.currency)).toEqual(['USD', 'EUR', 'CNY', 'AED', 'GBP', 'JPY', 'SAR'])
  })

  it('shows the same columns, date format and age words as Settings > Exchange rates, read-only', () => {
    render(<RatesTable />)
    const table = screen.getByRole('table', { name: 'Latest rate per currency' })
    for (const head of ['Currency', 'Rate, PKR', 'As of', 'Age']) {
      expect(within(table).getByRole('columnheader', { name: new RegExp(head) })).toBeInTheDocument()
    }
    expect(within(table).queryByRole('columnheader', { name: /Source|Rate age|PKR for 1 unit/ })).toBeNull()
    expect(within(table).queryByRole('button', { name: /Add rate|History/ })).toBeNull()
    const usd = within(table).getByText('USD').closest('tr') as HTMLElement
    expect(within(usd).getByText('278.40')).toBeInTheDocument()
    expect(within(usd).getByText('Automatic')).toBeInTheDocument()
    expect(within(usd).getByText('26 Nov')).toBeInTheDocument()
    expect(within(usd).getByText('1 day')).toBeInTheDocument()
    expect(within(usd).queryByText('Fresh')).toBeNull()
    expect(within(table).getByText('Entered manually')).toBeInTheDocument()
    const cny = within(table).getByText('CNY').closest('tr') as HTMLElement
    expect(within(cny).getByText('Old rate')).toBeInTheDocument()
    expect(within(cny).getByText('14 days old')).toBeInTheDocument()
    const aed = within(table).getByText('AED').closest('tr') as HTMLElement
    expect(within(aed).getByText('No rate')).toBeInTheDocument()
    expect(within(aed).getByText('52 days old')).toBeInTheDocument()
    const order = within(table).getAllByRole('row').slice(1).map(r => r.querySelector('td')?.textContent?.slice(0, 3))
    expect(order.slice(0, 4)).toEqual(['USD', 'EUR', 'CNY', 'AED'])
  })

  it('says plainly when the rates cannot load', () => {
    h.state = { data: [], isLoading: false, isError: true, refetch: vi.fn() }
    render(<RatesTable />)
    expect(screen.getByText('Could not load the exchange rates')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument()
  })
})

const signedIn = (role: string) => ({ status: 'signed-in' as const, user: { id: 'u1', name: 'Sana', role } })

describe('Settings home', () => {
  it("is today's rates only (the side menu lists the pages), with a status line from the data and one link to add a rate", () => {
    render(
      <SessionContext.Provider value={signedIn('sales')}>
        <MemoryRouter>
          <SettingsHomePage />
        </MemoryRouter>
      </SessionContext.Provider>,
    )
    expect(screen.getByRole('heading', { name: "Today's exchange rates" })).toBeInTheDocument()
    // RATES: 3 automatic (newest 26 Nov), 1 by hand
    expect(screen.getByText('Last automatic update Thu 26 Nov. 1 rate entered manually.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Add a rate or see history/ })).toHaveAttribute('href', '/settings/exchange-rates')
    expect(screen.queryByRole('heading', { name: 'Company profile' })).toBeNull()
    expect(screen.queryByText(/Updated every night/)).toBeNull()
  })

  it('an engineer gets the company profile link only: no rates shown or read (owner decision 2026-10-22)', () => {
    render(
      <SessionContext.Provider value={signedIn('engineer')}>
        <MemoryRouter>
          <SettingsHomePage />
        </MemoryRouter>
      </SessionContext.Provider>,
    )
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: "Today's exchange rates" })).toBeNull()
    expect(screen.queryByRole('link', { name: /Add a rate or see history/ })).toBeNull()
    // review 21: not a nearly blank page: their details, their password and the company profile, each with one line
    expect(screen.getByRole('link', { name: /Company profile/ })).toHaveAttribute('href', '/settings/company')
    expect(screen.getByRole('link', { name: /Your details/ })).toHaveAttribute('href', '/settings/details')
    expect(screen.getByRole('link', { name: /Change password/ })).toHaveAttribute('href', '/settings/password')
    expect(document.body.textContent).not.toMatch(/PKR|rate/i)
  })
})

describe('ratesStatusLine', () => {
  const r = (asOf: string, source: string) => ({ asOf, source })
  it('says what actually happened, never "updated every night" over rows entered by hand', () => {
    expect(ratesStatusLine([])).toBe('No rates yet.')
    expect(ratesStatusLine([r('2026-10-22', 'manual'), r('2026-10-22', 'manual')])).toBe('No automatic update yet. Rates entered manually.')
    expect(ratesStatusLine([r('2026-10-20', 'auto'), r('2026-10-22', 'auto')])).toBe('Last automatic update Thu 22 Oct.')
    expect(ratesStatusLine([r('2026-10-21', 'auto'), r('2026-10-22', 'manual'), r('2026-10-22', 'manual')])).toBe(
      'Last automatic update Wed 21 Oct. 2 rates entered manually.',
    )
  })
})