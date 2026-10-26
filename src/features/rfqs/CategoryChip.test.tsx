import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionContext, type SessionState } from '@/app/session'
import { ToastProvider } from '@/ui/Toast'
import { installFakeDb, opArgs } from '@/test/fakeSupabase'
import { CategoryChip } from '@/features/rfqs/CategoryChip'

let fake: ReturnType<typeof installFakeDb> | null = null
afterEach(() => fake?.uninstall())

const respond = (call: { target: string }) =>
  call.target === 'brands' ? { data: [{ id: 'f-con', name: 'Contactors' }, { id: 'f-pt', name: 'Pressure transmitters' }] } : { data: [{ id: 'x' }] }

function mount(role: 'admin' | 'sales' | 'engineer', item: { familyId: string | null; familyName: string | null; description: string }) {
  const session: SessionState = { status: 'signed-in', user: { id: 'u1', name: 'Ayesha', role } }
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <SessionContext.Provider value={session}>
        <ToastProvider>
          <CategoryChip rfqId="r1" item={{ id: 'i1', ...item }} />
        </ToastProvider>
      </SessionContext.Provider>
    </QueryClientProvider>,
  )
}

describe('the category chip on an RFQ item', () => {
  it('shows the guess dashed, and picking it saves the category', async () => {
    fake = installFakeDb(respond)
    mount('sales', { familyId: null, familyName: null, description: 'Contactor 3P 25A' })
    const chip = await screen.findByRole('button', { name: /Contactors, guessed/ })
    expect(chip).toHaveAttribute('data-category-chip', 'guess')
    expect(chip.className).toMatch(/border-dashed/)
    await userEvent.click(chip)
    await userEvent.click(await screen.findByRole('button', { name: /^Contactors/ }))
    await waitFor(() => expect(fake?.calls.some(c => c.target === 'rfq_items' && c.verb === 'update')).toBe(true))
    expect(opArgs(fake!.calls.find(c => c.target === 'rfq_items' && c.verb === 'update')!, 'update')?.[0]).toEqual({ family_id: 'f-con' })
  })

  it('an item with its own category shows it solid; one with neither says so, dashed and muted', async () => {
    fake = installFakeDb(respond)
    const a = mount('admin', { familyId: 'f-pt', familyName: 'Pressure transmitters', description: 'PMC51' })
    const own = await screen.findByRole('button', { name: /Pressure transmitters/ })
    expect(own).toHaveAttribute('data-category-chip', 'set')
    expect(own.className).not.toMatch(/border-dashed/)
    a.unmount()
    mount('admin', { familyId: null, familyName: null, description: 'something unusual' })
    expect(await screen.findByRole('button', { name: /No category/ })).toHaveClass('border-dashed')
  })

  it('an engineer sees the chip and has no picker', async () => {
    fake = installFakeDb(respond)
    mount('engineer', { familyId: 'f-pt', familyName: 'Pressure transmitters', description: 'PMC51' })
    expect(await screen.findByText('Pressure transmitters')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Change/ })).toBeNull()
  })
})
