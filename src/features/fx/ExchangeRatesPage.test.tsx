import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ExchangeRatesPage } from '@/features/fx/ExchangeRatesPage'
import { ToastProvider } from '@/ui/Toast'

const LATEST = [
  { currency: 'USD', ratePkr: 280.5, asOf: '2026-10-22', source: 'manual', ageDays: 0, staleness: 'fresh' as const },
  { currency: 'EUR', ratePkr: 304.2, asOf: '2026-10-21', source: 'auto', ageDays: 1, staleness: 'fresh' as const },
]
vi.mock('@/features/rfqs/hooks', () => ({ useFxLatest: () => ({ data: LATEST, isPending: false, isError: false, refetch: vi.fn() }) }))
vi.mock('@/features/fx/hooks', () => ({
  useFxHistory: (c: string | undefined) => ({
    data: c ? [{ asOf: '2026-10-22', ratePkr: c === 'USD' ? 280.5 : 304.2, source: 'manual' }] : [],
    isPending: false,
    isError: false,
  }),
  useFxLastAutoRun: () => ({ data: null }),
  useSetFxRate: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

function mount() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <ExchangeRatesPage />
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('Exchange rates (audit 2026-10-22)', () => {
  it('says once what happened, and who may enter a rate only in the (i)', () => {
    mount()
    expect(screen.getByText(/Last automatic update Wed 21 Oct\. 1 rate entered by hand\./)).toBeInTheDocument()
    expect(screen.queryByText(/Anyone on the team can enter today/)).toBeNull()
    expect(screen.queryByText(/Anyone on the team can add one/)).toBeNull()
    expect(screen.queryByRole('heading', { name: /^Recent .* rates$/ })).toBeNull() // no second panel repeating the table
  })

  it("a row's Add rate picks that currency in the form and puts the cursor in the rate", async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: 'Add rate for EUR' }))
    expect(screen.getByLabelText('Currency')).toHaveValue('EUR')
    expect(screen.getByLabelText('Rate, PKR for 1 unit')).toHaveFocus()
  })

  it("a row's History opens that currency's recent rates", async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: 'History of USD' }))
    const dialog = screen.getByRole('dialog', { name: 'Recent USD rates' })
    expect(within(dialog).getByText('280.50')).toBeInTheDocument()
  })
})
