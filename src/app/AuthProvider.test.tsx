import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '@/app/AuthProvider'
import { useSession, useSignInNotice } from '@/app/session'
import { isNetworkHeld, useConnection } from '@/lib/connection'
import { readRememberedUser, rememberUser } from '@/lib/storedSession'

type AuthCb = (event: string, session: unknown) => void
const h = vi.hoisted(() => ({
  cb: null as null | AuthCb,
  role: 'sales' as string | null,
  name: 'Ayesha' as string | null,
  signOut: vi.fn(),
  /** What Auth reports first: the stored session, none (a refresh failed or nobody signed in), or nothing yet. */
  initial: 'user' as 'user' | 'null' | 'never',
  /** The users row and current_user_role() fail as a dropped connection does. */
  failLookup: false,
  /** The lookup is refused as an invalid token (PostgREST PGRST301). */
  refuse: false,
  /** What the refusal says: PGRST301 (bad token), or the 0085 pre-request check (PT401) for an ended session or a deactivated account. */
  refusal: { message: 'JWT expired', details: '', hint: '', code: 'PGRST301' },
  start: vi.fn(),
  forgetSaved: vi.fn(),
  forgetCaptures: vi.fn(),
  /** The user id of the Supabase session kept in localStorage. */
  stored: 'u1' as string | null,
}))

vi.mock('@/lib/supabase', () => {
  const failed = { data: null, error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' } }
  const client = {
    auth: {
      onAuthStateChange: (cb: AuthCb) => {
        h.cb = cb
        if (h.initial !== 'never') queueMicrotask(() => cb('INITIAL_SESSION', h.initial === 'user' ? { user: { id: 'u1' } } : null))
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
      signOut: () => {
        h.signOut()
        h.stored = null
        h.cb?.('SIGNED_OUT', null)
        return Promise.resolve({ error: null })
      },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve(h.refuse ? { data: null, error: h.refusal } : h.failLookup ? failed : { data: h.name ? { id: 'u1', name: h.name } : null, error: null }),
        }),
      }),
    }),
    rpc: () => Promise.resolve(h.refuse ? { data: null, error: h.refusal } : h.failLookup ? failed : { data: h.role, error: null }),
  }
  return { onApiActivity: () => () => {}, onSessionRefused: () => () => {}, getSupabase: () => client }
})

vi.mock('@/lib/storedSession', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/storedSession')>()),
  storedSessionUserId: () => h.stored,
}))

vi.mock('@/lib/queryPersist', () => ({
  startQueryPersistence: (...a: unknown[]) => {
    h.start(...a)
    return Promise.resolve()
  },
  setCacheOwner: () => {},
  forgetSavedQueries: () => {
    h.forgetSaved()
    return Promise.resolve()
  },
}))

vi.mock('@/lib/capture/forget', () => ({
  forgetDeviceCaptures: () => {
    h.forgetCaptures()
    return Promise.resolve()
  },
}))

function Probe() {
  const s = useSession()
  const notice = useSignInNotice()
  const connection = useConnection()
  return (
    <>
      <p>
        {s.status}:{s.status === 'signed-in' ? s.user.role : ''}:{notice ?? 'none'}
      </p>
      <p>{`connection:${connection}`}</p>
    </>
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

const setOnline = (on: boolean) => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(on)
  window.dispatchEvent(new Event(on ? 'online' : 'offline'))
}

beforeEach(() => {
  h.role = 'sales'
  h.name = 'Ayesha'
  h.initial = 'user'
  h.failLookup = false
  h.refuse = false
  h.refusal = { message: 'JWT expired', details: '', hint: '', code: 'PGRST301' }
  h.stored = 'u1'
  h.start.mockClear()
  h.forgetSaved.mockClear()
  h.forgetCaptures.mockClear()
  h.signOut.mockClear()
  window.localStorage.clear()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('AuthProvider', () => {
  it('resolves the role from current_user_role()', async () => {
    mount()
    expect(await screen.findByText('signed-in:sales:none')).toBeInTheDocument()
    expect(screen.getByText('connection:online')).toBeInTheDocument()
  })

  it('signs a deactivated person out and says why', async () => {
    h.role = null
    h.name = null
    mount()
    expect(await screen.findByText('signed-out::deactivated')).toBeInTheDocument()
    await waitFor(() => expect(h.signOut).toHaveBeenCalledTimes(1))
  })

  it('remembers who resolved, for the next cold open', async () => {
    mount()
    await screen.findByText('signed-in:sales:none')
    await waitFor(() => expect(readRememberedUser()).toEqual({ id: 'u1', name: 'Ayesha', role: 'sales' }))
  })

  it('sign-out forgets the remembered person', async () => {
    rememberUser({ id: 'u1', name: 'Ayesha', role: 'sales' })
    mount()
    await screen.findByText('signed-in:sales:none')
    await act(async () => h.cb?.('SIGNED_OUT', null))
    h.stored = null
    expect(readRememberedUser()).toBeNull()
  })
})

describe('no signal is not a sign-out (phone audit 2c)', () => {
  it('offline cold open with a kept session: the shell opens at once from the remembered person, marked offline, with requests held', async () => {
    rememberUser({ id: 'u1', name: 'Ayesha', role: 'sales' })
    h.initial = 'never' // auth-js is still retrying the token refresh
    setOnline(false)
    mount()
    expect(await screen.findByText('signed-in:sales:none')).toBeInTheDocument()
    expect(screen.getByText('connection:offline')).toBeInTheDocument()
    expect(isNetworkHeld()).toBe(true)
  })

  it('a refresh that failed for lack of signal (Auth reports no session, the session is still kept): signed in, reconnecting, and recovers silently', async () => {
    rememberUser({ id: 'u1', name: 'Ayesha', role: 'sales' })
    h.initial = 'null'
    mount()
    expect(await screen.findByText('signed-in:sales:none')).toBeInTheDocument()
    expect(screen.getByText('connection:reconnecting')).toBeInTheDocument()
    expect(isNetworkHeld()).toBe(true)

    // Signal back: Auth refreshes the kept token.
    await act(async () => h.cb?.('TOKEN_REFRESHED', { user: { id: 'u1' } }))
    expect(await screen.findByText('connection:online')).toBeInTheDocument()
    expect(screen.getByText('signed-in:sales:none')).toBeInTheDocument()
    expect(isNetworkHeld()).toBe(false)
  })

  it('a failing account lookup never sends a signed-in person to the sign-in form', async () => {
    rememberUser({ id: 'u1', name: 'Ayesha', role: 'sales' })
    h.failLookup = true
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(screen.getByText('signed-in:sales:none')).toBeInTheDocument()
    expect(screen.getByText('connection:reconnecting')).toBeInTheDocument()
    // A live token: requests are not held, they simply fail until the network is back.
    expect(isNetworkHeld()).toBe(false)

    h.failLookup = false
    await act(async () => {
      setOnline(true)
      await vi.advanceTimersByTimeAsync(61_000)
    })
    expect(screen.getByText('connection:online')).toBeInTheDocument()
  })

  it('kept session but nobody remembered yet (first open after this update), offline: waiting, not loading for ever and not signed out', async () => {
    h.initial = 'never'
    setOnline(false)
    mount()
    expect(await screen.findByText('loading::none')).toBeInTheDocument()
    expect(screen.getByText('connection:offline')).toBeInTheDocument()
  })

  it('the remembered person is used only for the session kept on this device', async () => {
    rememberUser({ id: 'someone-else', name: 'Bilal', role: 'admin' })
    h.initial = 'never'
    setOnline(false)
    mount()
    expect(await screen.findByText('loading::none')).toBeInTheDocument()
  })

  it('nobody signed in on this device, offline: signed out (the sign-in page then shows its offline screen)', async () => {
    h.stored = null
    h.initial = 'null'
    setOnline(false)
    mount()
    expect(await screen.findByText('signed-out::none')).toBeInTheDocument()
  })
})

describe('nothing is kept for a person the server no longer accepts (owner security rule)', () => {
  it('the saved cache is restored only after the server confirmed the session, never from memory alone', async () => {
    rememberUser({ id: 'u1', name: 'Ayesha', role: 'sales' })
    h.initial = 'never'
    setOnline(false)
    mount()
    await screen.findByText('signed-in:sales:none')
    expect(h.start).not.toHaveBeenCalled()
  })

  it('restores it once the lookup confirms', async () => {
    mount()
    await screen.findByText('signed-in:sales:none')
    await waitFor(() => expect(h.start).toHaveBeenCalledWith(expect.anything(), 'u1'))
  })

  it('deactivated: signed out, and captures, drafts, the saved cache and the remembered person are wiped', async () => {
    rememberUser({ id: 'u1', name: 'Ayesha', role: 'sales' })
    h.role = null
    h.name = null
    mount()
    expect(await screen.findByText('signed-out::deactivated')).toBeInTheDocument()
    await waitFor(() => expect(h.signOut).toHaveBeenCalled())
    expect(h.forgetCaptures).toHaveBeenCalled()
    expect(h.forgetSaved).toHaveBeenCalled()
    expect(readRememberedUser()).toBeNull()
    expect(h.start).not.toHaveBeenCalled()
  })

  it('a session that ended without Sign out (no stored token, Auth reports none, someone remembered): wiped once (BUG-RV-06)', async () => {
    rememberUser({ id: 'u1', name: 'Ayesha', role: 'sales' })
    h.stored = null
    h.initial = 'null'
    mount()
    expect(await screen.findByText('signed-out::none')).toBeInTheDocument()
    await waitFor(() => expect(h.forgetCaptures).toHaveBeenCalledTimes(1))
    expect(h.forgetSaved).toHaveBeenCalled()
    expect(readRememberedUser()).toBeNull()
  })

  it('nobody was signed in on this device: nothing is wiped (a share kept while signed out stays)', async () => {
    h.stored = null
    h.initial = 'null'
    mount()
    expect(await screen.findByText('signed-out::none')).toBeInTheDocument()
    expect(h.forgetCaptures).not.toHaveBeenCalled()
  })

  it('a token the server refuses (PGRST301): signed out and wiped at once, not shown from memory', async () => {
    rememberUser({ id: 'u1', name: 'Ayesha', role: 'sales' })
    h.refuse = true
    mount()
    expect(await screen.findByText(/^signed-out:/)).toBeInTheDocument()
    await waitFor(() => expect(h.signOut).toHaveBeenCalled())
    expect(h.forgetCaptures).toHaveBeenCalled()
    expect(h.forgetSaved).toHaveBeenCalled()
  })

  it('HW-17: a session ended elsewhere (Reset password; PT401 from the pre-request check): signed out and wiped', async () => {
    rememberUser({ id: 'u1', name: 'Ayesha', role: 'sales' })
    h.refuse = true
    h.refusal = { message: 'Your session has ended. Sign in again.', details: 'session_ended', hint: '', code: 'PT401' }
    mount()
    expect(await screen.findByText('signed-out::none')).toBeInTheDocument()
    await waitFor(() => expect(h.signOut).toHaveBeenCalled())
    expect(h.forgetCaptures).toHaveBeenCalled()
  })

  it('HW-45: the pre-request check refusing a deactivated account signs out with the reason', async () => {
    h.refuse = true
    h.refusal = { message: 'This account has been deactivated.', details: 'account_deactivated', hint: '', code: 'PT401' }
    mount()
    expect(await screen.findByText('signed-out::deactivated')).toBeInTheDocument()
    await waitFor(() => expect(h.signOut).toHaveBeenCalled())
  })
})
