import type { AuthChangeEvent, AuthClient as AuthClientClass, GoTrueClientOptions, Session, Subscription } from '@supabase/auth-js'

type AuthClient = InstanceType<typeof AuthClientClass>

/*
 * Supabase Auth (auth-js, about 24 KB compressed) out of the first download (perf/lcp). The app uses six of its calls:
 * getSession, onAuthStateChange, signInWithPassword, signOut, updateUser and stopAutoRefresh. This stand-in has those six and
 * hands each to the real client, which is downloaded on first need:
 *
 *  - A phone that keeps a session whose access token is good for a while yet (more than FRESH_MS) does not need Auth to open:
 *    the token is the one auth-js itself would hand out for the next minute (its own margin is 90 s), read from the same
 *    storage key. So getSession answers from storage, and onAuthStateChange reports that session as INITIAL_SESSION, until
 *    the real client is in. The real client is fetched once the page's content is drawn (`deferLoad`), and from then on it
 *    answers everything, refreshes the token on its own timer and reports every change, as before. Its own INITIAL_SESSION is
 *    passed on unless it is the very session already reported.
 *  - Anything else (no session kept, a token near its end, a sign-in link in the address, any call other than getSession)
 *    fetches the real client at once and waits for it, exactly as before.
 */
export type AuthPart = Pick<AuthClient, 'getSession' | 'onAuthStateChange' | 'signInWithPassword' | 'signOut' | 'updateUser' | 'stopAutoRefresh'> & {
  readonly storageKey: string
}

/** The kept token must be good for at least this long to be used before the real client is in (auth-js refreshes at 90 s). */
const FRESH_MS = 3 * 60_000

function keptSession(storageKey: string): Session | null {
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return null
    const s = JSON.parse(raw) as Partial<Session> | null
    // auth-js's own test of a stored session (_isValidSession), plus a user to report.
    if (!s || typeof s !== 'object' || !('access_token' in s) || !('refresh_token' in s) || !('expires_at' in s) || !s.user) return null
    return s as Session
  } catch {
    return null
  }
}

const fresh = (s: Session) => typeof s.expires_at === 'number' && s.expires_at * 1000 - Date.now() > FRESH_MS

/** A sign-in or recovery link: auth-js reads the session from the address (detectSessionInUrl), so it must run first. */
function addressCarriesAuth(): boolean {
  if (typeof window === 'undefined') return false
  return /(?:^|[#?&])(?:access_token|refresh_token|error_description|code)=/.test(`${window.location.hash}${window.location.search}`)
}

interface Listener {
  callback: (event: AuthChangeEvent, session: Session | null) => void | Promise<void>
  active: boolean
  reported: Session | null
  real: Subscription | null
}

export function lazyAuth(options: GoTrueClientOptions & { storageKey: string }, deferLoad: (load: () => void) => void): AuthPart {
  const { storageKey } = options
  let client: AuthClient | null = null
  let loading: Promise<AuthClient> | null = null
  const listeners = new Set<Listener>()

  const attach = (c: AuthClient, l: Listener) => {
    l.real = c.onAuthStateChange((event, session) => {
      if (!l.active) return
      if (event === 'INITIAL_SESSION' && l.reported && session?.access_token === l.reported.access_token) return
      return l.callback(event, session)
    }).data.subscription
  }
  const load = (): Promise<AuthClient> =>
    (loading ??= import('@supabase/auth-js').then(m => {
      const c = new m.AuthClient(options)
      client = c
      for (const l of listeners) attach(c, l)
      return c
    }))

  const kept = keptSession(storageKey)
  const quick = (): Session | null => (client === null && kept && fresh(kept) ? kept : null)
  if (quick() && !addressCarriesAuth()) deferLoad(() => void load())
  else void load()

  let nextId = 0
  return {
    storageKey,
    getSession: async () => {
      const s = quick()
      if (s) return { data: { session: s }, error: null }
      return (await load()).getSession()
    },
    onAuthStateChange: ((callback: Listener['callback']) => {
      const l: Listener = { callback, active: true, reported: null, real: null }
      listeners.add(l)
      if (client) attach(client, l)
      else {
        const s = quick()
        if (s) {
          // Reported after the caller's subscribe returns, as auth-js does.
          void Promise.resolve().then(() => {
            if (!l.active || client) return
            l.reported = s
            void callback('INITIAL_SESSION', s)
          })
        }
      }
      const subscription = {
        id: `lazy-${++nextId}`,
        callback,
        unsubscribe: () => {
          l.active = false
          listeners.delete(l)
          l.real?.unsubscribe()
        },
      }
      return { data: { subscription } }
    }) as AuthClient['onAuthStateChange'],
    signInWithPassword: async credentials => (await load()).signInWithPassword(credentials),
    signOut: async opts => (await load()).signOut(opts),
    updateUser: async (attributes, opts) => (await load()).updateUser(attributes, opts),
    stopAutoRefresh: async () => (await load()).stopAutoRefresh(),
  }
}
