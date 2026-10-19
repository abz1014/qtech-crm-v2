import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { SessionContext, SignInNoticeContext, type SessionState, type SessionUser, type SignInNotice } from '@/app/session'
import { getSupabase, onApiActivity } from '@/lib/supabase'
import { forgetDeviceCaptures } from '@/lib/capture/forget'

/** A person who is signed in to Auth but has no active users row has been deactivated (or never set up). */
type Resolved = { user: SessionUser } | { user: null }

const KEY = ['session', 'user'] as const

/** Re-check the account at most this often after ordinary data requests. */
const ACTIVITY_RECHECK_MS = 5_000
/** And on a timer, so an idle tab notices too. */
const POLL_MS = 60_000

async function resolveUser(userId: string): Promise<Resolved> {
  const supabase = getSupabase()
  if (!supabase) throw new Error('Supabase is not configured')
  // Both calls go through RLS. A deactivated person gets null from current_user_role() and no users row.
  const [row, role] = await Promise.all([
    supabase.from('users').select('id, name').eq('id', userId).maybeSingle(),
    supabase.rpc('current_user_role'),
  ])
  if (role.error) throw role.error
  if (row.error) throw row.error
  if (!role.data || !row.data) return { user: null }
  return { user: { id: row.data.id, name: row.data.name, role: role.data } }
}

/**
 * The real session: Supabase Auth, then the users row and current_user_role() through TanStack
 * Query. Re-resolved on focus, on a timer and soon after data requests, so a deactivated person is
 * signed out on their next request instead of waiting for the access token to expire.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = getSupabase()
  const queryClient = useQueryClient()
  // undefined = Auth has not reported yet
  const [authSession, setAuthSession] = useState<Session | null | undefined>(supabase ? undefined : null)
  const [signedOutForDeactivation, setDeactivated] = useState(false)

  useEffect(() => {
    if (!supabase) return
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      // Only set state here: calling Supabase from inside this callback can deadlock.
      setAuthSession(next)
      if (event === 'SIGNED_OUT') {
        queryClient.clear()
      }
      if (event === 'SIGNED_IN') setDeactivated(false)
    })
    return () => data.subscription.unsubscribe()
  }, [supabase, queryClient])

  const userId = authSession?.user.id
  const query = useQuery({
    queryKey: [...KEY, userId],
    queryFn: () => resolveUser(userId as string),
    enabled: Boolean(userId),
    staleTime: 0,
    retry: 1,
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
    window.addEventListener('focus', recheck)
    return () => {
      stop()
      window.removeEventListener('focus', recheck)
    }
  }, [userId, queryClient])

  const deactivated = Boolean(userId) && query.data?.user === null
  useEffect(() => {
    if (!deactivated || !supabase) return
    setDeactivated(true)
    void forgetDeviceCaptures().finally(() => void supabase.auth.signOut())
  }, [deactivated, supabase])

  const { state, notice } = useMemo((): { state: SessionState; notice: SignInNotice } => {
    if (!supabase) return { state: { status: 'signed-out' }, notice: 'unconfigured' }
    if (authSession === undefined) return { state: { status: 'loading' }, notice: null }
    if (authSession === null) return { state: { status: 'signed-out' }, notice: signedOutForDeactivation ? 'deactivated' : null }
    if (query.data?.user) return { state: { status: 'signed-in', user: query.data.user }, notice: null }
    if (query.data && query.data.user === null) return { state: { status: 'signed-out' }, notice: 'deactivated' }
    if (query.isError) return { state: { status: 'signed-out' }, notice: 'unreachable' }
    return { state: { status: 'loading' }, notice: null }
  }, [supabase, authSession, query.data, query.isError, signedOutForDeactivation])

  return (
    <SessionContext.Provider value={state}>
      <SignInNoticeContext.Provider value={notice}>{children}</SignInNoticeContext.Provider>
    </SessionContext.Provider>
  )
}
