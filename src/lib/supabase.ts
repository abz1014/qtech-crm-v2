import type { Database } from '@/types/database'
import { createLeanClient, type LeanSupabaseClient } from '@/lib/supabaseClient'
import { whenContentDrawn } from '@/lib/afterContent'

/*
 * The one browser Supabase client. It carries the anon key only (public by design; Row Level
 * Security is the access control). Never put a service-role key in a VITE_ variable.
 *
 * `getSupabase()` returns null when the URL or key is missing (a dev checkout without .env.local,
 * unit tests), so the app can still render the sign-in screen with a clear message.
 */
/** supabase-js's client type, narrowed to the parts the app uses (no Realtime: supabaseClient.ts). */
export type AppSupabase = LeanSupabaseClient<Database>

let client: AppSupabase | null | undefined

const listeners = new Set<() => void>()
const refusedListeners = new Set<() => void>()

/** Called after every data request (not the session lookup itself) so the session can be re-checked soon after. */
export function onApiActivity(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/**
 * Called at once when the API refuses the token itself (HTTP 401: the session was ended by Reset password, Deactivate or a
 * sign-out elsewhere; supabase/migrations/0085_session_cutoff.sql), so the app signs out and wipes the device now (HW-17, HW-45).
 */
export function onSessionRefused(cb: () => void): () => void {
  refusedListeners.add(cb)
  return () => refusedListeners.delete(cb)
}

/** The session lookups must not trigger themselves. */
function isSessionLookup(url: string): boolean {
  return url.includes('/rest/v1/users') || url.includes('/rpc/current_user_role') || url.includes('/auth/v1/')
}

const activityFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init)
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url.includes('/rest/v1/') && !isSessionLookup(url)) listeners.forEach((l) => l())
  // Not for the session lookups themselves: the re-check they would trigger is the one already running (it would cancel itself).
  if (res.status === 401 && url.includes('/rest/v1/') && !isSessionLookup(url)) refusedListeners.forEach((l) => l())
  return res
}

/*
 * perf/lcp: on Vercel, database reads and writes go to this site's own /rest/v1/, which vercel.json forwards to the Supabase
 * project (a rewrite). A phone then opens one connection instead of two, and a request needs no CORS preflight (a cross-origin
 * request with an Authorization header waits a whole extra round trip for one), so a page's data arrives a round trip or two
 * sooner on a slow connection. Auth, storage and edge functions still go to Supabase itself. Set at build time
 * (vite.config.ts: on Vercel, or E2E_SAME_ORIGIN_REST=1 for the perf suite, whose preview server forwards the same way).
 */
declare const __REST_SAME_ORIGIN__: boolean | undefined
const sameOriginRest = typeof __REST_SAME_ORIGIN__ === 'boolean' && __REST_SAME_ORIGIN__ && typeof window !== 'undefined'

export function getSupabase(): AppSupabase | null {
  if (client !== undefined) return client
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  // A phone that keeps a fresh session fetches Auth once the opening page is drawn (lazyAuth.ts, afterContent.ts: perf/lcp).
  client =
    url && key
      ? createLeanClient<Database>(url, key, { fetch: activityFetch, deferAuth: whenContentDrawn, restOrigin: sameOriginRest ? window.location.origin : undefined })
      : null
  return client
}

/*
 * R01 additions (the data layer). Everything above is A03's client, unchanged.
 *
 * Feature code does not call getSupabase() directly. It goes through its feature's api module
 * (src/features/<area>/api.ts), which uses requireSupabase(): a call that needs the database fails
 * with a sentence a person can act on when the variables are missing, instead of a null dereference.
 */
export class SupabaseConfigError extends Error {
  constructor() {
    super('The app is not connected to its database yet. VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set.')
    this.name = 'SupabaseConfigError'
  }
}

export type Db = AppSupabase

export function requireSupabase(): Db {
  const db = getSupabase()
  if (!db) throw new SupabaseConfigError()
  return db
}

/** Tests only: swap in a fake client (or null to forget it). */
export function setSupabaseForTests(next: Db | null): void {
  client = next
}

/**
 * Unwrap a PostgREST result. A failure is thrown as the PostgREST error object as it is
 * ({ code, message, details }) so `mapPgError` can turn it into a plain sentence.
 */
export function unwrap<T>(res: { data: T | null; error: { code?: string; message: string } | null }): T {
  if (res.error) throw res.error
  return res.data as T
}

/** PostgREST returns at most 1000 rows per request (config.toml max_rows). Read a longer list in pages. */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { code?: string; message: string } | null }>,
): Promise<T[]> {
  const size = 1000
  const out: T[] = []
  for (let from = 0; ; from += size) {
    const rows = unwrap(await page(from, from + size - 1)) ?? []
    out.push(...rows)
    if (rows.length < size) return out
  }
}
