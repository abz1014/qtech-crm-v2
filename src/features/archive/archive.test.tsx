import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import { setSupabaseForTests, type Db } from '@/lib/supabase'
import { getArchiveState } from '@/features/archive/api'
import { ArchiveBanner } from '@/features/archive/ArchiveBanner'

const h = vi.hoisted(() => ({ rpc: vi.fn(), cutoff: '2026-11-17' as string | null }))

beforeEach(() => {
  h.rpc.mockReset()
  setSupabaseForTests({
    rpc: h.rpc,
    from: (t: string) => {
      if (t !== 'archive_settings') throw new Error(`unexpected table ${t}`)
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { cutoff: h.cutoff }, error: null }) }) }) }
    },
  } as unknown as Db)
})
afterEach(() => {
  cleanup()
  setSupabaseForTests(null)
})

function mount(role: 'admin' | 'sales' | 'engineer') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const spy = vi.spyOn(client, 'invalidateQueries')
  render(
    <QueryClientProvider client={client}>
      <SessionProvider value={{ status: 'signed-in', user: { id: 'u1', name: 'A', role } }}>
        <ArchiveBanner entity="invoice" id="i1" />
      </SessionProvider>
    </QueryClientProvider>,
  )
  return spy
}

describe('getArchiveState', () => {
  it('asks is_archived with the entity and id', async () => {
    h.rpc.mockResolvedValue({ data: true, error: null })
    expect(await getArchiveState('rfq', 'r1')).toEqual({ archived: true, cutoff: '2026-11-17' })
    expect(h.rpc).toHaveBeenCalledWith('is_archived', { p_entity: 'rfq', p_id: 'r1' })
  })
  it('treats false and NULL as not archived', async () => {
    h.rpc.mockResolvedValue({ data: false, error: null })
    expect((await getArchiveState('order', 'o1')).archived).toBe(false)
    h.rpc.mockResolvedValue({ data: null, error: null })
    expect((await getArchiveState('order', 'o1')).archived).toBe(false)
  })
})

describe('ArchiveBanner', () => {
  it('is hidden when not archived', async () => {
    h.rpc.mockResolvedValue({ data: false, error: null })
    mount('admin')
    await waitFor(() => expect(h.rpc).toHaveBeenCalled())
    expect(screen.queryByText(/In Archive/)).toBeNull()
  })
  it('is hidden when the state is NULL', async () => {
    h.rpc.mockResolvedValue({ data: null, error: null })
    mount('engineer')
    await waitFor(() => expect(h.rpc).toHaveBeenCalled())
    expect(screen.queryByText(/In Archive/)).toBeNull()
  })
  it('shows the text with the cutoff, and no button for sales', async () => {
    h.rpc.mockResolvedValue({ data: true, error: null })
    mount('sales')
    expect(await screen.findByText(/dated before Tue 17 Nov 2026\). It still counts in all totals\./)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unarchive' })).toBeNull()
  })
  it('gives an admin Unarchive, which confirms, calls archive_unhide and invalidates', async () => {
    const user = userEvent.setup()
    h.rpc.mockResolvedValue({ data: true, error: null })
    const spy = mount('admin')
    await user.click(await screen.findByRole('button', { name: 'Unarchive' }))
    h.rpc.mockClear()
    h.rpc.mockResolvedValue({ data: null, error: null })
    const buttons = await screen.findAllByRole('button', { name: 'Unarchive' })
    await user.click(buttons[buttons.length - 1])
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith('archive_unhide', { p_entity: 'invoice', p_id: 'i1' }))
    await waitFor(() => expect(spy).toHaveBeenCalledWith())
  })
})
