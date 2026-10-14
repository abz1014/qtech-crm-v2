import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCreatePerson, useSetRole, useTeam } from '@/features/settings/hooks'
import { qk } from '@/features/queryKeys'
import { setSupabaseForTests, type Db } from '@/lib/supabase'

const invoke = vi.fn()
const users = [{ id: 'u1', name: 'Ayesha Rana', email: 'a@x.test', role: 'sales', job_title: null, deactivated_at: null, created_at: 't' }]

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

beforeEach(() => {
  invoke.mockReset()
  setSupabaseForTests({ functions: { invoke } } as unknown as Db)
})
afterEach(() => setSupabaseForTests(null))

describe('settings hooks', () => {
  it('reads the team through the admin-users function, and not at all when not enabled', async () => {
    invoke.mockResolvedValue({ data: { users }, error: null })
    const off = renderHook(() => useTeam(false), { wrapper: setup().wrapper })
    expect(off.result.current.fetchStatus).toBe('idle')
    expect(invoke).not.toHaveBeenCalled()
    const on = renderHook(() => useTeam(true), { wrapper: setup().wrapper })
    await waitFor(() => expect(on.result.current.isSuccess).toBe(true))
    expect(invoke).toHaveBeenCalledWith('admin-users', { body: { action: 'list' } })
    expect(on.result.current.data).toEqual(users)
  })

  it('a role change makes the team list stale through the invalidation map', async () => {
    invoke.mockResolvedValue({ data: { user_id: 'u1', role: 'engineer' }, error: null })
    const { client, wrapper } = setup()
    const spy = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useSetRole(), { wrapper })
    await act(() => result.current.mutateAsync({ userId: 'u1', role: 'engineer' }))
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.settings.team() })
  })

  it('a generated password is not kept in the mutation cache once nothing is showing it', async () => {
    invoke.mockResolvedValue({ data: { user: { id: 'n', name: 'N', email: 'n@x.test', role: 'sales', job_title: null }, password: 'Vk7xmQ3pRt9wHn2e' }, error: null })
    const { client, wrapper } = setup()
    const { result, unmount } = renderHook(() => useCreatePerson(), { wrapper })
    await act(() => result.current.mutateAsync({ name: 'N', email: 'n@x.test', role: 'sales' }))
    unmount()
    await waitFor(() => expect(client.getMutationCache().getAll()).toHaveLength(0))
  })
})
