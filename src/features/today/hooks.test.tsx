import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installFakeDb, opArgs, type FakeCall } from '@/test/fakeSupabase'
import * as api from '@/features/today/api'
import { performChase, useTodayData } from '@/features/today/hooks'

vi.mock('@/features/today/api', async orig => {
  const real = await orig<typeof import('@/features/today/api')>()
  return { ...real, loadTodayData: vi.fn(real.loadTodayData) }
})

let fake: ReturnType<typeof installFakeDb> | null = null
afterEach(() => {
  fake?.uninstall()
  fake = null
  vi.mocked(api.loadTodayData).mockReset()
})

describe('useTodayData', () => {
  it('re-reads the board when the business date turns over (a tab left open across midnight)', async () => {
    const load = vi.mocked(api.loadTodayData)
    load.mockResolvedValue({} as api.TodayData)
    // The app's own defaults: 30 s fresh, no refetch on focus, so nothing else would re-read it.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const user = { id: 'me', role: 'admin' as const }
    const { rerender } = renderHook(({ today }) => useTodayData(user, today), { wrapper, initialProps: { today: '2026-10-31' } })
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
    rerender({ today: '2026-11-01' })
    await waitFor(() => expect(load).toHaveBeenLastCalledWith(user, '2026-11-01'))
  })
})

describe('performChase undo', () => {
  it('a supplier chase undo restores the stamp as it was at the tap, not the possibly stale Today facts', async () => {
    fake = installFakeDb((c: FakeCall) => {
      if (c.target === 'supplier_inquiries' && c.verb === 'select') return { data: { id: 'i1', last_chased_on: '2026-10-19', last_chased_by: 'ali', chase_count: 1 } }
      if (c.target === 'rpc:stamp_supplier_chase') return { data: 2 }
      return { data: null }
    })
    // The Today facts were read before Ali chased this morning.
    const r = await performChase({ kind: 'supplier', inquiryId: 'i1', before: { lastChasedOn: null, lastChasedBy: null, chaseCount: 0 } })
    await r.undo()
    const update = fake.calls.find(c => c.target === 'supplier_inquiries' && c.verb === 'update')
    expect(opArgs(update as FakeCall, 'update')?.[0]).toEqual({ last_chased_on: '2026-10-19', last_chased_by: 'ali', chase_count: 1 })
  })

  it('a goods chase undo restores the stamp as it was at the tap, not the possibly stale Today facts', async () => {
    fake = installFakeDb((c: FakeCall) => {
      if (c.target === 'supplier_orders' && c.verb === 'select') return { data: { id: 'l1', last_chased_on: '2026-10-19', last_chased_by: 'ali', chase_count: 1 } }
      if (c.target === 'rpc:stamp_goods_chase') return { data: 2 }
      return { data: null }
    })
    const r = await performChase({ kind: 'goods', legId: 'l1', before: { lastChasedOn: null, lastChasedBy: null, chaseCount: 0 } })
    await r.undo()
    const update = fake.calls.find(c => c.target === 'supplier_orders' && c.verb === 'update')
    expect(opArgs(update as FakeCall, 'update')?.[0]).toEqual({ last_chased_on: '2026-10-19', last_chased_by: 'ali', chase_count: 1 })
  })

  it('a payment reminder undo restores the invoices as they were at the tap, not the possibly stale draft data', async () => {
    fake = installFakeDb((c: FakeCall) => {
      if (c.target === 'invoices' && c.verb === 'select') return { data: [{ id: 'v1', last_reminded_on: '2026-10-19', reminder_count: 3 }] }
      if (c.target === 'rpc:stamp_payment_reminder') return { data: 1 }
      return { data: null }
    })
    const r = await performChase({ kind: 'payment', invoiceIds: ['v1'], before: [{ id: 'v1', lastRemindedOn: null, reminderCount: 2 }] })
    expect(r.count).toBe(4)
    await r.undo()
    const update = fake.calls.find(c => c.target === 'invoices' && c.verb === 'update')
    expect(opArgs(update as FakeCall, 'update')?.[0]).toEqual({ last_reminded_on: '2026-10-19', reminder_count: 3 })
  })
})
