import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionContext, type SessionState } from '@/app/session'
import { ToastProvider } from '@/ui/Toast'
import { installFakeDb, opArgs, type FakeCall } from '@/test/fakeSupabase'
import { ProductCategoriesPage } from '@/features/settings/productCategories/ProductCategoriesPage'

let fake: ReturnType<typeof installFakeDb> | null = null
afterEach(() => fake?.uninstall())

const FAMILIES = [
  { id: 'f-con', name: 'Contactors', curated: true },
  { id: 'f-pt', name: 'Pressure transmitters', curated: true },
  { id: 'f-old', name: 'Old family', curated: false },
]

function respond(call: FakeCall) {
  const has = (n: string) => call.ops.some(([m]) => m === n)
  switch (call.target) {
    case 'brands':
      return has('update') || call.verb === 'update' ? { data: [{ id: 'f-con' }] } : { data: FAMILIES }
    case 'company_brands':
      return { data: [{ brand_id: 'f-con', company_id: 's1' }, { brand_id: 'f-con', company_id: 's2' }] }
    case 'rfq_items':
      return call.verb === 'update' ? { data: ((opArgs(call, 'in')?.[1] as string[]) ?? []).map(id => ({ id })) } : { data: [{ id: 'r1', description: 'Contactor 25A' }, { id: 'r2', description: 'Pressure transmitter 0-10 bar' }] }
    case 'order_items':
      return call.verb === 'update' ? { data: ((opArgs(call, 'in')?.[1] as string[]) ?? []).map(id => ({ id })) } : { data: [{ id: 'o1', description: 'Contactor 25A' }] }
    default:
      return { data: [] }
  }
}

function mount(role: 'admin' | 'sales' = 'admin') {
  const session: SessionState = { status: 'signed-in', user: { id: 'u1', name: 'Owner', role } }
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <SessionContext.Provider value={session}>
        <MemoryRouter>
          <ToastProvider>
            <ProductCategoriesPage />
          </ToastProvider>
        </MemoryRouter>
      </SessionContext.Provider>
    </QueryClientProvider>,
  )
}

describe('Settings > Product categories', () => {
  it('lists the curated categories with their suppliers, one green button, and the others on a tap', async () => {
    fake = installFakeDb(respond)
    const { container } = mount()
    const list = await screen.findByRole('list', { name: 'Product categories' })
    const con = within(list).getByText('Contactors').closest('li') as HTMLElement
    expect(con).toHaveTextContent('Curated · 2 suppliers')
    expect(within(list).queryByText('Old family')).toBeNull()
    expect([...container.querySelectorAll('button.bg-primary')]).toHaveLength(1)
    await userEvent.click(screen.getByRole('radio', { name: 'Others' }))
    expect(within(screen.getByRole('list', { name: 'Product categories' })).getByText('Old family')).toBeInTheDocument()
  })

  it('refuses a name that is taken and renames with the new one', async () => {
    fake = installFakeDb(respond)
    mount()
    await screen.findByRole('list', { name: 'Product categories' })
    await userEvent.click(screen.getByRole('button', { name: 'More for Contactors' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /Rename/ }))
    const field = await screen.findByRole('textbox')
    await userEvent.clear(field)
    await userEvent.type(field, 'pressure transmitters')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/already exists/)).toBeInTheDocument()
    await userEvent.clear(field)
    await userEvent.type(field, 'Contactors and starters')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fake?.calls.some(c => c.target === 'brands' && c.verb === 'update')).toBe(true))
    expect(opArgs(fake!.calls.find(c => c.target === 'brands' && c.verb === 'update')!, 'update')?.[0]).toEqual({ name: 'Contactors and starters' })
  })

  it('Fill missing categories shows the counts per category first, then fills only on the button', async () => {
    fake = installFakeDb(respond)
    mount()
    await screen.findByRole('list', { name: 'Product categories' })
    await userEvent.click(screen.getByRole('button', { name: 'Fill missing categories' }))
    const summary = await screen.findByTestId('fill-summary')
    expect(summary).toHaveTextContent('3 items in 2 categories would be filled')
    const per = screen.getByRole('list', { name: 'Items per category' })
    expect(within(per).getByText('Contactors').closest('li')).toHaveTextContent('2')
    expect(fake?.calls.some(c => c.verb === 'update')).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Fill 3 items' }))
    await waitFor(() => expect(screen.getByTestId('fill-summary')).toHaveTextContent('Filled 3 of 3'))
    const writes = fake!.calls.filter(c => c.verb === 'update' && (c.target === 'rfq_items' || c.target === 'order_items'))
    expect(writes.map(w => w.target).sort()).toEqual(['order_items', 'rfq_items', 'rfq_items'])
    for (const w of writes) expect(w.ops.some(([n, a]) => n === 'is' && a[0] === 'family_id' && a[1] === null)).toBe(true)
  })
})
