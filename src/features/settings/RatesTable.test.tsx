import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RatesTable } from '@/features/settings/RatesTable'
import { rateAgeLabel, sortRates, sourceLabel } from '@/features/settings/ratesModel'
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

describe('exchange rate helpers', () => {
  it('puts USD, EUR, CNY, AED first, then the rest A to Z', () => {
    const sorted = sortRates([row('JPY', 1.8, 0, 'fresh'), ...RATES, row('GBP', 350, 0, 'fresh')])
    expect(sorted.map(r => r.currency)).toEqual(['USD', 'EUR', 'CNY', 'AED', 'GBP', 'JPY'])
  })

  it('words the age like the price comparison', () => {
    expect(rateAgeLabel({ ageDays: 0, staleness: 'fresh' })).toBe('Today')
    expect(rateAgeLabel({ ageDays: 1, staleness: 'fresh' })).toBe('1 day old')
    expect(rateAgeLabel({ ageDays: 14, staleness: 'stale' })).toBe('14 days old')
    expect(rateAgeLabel({ ageDays: 52, staleness: 'unusable' })).toBe('52 days old, not compared')
    expect(sourceLabel('auto')).toBe('Automatic')
    expect(sourceLabel('manual')).toBe('Entered by hand')
  })
})

describe('exchange rate table', () => {
  it('shows currency, PKR for 1 unit, source, as of and the rate age (text when fresh, a chip only for Old rate / No rate)', () => {
    render(<RatesTable />)
    const table = screen.getByRole('table', { name: 'Exchange rates' })
    for (const head of ['Currency', 'PKR for 1 unit', 'Source', 'As of', 'Rate age']) {
      expect(within(table).getByRole('columnheader', { name: new RegExp(head) })).toBeInTheDocument()
    }
    const usd = within(table).getByText('USD').closest('tr') as HTMLElement
    expect(within(usd).getByText('278.40')).toBeInTheDocument()
    expect(within(usd).getByText('Automatic')).toBeInTheDocument()
    expect(within(usd).getByText('Thu 26 Nov')).toBeInTheDocument()
    expect(within(usd).getByText('1 day old')).toBeInTheDocument()
    expect(within(usd).queryByText('Fresh')).toBeNull()
    expect(within(table).getByText('Entered by hand')).toBeInTheDocument()
    const cny = within(table).getByText('CNY').closest('tr') as HTMLElement
    expect(within(cny).getByText('Old rate')).toBeInTheDocument()
    expect(within(cny).getByText('14 days old')).toBeInTheDocument()
    const aed = within(table).getByText('AED').closest('tr') as HTMLElement
    expect(within(aed).getByText('No rate')).toBeInTheDocument()
    expect(within(aed).getByText('52 days old')).toBeInTheDocument()
  })

  it('says plainly when the rates cannot load', () => {
    h.state = { data: [], isLoading: false, isError: true, refetch: vi.fn() }
    render(<RatesTable />)
    expect(screen.getByText('Couldn’t load the exchange rates')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument()
  })
})

const signedIn = (role: string) => ({ status: 'signed-in' as const, user: { id: 'u1', name: 'Sana', role } })

describe('Settings home', () => {
  it('has the Settings title, the rates card with its button, and the company profile card with View', () => {
    render(
      <SessionContext.Provider value={signedIn('sales')}>
        <MemoryRouter>
          <SettingsHomePage />
        </MemoryRouter>
      </SessionContext.Provider>,
    )
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByText('Company details for documents, and the rates used to compare prices in other currencies.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open exchange rates/ })).toHaveAttribute('href', '/settings/exchange-rates')
    expect(screen.getByRole('link', { name: /^View/ })).toHaveAttribute('href', '/settings/company')
    expect(screen.getByRole('heading', { name: 'Company profile' })).toBeInTheDocument()
  })

  it('an engineer gets the company profile only: no rates card, no rates read (owner decision 2026-10-22)', () => {
    render(
      <SessionContext.Provider value={signedIn('engineer')}>
        <MemoryRouter>
          <SettingsHomePage />
        </MemoryRouter>
      </SessionContext.Provider>,
    )
    expect(screen.getByText('Company details for documents.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Exchange rates' })).toBeNull()
    expect(screen.queryByRole('link', { name: /Open exchange rates/ })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Company profile' })).toBeInTheDocument()
  })
})
