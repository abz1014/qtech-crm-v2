import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import { installFakeDb, opArgs } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'
import { HasPricesToggle } from '@/features/rfqs/HasPricesToggle'

const att = { id: 'a1', fileName: 'Customer PO.pdf', hasPrices: true }
function mount(role: 'admin' | 'sales' | 'engineer', hasPrices = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SessionProvider value={{ status: 'signed-in', user: { id: 'u', name: 'X', role } }}>
        <ToastProvider>
          <HasPricesToggle att={{ ...att, hasPrices }} rfqId="r1" />
        </ToastProvider>
      </SessionProvider>
    </QueryClientProvider>,
  )
}
afterEach(() => installFakeDb(() => ({})).uninstall())

describe('Has prices: hide from engineers', () => {
  it('only the admin gets the switch', () => {
    installFakeDb(() => ({ data: [] }))
    for (const role of ['sales', 'engineer'] as const) {
      const { unmount } = mount(role)
      expect(screen.queryByRole('checkbox')).toBeNull()
      unmount()
    }
    mount('admin')
    expect(screen.getByRole('checkbox', { name: 'Has prices: hide from engineers' })).toBeChecked()
  })

  it('turning it off writes has_prices = false on that file', async () => {
    const { calls } = installFakeDb(() => ({ data: [] }))
    const user = userEvent.setup()
    mount('admin')
    await user.click(screen.getByRole('checkbox', { name: 'Has prices: hide from engineers' }))
    await waitFor(() => expect(calls.some(c => c.target === 'attachments' && c.verb === 'update')).toBe(true))
    const call = calls.find(c => c.target === 'attachments' && c.verb === 'update')!
    expect(opArgs(call, 'update')).toEqual([{ has_prices: false }])
    expect(opArgs(call, 'eq')).toEqual(['id', 'a1'])
  })
})
