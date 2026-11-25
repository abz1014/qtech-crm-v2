import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import { businessToday } from '@/lib/dates'
import { monthKeyLabel } from '@/features/money/expenses/model'
import { GstFbrPage } from '@/features/money/monthEnd/ReportPages'
import { PaymentsPage } from '@/features/money/payments/PaymentsPage'
import { installFakeDb } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

/*
 * Screen review 2026-11-24, items 11 and 18: every money report opens on this month (Karachi), as Money in and out does; a month in
 * the link that cannot be shown opens this month, puts the address right and says so; the GST report's empty text names the month.
 */
const THIS = businessToday().slice(0, 7)
const THIS_LABEL = monthKeyLabel(THIS)

function Where() {
  const { search } = useLocation()
  return <output data-testid="where">{search}</output>
}

function mount(ui: React.ReactNode, path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SessionProvider value={{ status: 'signed-in', user: { id: 'u', name: 'Ayesha', role: 'admin' } }}>
        <MemoryRouter initialEntries={[path]}>
          <ToastProvider>
            {ui}
            <Where />
          </ToastProvider>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => installFakeDb(() => ({})).uninstall())

describe('the month a report opens on', () => {
  it('with no month in the link, the GST report opens on this month and its empty text names it', async () => {
    installFakeDb(() => ({ data: [] }))
    mount(<GstFbrPage />, '/money/reports/gst')
    expect(await screen.findByText(`No invoices in ${THIS_LABEL}`)).toBeInTheDocument()
    expect(screen.queryByText('No invoices yet')).toBeNull()
    expect(screen.queryByTestId('period-note')).toBeNull()
  })

  it('an impossible month (2026-13) opens this month, puts the address right and says so', async () => {
    installFakeDb(() => ({ data: [] }))
    mount(<GstFbrPage />, '/money/reports/gst?month=2026-13')
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`?month=${THIS}`))
    expect(screen.getByTestId('period-note')).toHaveTextContent(`2026-13 in the link is not a month, so this shows ${THIS_LABEL}.`)
    expect(await screen.findByText(`No invoices in ${THIS_LABEL}`)).toBeInTheDocument()
  })

  it('a month still to come does the same, and says it has not started', async () => {
    installFakeDb(() => ({ data: [] }))
    mount(<GstFbrPage />, '/money/reports/gst?month=2999-01')
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`?month=${THIS}`))
    expect(screen.getByTestId('period-note')).toHaveTextContent(`2999-01 in the link has not started yet, so this shows ${THIS_LABEL}.`)
  })

  it('Payments puts an impossible month right too', async () => {
    installFakeDb(() => ({ data: [] }))
    mount(<PaymentsPage />, '/money/payments?month=2026-13')
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`?month=${THIS}`))
    expect(screen.getByTestId('period-note')).toHaveTextContent(`2026-13 in the link is not a month, so this shows ${THIS_LABEL}.`)
  })
})
