import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '@/app/AuthProvider'
import { useSession, useSignInNotice } from '@/app/session'

type AuthCb = (event: string, session: unknown) => void
const h = vi.hoisted(() => ({ cb: null as null | AuthCb, role: 'sales' as string | null, name: 'Ayesha' as string | null, signOut: vi.fn() }))

vi.mock('@/lib/supabase', () => {
  const client = {
    auth: {
      onAuthStateChange: (cb: AuthCb) => {
        h.cb = cb
        queueMicrotask(() => cb('INITIAL_SESSION', { user: { id: 'u1' } }))
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
      signOut: () => {
        h.signOut()
        h.cb?.('SIGNED_OUT', null)
        return Promise.resolve({ error: null })
      },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: h.name ? { id: 'u1', name: h.name } : null, error: null }),
        }),
      }),
    }),
    rpc: () => Promise.resolve({ data: h.role, error: null }),
  }
  return { onApiActivity: () => () => {}, getSupabase: () => client }
})

function Probe() {
  const s = useSession()
  const notice = useSignInNotice()
  return (
    <p>
      {s.status}:{s.status === 'signed-in' ? s.user.role : ''}:{notice ?? 'none'}
    </p>
  )
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  h.role = 'sales'
  h.name = 'Ayesha'
  h.signOut.mockClear()
})

describe('AuthProvider', () => {
  it('resolves the role from current_user_role()', async () => {
    mount()
    expect(await screen.findByText('signed-in:sales:none')).toBeInTheDocument()
  })

  it('signs a deactivated person out and says why', async () => {
    h.role = null
    h.name = null
    mount()
    expect(await screen.findByText('signed-out::deactivated')).toBeInTheDocument()
    await waitFor(() => expect(h.signOut).toHaveBeenCalledTimes(1))
  })
})
