import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionContext, type SessionState } from '@/app/session'
import { ToastProvider } from '@/ui/Toast'
import { installFakeDb, opArgs } from '@/test/fakeSupabase'
import { CategoriesDealtIn } from '@/features/companies/CategoriesDealtIn'

let fake: ReturnType<typeof installFakeDb> | null = null
afterEach(() => fake?.uninstall())

function respond(call: { target: string; verb: string; ops: [string, unknown[]][] }) {
  switch (call.target) {
    case 'v_supplier_category_evidence':
      return { data: [{ family_id: 'f-pt', asked: 8, replied: 7, quoted: 6, no_offer: 1, ordered: 2 }, { family_id: 'f-cab', asked: 3, replied: 0, quoted: 0, no_offer: 0, ordered: 0 }] }
    case 'brands':
      return call.ops.some(([n, a]) => n === 'eq' && a[0] === 'curated')
        ? { data: [{ id: 'f-pt', name: 'Pressure transmitters' }, { id: 'f-cab', name: 'Cables' }, { id: 'f-mcb', name: 'MCB' }] }
        : { data: [{ id: 'f-pt', name: 'Pressure transmitters' }, { id: 'f-cab', name: 'Cables' }] }
    case 'company_brands':
      return call.verb === 'select' ? { data: [{ brand_id: 'f-pt', brands: { name: 'Pressure transmitters', kind: 'family' } }] } : { data: null }
    default:
      return { data: [] }
  }
}

function mount(role: 'admin' | 'sales' | 'engineer') {
  const session: SessionState = { status: 'signed-in', user: { id: 'u1', name: 'Ayesha', role } }
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <SessionContext.Provider value={session}>
        <MemoryRouter>
          <ToastProvider>
            <CategoriesDealtIn companyId="s1" />
          </ToastProvider>
        </MemoryRouter>
      </SessionContext.Provider>
    </QueryClientProvider>,
  )
}

describe('Categories they deal in', () => {
  it('shows each category with its evidence, and lets sales tag and untag', async () => {
    fake = installFakeDb(respond)
    mount('sales')
    const list = await screen.findByRole('list', { name: 'Categories they deal in' })
    const pt = within(list).getByText('Pressure transmitters').closest('li') as HTMLElement
    expect(pt).toHaveTextContent('quoted 6 · ordered 2')
    expect(within(pt).getByRole('button', { name: 'Untag Pressure transmitters' })).toBeEnabled()
    const cab = within(list).getByText('Cables').closest('li') as HTMLElement
    expect(cab).toHaveTextContent('asked 3, no quote yet')
    await userEvent.click(within(cab).getByRole('button', { name: 'Tag Cables' }))
    await waitFor(() => expect(fake?.calls.some(c => c.target === 'company_brands' && c.verb === 'upsert')).toBe(true))
    const up = fake?.calls.find(c => c.target === 'company_brands' && c.verb === 'upsert')
    expect(opArgs(up!, 'upsert')?.[0]).toEqual({ company_id: 's1', brand_id: 'f-cab' })
  })

  it('an engineer reads the counts and has no Tag or Untag', async () => {
    fake = installFakeDb(respond)
    mount('engineer')
    const list = await screen.findByRole('list', { name: 'Categories they deal in' })
    expect(list).toHaveTextContent('quoted 6 · ordered 2')
    expect(screen.queryByRole('button', { name: /^(Tag|Untag) / })).toBeNull()
    expect(screen.queryByLabelText('Tag a category')).toBeNull()
  })
})
