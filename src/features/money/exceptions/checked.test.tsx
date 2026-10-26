import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { checkedSet, findingRow, isChecked, openFindings, useCarryOverLocalTicks, useUnchecked } from '@/features/money/exceptions/checked'
import { sha256Hex } from '@/features/money/exceptions/sha256'
import type { ReconciliationException } from '@/lib/reconciliation'
import { installFakeDb, opArgs, type FakeCall } from '@/test/fakeSupabase'

const f = (key: string, message: string): ReconciliationException => ({ key, message, severity: 'warning', category: 'Costs exceed expected', orderId: 'o1' })

afterEach(() => {
  window.localStorage.clear()
  installFakeDb(() => ({})).uninstall()
})

describe('sha256Hex', () => {
  it('matches the published test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1')
  })
  it('reads text as UTF-8 and handles a long message (several blocks)', () => {
    expect(sha256Hex('é')).toBe('4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c')
    expect(sha256Hex('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3')
  })
})

describe('Mistakes to fix: ticks are the finding key and the digest of its message', () => {
  const a = f('a', 'ORD-0005: costs 1,480,000 are above expected 640,000')
  it('a ticked finding leaves the open list for everyone who reads the set', () => {
    const set = checkedSet([findingRow(a)])
    expect(openFindings(set, [a, f('b', 'ORD-0007: paid twice')]).map(e => e.key)).toEqual(['b'])
  })
  it('comes back by itself when the figures behind it change (the message changes)', () => {
    const set = checkedSet([findingRow(a)])
    expect(openFindings(set, [f('a', 'ORD-0005: costs 1,600,000 are above expected 640,000')]).map(e => e.key)).toEqual(['a'])
    expect(isChecked(set, a)).toBe(true)
  })
  it('while the ticks are not loaded nothing is hidden', () => {
    expect(openFindings(null, [a])).toHaveLength(1)
  })
})

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('useUnchecked (stored in checked_findings, not in the browser)', () => {
  it('Mark as checked writes one row and the finding leaves the list at once; Put back deletes it', async () => {
    const stored: { finding_key: string; message_hash: string }[] = []
    const db = installFakeDb((c: FakeCall) => {
      if (c.target !== 'checked_findings') return { data: [] }
      if (c.verb === 'upsert') {
        stored.push(...(opArgs(c, 'upsert')?.[0] as typeof stored))
        return { data: null }
      }
      if (c.verb === 'delete') {
        stored.length = 0
        return { data: null }
      }
      return { data: [...stored] }
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const a = f('a', 'ORD-0005: costs are above expected')
    const { result } = renderHook(() => useUnchecked([a]), { wrapper: wrapper(client) })
    await waitFor(() => expect(db.calls.some(c => c.target === 'checked_findings' && c.verb === 'select')).toBe(true))
    expect(result.current.open).toHaveLength(1)
    act(() => result.current.mark(a, true))
    await waitFor(() => expect(result.current.checked).toHaveLength(1))
    expect(result.current.open).toHaveLength(0)
    const up = db.calls.find(c => c.verb === 'upsert') as FakeCall
    expect((opArgs(up, 'upsert')?.[0] as { finding_key: string; message_hash: string }[])[0]).toEqual({ finding_key: 'a', message_hash: sha256Hex(a.message) })
    act(() => result.current.mark(a, false))
    await waitFor(() => expect(result.current.open).toHaveLength(1))
    expect(db.calls.some(c => c.target === 'checked_findings' && c.verb === 'delete')).toBe(true)
  })

  it('puts the finding back and says so when the tick was not saved', async () => {
    installFakeDb((c: FakeCall) => (c.target === 'checked_findings' && c.verb === 'upsert' ? { error: { message: 'boom' } } : { data: [] }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const a = f('a', 'x y')
    const { result } = renderHook(() => useUnchecked([a]), { wrapper: wrapper(client) })
    await waitFor(() => expect(result.current.open).toHaveLength(1))
    act(() => result.current.mark(a, true))
    await waitFor(() => expect(result.current.error).toBe('That tick was not saved. Try again.'))
    expect(result.current.open).toHaveLength(1)
  })
})

describe('ticks an earlier version kept in this browser', () => {
  it('are saved once for the findings still listed, then removed from the browser', async () => {
    const a = f('order-overpaid-in-o1', 'ORD-0005: paid 120,000 of 118,000.')
    const gone = f('order-gone', 'ORD-0009: old')
    window.localStorage.setItem(`qtech.checked.u1.${a.key}.${a.message}`, '1')
    window.localStorage.setItem(`qtech.checked.u1.${gone.key}.${gone.message}`, '1')
    window.localStorage.setItem('qtech.checked.u2.other.thing', '1')
    const db = installFakeDb(() => ({ data: [] }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    renderHook(() => useCarryOverLocalTicks('u1', [a], true), { wrapper: wrapper(client) })
    await waitFor(() => expect(db.calls.some(c => c.verb === 'upsert')).toBe(true))
    const up = db.calls.find(c => c.verb === 'upsert') as FakeCall
    expect(opArgs(up, 'upsert')?.[0]).toEqual([{ finding_key: a.key, message_hash: sha256Hex(a.message) }])
    await waitFor(() => expect(window.localStorage.getItem(`qtech.checked.u1.${a.key}.${a.message}`)).toBeNull())
    expect(window.localStorage.getItem(`qtech.checked.u1.${gone.key}.${gone.message}`)).toBeNull()
    expect(window.localStorage.getItem('qtech.checked.u2.other.thing')).toBe('1')
  })
})
