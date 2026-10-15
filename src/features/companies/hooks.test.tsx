import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DuplicateCompanyError, useCompany, useCompanyList, useCompanyMoney, useCreateCompany, useMergeCompanies, useSupplierStats } from '@/features/companies/hooks'
import { searchCompanies } from '@/features/companies/api'
import { qk } from '@/features/queryKeys'
import { installFakeDb, opArgs, type FakeCall, type FakeResult } from '@/test/fakeSupabase'

function setup(respond: (c: FakeCall) => FakeResult) {
  const db = installFakeDb(respond)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { db, client, wrapper }
}

afterEach(() => {
  installFakeDb(() => ({})).uninstall()
})

describe('companies reads', () => {
  it('useCompanyList joins roles and counts onto each company', async () => {
    const { wrapper } = setup(c => {
      switch (c.target) {
        case 'companies':
          return { data: [{ id: 'a', name: 'Alpenmark', country: 'Austria', updated_at: 't' }, { id: 'b', name: 'Karachi Glassworks', country: null, updated_at: 't' }] }
        case 'v_company_roles':
          return { data: [{ company_id: 'a', role: 'supplier' }, { company_id: 'b', role: 'customer' }] }
        case 'rfqs':
          return { data: [{ company_id: 'b' }, { company_id: 'b' }] }
        case 'orders':
          return { data: [{ company_id: 'b' }] }
        default:
          return { data: [] }
      }
    })
    const { result } = renderHook(() => useCompanyList(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([
      { id: 'a', name: 'Alpenmark', country: 'Austria', role: 'supplier', rfqCount: 0, orderCount: 0, updatedAt: 't' },
      { id: 'b', name: 'Karachi Glassworks', country: null, role: 'customer', rfqCount: 2, orderCount: 1, updatedAt: 't' },
    ])
  })

  it('useCompany returns null for a company that is gone, not an error', async () => {
    const { wrapper } = setup(() => ({ data: null }))
    const { result } = renderHook(() => useCompany('missing'), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeNull()
  })

  it('useCompany does not run without an id', () => {
    const { wrapper, db } = setup(() => ({ data: null }))
    const { result } = renderHook(() => useCompany(undefined), { wrapper })
    expect(result.current.fetchStatus).toBe('idle')
    expect(db.calls).toHaveLength(0)
  })

  it('useCompanyMoney never asks the database unless the caller is an admin', () => {
    const { wrapper, db } = setup(() => ({ data: [] }))
    const { result } = renderHook(() => useCompanyMoney('c1', false), { wrapper })
    expect(result.current.fetchStatus).toBe('idle')
    expect(db.calls.filter(c => c.target === 'v_order_money')).toHaveLength(0)
  })

  it('useCompanyMoney totals the receivable and what was settled for an admin', async () => {
    const { wrapper } = setup(() => ({ data: [{ receivable: 1000, settled: 400 }, { receivable: '500.50', settled: 0 }] }))
    const { result } = renderHook(() => useCompanyMoney('c1', true), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({ receivable: 1500.5, settled: 400, balance: 1100.5, orders: 2 })
  })

  it('useSupplierStats reads the one row from v_supplier_stats', async () => {
    const { wrapper, db } = setup(() => ({ data: { supplier_id: 's1', asked: 6 } }))
    const { result } = renderHook(() => useSupplierStats('s1'), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.asked).toBe(6)
    expect(db.calls[0].target).toBe('v_supplier_stats')
    expect(opArgs(db.calls[0], 'eq')).toEqual(['supplier_id', 's1'])
  })

  it('surfaces a database error on the hook, as the PostgREST error', async () => {
    const { wrapper } = setup(() => ({ error: { code: '42501', message: 'permission denied' } }))
    const { result } = renderHook(() => useCompanyMoney('c1', true), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as unknown as { code: string }).code).toBe('42501')
  })

  it('searchCompanies escapes like-wildcards so "50%" is searched literally', async () => {
    const { db } = setup(() => ({ data: [] }))
    await searchCompanies('50%_x')
    expect(opArgs(db.calls[0], 'ilike')).toEqual(['name', '%50\\%\\_x%'])
  })
})

describe('companies writes', () => {
  it('useCreateCompany inserts with the request id, trims, and refreshes the lists', async () => {
    const { wrapper, db, client } = setup(c => (c.verb === 'insert' ? { data: { id: 'new-id', name: 'Indus Textile' } } : {}))
    const spy = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useCreateCompany(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ id: 'new-id', name: '  Indus Textile ', country: ' ' })
    })
    expect(opArgs(db.calls[0], 'insert')).toEqual([{ id: 'new-id', name: 'Indus Textile', country: null, notes: null, city: null }])
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.companies.lists() })
  })

  it('a duplicate name (23505 on companies_name_key) comes back as DuplicateCompanyError carrying the existing company', async () => {
    const { wrapper } = setup(c => {
      if (c.verb === 'insert') return { error: { code: '23505', message: 'duplicate key value violates unique constraint "companies_name_key"' } }
      return { data: [{ id: 'existing', name: 'Indus Textile', country: 'Pakistan' }] }
    })
    const { result } = renderHook(() => useCreateCompany(), { wrapper })
    let caught: unknown
    await act(async () => {
      try {
        await result.current.mutateAsync({ id: 'x', name: 'indus textile ' })
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(DuplicateCompanyError)
    expect((caught as DuplicateCompanyError).existing?.id).toBe('existing')
    expect((caught as DuplicateCompanyError).code).toBe('23505')
  })

  it('any other create error is passed through untouched', async () => {
    const { wrapper } = setup(() => ({ error: { code: '42501', message: 'denied' } }))
    const { result } = renderHook(() => useCreateCompany(), { wrapper })
    let caught: unknown
    await act(async () => {
      try {
        await result.current.mutateAsync({ id: 'x', name: 'Q' })
      } catch (e) {
        caught = e
      }
    })
    expect((caught as { code: string }).code).toBe('42501')
  })

  it('useMergeCompanies calls merge_companies(keep, drop), forgets the dropped company and refreshes RFQs and orders', async () => {
    const { wrapper, db, client } = setup(() => ({}))
    client.setQueryData(qk.companies.detail('drop-id'), { id: 'drop-id' })
    const spy = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useMergeCompanies(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ keepId: 'keep-id', dropId: 'drop-id' })
    })
    expect(db.calls[0].target).toBe('rpc:merge_companies')
    expect(opArgs(db.calls[0], 'args')).toEqual([{ p_keep: 'keep-id', p_drop: 'drop-id' }])
    expect(client.getQueryData(qk.companies.detail('drop-id'))).toBeUndefined()
    const keys = spy.mock.calls.map(c => (c[0] as { queryKey: unknown }).queryKey)
    expect(keys).toContainEqual(qk.rfqs.all)
    expect(keys).toContainEqual(qk.orders.all)
  })

  it('a refused merge leaves the cache alone and reports the database message', async () => {
    const { wrapper, client } = setup(() => ({ error: { code: '23505', message: 'merge conflict: both companies have an RFQ with the same customer reference' } }))
    const spy = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useMergeCompanies(), { wrapper })
    let caught: unknown
    await act(async () => {
      await result.current.mutateAsync({ keepId: 'k', dropId: 'd' }).catch(e => (caught = e))
    })
    expect(spy).not.toHaveBeenCalled()
    expect((caught as { message: string }).message).toMatch(/merge conflict/)
  })
})
