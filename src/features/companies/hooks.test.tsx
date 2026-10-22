import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DuplicateCompanyError, useCompany, useCompanyList, useCompanyMoney, useCreateCompany, useMergeCompanies, useSupplierStats } from '@/features/companies/hooks'
import { sameCompanyNameKey, searchCompanies, tidyCompanyName } from '@/features/companies/api'
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
  it('useCompanyList joins roles, counts and contacts (names and phone digits) onto each company', async () => {
    const { wrapper, db } = setup(c => {
      switch (c.target) {
        case 'companies':
          return {
            data: [
              { id: 'a', name: 'Alpenmark', country: 'Austria', city: 'Linz', updated_at: 't' },
              { id: 'b', name: 'Karachi Glassworks', country: null, city: null, updated_at: 't' },
            ],
          }
        case 'v_company_roles':
          return { data: [{ company_id: 'a', role: 'supplier' }, { company_id: 'b', role: 'customer' }] }
        case 'rfqs':
          return { data: [{ id: 'r1', company_id: 'b', received_on: '2026-09-02' }, { id: 'r2', company_id: 'b', received_on: '2026-10-05' }] }
        case 'orders':
          return { data: [{ id: 'o1', company_id: 'b', ordered_on: '2026-09-20' }] }
        case 'contacts':
          return { data: [{ company_id: 'b', name: 'Naveed Akhtar', phone: '+92 301 555 0142' }, { company_id: 'b', name: 'Front desk', phone: null }] }
        default:
          return { data: [] }
      }
    })
    const { result } = renderHook(() => useCompanyList(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([
      { id: 'a', name: 'Alpenmark', country: 'Austria', city: 'Linz', role: 'supplier', rfqCount: 0, orderCount: 0, lastActivity: null, updatedAt: 't', contacts: [] },
      {
        id: 'b',
        name: 'Karachi Glassworks',
        country: null,
        city: null,
        role: 'customer',
        rfqCount: 2,
        orderCount: 1,
        // R2-19: the later of the last RFQ received and the last order
        lastActivity: '2026-10-05',
        updatedAt: 't',
        contacts: [
          { name: 'Naveed Akhtar', phoneKey: '3015550142' },
          { name: 'Front desk', phoneKey: '' },
        ],
      },
    ])
    // Contacts are read in pages like every other list (fetchAll), only the three columns the search needs.
    const read = db.calls.find(c => c.target === 'contacts')
    expect(read?.verb).toBe('select')
    expect(opArgs(read!, 'select')).toEqual(['company_id, name, phone'])
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
    expect(db.calls.filter(c => c.target === 'rpc:receivables_list')).toHaveLength(0)
  })

  it('useCompanyMoney totals gross, received and balance over the company receivables for an admin', async () => {
    const { wrapper, db } = setup(() => ({
      data: [
        { gross_target: 1000, settled: 400, balance: 600, overpaid_by: 0 },
        { gross_target: '500.50', settled: '600.00', balance: 0, overpaid_by: '99.50' },
      ],
    }))
    const { result } = renderHook(() => useCompanyMoney('c1', true), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({ receivable: 1500.5, settled: 1000, balance: 600, overpaid: 99.5, orders: 2 })
    expect(db.calls[0].target).toBe('rpc:receivables_list')
    expect(opArgs(db.calls[0], 'args')).toEqual([{ p_company_id: 'c1' }])
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
      await result.current.mutateAsync({ id: 'new-id', name: '  Indus   Textile ', country: ' ' })
    })
    const insert = db.calls.find(c => c.verb === 'insert')!
    expect(opArgs(insert, 'insert')).toEqual([{ id: 'new-id', name: 'Indus Textile', country: null, notes: null, city: null }])
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.companies.lists() })
  })

  it('HW-33: a near duplicate (doubled spaces, a full stop at the end) is refused before the insert, carrying the existing company', async () => {
    const { wrapper, db } = setup(c => (c.verb === 'insert' ? { data: { id: 'x', name: 'x' } } : { data: [{ id: 'existing', name: 'Hunt Traders', country: null }] }))
    const { result } = renderHook(() => useCreateCompany(), { wrapper })
    let caught: unknown
    await act(async () => {
      try {
        await result.current.mutateAsync({ id: 'x', name: 'hunt  TRADERS.' })
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(DuplicateCompanyError)
    expect((caught as DuplicateCompanyError).existing?.id).toBe('existing')
    expect(opArgs(db.calls[0], 'ilike')).toEqual(['name', 'hunt%traders%'])
    expect(db.calls.some(c => c.verb === 'insert')).toBe(false)
  })

  it('sameCompanyNameKey ignores case, extra spaces and punctuation at the end, but not words', () => {
    expect(sameCompanyNameKey('  Hunt  HW33   Traders. ')).toBe('hunt hw33 traders')
    expect(sameCompanyNameKey('Hunt HW33 Traders,')).toBe('hunt hw33 traders')
    expect(sameCompanyNameKey('Hunt HW33 Traders Ltd')).toBe('hunt hw33 traders ltd')
    expect(tidyCompanyName('  A   B. ')).toBe('A B.')
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

  it('a retry after the company saved but its first contact failed adds the contact and refreshes the lists', async () => {
    let contactTries = 0
    const { wrapper, db, client } = setup(c => {
      if (c.target === 'companies' && c.verb === 'insert') {
        // The retry reuses the request id, so the company row is already there.
        return { error: { code: '23505', message: 'duplicate key value violates unique constraint "companies_pkey"' } }
      }
      if (c.target === 'contacts' && c.verb === 'insert') {
        contactTries++
        return { data: { id: 'k1' } }
      }
      return { data: [] }
    })
    const spy = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useCreateCompany(), { wrapper })
    let created: unknown
    await act(async () => {
      created = await result.current.mutateAsync({ id: 'req-1', name: 'Indus Textile', contactName: 'Bilal' })
    })
    expect(created).toEqual({ id: 'req-1', name: 'Indus Textile' })
    expect(contactTries).toBe(1)
    const contact = db.calls.find(c => c.target === 'contacts' && c.verb === 'insert')!
    expect((opArgs(contact, 'insert')?.[0] as { company_id: string }).company_id).toBe('req-1')
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.companies.lists() })
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
