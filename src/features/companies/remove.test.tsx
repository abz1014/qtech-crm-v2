import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InUseError, inUseSentence } from '@/features/companies/api'
import { ConfirmRemove } from '@/features/companies/CompanyParts'
import {
  useRemoveContact,
  useRemoveSite,
  useUnlinkBrand,
  useUpdateContact,
  useUpdateSite,
} from '@/features/companies/hooks'
import { removeErrorMessage } from '@/features/companies/removeError'
import { qk } from '@/features/queryKeys'
import { installFakeDb, opArgs, type FakeCall, type FakeResult } from '@/test/fakeSupabase'

function setup(respond: (c: FakeCall) => FakeResult) {
  const db = installFakeDb(respond)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { db, client, wrapper }
}

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}` }))
const eqs = (c: FakeCall) => c.ops.filter(([n]) => n === 'eq').map(([, a]) => a)

afterEach(() => {
  installFakeDb(() => ({})).uninstall()
})

describe('in-use sentence', () => {
  it('names the count, with the right plural and a joined list', () => {
    expect(inUseSentence('site', { rfqs: 3, orders: 0, quotations: 0 })).toBe("This site is used on 3 RFQs; it can't be removed.")
    expect(inUseSentence('site', { rfqs: 1, orders: 0, quotations: 0 })).toBe("This site is used on 1 RFQ; it can't be removed.")
    expect(inUseSentence('site', { rfqs: 2, orders: 1, quotations: 0 })).toBe("This site is used on 2 RFQs and 1 order; it can't be removed.")
    expect(inUseSentence('contact', { rfqs: 1, orders: 2, quotations: 4 })).toBe("This contact is used on 1 RFQ, 2 orders and 4 quotations; it can't be removed.")
  })

  it('removeErrorMessage uses it, and turns a database 23503 into a plain sentence', () => {
    expect(removeErrorMessage(new InUseError('site', { rfqs: 3, orders: 0, quotations: 0 }), 'site')).toBe("This site is used on 3 RFQs; it can't be removed.")
    expect(removeErrorMessage({ code: '23503', message: 'update or delete on table "contacts" violates foreign key constraint "x"' }, 'contact')).toBe(
      "This contact is still used by other records, so it can't be removed.",
    )
    expect(removeErrorMessage({ code: '42501', message: 'denied' }, 'site')).toMatch(/Nothing was saved/)
  })
})

const fk = { error: { code: '23503', message: 'violates foreign key constraint', details: 'still referenced' } }
/** The database refuses the delete (23503); the counts are only read afterwards, to word the message. */
const refuse = (counts: Record<string, number>) => (c: FakeCall): FakeResult =>
  c.verb === 'delete' ? fk : { data: rows(counts[c.target] ?? 0) }

describe('removing a site', () => {
  it('relies on the database refusal, then counts to say how many; nothing is refreshed', async () => {
    const { wrapper, db, client } = setup(refuse({ rfqs: 3 }))
    const spy = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useRemoveSite('co'), { wrapper })
    let caught: unknown
    await act(async () => {
      await result.current.mutateAsync('site-1').catch(e => (caught = e))
    })
    expect(caught).toBeInstanceOf(InUseError)
    expect((caught as Error).message).toBe("This site is used on 3 RFQs; it can't be removed.")
    expect((caught as InUseError).code).toBe('23503')
    expect(db.calls[0].verb).toBe('delete')
    expect(db.calls.slice(1).every(c => c.verb === 'select')).toBe(true)
    expect(spy).not.toHaveBeenCalled()
  })

  it('names an order too, even with no RFQ', async () => {
    const { wrapper } = setup(refuse({ orders: 1 }))
    const { result } = renderHook(() => useRemoveSite('co'), { wrapper })
    let caught: unknown
    await act(async () => {
      await result.current.mutateAsync('site-1').catch(e => (caught = e))
    })
    expect((caught as Error).message).toBe("This site is used on 1 order; it can't be removed.")
  })

  it('deletes an unused site with a single call, scoped to its company, and refreshes that company', async () => {
    const { wrapper, db, client } = setup(() => ({ data: [] }))
    const spy = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useRemoveSite('co'), { wrapper })
    await act(async () => {
      await result.current.mutateAsync('site-1')
    })
    expect(db.calls).toHaveLength(1)
    const del = db.calls[0]
    expect(del.verb).toBe('delete')
    expect(del.target).toBe('company_sites')
    expect(eqs(del)).toEqual([['id', 'site-1'], ['company_id', 'co']])
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.companies.detail('co') })
  })

  it('a refusal nobody can be counted against still reads in plain words', async () => {
    const { wrapper } = setup(refuse({}))
    const { result } = renderHook(() => useRemoveSite('co'), { wrapper })
    let caught: unknown
    await act(async () => {
      await result.current.mutateAsync('s').catch(e => (caught = e))
    })
    expect(removeErrorMessage(caught, 'site')).toBe("This site is still used by other records, so it can't be removed.")
  })

  it('other failures pass through untouched, with no counting', async () => {
    const { wrapper, db } = setup(() => ({ error: { code: '42501', message: 'denied' } }))
    const { result } = renderHook(() => useRemoveSite('co'), { wrapper })
    let caught: unknown
    await act(async () => {
      await result.current.mutateAsync('s').catch(e => (caught = e))
    })
    expect((caught as { code: string }).code).toBe('42501')
    expect(db.calls).toHaveLength(1)
  })
})

describe('removing a contact', () => {
  it('counts RFQs, orders and quotations together, but only after the database refuses', async () => {
    const { wrapper, db } = setup(refuse({ rfqs: 1, orders: 2, quotations: 1 }))
    const { result } = renderHook(() => useRemoveContact('co'), { wrapper })
    let caught: unknown
    await act(async () => {
      await result.current.mutateAsync('ct').catch(e => (caught = e))
    })
    expect((caught as Error).message).toBe("This contact is used on 1 RFQ, 2 orders and 1 quotation; it can't be removed.")
    expect(db.calls[0].verb).toBe('delete')
    expect(db.calls.slice(1).map(c => opArgs(c, 'eq'))).toEqual([
      ['contact_id', 'ct'],
      ['contact_id', 'ct'],
      ['contact_id', 'ct'],
    ])
  })

  it('deletes an unreferenced contact with a single call', async () => {
    const { wrapper, db } = setup(() => ({ data: [] }))
    const { result } = renderHook(() => useRemoveContact('co'), { wrapper })
    await act(async () => {
      await result.current.mutateAsync('ct')
    })
    expect(db.calls).toHaveLength(1)
    expect(db.calls[0].target).toBe('contacts')
    expect(db.calls[0].verb).toBe('delete')
  })
})

describe('editing and unlinking', () => {
  it('useUpdateSite trims, blanks become null, and nothing is inserted', async () => {
    const { wrapper, db } = setup(() => ({ data: { id: 's' } }))
    const { result } = renderHook(() => useUpdateSite('co'), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ id: 's', name: ' Karachi ', address: '  ' })
    })
    expect(db.calls[0].verb).toBe('update')
    expect(opArgs(db.calls[0], 'update')).toEqual([{ name: 'Karachi', address: null }])
    expect(opArgs(db.calls[0], 'eq')).toEqual(['id', 's'])
  })

  it('useUpdateContact sends every field, so a cleared one is cleared', async () => {
    const { wrapper, db } = setup(() => ({ data: { id: 'c' } }))
    const { result } = renderHook(() => useUpdateContact('co'), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ id: 'c', name: ' Salman ', phone: '', email: ' s@x.pk ', notes: null, siteId: '' })
    })
    expect(opArgs(db.calls[0], 'update')).toEqual([{ name: 'Salman', site_id: null, phone: null, email: 's@x.pk', job_title: null, notes: null }])
  })

  it('useUnlinkBrand removes only the link and refreshes the roster', async () => {
    const { wrapper, db, client } = setup(() => ({ data: [] }))
    const spy = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useUnlinkBrand('co'), { wrapper })
    await act(async () => {
      await result.current.mutateAsync('b1')
    })
    expect(db.calls).toHaveLength(1)
    expect(db.calls[0].target).toBe('company_brands')
    expect(db.calls[0].verb).toBe('delete')
    expect(eqs(db.calls[0])).toEqual([['company_id', 'co'], ['brand_id', 'b1']])
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.companies.lists() })
  })
})

describe('ConfirmRemove', () => {
  it('asks first, names the consequence, and focuses Cancel', async () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<ConfirmRemove title="Remove Karachi?" detail="Its address is deleted." onConfirm={onConfirm} onCancel={onCancel} />)
    expect(screen.getByRole('group', { name: 'Remove Karachi?' })).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' })))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('a refusal replaces the question with the reason and leaves only Close', () => {
    render(<ConfirmRemove title="Remove Karachi?" error="This site is used on 3 RFQs; it can't be removed." onConfirm={() => undefined} onCancel={() => undefined} />)
    expect(screen.getByRole('alert').textContent).toContain("This site is used on 3 RFQs; it can't be removed.")
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
  })
})
