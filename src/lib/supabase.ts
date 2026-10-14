import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/*
 * The one browser Supabase client. It carries the anon key only (public by design; Row Level
 * Security is the access control). Never put a service-role key in a VITE_ variable.
 *
 * `getSupabase()` returns null when the URL or key is missing (a dev checkout without .env.local,
 * unit tests), so the app can still render the sign-in screen with a clear message.
 */
export type AppSupabase = SupabaseClient<Database>

let client: AppSupabase | null | undefined

const listeners = new Set<() => void>()

/** Called after every data request (not the session lookup itself) so the session can be re-checked soon after. */
export function onApiActivity(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** The session lookups must not trigger themselves. */
function isSessionLookup(url: string): boolean {
  return url.includes('/rest/v1/users') || url.includes('/rpc/current_user_role') || url.includes('/auth/v1/')
}

const activityFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init)
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url.includes('/rest/v1/') && !isSessionLookup(url)) listeners.forEach((l) => l())
  return res
}

export function getSupabase(): AppSupabase | null {
  if (client !== undefined) return client
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  client = url && key ? createClient<Database>(url, key, { global: { fetch: activityFetch } }) : null
  return client
}
