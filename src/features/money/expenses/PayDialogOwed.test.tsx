import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import { PayDialog } from '@/features/money/expenses/PayDialog'
import { installFakeDb } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

/* Live bug 16: the line under the amount said "Still owed: PKR X (Still owed on leg A: ...)": "owed" twice. */
afterEach(() => installFakeDb(() => ({})).uninstall())

describe('Pay dialog, owed line', () => {
  it('says "owed" once when the order page sends its own note', async () => {
    installFakeDb(() => ({ data: [] }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <SessionProvider value={{ status: 'signed-in', user: { id: 'u', name: 'Ayesha Rana', role: 'admin' } }}>
          <ToastProvider>
            <PayDialog
              open
              onOpenChange={() => undefined}
              context={{ orderId: 'o1', legId: 'l1', supplierId: 's1', supplierName: 'Alpenmark', currency: 'PKR', amount: 384497, amountNote: 'Still owed on leg A: EUR 2,430.00 less the 412,300 advance' }}
            />
          </ToastProvider>
        </SessionProvider>
      </QueryClientProvider>,
    )
    const line = await screen.findByText(/Still owed: PKR/)
    expect((line.textContent ?? '').match(/owed/gi)).toHaveLength(1)
    expect(line.textContent).toContain('on leg A: EUR 2,430.00')
  })
})
