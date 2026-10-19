import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useCompanyContacts as useCompanyPageContacts } from '@/features/companies/hooks'
import { useCompanyContacts } from '@/features/quotations/hooks'
import { installFakeDb } from '@/test/fakeSupabase'

const ROWS = [{ id: 'k1', name: 'Ayesha Khan', phone: '0300', email: 'a@x.pk', job_title: 'Buyer', notes: null, site_id: 's1' }]

function setup() {
  const db = installFakeDb(c => (c.target === 'contacts' ? { data: ROWS } : { data: [] }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { db, wrapper }
}

afterEach(() => {
  installFakeDb(() => ({})).uninstall()
})

describe('quotation contacts share the company contacts cache entry', () => {
  it('the issue dialog still gets the job title when the company page read the contacts first', async () => {
    const { wrapper } = setup()
    const page = renderHook(() => useCompanyPageContacts('c1'), { wrapper })
    await waitFor(() => expect(page.result.current.isSuccess).toBe(true))
    const dialog = renderHook(() => useCompanyContacts('c1', true), { wrapper })
    await waitFor(() => expect(dialog.result.current.isSuccess).toBe(true))
    expect(dialog.result.current.data).toEqual([{ id: 'k1', name: 'Ayesha Khan', jobTitle: 'Buyer' }])
  })

  it('the company page still gets phone, email and site when the issue dialog read the contacts first', async () => {
    const { wrapper } = setup()
    const dialog = renderHook(() => useCompanyContacts('c1', true), { wrapper })
    await waitFor(() => expect(dialog.result.current.isSuccess).toBe(true))
    const page = renderHook(() => useCompanyPageContacts('c1'), { wrapper })
    await waitFor(() => expect(page.result.current.isSuccess).toBe(true))
    expect(page.result.current.data).toEqual(ROWS)
  })
})
