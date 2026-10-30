import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import type { SessionState } from '@/app/session'
import { TaxDeadlinesPage } from '@/features/settings/TaxDeadlinesPage'
import { settingsLinksFor } from '@/features/settings/settingsLinks'
import { installFakeDb, opArgs, type FakeCall } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

let fake: ReturnType<typeof installFakeDb> | null = null
afterEach(() => fake?.uninstall())

function mount(role: 'admin' | 'sales') {
  fake = installFakeDb((c: FakeCall) => {
    if (c.target === 'gst_deadline_settings' && c.verb === 'select') return { data: { pay_day: 15, return_day: 18 } }
    if (c.target === 'gst_deadline_overrides' && c.verb === 'select') return { data: [{ month: '2026-09-01', pay_by: '2026-10-22', return_by: null }] }
    if (c.verb === 'update') return { data: [{ id: 1 }] }
    return { data: [] }
  })
  const session: SessionState = { status: 'signed-in', user: { id: 'u', name: 'Ayesha Rana', role } }
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <SessionProvider value={session}>
        <MemoryRouter>
          <ToastProvider>
            <TaxDeadlinesPage />
          </ToastProvider>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

describe('Settings > Tax deadlines', () => {
  it('lets the admin change the two days and saves both on the one settings row', async () => {
    mount('admin')
    const pay = await screen.findByLabelText(/Pay GST to FBR by day/)
    expect(pay).toHaveValue('15')
    expect(screen.getByLabelText(/File the return by day/)).toHaveValue('18')
    fireEvent.change(pay, { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText(/File the return by day/), { target: { value: '25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save days' }))
    await waitFor(() => expect(fake?.calls.some(c => c.verb === 'update')).toBe(true))
    const call = fake!.calls.find(c => c.verb === 'update')!
    expect(call.target).toBe('gst_deadline_settings')
    expect(opArgs(call, 'update')?.[0]).toEqual({ pay_day: 20, return_day: 25 })
  })

  it('refuses a day outside 1 to 28 before anything is sent', async () => {
    mount('admin')
    const pay = await screen.findByLabelText(/Pay GST to FBR by day/)
    fireEvent.change(pay, { target: { value: '31' } })
    expect(screen.getByRole('button', { name: 'Save days' })).toBeDisabled()
    expect(screen.getByText('Enter a day from 1 to 28')).toBeInTheDocument()
  })

  it('shows the one-off dates, with the usual day for an empty one', async () => {
    mount('admin')
    const list = await screen.findByTestId('overrides')
    expect(list).toHaveTextContent('Pay by')
    expect(list).toHaveTextContent('22 Oct')
    expect(list).toHaveTextContent('(usual day)')
  })

  it('shows sales the days to read and no way to change them', async () => {
    mount('sales')
    expect(await screen.findByTestId('read-pay-day')).toHaveTextContent('15th of the following month')
    expect(screen.getByTestId('read-return-day')).toHaveTextContent('18th of the following month')
    expect(screen.queryByRole('button', { name: 'Save days' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Remove the one-off date/ })).toBeNull()
  })

  it('is in the menu for admin and sales and not for an engineer', () => {
    expect(settingsLinksFor('admin').some(l => l.to === '/settings/tax-deadlines')).toBe(true)
    expect(settingsLinksFor('sales').some(l => l.to === '/settings/tax-deadlines')).toBe(true)
    expect(settingsLinksFor('engineer').some(l => l.to === '/settings/tax-deadlines')).toBe(false)
  })
})
