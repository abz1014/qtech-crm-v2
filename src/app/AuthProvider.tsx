import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { SessionContext, SignInNoticeContext, type SessionState, type SessionUser, type SignInNotice } from '@/app/session'
import { getSupabase, onApiActivity, onSessionRefused } from '@/lib/supabase'
import { forgetDeviceCaptures } from '@/lib/capture/forget'
import { ConnectionContext, holdNetwork, useOnline, type Connection } from '@/lib/connection'
import { forgetSavedQueries, setCacheOwner, startQueryPersistence } from '@/lib/queryPersist'
import { forgetRememberedUser, parseRememberedUser, rememberUser, rememberedUserRaw, storedSessionUserId } from '@/lib/storedSession'

/** A person who is signed in to Auth but has no active users row has been deactivated (or never set up). */
type Resolved = { user: SessionUser } | { user: null }

const KEY = ['session', 'user'] as const

/** Re-check the account at most this often after ordinary data requests. */
const ACTIVITY_RECHECK_MS = 5_000
/** And on a timer, so an idle tab notices too. */
const POLL_MS = 60_000
/** A session that has not confirmed within this long on a slow or failing connection opens from what the device kept. */
const SLOW_SESSION_MS = 5_000
/** The account lookup is retried quietly this many times (1 s, 2 s, 4 s apart) before it counts as failed. */
const LOOKUP_RETRIES = 3

async function resolveUser(userId: string): Promise<Resolved> {
  const supabase = getSupabase()
  if (!supabase) throw new Error('Supabase is not configured')
  // Both calls go through RLS. A deactivated person gets null from current_user_role() and no users row.
  const [row, role] = await Promise.all([
    supabase.from('users').select('id, name').eq('id', userId).maybeSingle(),
    supabase.rpc('current_user_role'),
  ])
  // The API's pre-request check (0087) refuses a deactivated account outright: that is a deactivation, not a failed lookup.
  if (isDeactivatedRefusal(role.error) || isDeactivatedRefusal(row.error)) return { user: null }
  if (role.error) throw role.error
  if (row.error) throw row.error
  if (!role.data || !row.data) return { user: null }
  return { user: { id: row.data.id, name: row.data.name, role: role.data } }
}

/**
 * PostgREST's answers to a token it will not accept, or a role check refused: the session is not valid. PT401 is the
 * pre-request check of 0087_session_cutoff.sql: the session was ended (Reset password, Deactivate, signed out elsewhere).
 */
function isAuthRefusal(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: unknown }).code
  return code === 'PGRST301' || code === 'PGRST302' || code === 'PGRST303' || code === '42501' || code === 'PT401'
}

/** The pre-request check refused the request because the account is deactivated. */
function isDeactivatedRefusal(err: unknown): boolean {
  return Boolean(err) && typeof err === 'object' && (err as { code?: unknown }).code === 'PT401' && (err as { details?: unknown }).details === 'account_deactivated'
}

/** True once `running` has stayed true for `ms`. */
function useElapsed(running: boolean, ms: number): boolean {
  const [elapsed, setElapsed] = useState(false)
  useEffect(() => {
    setElapsed(false)
    if (!running) return
    const t = setTimeout(() => setElapsed(true), ms)
    return () => clearTimeout(t)
  }, [running, ms])
  return running && elapsed
}

interface Decision {
  state: SessionState
  notice: SignInNotice
  connection: Connection
  /** The shell runs on the remembered person, not on a confirmed lookup. */
  fromMemory: boolean
}

const LOADING: Decision = { state: { status: 'loading' }, notice: null, connection: 'online', fromMemory: false }

/**
 * The real session: Supabase Auth, then the users row and current_user_role() through TanStack
 * Query. Re-resolved on focus, on a timer and soon after data requests, so a deactivated person is
 * signed out on their next request instead of waiting for the access token to expire.
 *
 * No signal is not a sign-out (phone audit 2c, performance audit 3.2). supabase-js keeps the session in localStorage
 * when a token refresh fails for lack of signal, and a failed lookup proves nothing about the account. So while a
 * session is kept on this device, this provider never sends the person to the sign-in form for a network reason:
 *  - it opens the shell at once from the remembered person (src/lib/storedSession.ts) and the saved query cache
 *    (src/lib/queryPersist.ts), with Connection 'offline' or 'reconnecting' for the banner (RequireSession);
 *  - with no live token it holds TanStack's requests (they would go out anonymous and cache empty lists);
 *  - it retries quietly and recovers by itself: the `online` event nudges Auth, the lookup refetches on reconnect, and
 *    the banner goes when the session is confirmed.
 * Only Auth saying "no session" (sign-out, a refused refresh token) or a deactivated account signs anyone out.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = getSupabase()
  const queryClient = useQueryClient()
  const online = useOnline()
  // undefined = Auth has not reported yet
  const [authSession, setAuthSession] = useState<Session | null | undefined>(supabase ? undefined : null)
  const [signedOutForDeactivation, setDeactivated] = useState(false)


  useEffect(() => {
    if (!supabase) return
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      // Only set state here: calling Supabase from inside this callback can deadlock.
      setAuthSession(next)
      // A session that ended without Sign out (refresh token expired or revoked, the stored token gone): Auth opens with
      // no session and nothing kept, but the device still remembers the last person (BUG-RV-06). A refresh that failed for
      // lack of signal keeps the stored session, so it is not counted here.
      const endedUnseen = event === 'INITIAL_SESSION' && !next && !storedSessionUserId() && rememberedUserRaw() !== null
      if (event === 'SIGNED_OUT' || endedUnseen) {
        // Sign-out, a refused refresh token or a deactivation: this device keeps nothing of theirs (owner rule).
        queryClient.clear()
        forgetRememberedUser()
        void forgetSavedQueries()
        void forgetDeviceCaptures({ keepShares: endedUnseen })
      }
      if (event === 'SIGNED_IN') setDeactivated(false)
    })
    return () => data.subscription.unsubscribe()
  }, [supabase, queryClient])

  // Signal is back: ask Auth for the session now (it refreshes a kept token) instead of waiting for its next tick.
  useEffect(() => {
    if (!supabase) return
    const nudge = () => void supabase.auth.getSession()
    window.addEventListener('online', nudge)
    return () => window.removeEventListener('online', nudge)
  }, [supabase])

  const userId = authSession?.user.id
  const query = useQuery({
    queryKey: [...KEY, userId],
    queryFn: () => resolveUser(userId as string),
    enabled: Boolean(userId),
    staleTime: 0,
    retry: (count, err) => count < LOOKUP_RETRIES && !isAuthRefusal(err),
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: 'always',
  })

  // Re-check on focus and soon after any data request.
  useEffect(() => {
    if (!userId) return
    const recheck = () => void queryClient.refetchQueries({ queryKey: [...KEY, userId] })
    let last = 0
    const stop = onApiActivity(() => {
      const now = Date.now()
      if (now - last < ACTIVITY_RECHECK_MS) return
      last = now
      recheck()
    })
    // A data request refused for the token itself: check now, not on the next tick (HW-45), so the shell goes at once.
    const stopRefused = onSessionRefused(recheck)
    window.addEventListener('focus', recheck)
    return () => {
      stop()
      stopRefused()
      window.removeEventListener('focus', recheck)
    }
  }, [userId, queryClient])

  const live = query.data?.user ?? null
  useEffect(() => {
    if (live) rememberUser(live)
  }, [live])

  // The saved query cache is restored only once the server has confirmed the session (owner rule: a deactivated
  // person's phone shows nothing). Offline, the shell opens from the remembered person with no saved data.
  const liveId = live?.id ?? null
  useEffect(() => {
    if (liveId) void startQueryPersistence(queryClient, liveId)
  }, [liveId, queryClient])

  // The server refusing the token itself (JWT invalid or expired past refresh, permission refused) ends the session
  // and wipes the device like a deactivation. A network failure does not.
  const refused = isAuthRefusal(query.error)
  useEffect(() => {
    if (!refused || !supabase) return
    // local: the server already ended this session; only this device's copy is left to clear
    void forgetDeviceCaptures().finally(() => void supabase.auth.signOut({ scope: 'local' }))
  }, [refused, supabase])

  const deactivated = Boolean(userId) && query.data?.user === null
  useEffect(() => {
    if (!deactivated || !supabase) return
    setDeactivated(true)
    void forgetDeviceCaptures().finally(() => void supabase.auth.signOut({ scope: 'local' }))
  }, [deactivated, supabase])

  // Read on each render: both are small, and both change only around the auth events that re-render this provider.
  const stored = supabase ? storedSessionUserId() : null
  const keptRaw = supabase ? rememberedUserRaw() : null
  const kept = useMemo(() => parseRememberedUser(keptRaw), [keptRaw])
  const confirming = Boolean(stored) && (authSession === undefined || (Boolean(authSession) && !query.data))
  const slow = useElapsed(confirming, SLOW_SESSION_MS)

  const decision = useMemo((): Decision => {
    const signedOut = (notice: SignInNotice): Decision => ({ state: { status: 'signed-out' }, notice, connection: online ? 'online' : 'offline', fromMemory: false })
    if (!supabase) return signedOut('unconfigured')
    const away: Connection = online ? 'reconnecting' : 'offline'
    const owner = userId ?? stored
    const remembered = kept && owner && kept.id === owner ? kept : null
    const fromMemory = (): Decision =>
      remembered
        ? { state: { status: 'signed-in', user: remembered }, notice: null, connection: away, fromMemory: true }
        : { state: { status: 'loading' }, notice: null, connection: away, fromMemory: false }

    if (authSession === undefined) return stored && (!online || slow) ? fromMemory() : LOADING
    if (authSession === null) {
      // Kept on this device after a refresh that failed for lack of signal: still signed in.
      if (stored) return fromMemory()
      return signedOut(signedOutForDeactivation ? 'deactivated' : null)
    }
    if (query.data?.user) return { state: { status: 'signed-in', user: query.data.user }, notice: null, connection: online ? 'online' : 'offline', fromMemory: false }
    if (query.data && query.data.user === null) return signedOut('deactivated')
    if (query.isError && isAuthRefusal(query.error)) return signedOut(null)
    if (query.isError || !online || slow) return fromMemory()
    return LOADING
  }, [supabase, authSession, query.data, query.isError, query.error, signedOutForDeactivation, online, slow, stored, kept, userId])

  // No live token: hold every query (they would go out anonymous) until Auth confirms the session.
  const hold = decision.state.status === 'signed-in' && decision.fromMemory && !authSession
  useEffect(() => {
    holdNetwork(hold)
    return () => holdNetwork(false)
  }, [hold])

  // The saved query cache belongs to whoever the shell is showing; a different person empties it.
  const cacheOwner = decision.state.status === 'signed-in' ? decision.state.user.id : null
  useEffect(() => {
    setCacheOwner(cacheOwner)
  }, [cacheOwner])

  return (
    <SessionContext.Provider value={decision.state}>
      <SignInNoticeContext.Provider value={decision.notice}>
        <ConnectionContext.Provider value={decision.connection}>{children}</ConnectionContext.Provider>
      </SignInNoticeContext.Provider>
    </SessionContext.Provider>
  )
}
