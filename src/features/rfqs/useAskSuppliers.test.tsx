import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionContext } from '@/app/session'
import type { RfqHeader, RfqItemRow } from '@/features/rfqs/api'
import { useAskSuppliers } from '@/features/rfqs/useAskSuppliers'
import { installFakeDb, type FakeCall } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

/* Asking suppliers from the RFQ page: a second tap while the first is still copying records nothing more. */

afterEach(() => {
  installFakeDb(() => ({})).uninstall()
})

const rfq = { id: 'r-1', number: 185, dueOn: null, company: { id: 'c-1', name: 'Acme' } } as unknown as RfqHeader
const items: RfqItemRow[] = [{ id: 'it-1', number: 1, description: 'Hach HQ1110 meter', brandId: null, brandName: null, familyId: null, qty: 1, unit: 'pcs' }]

describe('useAskSuppliers', () => {
  it('a double tap asks the supplier once', async () => {
    const inserts: FakeCall[] = []
    installFakeDb(call => {
      if (call.target === 'supplier_inquiries' && call.verb === 'insert') {
        inserts.push(call)
        return { data: [{ id: `inq-${inserts.length}` }] }
      }
      return { data: [] }
    })
    let release: () => void = () => undefined
    const held = new Promise<void>(r => (release = r))
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => held } })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <SessionContext.Provider value={{ status: 'signed-in', user: { id: 'u1', name: 'Ayesha Rana', role: 'sales' } }}>
          <ToastProvider>{children}</ToastProvider>
        </SessionContext.Provider>
      </QueryClientProvider>
    )
    const { result } = renderHook(() => useAskSuppliers(rfq, []), { wrapper })
    const input = { supplierIds: ['s-1'], names: ['Orient'], items }
    let a!: Promise<boolean>
    let b!: Promise<boolean>
    act(() => {
      a = result.current.ask(input)
      b = result.current.ask(input)
    })
    release()
    await act(async () => {
      await Promise.all([a, b])
    })
    expect(inserts).toHaveLength(1)
  })
})
