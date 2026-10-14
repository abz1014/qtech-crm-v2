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
