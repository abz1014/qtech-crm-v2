import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useCorrectPayment, useOrderPayments, useRestorePayment, useVoidPayment } from '@/features/money/payments/correctionHooks'
import { qk } from '@/features/queryKeys'
import { installFakeDb, type FakeCall, type FakeResult } from '@/test/fakeSupabase'

function setup(respond: (c: FakeCall) => FakeResult = () => ({ data: null })) {
  const db = installFakeDb(respond)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { db, client, wrapper }
}

afterEach(() => installFakeDb(() => ({})).uninstall())

describe('payment correction hooks (0073)', () => {
  it('reads an order\'s payments only when enabled (payments are admin only)', async () => {
    const { db, wrapper } = setup(() => ({ data: [] }))
    const off = renderHook(() => useOrderPayments('o1', false), { wrapper })
    expect(off.result.current.fetchStatus).toBe('idle')
    const on = renderHook(() => useOrderPayments('o1', true), { wrapper })
    await waitFor(() => expect(on.result.current.isSuccess).toBe(true))
    expect(db.calls.filter(c => c.target === 'payments_in')).toHaveLength(1)
  })

  it('a void, a correction and an Undo each call their RPC and leave the payment figures stale', async () => {
    const { db, client, wrapper } = setup(c => ({ data: c.target === 'rpc:correct_payment' ? 'n1' : null }))
    const watched = [qk.money.receivables.payments('o1'), qk.money.receivables.list(), qk.today.board(), qk.orders.part('o1', 'money')]
    const prime = () => watched.forEach(k => client.setQueryData(k, []))
    // Money no screen watches is dropped rather than marked (invalidation.ts): gone counts as stale.
    const stale = () => watched.map(k => client.getQueryState(k)?.isInvalidated ?? (client.getQueryState(k) === undefined))

    const v = renderHook(() => useVoidPayment('o1'), { wrapper })
    prime()
    await act(() => v.result.current.mutateAsync({ paymentId: 'p1', reason: 'Typed twice' }))
    expect(stale()).toEqual([true, true, true, true])

    const c = renderHook(() => useCorrectPayment('o1'), { wrapper })
    prime()
    let newId = ''
    await act(async () => {
      newId = await c.result.current.mutateAsync({ paymentId: 'p2', newId: 'n1', amount: 5000, receivedOn: '2026-10-11', paidVia: 'cash', reference: null, reason: 'Wrong amount' })
    })
    expect(newId).toBe('n1')
    expect(stale()).toEqual([true, true, true, true])

    const r = renderHook(() => useRestorePayment('o1'), { wrapper })
    prime()
    await act(() => r.result.current.mutateAsync('p2'))
    expect(stale()).toEqual([true, true, true, true])

    expect(db.calls.map(x => x.target)).toEqual(['rpc:void_payment', 'rpc:correct_payment', 'rpc:restore_payment'])
  })
})
